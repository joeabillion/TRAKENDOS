import { execSync, exec } from 'child_process';
import { EventLogger } from './eventLogger';
import Database from 'better-sqlite3';
import { v4 as uuidv4 } from 'uuid';
import * as fs from 'fs';
import * as path from 'path';

// ============================================================
// Types
// ============================================================

export type DriveRole = 'data' | 'parity' | 'parity2' | 'cache' | 'hot_spare' | 'unassigned';
export type ArrayMode = 'parity' | 'mirror' | 'stripe' | 'raid5' | 'raid6' | 'jbod';
export type ArrayState = 'stopped' | 'starting' | 'running' | 'degraded' | 'rebuilding' | 'stopping' | 'error';
export type ParityState = 'valid' | 'invalid' | 'building' | 'checking' | 'rebuilding' | 'none';
export type DriveHealth = 'healthy' | 'warning' | 'failing' | 'failed' | 'unknown';

export interface PhysicalDrive {
  id: string;
  device: string;           // /dev/sda, /dev/nvme0n1, etc.
  model: string;
  serial: string;
  size_bytes: number;
  size_human: string;
  transport: string;        // sata, nvme, usb, sas
  rpm: number;              // 0 = SSD
  temperature: number;
  health: DriveHealth;
  smart_passed: boolean;
  smart_data?: SmartData;
  role: DriveRole;
  slot?: number;            // array slot number (for data drives)
  filesystem?: string;
  mount_point?: string;
  usage_bytes?: number;
  spin_state: 'active' | 'standby' | 'unknown';
  power_on_hours: number;
  reallocated_sectors: number;
}

export interface SmartData {
  overall: string;
  temperature: number;
  power_on_hours: number;
  reallocated_sectors: number;
  pending_sectors: number;
  uncorrectable_sectors: number;
  read_error_rate: number;
  seek_error_rate: number;
  spin_retry_count: number;
  raw_attributes: Record<string, { id: number; value: number; worst: number; threshold: number; raw: number }>;
}

export interface ArrayConfig {
  id: string;
  name: string;
  mode: ArrayMode;
  state: ArrayState;
  parity_state: ParityState;
  created_at: number;
  last_parity_check?: number;
  next_parity_check?: number;
  parity_check_schedule: string;  // cron expression
  auto_start: boolean;
  spin_down_delay: number;        // minutes, 0 = never
  reconstruct_write: boolean;     // turbo write mode
  share_user_include: string;     // default share config
}

export interface ArrayDriveAssignment {
  drive_id: string;
  device: string;
  serial: string;
  role: DriveRole;
  slot: number;
  added_at: number;
  status: 'active' | 'missing' | 'disabled' | 'rebuilding' | 'new' | 'error';
}

export interface ParityOperation {
  id: string;
  type: 'sync' | 'check' | 'rebuild' | 'correct';
  status: 'running' | 'paused' | 'completed' | 'failed' | 'cancelled';
  started_at: number;
  completed_at?: number;
  progress: number;          // 0-100
  speed_mbps: number;
  estimated_finish?: number;
  errors_found: number;
  errors_corrected: number;
  target_drive?: string;     // for rebuild: which drive is being rebuilt
}

export interface Share {
  id: string;
  name: string;
  path: string;
  pool: 'array' | 'cache' | 'specific';
  specific_drives?: string[];
  use_cache: 'yes' | 'no' | 'prefer' | 'only';
  min_free_space: string;    // e.g., "50GB"
  split_level: number;       // 0-5, how deep to allow dir splitting
  allocation_method: 'highwater' | 'fillup' | 'mostfree';
  export_nfs: boolean;
  export_smb: boolean;
  nfs_rule?: string;
  smb_security?: 'public' | 'secure' | 'private';
}

// ============================================================
// Array Service
// ============================================================

export class ArrayService {
  private db: Database.Database;
  private logger: EventLogger;
  private drives: Map<string, PhysicalDrive> = new Map();
  private arrayConfig: ArrayConfig;
  private parityOp?: ParityOperation;
  private spinDownTimers: Map<string, NodeJS.Timeout> = new Map();

  constructor(db: Database.Database, logger: EventLogger) {
    this.db = db;
    this.logger = logger;
    this.initializeTables();
    this.arrayConfig = this.loadArrayConfig();
  }

  // ──────────────────────────────────────────────────────
  // Database setup
  // ──────────────────────────────────────────────────────

  private initializeTables(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS array_config (
        id TEXT PRIMARY KEY DEFAULT 'default',
        name TEXT NOT NULL DEFAULT 'Trakend Array',
        mode TEXT NOT NULL DEFAULT 'parity',
        state TEXT NOT NULL DEFAULT 'stopped',
        parity_state TEXT NOT NULL DEFAULT 'none',
        created_at INTEGER NOT NULL,
        last_parity_check INTEGER,
        next_parity_check INTEGER,
        parity_check_schedule TEXT DEFAULT '0 2 1 * *',
        auto_start INTEGER DEFAULT 1,
        spin_down_delay INTEGER DEFAULT 30,
        reconstruct_write INTEGER DEFAULT 0,
        share_user_include TEXT DEFAULT 'all'
      );

      CREATE TABLE IF NOT EXISTS array_drives (
        drive_id TEXT PRIMARY KEY,
        device TEXT NOT NULL,
        serial TEXT NOT NULL,
        role TEXT NOT NULL DEFAULT 'unassigned',
        slot INTEGER DEFAULT 0,
        added_at INTEGER NOT NULL,
        status TEXT NOT NULL DEFAULT 'active'
      );

      CREATE TABLE IF NOT EXISTS array_shares (
        id TEXT PRIMARY KEY,
        name TEXT UNIQUE NOT NULL,
        path TEXT NOT NULL,
        pool TEXT DEFAULT 'array',
        specific_drives TEXT,
        use_cache TEXT DEFAULT 'no',
        min_free_space TEXT DEFAULT '50GB',
        split_level INTEGER DEFAULT 1,
        allocation_method TEXT DEFAULT 'highwater',
        export_nfs INTEGER DEFAULT 0,
        export_smb INTEGER DEFAULT 1,
        nfs_rule TEXT,
        smb_security TEXT DEFAULT 'secure'
      );

      CREATE TABLE IF NOT EXISTS parity_history (
        id TEXT PRIMARY KEY,
        type TEXT NOT NULL,
        status TEXT NOT NULL,
        started_at INTEGER NOT NULL,
        completed_at INTEGER,
        duration_seconds INTEGER,
        errors_found INTEGER DEFAULT 0,
        errors_corrected INTEGER DEFAULT 0,
        speed_avg_mbps REAL,
        target_drive TEXT
      );

      CREATE TABLE IF NOT EXISTS drive_smart_history (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        drive_serial TEXT NOT NULL,
        timestamp INTEGER NOT NULL,
        temperature INTEGER,
        reallocated_sectors INTEGER,
        pending_sectors INTEGER,
        power_on_hours INTEGER,
        smart_passed INTEGER,
        health TEXT
      );

      CREATE INDEX IF NOT EXISTS idx_smart_serial ON drive_smart_history(drive_serial, timestamp);
    `);

    // Migration: stable identity for drives. /dev/sdX letters change between boots and
    // USB enclosures report one serial for every bay, so we persist the filesystem UUID
    // (or PARTUUID for parity drives with no filesystem) and resolve the device from it.
    try { this.db.exec('ALTER TABLE array_drives ADD COLUMN fs_uuid TEXT'); } catch { /* exists */ }
    try { this.db.exec('ALTER TABLE array_drives ADD COLUMN part_uuid TEXT'); } catch { /* exists */ }
  }

  // ──────────────────────────────────────────────────────
  // Stable device identity (UUID) helpers
  // ──────────────────────────────────────────────────────

  /** True if `target` is a mountpoint (any number of stacked mounts). */
  private isMountpoint(target: string): boolean {
    try {
      const out = execSync(`findmnt -n -o TARGET "${target}" 2>/dev/null`, { encoding: 'utf-8' });
      return out.split('\n').map(s => s.trim()).includes(target);
    } catch { return false; }
  }

  /** Every target where a source device is currently mounted. */
  private mountTargetsOf(source: string): string[] {
    try {
      return execSync(`findmnt -n -o TARGET "${source}" 2>/dev/null`, { encoding: 'utf-8' })
        .split('\n').map(s => s.trim()).filter(Boolean);
    } catch { return []; }
  }

  /** First partition of a disk (handles sda1, nvme0n1p1, mmcblk0p1), or the disk itself. */
  private getMountablePartition(device: string): string {
    try {
      const out = execSync(`lsblk -ln -o NAME,TYPE "${device}" 2>/dev/null`, { encoding: 'utf-8' });
      const parts = out.trim().split('\n').map(l => l.trim().split(/\s+/)).filter(p => p[1] === 'part');
      if (parts.length > 0) return `/dev/${parts[0][0]}`;
    } catch { /* fall through */ }
    return device;
  }

  /** Filesystem UUID + PARTUUID for a disk's mountable partition. */
  private getDeviceUuids(device: string): { fs_uuid: string; part_uuid: string } {
    const partDev = this.getMountablePartition(device);
    const read = (tag: string, dev: string) => {
      try { return execSync(`blkid -s ${tag} -o value "${dev}" 2>/dev/null`, { encoding: 'utf-8' }).trim(); } catch { return ''; }
    };
    return {
      fs_uuid: read('UUID', partDev) || read('UUID', device),
      part_uuid: read('PARTUUID', partDev),
    };
  }

  /** Resolve {disk, part} device paths from a stored UUID. Empty strings if not present. */
  private resolveDeviceByUuid(fsUuid?: string | null, partUuid?: string | null): { disk: string; part: string } {
    const tryLink = (dir: string, id: string) => {
      try {
        const p = `${dir}/${id}`;
        if (!fs.existsSync(p)) return null;
        const part = fs.realpathSync(p); // e.g. /dev/sdc1 or /dev/nvme1n1p4
        const pk = execSync(`lsblk -no PKNAME "${part}" 2>/dev/null`, { encoding: 'utf-8' }).trim();
        return { disk: pk ? `/dev/${pk}` : part, part };
      } catch { return null; }
    };
    if (fsUuid) { const d = tryLink('/dev/disk/by-uuid', fsUuid); if (d) return d; }
    if (partUuid) { const d = tryLink('/dev/disk/by-partuuid', partUuid); if (d) return d; }
    return { disk: '', part: '' };
  }

  /**
   * Before scanning, walk every assignment and fix its stored /dev path using the UUID.
   * This is what makes the array survive drive re-lettering and duplicate USB serials.
   */
  private reconcileAssignedDevices(): void {
    const rows = this.db.prepare('SELECT drive_id, device, serial, fs_uuid, part_uuid FROM array_drives').all() as any[];
    for (const row of rows) {
      // Backfill UUIDs for legacy rows that only have a /dev path
      if (!row.fs_uuid && !row.part_uuid && row.device && fs.existsSync(row.device)) {
        const ids = this.getDeviceUuids(row.device);
        if (ids.fs_uuid || ids.part_uuid) {
          this.db.prepare('UPDATE array_drives SET fs_uuid = ?, part_uuid = ? WHERE drive_id = ?')
            .run(ids.fs_uuid || null, ids.part_uuid || null, row.drive_id);
          row.fs_uuid = ids.fs_uuid; row.part_uuid = ids.part_uuid;
          this.logger.info('ARRAY', `Recorded UUID for ${row.drive_id}: ${ids.fs_uuid || ids.part_uuid}`);
        }
        continue;
      }
      const { disk, part } = this.resolveDeviceByUuid(row.fs_uuid, row.part_uuid);
      if (!disk) continue;
      // Already pointing at this disk (either as whole disk or as its partition, e.g. the
      // OS /data partition /dev/nvme1n1p4) — nothing to do. Never rewrite a partition row
      // to its parent disk: that would make slot 1 look like the whole OS drive.
      if (row.device === disk || row.device === part) continue;
      // Keep the same granularity the row was created with
      let rowIsPartition = false;
      try { rowIsPartition = execSync(`lsblk -dno TYPE "${row.device}" 2>/dev/null`, { encoding: 'utf-8' }).trim() === 'part'; } catch { rowIsPartition = /p\d+$|[a-z]\d+$/.test(row.device) && !fs.existsSync(row.device); }
      const resolved = rowIsPartition ? part : disk;
      if (resolved && resolved !== row.device) {
        this.logger.warn('ARRAY', `Drive ${row.drive_id} moved: ${row.device} → ${resolved} (matched by UUID)`);
        this.db.prepare('UPDATE array_drives SET device = ? WHERE drive_id = ?').run(resolved, row.drive_id);
      }
    }
  }

  private loadArrayConfig(): ArrayConfig {
    const row = this.db.prepare('SELECT * FROM array_config WHERE id = ?').get('default') as any;
    if (row) {
      return {
        id: row.id,
        name: row.name,
        mode: row.mode,
        state: row.state,
        parity_state: row.parity_state,
        created_at: row.created_at,
        last_parity_check: row.last_parity_check,
        next_parity_check: row.next_parity_check,
        parity_check_schedule: row.parity_check_schedule,
        auto_start: !!row.auto_start,
        spin_down_delay: row.spin_down_delay,
        reconstruct_write: !!row.reconstruct_write,
        share_user_include: row.share_user_include,
      };
    }

    // Create default config
    const config: ArrayConfig = {
      id: 'default',
      name: 'Trakend Array',
      mode: 'parity',
      state: 'stopped',
      parity_state: 'none',
      created_at: Date.now(),
      parity_check_schedule: '0 2 1 * *', // 2am on the 1st of every month
      auto_start: true,
      spin_down_delay: 30,
      reconstruct_write: false,
      share_user_include: 'all',
    };

    this.db.prepare(`
      INSERT INTO array_config (id, name, mode, state, parity_state, created_at,
        parity_check_schedule, auto_start, spin_down_delay, reconstruct_write, share_user_include)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(config.id, config.name, config.mode, config.state, config.parity_state,
      config.created_at, config.parity_check_schedule, config.auto_start ? 1 : 0,
      config.spin_down_delay, config.reconstruct_write ? 1 : 0, config.share_user_include);

    return config;
  }

  private saveArrayConfig(): void {
    this.db.prepare(`
      UPDATE array_config SET
        name = ?, mode = ?, state = ?, parity_state = ?,
        last_parity_check = ?, next_parity_check = ?,
        parity_check_schedule = ?, auto_start = ?,
        spin_down_delay = ?, reconstruct_write = ?,
        share_user_include = ?
      WHERE id = ?
    `).run(
      this.arrayConfig.name, this.arrayConfig.mode, this.arrayConfig.state,
      this.arrayConfig.parity_state, this.arrayConfig.last_parity_check || null,
      this.arrayConfig.next_parity_check || null, this.arrayConfig.parity_check_schedule,
      this.arrayConfig.auto_start ? 1 : 0, this.arrayConfig.spin_down_delay,
      this.arrayConfig.reconstruct_write ? 1 : 0, this.arrayConfig.share_user_include,
      this.arrayConfig.id
    );
  }

  // ──────────────────────────────────────────────────────
  // Drive detection and SMART
  // ──────────────────────────────────────────────────────

  async scanDrives(): Promise<PhysicalDrive[]> {
    const drives: PhysicalDrive[] = [];

    // Fix stale /dev paths first so the device-path match below is trustworthy
    try { this.reconcileAssignedDevices(); } catch (e) { this.logger.warn('ARRAY', `UUID reconcile failed: ${e}`); }

    try {
      // Get block device list
      const lsblkOutput = execSync(
        'lsblk -d -b -n -o NAME,SIZE,TYPE,TRAN,MODEL,SERIAL,ROTA,MOUNTPOINT -J 2>/dev/null || lsblk -d -b -n -o NAME,SIZE,TYPE,TRAN,MODEL,SERIAL',
        { encoding: 'utf-8', timeout: 10000 }
      );

      let devices: any[] = [];
      try {
        const parsed = JSON.parse(lsblkOutput);
        devices = parsed.blockdevices || [];
      } catch {
        // Fallback: parse line-by-line
        const lines = lsblkOutput.trim().split('\n');
        for (const line of lines) {
          const parts = line.trim().split(/\s+/);
          if (parts.length >= 3 && parts[2] === 'disk') {
            devices.push({
              name: parts[0],
              size: parseInt(parts[1]) || 0,
              type: parts[2],
              tran: parts[3] || '',
              model: parts[4] || 'Unknown',
              serial: parts[5] || '',
              rota: parts[6] === '1',
            });
          }
        }
      }

      // Get the OS root device to exclude it
      let rootDev = '';
      try {
        rootDev = execSync('findmnt -n -o SOURCE / 2>/dev/null', { encoding: 'utf-8' })
          .trim().replace(/[0-9]*$/, '').replace(/p[0-9]*$/, '');
        rootDev = path.basename(rootDev);
      } catch { /* ignore */ }

      for (const dev of devices) {
        if (dev.type !== 'disk') continue;
        if (dev.name === rootDev) continue;
        if (dev.name.startsWith('loop')) continue;
        if (dev.size < 1073741824) continue; // Skip < 1GB

        const devPath = `/dev/${dev.name}`;
        const smart = await this.getSmartData(devPath);

        // Check existing assignment — prefer device path match over serial match
        // (USB enclosures can report the same serial for multiple drives)
        // reconcileAssignedDevices() already rewrote stale paths from UUIDs, so a device-path
        // match is authoritative. Never fall back to serial alone (USB bays share serials).
        const assignment = this.db.prepare(
          'SELECT * FROM array_drives WHERE device = ?'
        ).get(devPath) as any;

        // Unassigned drives get an id that is unique per physical device even when the
        // enclosure reports a duplicate serial (serial + kernel name).
        const unassignedId = dev.serial
          ? (drives.some(d => d.serial === (dev.serial || '').trim()) ? `${dev.serial}-${dev.name}` : dev.serial)
          : `drive-${dev.name}`;

        const drive: PhysicalDrive = {
          id: assignment?.drive_id || unassignedId,
          device: devPath,
          model: (dev.model || 'Unknown').trim(),
          serial: (dev.serial || '').trim(),
          size_bytes: dev.size || 0,
          size_human: this.formatBytes(dev.size || 0),
          transport: (dev.tran || 'unknown').toLowerCase(),
          rpm: dev.rota ? 7200 : 0, // Approximate; SMART has real value
          temperature: smart?.temperature || 0,
          health: this.assessHealth(smart),
          smart_passed: smart?.overall === 'PASSED',
          smart_data: smart || undefined,
          role: assignment?.role || 'unassigned',
          slot: assignment?.slot || 0,
          filesystem: this.getFilesystem(devPath),
          mount_point: this.getMountPoint(devPath),
          spin_state: 'active',
          power_on_hours: smart?.power_on_hours || 0,
          reallocated_sectors: smart?.reallocated_sectors || 0,
        };

        // Estimate usage
        if (drive.mount_point) {
          try {
            const dfOut = execSync(`df -B1 "${drive.mount_point}" 2>/dev/null | tail -1`, { encoding: 'utf-8' });
            const parts = dfOut.trim().split(/\s+/);
            drive.usage_bytes = parseInt(parts[2]) || 0;
          } catch { /* ignore */ }
        }

        drives.push(drive);
        this.drives.set(drive.id, drive);
      }

      // Include the OS drive's /data partition as usable storage
      if (rootDev) {
        try {
          const rootDevPath = `/dev/${rootDev}`;
          // Find the data partition (partition 4, labeled TRAKEND_DATA, mounted at /data)
          let dataPart = '';
          try {
            dataPart = execSync('findmnt -n -o SOURCE /data 2>/dev/null', { encoding: 'utf-8' }).trim();
          } catch { /* ignore */ }

          if (dataPart && fs.existsSync(dataPart)) {
            const smart = await this.getSmartData(rootDevPath);
            const rootDisk = devices.find((d: any) => d.name === rootDev);

            const assignment = this.db.prepare(
              'SELECT * FROM array_drives WHERE device = ?'
            ).get(dataPart) as any;

            // Get partition size from df
            let partSize = 0;
            let partUsed = 0;
            try {
              const dfOut = execSync(`df -B1 /data 2>/dev/null | tail -1`, { encoding: 'utf-8' });
              const parts = dfOut.trim().split(/\s+/);
              partSize = parseInt(parts[1]) || 0;
              partUsed = parseInt(parts[2]) || 0;
            } catch { /* ignore */ }

            const dataDrive: PhysicalDrive = {
              id: `${rootDisk?.serial || rootDev}-data`,
              device: dataPart,
              model: `${(rootDisk?.model || 'OS Drive').trim()} (Data Partition)`,
              serial: `${(rootDisk?.serial || '').trim()}-data`,
              size_bytes: partSize,
              size_human: this.formatBytes(partSize),
              transport: (rootDisk?.tran || 'nvme').toLowerCase(),
              rpm: rootDisk?.rota ? 7200 : 0,
              temperature: smart?.temperature || 0,
              health: this.assessHealth(smart),
              smart_passed: smart?.overall === 'PASSED',
              smart_data: smart || undefined,
              role: assignment?.role || 'unassigned',
              slot: assignment?.slot || 0,
              filesystem: 'ext4',
              mount_point: '/data',
              usage_bytes: partUsed,
              spin_state: 'active',
              power_on_hours: smart?.power_on_hours || 0,
              reallocated_sectors: smart?.reallocated_sectors || 0,
            };

            drives.push(dataDrive);
            this.drives.set(dataDrive.id, dataDrive);
          }
        } catch (error) {
          this.logger.debug('ARRAY', `Could not add OS data partition: ${error}`);
        }
      }

      // Record SMART history for tracked drives
      for (const drive of drives) {
        if (drive.smart_data && drive.serial) {
          this.recordSmartHistory(drive);
        }
      }

    } catch (error) {
      this.logger.error('ARRAY', `Drive scan failed: ${error}`);
    }

    return drives;
  }

  async getSmartData(device: string): Promise<SmartData | null> {
    try {
      const output = execSync(
        `smartctl -A -H -i "${device}" 2>/dev/null || true`,
        { encoding: 'utf-8', timeout: 15000 }
      );

      const data: SmartData = {
        overall: 'UNKNOWN',
        temperature: 0,
        power_on_hours: 0,
        reallocated_sectors: 0,
        pending_sectors: 0,
        uncorrectable_sectors: 0,
        read_error_rate: 0,
        seek_error_rate: 0,
        spin_retry_count: 0,
        raw_attributes: {},
      };

      // Parse health
      if (output.includes('PASSED')) data.overall = 'PASSED';
      else if (output.includes('FAILED')) data.overall = 'FAILED';

      // Parse attributes
      const attrRegex = /^\s*(\d+)\s+(\S+)\s+\S+\s+(\d+)\s+(\d+)\s+(\d+)\s+\S+\s+\S+\s+\S+\s+(\d+)/gm;
      let match;
      while ((match = attrRegex.exec(output)) !== null) {
        const id = parseInt(match[1]);
        const name = match[2];
        const value = parseInt(match[3]);
        const worst = parseInt(match[4]);
        const threshold = parseInt(match[5]);
        const raw = parseInt(match[6]);

        data.raw_attributes[name] = { id, value, worst, threshold, raw };

        switch (id) {
          case 194: case 190: data.temperature = raw; break;
          case 9: data.power_on_hours = raw; break;
          case 5: data.reallocated_sectors = raw; break;
          case 197: data.pending_sectors = raw; break;
          case 198: data.uncorrectable_sectors = raw; break;
          case 1: data.read_error_rate = raw; break;
          case 7: data.seek_error_rate = raw; break;
          case 10: data.spin_retry_count = raw; break;
        }
      }

      // NVMe: try different parsing
      if (output.includes('NVMe')) {
        const tempMatch = output.match(/Temperature:\s+(\d+)/);
        if (tempMatch) data.temperature = parseInt(tempMatch[1]);
        const hoursMatch = output.match(/Power On Hours:\s+(\d[\d,]*)/);
        if (hoursMatch) data.power_on_hours = parseInt(hoursMatch[1].replace(/,/g, ''));
      }

      return data;
    } catch {
      return null;
    }
  }

  private assessHealth(smart: SmartData | null): DriveHealth {
    if (!smart) return 'unknown';
    if (smart.overall === 'FAILED') return 'failed';
    if (smart.reallocated_sectors > 100 || smart.uncorrectable_sectors > 10) return 'failing';
    if (smart.reallocated_sectors > 0 || smart.pending_sectors > 0 || smart.temperature > 55) return 'warning';
    return 'healthy';
  }

  private recordSmartHistory(drive: PhysicalDrive): void {
    this.db.prepare(`
      INSERT INTO drive_smart_history (drive_serial, timestamp, temperature,
        reallocated_sectors, pending_sectors, power_on_hours, smart_passed, health)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      drive.serial, Date.now(), drive.temperature,
      drive.reallocated_sectors, drive.smart_data?.pending_sectors || 0,
      drive.power_on_hours, drive.smart_passed ? 1 : 0, drive.health
    );
  }

  private getFilesystem(device: string): string | undefined {
    try {
      // Check first partition
      const parts = execSync(`lsblk -ln -o NAME "${device}" | tail -n +2 | head -1`, { encoding: 'utf-8' }).trim();
      if (parts) {
        const partDev = `/dev/${parts}`;
        return execSync(`blkid -s TYPE -o value "${partDev}" 2>/dev/null`, { encoding: 'utf-8' }).trim() || undefined;
      }
      return execSync(`blkid -s TYPE -o value "${device}" 2>/dev/null`, { encoding: 'utf-8' }).trim() || undefined;
    } catch {
      return undefined;
    }
  }

  private getMountPoint(device: string): string | undefined {
    try {
      // Check whole device first
      try {
        const direct = execSync(`findmnt -n -o TARGET "${device}" 2>/dev/null`, { encoding: 'utf-8' }).trim();
        if (direct) return direct;
      } catch { /* not mounted as whole device */ }

      // Check partitions via lsblk — handles all naming conventions:
      // SATA: /dev/sda1, NVMe: /dev/nvme0n1p1, MMC: /dev/mmcblk0p1, etc.
      try {
        const firstPart = execSync(`lsblk -ln -o NAME "${device}" | tail -n +2 | head -1`, { encoding: 'utf-8' }).trim();
        if (firstPart) {
          const partMount = execSync(`findmnt -n -o TARGET "/dev/${firstPart}" 2>/dev/null`, { encoding: 'utf-8' }).trim();
          if (partMount) return partMount;
        }
      } catch { /* no partitions or not mounted */ }

      return undefined;
    } catch {
      return undefined;
    }
  }

  // ──────────────────────────────────────────────────────
  // Array management
  // ──────────────────────────────────────────────────────

  getArrayConfig(): ArrayConfig {
    return { ...this.arrayConfig };
  }

  updateArrayConfig(updates: Partial<ArrayConfig>): ArrayConfig {
    if (this.arrayConfig.state !== 'stopped' && (updates.mode || updates.name)) {
      throw new Error('Cannot change array mode or name while array is running. Stop the array first.');
    }

    Object.assign(this.arrayConfig, updates);
    this.saveArrayConfig();
    this.logger.info('ARRAY', 'Array configuration updated', updates);
    return this.arrayConfig;
  }

  async assignDrive(driveId: string, role: DriveRole, slot: number = 0): Promise<void> {
    if (this.arrayConfig.state !== 'stopped') {
      throw new Error('Cannot assign drives while array is running. Stop the array first.');
    }

    const drive = this.drives.get(driveId);
    if (!drive) throw new Error(`Drive ${driveId} not found. Run a drive scan first.`);

    // Validate assignments
    if (role === 'parity') {
      const existingParity = this.getAssignedDrives().filter(d => d.role === 'parity');
      if (existingParity.length > 0) throw new Error('A parity drive is already assigned. Remove it first or use parity2 for dual parity.');
    }
    if (role === 'parity2') {
      const existingParity = this.getAssignedDrives().filter(d => d.role === 'parity');
      if (existingParity.length === 0) throw new Error('You need a primary parity drive before adding a second parity drive.');
      const existingParity2 = this.getAssignedDrives().filter(d => d.role === 'parity2');
      if (existingParity2.length > 0) throw new Error('A secondary parity drive is already assigned.');
    }
    if (role === 'parity' || role === 'parity2') {
      // Parity drive must be >= largest data drive
      const dataDrives = this.getAssignedDrives().filter(d => d.role === 'data');
      const largestData = dataDrives.reduce((max, d) => {
        const driveInfo = this.drives.get(d.drive_id);
        return driveInfo && driveInfo.size_bytes > max ? driveInfo.size_bytes : max;
      }, 0);
      if (drive.size_bytes < largestData) {
        throw new Error(`Parity drive must be at least as large as the largest data drive (${this.formatBytes(largestData)}). This drive is ${drive.size_human}.`);
      }
    }

    // Auto-assign slot for data drives
    if (role === 'data' && slot === 0) {
      const dataDrives = this.getAssignedDrives().filter(d => d.role === 'data');
      slot = dataDrives.length + 1;
    }

    // Remove existing assignment if any
    this.db.prepare('DELETE FROM array_drives WHERE drive_id = ?').run(driveId);

    // Create new assignment
    const ids = this.getDeviceUuids(drive.device);
    this.db.prepare(`
      INSERT INTO array_drives (drive_id, device, serial, role, slot, added_at, status, fs_uuid, part_uuid)
      VALUES (?, ?, ?, ?, ?, ?, 'new', ?, ?)
    `).run(driveId, drive.device, drive.serial, role, slot, Date.now(), ids.fs_uuid || null, ids.part_uuid || null);

    drive.role = role;
    drive.slot = slot;

    this.logger.info('ARRAY', `Drive ${drive.device} (${drive.model}) assigned as ${role}`, { driveId, role, slot });
  }

  async unassignDrive(driveId: string): Promise<void> {
    if (this.arrayConfig.state !== 'stopped') {
      throw new Error('Cannot unassign drives while array is running.');
    }

    this.db.prepare('DELETE FROM array_drives WHERE drive_id = ?').run(driveId);

    const drive = this.drives.get(driveId);
    if (drive) {
      drive.role = 'unassigned';
      drive.slot = undefined;
    }

    this.logger.info('ARRAY', `Drive ${driveId} unassigned from array`);
  }

  getAssignedDrives(): ArrayDriveAssignment[] {
    return this.db.prepare('SELECT * FROM array_drives ORDER BY role, slot').all() as ArrayDriveAssignment[];
  }

  /**
   * Called once at process boot. Whatever state the DB persisted (running/starting/
   * stopping/error/rebuilding) is stale — nothing is mounted by us yet. Reset to
   * 'stopped' so startArray() performs a full reconcile instead of rejecting.
   */
  resetStateForBoot(): string {
    const prev = this.arrayConfig.state;
    this.arrayConfig.state = 'stopped';
    // A parity op cannot survive a restart; mark it so the UI doesn't show a ghost job
    if (this.arrayConfig.parity_state === 'building' || this.arrayConfig.parity_state === 'checking') {
      this.arrayConfig.parity_state = 'invalid';
      this.logger.warn('ARRAY', `Parity operation was interrupted by restart (was ${prev}) — parity marked invalid, re-run sync`);
    }
    this.saveArrayConfig();
    return prev;
  }

  // ──────────────────────────────────────────────────────
  // fstab ownership — the array is the single source of truth for its mounts
  // ──────────────────────────────────────────────────────

  private static readonly FSTAB_BEGIN = '# >>> TRAKEND ARRAY (managed — do not edit between markers) >>>';
  private static readonly FSTAB_END = '# <<< TRAKEND ARRAY <<<';

  /**
   * Rewrite the managed block in /etc/fstab with one UUID= line per mounted data/cache
   * drive at its slot path (nofail so a missing disk never blocks boot). Any pre-existing
   * line referencing the same UUID at a different path is removed — that is exactly the
   * legacy /mnt/disks/usb1-style entry that fought the array on this server.
   */
  private writeManagedFstab(): void {
    const fstabPath = '/etc/fstab';
    if (!fs.existsSync(fstabPath)) return;

    const assignments = this.getAssignedDrives() as any[];
    const managed: string[] = [];
    const ourUuids = new Set<string>();

    // The OS data partition must never be touched — resolve its device once.
    let dataSrc = '';
    try { dataSrc = execSync('findmnt -n -o SOURCE /data 2>/dev/null', { encoding: 'utf-8' }).trim().split('[')[0]; } catch { /* ignore */ }
    let dataReal = '';
    try { if (dataSrc) dataReal = fs.realpathSync(dataSrc); } catch { dataReal = dataSrc; }
    const isDataDevice = (dev: string) => {
      if (!dev || !dataReal) return false;
      try { return fs.realpathSync(dev) === dataReal; } catch { return dev === dataSrc; }
    };

    for (const a of assignments) {
      if (a.role !== 'data' && a.role !== 'cache') continue;
      const drive = this.drives.get(a.drive_id);
      if (!drive?.mount_point) continue;

      const mountPoint = a.role === 'cache' ? '/mnt/disks/cache' : `/mnt/disks/disk${a.slot}`;
      const partDev = this.getMountablePartition(drive.device);

      // Slot that IS the OS /data partition → bind entry, never a UUID line
      if (isDataDevice(partDev) || isDataDevice(drive.device)) {
        if (drive.mount_point === mountPoint) managed.push(`/data  ${mountPoint}  none  bind,nofail  0  0`);
        continue;
      }

      let uuid = a.fs_uuid || '';
      let fsType = '';
      try { if (!uuid) uuid = execSync(`blkid -s UUID -o value "${partDev}" 2>/dev/null`, { encoding: 'utf-8' }).trim(); } catch { /* ignore */ }
      try { fsType = execSync(`blkid -s TYPE -o value "${partDev}" 2>/dev/null`, { encoding: 'utf-8' }).trim(); } catch { /* ignore */ }
      if (!uuid || !fsType) continue;

      // Preserve a deliberate read-only mount
      let ro = false;
      try { ro = /(^|,)ro(,|$)/.test(execSync(`findmnt -n -o OPTIONS "${drive.mount_point}" 2>/dev/null`, { encoding: 'utf-8' }).trim()); } catch { /* ignore */ }

      ourUuids.add(uuid);
      managed.push(`UUID=${uuid}  ${mountPoint}  ${fsType}  ${ro ? 'ro' : 'defaults'},noatime,nofail,x-systemd.device-timeout=15  0  2`);
    }

    const original = fs.readFileSync(fstabPath, 'utf-8');
    const lines = original.split('\n');
    const out: string[] = [];
    let inBlock = false;
    const removed: string[] = [];

    for (const line of lines) {
      if (line.trim() === ArrayService.FSTAB_BEGIN) { inBlock = true; continue; }
      if (line.trim() === ArrayService.FSTAB_END) { inBlock = false; continue; }
      if (inBlock) continue; // drop old managed content

      // Drop unmanaged lines that point one of OUR disks at a /mnt path (legacy names like
      // /mnt/disks/usb1). Lines whose target is outside /mnt/ (/, /boot, /data, swap, binds)
      // are never removed, whatever their source.
      const t = line.trim();
      if (t && !t.startsWith('#')) {
        const cols = t.split(/\s+/);
        const src = cols[0] || '';
        const target = cols[1] || '';
        if (target.startsWith('/mnt/')) {
          const uuidMatch = src.startsWith('UUID=') && ourUuids.has(src.slice(5));
          const pathMatch = /^\/mnt\/disks\/(disk\d+|cache|usb\d+|disk\d+-[\w-]+)$/.test(target);
          if (uuidMatch || pathMatch) { removed.push(t); continue; }
        }
      }
      out.push(line);
    }

    while (out.length && out[out.length - 1].trim() === '') out.pop();
    out.push('', ArrayService.FSTAB_BEGIN, ...managed, ArrayService.FSTAB_END, '');

    const next = out.join('\n');
    if (next === original) return;

    fs.copyFileSync(fstabPath, `${fstabPath}.trakend.bak`);
    fs.writeFileSync(`${fstabPath}.tmp`, next, { mode: 0o644 });
    fs.renameSync(`${fstabPath}.tmp`, fstabPath);
    try { execSync('systemctl daemon-reload', { timeout: 15000 }); } catch { /* ignore */ }

    this.logger.info('ARRAY', `fstab updated: ${managed.length} managed mount(s)` + (removed.length ? `; removed ${removed.length} conflicting line(s)` : ''));
    for (const r of removed) this.logger.warn('ARRAY', `fstab: removed legacy entry → ${r}`);
  }

  // ──────────────────────────────────────────────────────
  // Runtime watchdog — a data drive dropping out must never go unnoticed
  // ──────────────────────────────────────────────────────

  private mountWatchdog?: NodeJS.Timeout;
  private watchdogFailStreak = 0;

  private startMountWatchdog(): void {
    this.stopMountWatchdog();
    this.watchdogFailStreak = 0;
    this.mountWatchdog = setInterval(() => this.checkMountsOnce(), 20000);
    this.mountWatchdog.unref();
  }

  private stopMountWatchdog(): void {
    if (this.mountWatchdog) { clearInterval(this.mountWatchdog); this.mountWatchdog = undefined; }
  }

  private checkMountsOnce(): void {
    if (this.arrayConfig.state !== 'running') return;
    const problems: string[] = [];
    for (const a of this.getAssignedDrives()) {
      if (a.role !== 'data') continue;
      const mp = `/mnt/disks/disk${a.slot}`;
      const drive = this.drives.get(a.drive_id);
      const devPresent = !!(drive?.device && fs.existsSync(drive.device)) || (!!a.device && fs.existsSync(a.device));
      let mounted = false;
      mounted = this.isMountpoint(mp);
      if (!devPresent) problems.push(`slot ${a.slot}: device ${drive?.device || a.device} disappeared`);
      else if (!mounted) problems.push(`slot ${a.slot}: ${mp} is no longer mounted`);
      if (drive) drive.mount_point = mounted ? mp : undefined;
    }

    if (problems.length === 0) { this.watchdogFailStreak = 0; return; }

    // Require two consecutive failures (40 s) to avoid flapping on a transient USB hiccup
    this.watchdogFailStreak++;
    if (this.watchdogFailStreak < 2) {
      this.logger.warn('ARRAY', `Mount check failed (will re-check): ${problems.join('; ')}`);
      return;
    }

    this.arrayConfig.state = 'error';
    this.saveArrayConfig();
    this.stopMountWatchdog();
    this.logger.error('ARRAY', `ARRAY FAULT — ${problems.join('; ')}. State set to ERROR. Fix the drive and start the array again.`);

    // Stop only the containers that use the failed slot paths, so their writes can't land
    // on the root filesystem. Containers on /data (web stack, DB, tunnel) keep running.
    const failedPaths = problems.map(p => p.match(/\/mnt\/disks\/disk\d+/)?.[0]).filter(Boolean) as string[];
    const failedSlots = problems.map(p => p.match(/slot (\d+)/)?.[1]).filter(Boolean).map(s => `/mnt/disks/disk${s}`);
    const affected = new Set([...failedPaths, ...failedSlots]);
    if (affected.size === 0) return;
    try {
      const out = execSync(`docker ps -q | xargs -r docker inspect -f '{{.Name}}|{{range .Mounts}}{{.Source}};{{end}}' 2>/dev/null`, { encoding: 'utf-8', timeout: 30000 });
      const toStop: string[] = [];
      for (const line of out.split('\n')) {
        const [name, mounts = ''] = line.split('|');
        if (!name) continue;
        if (mounts.split(';').some(src => [...affected].some(p => src === p || src.startsWith(p + '/')))) toStop.push(name.replace(/^\//, ''));
      }
      if (toStop.length) {
        execSync(`docker stop ${toStop.map(n => `"${n}"`).join(' ')} 2>/dev/null || true`, { timeout: 120000 });
        this.logger.warn('ARRAY', `Stopped containers using the failed disk: ${toStop.join(', ')}`);
      }
    } catch { /* docker down */ }
  }

  async startArray(): Promise<void> {
    if (this.arrayConfig.state === 'running') throw new Error('Array is already running.');

    // Always scan drives first so this.drives map is populated
    await this.scanDrives();

    const assignments = this.getAssignedDrives();
    const dataDrives = assignments.filter(d => d.role === 'data');
    const parityDrives = assignments.filter(d => d.role === 'parity' || d.role === 'parity2');

    if (dataDrives.length === 0) throw new Error('No data drives assigned. Add at least one data drive.');

    // Validate all assigned drives are present and log missing ones
    const missingDrives = assignments.filter(a => {
      const d = this.drives.get(a.drive_id);
      return !d || !fs.existsSync(d.device);
    });

    if (missingDrives.length > 0) {
      const missingList = missingDrives.map(d => d.drive_id).join(', ');
      this.logger.warn('ARRAY', `Missing drives detected: ${missingList}`);

      // Check if any missing drives are data drives
      const missingDataDrives = missingDrives.filter(d => d.role === 'data');
      if (missingDataDrives.length > 0) {
        this.logger.warn('ARRAY', `Starting array in DEGRADED mode — ${missingDataDrives.length} data drive(s) missing`);
      }

      // Check if parity is missing
      const missingParity = missingDrives.filter(d => d.role === 'parity' || d.role === 'parity2');
      if (missingParity.length > 0) {
        this.logger.warn('ARRAY', `NO PARITY PROTECTION — ${missingParity.length} parity drive(s) missing`);
      }
    }

    if (this.arrayConfig.mode === 'parity' && parityDrives.length === 0) {
      this.logger.warn('ARRAY', 'Starting array WITHOUT parity protection!');
    }

    this.arrayConfig.state = 'starting';
    this.saveArrayConfig();
    this.logger.info('ARRAY', `Starting array with ${dataDrives.length} data + ${parityDrives.length} parity drive(s)...`);

    try {
      // Prepare new drives — only format if they don't already have a filesystem
      for (const assignment of dataDrives) {
        if (assignment.status === 'new') {
          const drive = this.drives.get(assignment.drive_id);
          const existingFs = drive ? this.getFilesystem(drive.device) : '';
          if (existingFs) {
            // Drive already has a filesystem (e.g. from Unraid) — use it as-is
            this.logger.info('ARRAY', `${drive!.device} already has ${existingFs} filesystem — mounting as-is (no format)`);
            drive!.filesystem = existingFs;
          } else {
            await this.formatDriveForArray(assignment.drive_id);
          }
          this.db.prepare('UPDATE array_drives SET status = ? WHERE drive_id = ?').run('active', assignment.drive_id);
        }
      }

      // Mount all data drives
      let successfulMounts = 0;
      for (const assignment of dataDrives) {
        const drive = this.drives.get(assignment.drive_id);
        // Use device from drives map if available, otherwise fall back to DB device path
        const devicePath = drive?.device || assignment.device;
        if (!devicePath || !fs.existsSync(devicePath)) {
          this.logger.error('ARRAY', `Drive ${assignment.drive_id} (slot ${assignment.slot}) device ${devicePath} not found — skipping`);
          if (drive) drive.mount_point = undefined;
          // Update status to missing if it was mounted
          this.db.prepare('UPDATE array_drives SET status = ? WHERE drive_id = ?').run('missing', assignment.drive_id);
          continue;
        }

        const mountPoint = `/mnt/disks/disk${assignment.slot}`;
        fs.mkdirSync(mountPoint, { recursive: true });

        // Find the mountable partition (handles sdX1 / nvmeXn1p1 / whole-disk filesystems)
        const partDev = this.getMountablePartition(devicePath);

        this.logger.info('ARRAY', `Slot ${assignment.slot}: device=${devicePath} partDev=${partDev} driveMapHit=${!!drive}`);

        // Where is it mounted right now? (findmnt lists every mountpoint for a source)
        let currentMounts: string[] = [];
        try {
          currentMounts = execSync(`findmnt -n -o TARGET "${partDev}" 2>/dev/null`, { encoding: 'utf-8' })
            .split('\n').map(s => s.trim()).filter(Boolean);
        } catch { /* not mounted anywhere */ }

        if (currentMounts.includes(mountPoint)) {
          if (drive) drive.mount_point = mountPoint;
          successfulMounts++;
          this.logger.info('ARRAY', `${partDev} already mounted at ${mountPoint}`);
          // Same device also mounted at legacy paths (e.g. /mnt/disks/usb1 or a stale slot)?
          // Clear those if nobody is using them so one disk == one path.
          for (const extra of currentMounts.filter(m => m !== mountPoint && m.startsWith('/mnt/disks/'))) {
            try { execSync(`umount "${extra}"`, { timeout: 10000, stdio: 'pipe' }); this.logger.info('ARRAY', `Removed legacy mount of ${partDev} at ${extra}`); }
            catch { this.logger.warn('ARRAY', `${partDev} also mounted at ${extra} (busy) — will clear when free`); }
          }
          continue;
        }

        // Special case: the OS data partition (/data) is a valid array member but must never
        // be unmounted — bind-mount it to its slot path instead.
        let isDataPartition = currentMounts.includes('/data');
        if (!isDataPartition) {
          try {
            const dataSrc = execSync('findmnt -n -o SOURCE /data 2>/dev/null', { encoding: 'utf-8' }).trim().split('[')[0];
            isDataPartition = !!dataSrc && fs.realpathSync(dataSrc) === fs.realpathSync(partDev);
          } catch { /* ignore */ }
        }
        if (isDataPartition) {
          try {
            execSync(`mount --bind /data "${mountPoint}"`, { timeout: 10000 });
            if (drive) drive.mount_point = mountPoint;
            successfulMounts++;
            this.logger.info('ARRAY', `Slot ${assignment.slot} is the OS data partition — bind-mounted /data at ${mountPoint}`);
          } catch (err) {
            this.logger.error('ARRAY', `Failed to bind-mount /data at ${mountPoint}: ${err}`);
            if (drive) drive.mount_point = undefined;
          }
          continue;
        }

        // Mounted somewhere else (legacy path like /mnt/disks/usb1) — relocate to the slot path.
        // Remember if it was deliberately read-only so we don't flip it (and so the kernel
        // doesn't refuse a second rw mount of an ro superblock).
        let wasReadOnly = false;
        for (const cm of currentMounts) {
          try { wasReadOnly = wasReadOnly || /(^|,)ro(,|$)/.test(execSync(`findmnt -n -o OPTIONS "${cm}" 2>/dev/null`, { encoding: 'utf-8' }).trim()); } catch { /* ignore */ }
          this.logger.info('ARRAY', `${partDev} mounted at ${cm}, remounting to ${mountPoint}`);
          let unmounted = false;
          for (let attempt = 0; attempt < 3 && !unmounted; attempt++) {
            try { execSync(`umount "${cm}"`, { timeout: 10000, stdio: 'pipe' }); unmounted = true; }
            catch { try { execSync('sleep 1'); } catch { /* ignore */ } }
          }
          if (!unmounted) {
            let holders = '';
            try { holders = execSync(`fuser -vm "${cm}" 2>&1 | tail -n +2 | head -5`, { encoding: 'utf-8' }).trim(); } catch { /* ignore */ }
            // ext4/xfs allow the same device at two paths (shared superblock); the old path
            // goes away once its users close. Log the holders so the admin can see who.
            this.logger.warn('ARRAY', `${cm} is busy — mounting ${mountPoint} alongside it. Holders: ${holders || 'unknown'}`);
          }
        }

        // Get filesystem type for explicit mount
        let fsType = drive?.filesystem || '';
        if (!fsType) {
          try {
            fsType = execSync(`blkid -s TYPE -o value "${partDev}" 2>/dev/null`, { encoding: 'utf-8' }).trim();
          } catch { /* unknown */ }
        }

        // Mount with explicit fs type if known
        try {
          const opts = wasReadOnly ? 'ro,noatime' : 'noatime';
          const mountCmd = fsType
            ? `mount -t ${fsType} -o ${opts} "${partDev}" "${mountPoint}"`
            : `mount -o ${opts} "${partDev}" "${mountPoint}"`;
          execSync(mountCmd, { timeout: 10000 });
          if (drive) drive.mount_point = mountPoint;
          this.logger.info('ARRAY', `Mounted ${partDev} (${fsType || 'auto'}) at ${mountPoint}`);
          successfulMounts++;
        } catch (err) {
          this.logger.error('ARRAY', `Failed to mount ${partDev} at ${mountPoint}: ${err}`);
          if (drive) {
            drive.mount_point = undefined;
            // Update drive status to error if mount failed
            this.db.prepare('UPDATE array_drives SET status = ? WHERE drive_id = ?').run('error', assignment.drive_id);
          }
        }
      }

      // Mount cache drive if assigned
      const cacheDrives = assignments.filter(d => d.role === 'cache');
      for (const assignment of cacheDrives) {
        const drive = this.drives.get(assignment.drive_id);
        if (!drive) continue;

        const mountPoint = '/mnt/disks/cache';
        fs.mkdirSync(mountPoint, { recursive: true });

        const partDev = this.getMountablePartition(drive.device);

        // Check if already mounted
        try {
          const currentMount = execSync(`findmnt -n -o TARGET "${partDev}" 2>/dev/null`, { encoding: 'utf-8' }).trim().split('\n')[0];
          if (currentMount) {
            drive.mount_point = currentMount;
            this.logger.info('ARRAY', `Cache ${partDev} already mounted at ${currentMount}`);
            continue;
          }
        } catch { /* not mounted */ }

        try {
          execSync(`mount -o noatime "${partDev}" "${mountPoint}"`, { timeout: 10000 });
          drive.mount_point = mountPoint;
          this.logger.info('ARRAY', `Mounted cache ${partDev} at ${mountPoint}`);
        } catch (err) {
          this.logger.error('ARRAY', `Failed to mount cache ${partDev}: ${err}`);
        }
      }

      // Mount unassigned drives that have a filesystem (so ALL drives are always browsable)
      const assignedDevices = new Set(assignments.map(a => a.device));
      let unassignedSlot = 50; // Start unassigned drives at slot 50+ to avoid conflicts
      for (const [, drive] of this.drives) {
        if (assignedDevices.has(drive.device)) continue; // Skip assigned drives
        if (drive.mount_point) continue; // Already mounted
        if (drive.device.includes('nvme') && drive.device.includes('p')) continue; // Skip partitions listed as drives

        // Find a mountable partition
        let partDev = drive.device;
        try {
          const firstPart = execSync(`lsblk -ln -o NAME "${drive.device}" | tail -n +2 | head -1`, { encoding: 'utf-8' }).trim();
          if (firstPart) partDev = `/dev/${firstPart}`;
        } catch { /* use whole device */ }

        // Check if it has a filesystem
        let fsType = '';
        try {
          fsType = execSync(`blkid -s TYPE -o value "${partDev}" 2>/dev/null`, { encoding: 'utf-8' }).trim();
        } catch { /* no filesystem */ }
        if (!fsType) {
          // Try the whole device if partition check failed
          try {
            fsType = execSync(`blkid -s TYPE -o value "${drive.device}" 2>/dev/null`, { encoding: 'utf-8' }).trim();
            if (fsType) partDev = drive.device;
          } catch { /* no filesystem */ }
        }
        if (!fsType) continue; // No filesystem, skip (e.g. parity drive)

        // Check if already mounted somewhere
        try {
          const currentMount = execSync(`findmnt -n -o TARGET "${partDev}" 2>/dev/null`, { encoding: 'utf-8' }).trim();
          if (currentMount) {
            drive.mount_point = currentMount;
            this.logger.info('ARRAY', `Unassigned drive ${partDev} already mounted at ${currentMount}`);
            continue;
          }
        } catch { /* not mounted */ }

        // Mount to /mnt/disks/diskN with a high slot number
        const mountPoint = `/mnt/disks/disk${unassignedSlot}`;
        fs.mkdirSync(mountPoint, { recursive: true });
        try {
          const mountCmd = `mount -t ${fsType} "${partDev}" "${mountPoint}"`;
          execSync(mountCmd, { timeout: 10000 });
          drive.mount_point = mountPoint;
          this.logger.info('ARRAY', `Mounted unassigned drive ${partDev} (${fsType}) at ${mountPoint}`);
        } catch (err) {
          this.logger.warn('ARRAY', `Failed to mount unassigned drive ${partDev}: ${err}`);
        }
        unassignedSlot++;
      }

      // Check if parity is valid
      if (parityDrives.length > 0) {
        // Check for new parity drives that need initial sync
        const newParity = parityDrives.filter(p => {
          const existing = this.db.prepare('SELECT status FROM array_drives WHERE drive_id = ?').get(p.drive_id) as any;
          return existing?.status === 'new';
        });
        if (newParity.length > 0) {
          this.arrayConfig.parity_state = 'invalid';
          this.logger.warn('ARRAY', 'Parity is invalid — run a parity sync to build parity data');
        }
      }

      // Check if we have zero data drives mounted — this is a critical error
      if (successfulMounts === 0) {
        this.arrayConfig.state = 'error';
        this.saveArrayConfig();
        throw new Error('Failed to mount any data drives. Array startup aborted.');
      }

      // Check for mount failures or missing drives
      const unmountedDataDrives = dataDrives.filter(a => {
        const d = this.drives.get(a.drive_id);
        return !d?.mount_point;
      });

      if (unmountedDataDrives.length > 0) {
        // ALL data drives must be mounted — no partial starts allowed
        this.arrayConfig.state = 'error';
        this.saveArrayConfig();
        const unmountedList = unmountedDataDrives.map(d => `${d.drive_id} (slot ${d.slot})`).join(', ');
        this.logger.error('ARRAY', `Array startup FAILED — ${unmountedDataDrives.length} data drive(s) not mounted: ${unmountedList}`);
        // Leave whatever did mount in place (ripping mounts out from under Samba/Docker
        // would send their writes to the root filesystem). State is ERROR; the UI tells
        // the admin which slot to fix, and the next Start reconciles everything.
        throw new Error(`Array startup aborted — all data drives must be mounted. Failed: ${unmountedList}`);
      } else {
        this.arrayConfig.state = 'running';
        this.logger.info('ARRAY', `Array started. ${successfulMounts} data drive(s) mounted, ${parityDrives.length} parity drive(s).`);
      }

      // Persist the mounts by UUID so they come back at the right slot after a reboot,
      // and drop any legacy fstab lines that point the same disk at an old path.
      try { this.writeManagedFstab(); } catch (e) { this.logger.warn('ARRAY', `fstab update failed: ${e}`); }

      // Start watching for drives dropping out while running
      this.startMountWatchdog();

      // Start Docker only if we have at least one data drive mounted
      if (successfulMounts > 0) {
        try {
          execSync('systemctl is-active docker >/dev/null 2>&1', { timeout: 5000 });
          this.logger.info('ARRAY', 'Docker is already running');
        } catch {
          try {
            this.logger.info('ARRAY', 'Starting Docker daemon...');
            execSync('systemctl start docker', { timeout: 30000 });
            this.logger.info('ARRAY', 'Docker started successfully');
          } catch (err) {
            this.logger.error('ARRAY', `Failed to start Docker: ${err}`);
          }
        }
      } else {
        this.logger.warn('ARRAY', 'Docker not started — no data drives mounted');
      }

      // Bring network shares back (stopArray takes them down so unmounts succeed)
      try {
        execSync('systemctl start smbd nmbd 2>/dev/null || true', { timeout: 30000 });
        execSync('systemctl is-enabled nfs-server >/dev/null 2>&1 && systemctl start nfs-server || true', { timeout: 30000 });
        this.logger.info('ARRAY', 'Network shares started');
      } catch { /* samba not installed */ }

      // Set up spin-down timers
      if (this.arrayConfig.spin_down_delay > 0) {
        this.setupSpinDown();
      }

      this.saveArrayConfig();
    } catch (error) {
      this.arrayConfig.state = 'error';
      this.saveArrayConfig();
      this.logger.error('ARRAY', `Failed to start array: ${error}`);
      throw error;
    }
  }

  async stopArray(): Promise<void> {
    if (this.arrayConfig.state === 'stopped') throw new Error('Array is already stopped.');
    if (this.parityOp?.status === 'running') throw new Error('Cannot stop array while a parity operation is in progress. Cancel it first.');

    this.arrayConfig.state = 'stopping';
    this.saveArrayConfig();
    this.logger.info('ARRAY', 'Stopping array...');
    this.stopMountWatchdog();

    // Clear spin-down timers
    for (const [, timer] of this.spinDownTimers) {
      clearTimeout(timer);
    }
    this.spinDownTimers.clear();

    // Network shares hold files open on the array — stop them first so unmounts succeed
    try {
      execSync('systemctl stop smbd nmbd nfs-server 2>/dev/null || true', { timeout: 30000 });
      this.logger.info('ARRAY', 'Stopped SMB/NFS services');
    } catch { /* not installed */ }

    // Stop Docker before unmounting drives
    try {
      execSync('systemctl is-active docker >/dev/null 2>&1', { timeout: 5000 });
      this.logger.info('ARRAY', 'Stopping all Docker containers...');
      try {
        execSync('docker stop $(docker ps -q) 2>/dev/null || true', { timeout: 60000 });
      } catch { /* no running containers */ }
      this.logger.info('ARRAY', 'Stopping Docker daemon...');
      execSync('systemctl stop docker docker.socket 2>/dev/null || true', { timeout: 30000 });
      this.logger.info('ARRAY', 'Docker stopped');
    } catch {
      this.logger.info('ARRAY', 'Docker was not running');
    }

    // Unmount ALL drives (data, cache, unassigned). Retry busy mounts; never silently
    // lazy-unmount a data disk (a lazy unmount leaves it live and blocks the next start).
    const assignments = this.getAssignedDrives();
    const stillBusy: string[] = [];
    for (const assignment of assignments) {
      if (assignment.role === 'parity' || assignment.role === 'parity2' || assignment.role === 'hot_spare') continue;
      const mountPoint = assignment.role === 'cache' ? '/mnt/disks/cache' : `/mnt/disks/disk${assignment.slot}`;
      let isMounted = false;
      isMounted = this.isMountpoint(mountPoint);
      if (!isMounted) continue;

      // Peel off every stacked layer (legacy mount under the slot mount); retry on busy.
      let done = false;
      for (let attempt = 0; attempt < 8 && !done; attempt++) {
        try {
          execSync(`umount "${mountPoint}"`, { timeout: 30000, stdio: 'pipe' });
          if (!this.isMountpoint(mountPoint)) done = true; // another layer underneath? loop again
        } catch { try { execSync('sleep 2'); } catch { /* ignore */ } }
      }
      if (done) {
        this.logger.info('ARRAY', `Unmounted ${mountPoint}`);
      } else {
        let holders = '';
        try { holders = execSync(`fuser -vm "${mountPoint}" 2>&1 | tail -n +2 | head -8`, { encoding: 'utf-8' }).trim(); } catch { /* ignore */ }
        this.logger.error('ARRAY', `Cannot unmount ${mountPoint} — in use:\n${holders || 'unknown process'}`);
        stillBusy.push(mountPoint);
      }
    }

    if (stillBusy.length > 0) {
      // Docker and Samba are already down and some slots are unmounted — this is neither
      // "running" nor "stopped". Report ERROR; "Start array" remounts everything and
      // brings Docker/Samba back.
      this.arrayConfig.state = 'error';
      this.saveArrayConfig();
      throw new Error(`Array stop incomplete — still in use: ${stillBusy.join(', ')}. Close open files/terminals in those paths, then Stop again or Start to recover.`);
    }

    // Also unmount any unassigned drives that were mounted during startArray
    const assignedMounts = new Set<string>();
    for (const a of assignments) {
      assignedMounts.add(a.role === 'cache' ? '/mnt/disks/cache' : `/mnt/disks/disk${a.slot}`);
    }
    for (const [, drive] of this.drives) {
      if (drive.mount_point && drive.mount_point.startsWith('/mnt/disks/') && !assignedMounts.has(drive.mount_point)) {
        try {
          execSync(`umount "${drive.mount_point}" 2>/dev/null`, { timeout: 30000 });
          this.logger.info('ARRAY', `Unmounted unassigned drive at ${drive.mount_point}`);
          drive.mount_point = undefined;
        } catch {
          try {
            execSync(`umount -l "${drive.mount_point}" 2>/dev/null`);
            drive.mount_point = undefined;
          } catch { /* ignore */ }
        }
      }
    }

    this.arrayConfig.state = 'stopped';
    this.saveArrayConfig();
    this.logger.info('ARRAY', 'Array stopped');
  }

  // ──────────────────────────────────────────────────────
  // Drive formatting
  // ──────────────────────────────────────────────────────

  private async formatDriveForArray(driveId: string): Promise<void> {
    const drive = this.drives.get(driveId);
    if (!drive) throw new Error(`Drive ${driveId} not found`);

    this.logger.info('ARRAY', `Formatting ${drive.device} for array use...`);

    try {
      // Create single partition using full drive
      execSync(`wipefs -a "${drive.device}" 2>/dev/null`, { timeout: 10000 });
      execSync(`parted -s "${drive.device}" mklabel gpt`, { timeout: 10000 });
      execSync(`parted -s "${drive.device}" mkpart primary ext4 1MiB 100%`, { timeout: 10000 });

      // Wait for partition
      execSync('sleep 2 && partprobe 2>/dev/null || true');

      let partDev = drive.device;
      if (drive.device.includes('nvme') || drive.device.includes('mmcblk')) {
        partDev = `${drive.device}p1`;
      } else {
        partDev = `${drive.device}1`;
      }

      // Format as XFS (preferred for large drives) or ext4
      try {
        execSync(`mkfs.xfs -f -L "trakend-data" "${partDev}" 2>/dev/null`, { timeout: 120000 });
        drive.filesystem = 'xfs';
      } catch {
        execSync(`mkfs.ext4 -F -L "trakend-data" "${partDev}" 2>/dev/null`, { timeout: 120000 });
        drive.filesystem = 'ext4';
      }

      this.logger.info('ARRAY', `${drive.device} formatted as ${drive.filesystem}`);
    } catch (error) {
      this.logger.error('ARRAY', `Failed to format ${drive.device}: ${error}`);
      throw error;
    }
  }

  // ──────────────────────────────────────────────────────
  // Parity operations
  // ──────────────────────────────────────────────────────

  async startParitySync(): Promise<ParityOperation> {
    if (this.parityOp?.status === 'running') throw new Error('A parity operation is already running.');
    if (this.arrayConfig.state !== 'running' && this.arrayConfig.state !== 'degraded') {
      throw new Error('Array must be running to perform parity operations.');
    }

    const parityDrives = this.getAssignedDrives().filter(d => d.role === 'parity' || d.role === 'parity2');
    if (parityDrives.length === 0) throw new Error('No parity drive assigned.');

    this.parityOp = {
      id: uuidv4(),
      type: 'sync',
      status: 'running',
      started_at: Date.now(),
      progress: 0,
      speed_mbps: 0,
      errors_found: 0,
      errors_corrected: 0,
    };

    this.arrayConfig.parity_state = 'building';
    this.saveArrayConfig();

    this.logger.info('ARRAY', 'Starting parity sync...');

    // Run parity sync in background
    this.runParitySync().catch(err => {
      this.logger.error('ARRAY', `Parity sync failed: ${err}`);
    });

    return this.parityOp;
  }

  async startParityCheck(correct: boolean = false): Promise<ParityOperation> {
    if (this.parityOp?.status === 'running') throw new Error('A parity operation is already running.');
    if (this.arrayConfig.parity_state !== 'valid') throw new Error('Parity must be valid before checking. Run a parity sync first.');

    this.parityOp = {
      id: uuidv4(),
      type: correct ? 'correct' : 'check',
      status: 'running',
      started_at: Date.now(),
      progress: 0,
      speed_mbps: 0,
      errors_found: 0,
      errors_corrected: 0,
    };

    this.arrayConfig.parity_state = 'checking';
    this.saveArrayConfig();

    this.logger.info('ARRAY', `Starting parity ${correct ? 'check+correct' : 'check'}...`);

    this.runParityCheck(correct).catch(err => {
      this.logger.error('ARRAY', `Parity check failed: ${err}`);
    });

    return this.parityOp;
  }

  async startDriveRebuild(driveId: string): Promise<ParityOperation> {
    if (this.parityOp?.status === 'running') throw new Error('A parity operation is already running.');
    if (this.arrayConfig.state !== 'degraded') throw new Error('Drive rebuild is only available when array is degraded.');

    const parityDrives = this.getAssignedDrives().filter(d => d.role === 'parity' || d.role === 'parity2');
    if (parityDrives.length === 0) throw new Error('Cannot rebuild without parity drive.');

    this.parityOp = {
      id: uuidv4(),
      type: 'rebuild',
      status: 'running',
      started_at: Date.now(),
      progress: 0,
      speed_mbps: 0,
      errors_found: 0,
      errors_corrected: 0,
      target_drive: driveId,
    };

    this.arrayConfig.parity_state = 'rebuilding';
    this.arrayConfig.state = 'rebuilding';
    this.saveArrayConfig();

    this.logger.info('ARRAY', `Starting drive rebuild for ${driveId}...`);

    this.runDriveRebuild(driveId).catch(err => {
      this.logger.error('ARRAY', `Drive rebuild failed: ${err}`);
    });

    return this.parityOp;
  }

  cancelParityOperation(): void {
    if (!this.parityOp || this.parityOp.status !== 'running') {
      throw new Error('No active parity operation to cancel.');
    }

    this.parityOp.status = 'cancelled';
    this.arrayConfig.parity_state = this.parityOp.type === 'sync' ? 'invalid' : 'valid';
    this.saveArrayConfig();
    this.logger.info('ARRAY', `Parity operation ${this.parityOp.type} cancelled`);
  }

  getParityStatus(): ParityOperation | null {
    return this.parityOp || null;
  }

  getParityHistory(): any[] {
    return this.db.prepare('SELECT * FROM parity_history ORDER BY started_at DESC LIMIT 50').all();
  }

  // Real block-level XOR parity sync
  private async runParitySync(): Promise<void> {
    if (!this.parityOp) return;

    const dataDrives = this.getAssignedDrives().filter(d => d.role === 'data');
    const parityAssignment = this.getAssignedDrives().find(d => d.role === 'parity');

    if (!parityAssignment || dataDrives.length === 0) {
      throw new Error('No data or parity drives assigned');
    }

    const dataDriveDevices = dataDrives.map(d => {
      const drive = this.drives.get(d.drive_id);
      if (!drive) throw new Error(`Drive ${d.drive_id} not found`);
      return drive.device;
    });

    const parityDrive = this.drives.get(parityAssignment.drive_id);
    if (!parityDrive) throw new Error('Parity drive not found');

    // Determine the largest data drive size for parity coverage
    const maxDataSize = Math.max(...dataDrives.map(d => {
      const drive = this.drives.get(d.drive_id);
      return drive?.size_bytes || 0;
    }));

    const blockSize = 1024 * 1024; // 1MB blocks
    const totalBlocks = Math.ceil(maxDataSize / blockSize);

    const startTime = Date.now();
    let bytesProcessed = 0;
    let lastUpdateTime = startTime;
    let lastBytesProcessed = 0;

    try {
      // Process blocks sequentially
      for (let blockNum = 0; blockNum < totalBlocks; blockNum++) {
        if (!this.parityOp || this.parityOp.status !== 'running') {
          return;
        }

        const blockOffset = BigInt(blockNum) * BigInt(blockSize);
        const blockData = Buffer.alloc(blockSize, 0);

        // Read blocks from all data drives and XOR them
        for (let i = 0; i < dataDriveDevices.length; i++) {
          const device = dataDriveDevices[i];
          const driveSize = this.drives.get(dataDrives[i].drive_id)?.size_bytes || 0;

          // Only XOR if block is within this drive's size
          if (blockOffset < BigInt(driveSize)) {
            try {
              const readData = await this.readBlock(device, blockOffset, blockSize);
              // XOR operation
              for (let j = 0; j < readData.length; j++) {
                blockData[j] ^= readData[j];
              }
            } catch (err) {
              // If we can't read, assume zeros (which is valid for parity)
              this.logger.warn('ARRAY', `Failed to read block from ${device}: ${err}`);
            }
          }
        }

        // Write parity block
        try {
          await this.writeBlock(parityDrive.device, blockOffset, blockData);
        } catch (err) {
          this.logger.error('ARRAY', `Failed to write parity block: ${err}`);
          throw err;
        }

        bytesProcessed = (blockNum + 1) * blockSize;

        // Update progress every 5 seconds
        const now = Date.now();
        if (now - lastUpdateTime >= 5000) {
          const elapsedSeconds = (now - startTime) / 1000;
          const bytesDiff = bytesProcessed - lastBytesProcessed;
          const timeDiff = (now - lastUpdateTime) / 1000;
          const currentSpeed = bytesDiff / timeDiff / (1024 * 1024); // MB/s

          this.parityOp.progress = Math.min(99, (bytesProcessed / maxDataSize) * 100);
          this.parityOp.speed_mbps = currentSpeed;
          this.parityOp.estimated_finish = startTime + (maxDataSize / (bytesProcessed / elapsedSeconds) * 1000);

          lastUpdateTime = now;
          lastBytesProcessed = bytesProcessed;
        }
      }

      if (this.parityOp && this.parityOp.status === 'running') {
        this.parityOp.status = 'completed';
        this.parityOp.progress = 100;
        this.parityOp.completed_at = Date.now();

        const totalElapsed = this.parityOp.completed_at - this.parityOp.started_at;
        const elapsedSeconds = totalElapsed / 1000;
        // Guard against division by zero: if elapsed time is 0, set speed to 0
        this.parityOp.speed_mbps = elapsedSeconds > 0 ? (bytesProcessed / (1024 * 1024)) / elapsedSeconds : 0;

        this.arrayConfig.parity_state = 'valid';
        this.arrayConfig.last_parity_check = Date.now();
        this.saveArrayConfig();

        // Record in history
        this.db.prepare(`
          INSERT INTO parity_history (id, type, status, started_at, completed_at,
            duration_seconds, errors_found, errors_corrected, speed_avg_mbps)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(
          this.parityOp.id, this.parityOp.type, 'completed',
          this.parityOp.started_at, this.parityOp.completed_at,
          Math.round(totalElapsed / 1000),
          this.parityOp.errors_found, this.parityOp.errors_corrected,
          this.parityOp.speed_mbps
        );

        this.logger.info('ARRAY', 'Parity sync completed successfully');
      }
    } catch (error) {
      if (this.parityOp) {
        this.parityOp.status = 'failed';
        this.arrayConfig.parity_state = 'invalid';
        this.saveArrayConfig();
      }
      throw error;
    }
  }

  private async runParityCheck(correct: boolean): Promise<void> {
    if (!this.parityOp) return;

    const dataDrives = this.getAssignedDrives().filter(d => d.role === 'data');
    const parityAssignment = this.getAssignedDrives().find(d => d.role === 'parity');

    if (!parityAssignment || dataDrives.length === 0) {
      throw new Error('No data or parity drives assigned');
    }

    const dataDriveDevices = dataDrives.map(d => {
      const drive = this.drives.get(d.drive_id);
      if (!drive) throw new Error(`Drive ${d.drive_id} not found`);
      return drive.device;
    });

    const parityDrive = this.drives.get(parityAssignment.drive_id);
    if (!parityDrive) throw new Error('Parity drive not found');

    const maxDataSize = Math.max(...dataDrives.map(d => {
      const drive = this.drives.get(d.drive_id);
      return drive?.size_bytes || 0;
    }));

    const blockSize = 1024 * 1024; // 1MB blocks
    const totalBlocks = Math.ceil(maxDataSize / blockSize);

    const startTime = Date.now();
    let bytesProcessed = 0;
    let lastUpdateTime = startTime;
    let lastBytesProcessed = 0;
    let errorsFound = 0;
    let errorsCorrected = 0;

    try {
      // Check blocks sequentially
      for (let blockNum = 0; blockNum < totalBlocks; blockNum++) {
        if (!this.parityOp || this.parityOp.status !== 'running') {
          return;
        }

        const blockOffset = BigInt(blockNum) * BigInt(blockSize);
        const blockData = Buffer.alloc(blockSize, 0);

        // XOR all data blocks
        for (let i = 0; i < dataDriveDevices.length; i++) {
          const device = dataDriveDevices[i];
          const driveSize = this.drives.get(dataDrives[i].drive_id)?.size_bytes || 0;

          if (blockOffset < BigInt(driveSize)) {
            try {
              const readData = await this.readBlock(device, blockOffset, blockSize);
              for (let j = 0; j < readData.length; j++) {
                blockData[j] ^= readData[j];
              }
            } catch (err) {
              this.logger.warn('ARRAY', `Failed to read block from ${device}: ${err}`);
            }
          }
        }

        // Read actual parity block
        let parityBlock: Buffer;
        try {
          parityBlock = await this.readBlock(parityDrive.device, blockOffset, blockSize);
        } catch (err) {
          this.logger.error('ARRAY', `Failed to read parity block: ${err}`);
          errorsFound++;
          parityBlock = Buffer.alloc(blockSize, 0);
        }

        // Compare
        const matches = blockData.equals(parityBlock);
        if (!matches) {
          errorsFound++;

          if (correct) {
            // Correct by writing the correct parity
            try {
              await this.writeBlock(parityDrive.device, blockOffset, blockData);
              errorsCorrected++;
            } catch (err) {
              this.logger.error('ARRAY', `Failed to correct parity block: ${err}`);
            }
          }
        }

        bytesProcessed = (blockNum + 1) * blockSize;

        // Update progress every 5 seconds
        const now = Date.now();
        if (now - lastUpdateTime >= 5000) {
          const elapsedSeconds = (now - startTime) / 1000;
          const bytesDiff = bytesProcessed - lastBytesProcessed;
          const timeDiff = (now - lastUpdateTime) / 1000;
          const currentSpeed = bytesDiff / timeDiff / (1024 * 1024); // MB/s

          this.parityOp.progress = Math.min(99, (bytesProcessed / maxDataSize) * 100);
          this.parityOp.speed_mbps = currentSpeed;
          this.parityOp.estimated_finish = startTime + (maxDataSize / (bytesProcessed / elapsedSeconds) * 1000);
          this.parityOp.errors_found = errorsFound;
          this.parityOp.errors_corrected = errorsCorrected;

          lastUpdateTime = now;
          lastBytesProcessed = bytesProcessed;
        }
      }

      if (this.parityOp && this.parityOp.status === 'running') {
        this.parityOp.status = 'completed';
        this.parityOp.progress = 100;
        this.parityOp.completed_at = Date.now();
        this.parityOp.errors_found = errorsFound;
        this.parityOp.errors_corrected = errorsCorrected;

        const totalElapsed = this.parityOp.completed_at - this.parityOp.started_at;
        const elapsedSeconds = totalElapsed / 1000;
        // Guard against division by zero: if elapsed time is 0, set speed to 0
        this.parityOp.speed_mbps = elapsedSeconds > 0 ? (bytesProcessed / (1024 * 1024)) / elapsedSeconds : 0;

        this.arrayConfig.parity_state = 'valid';
        this.arrayConfig.last_parity_check = Date.now();
        this.saveArrayConfig();

        // Record in history
        this.db.prepare(`
          INSERT INTO parity_history (id, type, status, started_at, completed_at,
            duration_seconds, errors_found, errors_corrected, speed_avg_mbps)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(
          this.parityOp.id, this.parityOp.type, correct ? 'corrected' : 'completed',
          this.parityOp.started_at, this.parityOp.completed_at,
          Math.round(totalElapsed / 1000),
          errorsFound, errorsCorrected,
          this.parityOp.speed_mbps
        );

        this.logger.info('ARRAY', `Parity check completed. ${errorsFound} errors found${correct ? `, ${errorsCorrected} corrected` : ''}.`);
      }
    } catch (error) {
      if (this.parityOp) {
        this.parityOp.status = 'failed';
        this.arrayConfig.parity_state = 'invalid';
        this.saveArrayConfig();
      }
      throw error;
    }
  }

  private async runDriveRebuild(driveId: string): Promise<void> {
    if (!this.parityOp) return;

    const drive = this.drives.get(driveId);
    if (!drive) return;

    const dataDrives = this.getAssignedDrives().filter(d => d.role === 'data');
    const parityAssignment = this.getAssignedDrives().find(d => d.role === 'parity');

    if (!parityAssignment) {
      throw new Error('No parity drive assigned');
    }

    // Get the OTHER data drives (not the one being rebuilt)
    const otherDataDrives = dataDrives.filter(d => d.drive_id !== driveId);
    if (otherDataDrives.length === 0) {
      throw new Error('Cannot rebuild with only one data drive');
    }

    const otherDataDevices = otherDataDrives.map(d => {
      const drv = this.drives.get(d.drive_id);
      if (!drv) throw new Error(`Drive ${d.drive_id} not found`);
      return drv.device;
    });

    const parityDrive = this.drives.get(parityAssignment.drive_id);
    if (!parityDrive) throw new Error('Parity drive not found');

    this.logger.info('ARRAY', `Rebuilding drive ${drive.device}...`);

    const blockSize = 1024 * 1024; // 1MB blocks
    const totalBlocks = Math.ceil(drive.size_bytes / blockSize);

    const startTime = Date.now();
    let bytesProcessed = 0;
    let lastUpdateTime = startTime;
    let lastBytesProcessed = 0;

    try {
      // Rebuild blocks sequentially
      for (let blockNum = 0; blockNum < totalBlocks; blockNum++) {
        if (!this.parityOp || this.parityOp.status !== 'running') {
          return;
        }

        const blockOffset = BigInt(blockNum) * BigInt(blockSize);
        const reconstructedBlock = Buffer.alloc(blockSize, 0);

        // XOR all OTHER data blocks with parity to reconstruct
        for (const device of otherDataDevices) {
          try {
            const blockData = await this.readBlock(device, blockOffset, blockSize);
            for (let j = 0; j < blockData.length; j++) {
              reconstructedBlock[j] ^= blockData[j];
            }
          } catch (err) {
            this.logger.warn('ARRAY', `Failed to read block from ${device}: ${err}`);
          }
        }

        // XOR with parity
        try {
          const parityBlock = await this.readBlock(parityDrive.device, blockOffset, blockSize);
          for (let j = 0; j < parityBlock.length; j++) {
            reconstructedBlock[j] ^= parityBlock[j];
          }
        } catch (err) {
          this.logger.error('ARRAY', `Failed to read parity block: ${err}`);
          throw err;
        }

        // Write reconstructed data to the replacement drive
        try {
          await this.writeBlock(drive.device, blockOffset, reconstructedBlock);
        } catch (err) {
          this.logger.error('ARRAY', `Failed to write reconstructed block: ${err}`);
          throw err;
        }

        bytesProcessed = (blockNum + 1) * blockSize;

        // Update progress every 5 seconds
        const now = Date.now();
        if (now - lastUpdateTime >= 5000) {
          const elapsedSeconds = (now - startTime) / 1000;
          const bytesDiff = bytesProcessed - lastBytesProcessed;
          const timeDiff = (now - lastUpdateTime) / 1000;
          const currentSpeed = bytesDiff / timeDiff / (1024 * 1024); // MB/s

          this.parityOp.progress = Math.min(99, (bytesProcessed / drive.size_bytes) * 100);
          this.parityOp.speed_mbps = currentSpeed;
          this.parityOp.estimated_finish = startTime + (drive.size_bytes / (bytesProcessed / elapsedSeconds) * 1000);

          lastUpdateTime = now;
          lastBytesProcessed = bytesProcessed;
        }
      }

      if (this.parityOp && this.parityOp.status === 'running') {
        this.parityOp.status = 'completed';
        this.parityOp.progress = 100;
        this.parityOp.completed_at = Date.now();

        const totalElapsed = this.parityOp.completed_at - this.parityOp.started_at;
        const elapsedSeconds = totalElapsed / 1000;
        // Guard against division by zero: if elapsed time is 0, set speed to 0
        this.parityOp.speed_mbps = elapsedSeconds > 0 ? (bytesProcessed / (1024 * 1024)) / elapsedSeconds : 0;

        // Update drive status
        this.db.prepare('UPDATE array_drives SET status = ? WHERE drive_id = ?').run('active', driveId);

        this.arrayConfig.state = 'running';
        this.arrayConfig.parity_state = 'valid';
        this.saveArrayConfig();

        // Record in history
        this.db.prepare(`
          INSERT INTO parity_history (id, type, status, started_at, completed_at,
            duration_seconds, errors_found, errors_corrected, speed_avg_mbps, target_drive)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(
          this.parityOp.id, this.parityOp.type, 'completed',
          this.parityOp.started_at, this.parityOp.completed_at,
          Math.round(totalElapsed / 1000),
          0, 0,
          this.parityOp.speed_mbps,
          driveId
        );

        this.logger.info('ARRAY', `Drive rebuild completed for ${drive.device}`);
      }
    } catch (error) {
      if (this.parityOp) {
        this.parityOp.status = 'failed';
        this.arrayConfig.parity_state = 'invalid';
        this.saveArrayConfig();
      }
      throw error;
    }
  }

  // ──────────────────────────────────────────────────────
  // Block-level I/O for parity operations
  // ──────────────────────────────────────────────────────

  private readBlock(device: string, offset: bigint, size: number): Promise<Buffer> {
    return new Promise((resolve, reject) => {
      const buffer = Buffer.alloc(size);
      fs.open(device, 'r', (err, fd) => {
        if (err) return reject(err);

        // Note: Converting bigint to Number for fs.read position parameter.
        // This is safe for drives up to ~8PB (2^53 bytes). For larger drives, consider using fs.promises.read()
        // which natively accepts bigint positions.
        const position = Number(offset);
        fs.read(fd, buffer, 0, size, position, (err, bytesRead, data) => {
          // Always close fd in finally to prevent leaks
          fs.close(fd, (closeErr) => {
            if (closeErr) {
              this.logger.warn('ARRAY', `Failed to close file descriptor: ${closeErr}`);
            }
          });

          if (err) return reject(err);

          // If we read fewer bytes than requested, pad with zeros
          if (bytesRead < size) {
            const paddedBuffer = Buffer.alloc(size, 0);
            data.copy(paddedBuffer, 0, 0, bytesRead);
            resolve(paddedBuffer);
          } else {
            resolve(data);
          }
        });
      });
    });
  }

  private writeBlock(device: string, offset: bigint, data: Buffer): Promise<void> {
    return new Promise((resolve, reject) => {
      fs.open(device, 'r+', (err, fd) => {
        if (err) return reject(err);

        const position = Number(offset);
        fs.write(fd, data, 0, data.length, position, (err) => {
          // Always close fd to prevent leaks, even on error
          fs.close(fd, (closeErr) => {
            if (closeErr) {
              this.logger.warn('ARRAY', `Failed to close file descriptor: ${closeErr}`);
            }
          });

          if (err) return reject(err);
          resolve();
        });
      });
    });
  }

  // ──────────────────────────────────────────────────────
  // Shares
  // ──────────────────────────────────────────────────────

  getShares(): Share[] {
    return this.db.prepare('SELECT * FROM array_shares ORDER BY name').all() as Share[];
  }

  createShare(share: Omit<Share, 'id'>): Share {
    const id = uuidv4();
    const newShare: Share = { id, ...share };

    this.db.prepare(`
      INSERT INTO array_shares (id, name, path, pool, specific_drives, use_cache,
        min_free_space, split_level, allocation_method, export_nfs, export_smb,
        nfs_rule, smb_security)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(id, share.name, share.path || `/mnt/user/${share.name}`, share.pool || 'array',
      JSON.stringify(share.specific_drives || []), share.use_cache || 'no',
      share.min_free_space || '50GB', share.split_level ?? 1,
      share.allocation_method || 'highwater',
      share.export_nfs ? 1 : 0, share.export_smb !== false ? 1 : 0,
      share.nfs_rule || '', share.smb_security || 'secure');

    // Create the share directory on each data disk
    if (this.arrayConfig.state === 'running') {
      const dataDrives = this.getAssignedDrives().filter(d => d.role === 'data');
      for (const assignment of dataDrives) {
        const dirPath = `/mnt/disks/disk${assignment.slot}/${share.name}`;
        fs.mkdirSync(dirPath, { recursive: true });
      }
    }

    this.logger.info('ARRAY', `Share "${share.name}" created`, { pool: share.pool });
    return newShare;
  }

  updateShare(id: string, updates: Partial<Share>): Share {
    const existing = this.db.prepare('SELECT * FROM array_shares WHERE id = ?').get(id) as any;
    if (!existing) throw new Error(`Share ${id} not found`);

    const merged = { ...existing, ...updates };
    this.db.prepare(`
      UPDATE array_shares SET name = ?, path = ?, pool = ?, specific_drives = ?,
        use_cache = ?, min_free_space = ?, split_level = ?, allocation_method = ?,
        export_nfs = ?, export_smb = ?, nfs_rule = ?, smb_security = ?
      WHERE id = ?
    `).run(merged.name, merged.path, merged.pool, JSON.stringify(merged.specific_drives || []),
      merged.use_cache, merged.min_free_space, merged.split_level, merged.allocation_method,
      merged.export_nfs ? 1 : 0, merged.export_smb ? 1 : 0,
      merged.nfs_rule || '', merged.smb_security || 'secure', id);

    return merged as Share;
  }

  deleteShare(id: string): void {
    this.db.prepare('DELETE FROM array_shares WHERE id = ?').run(id);
    this.logger.info('ARRAY', `Share ${id} deleted`);
  }

  // ──────────────────────────────────────────────────────
  // Spin-down management
  // ──────────────────────────────────────────────────────

  private setupSpinDown(): void {
    const dataDrives = this.getAssignedDrives().filter(d => d.role === 'data');
    for (const assignment of dataDrives) {
      this.resetSpinDownTimer(assignment.drive_id);
    }
  }

  resetSpinDownTimer(driveId: string): void {
    if (this.arrayConfig.spin_down_delay <= 0) return;

    // Clear existing timer
    const existing = this.spinDownTimers.get(driveId);
    if (existing) clearTimeout(existing);

    // Set new timer
    const timer = setTimeout(() => {
      this.spinDownDrive(driveId);
    }, this.arrayConfig.spin_down_delay * 60 * 1000);

    this.spinDownTimers.set(driveId, timer);
  }

  private spinDownDrive(driveId: string): void {
    const drive = this.drives.get(driveId);
    if (!drive) return;

    try {
      execSync(`hdparm -y "${drive.device}" 2>/dev/null`);
      drive.spin_state = 'standby';
      this.logger.debug('ARRAY', `Drive ${drive.device} spun down`);
    } catch {
      // Some drives don't support standby
    }
  }

  spinUpDrive(driveId: string): void {
    const drive = this.drives.get(driveId);
    if (!drive || drive.spin_state === 'active') return;

    // Reading from the drive will spin it up
    try {
      execSync(`dd if="${drive.device}" of=/dev/null bs=512 count=1 2>/dev/null`);
      drive.spin_state = 'active';
      this.resetSpinDownTimer(driveId);
    } catch { /* ignore */ }
  }

  // ──────────────────────────────────────────────────────
  // SMART history
  // ──────────────────────────────────────────────────────

  getSmartHistory(serial: string, limit: number = 100): any[] {
    return this.db.prepare(
      'SELECT * FROM drive_smart_history WHERE drive_serial = ? ORDER BY timestamp DESC LIMIT ?'
    ).all(serial, limit);
  }

  // ──────────────────────────────────────────────────────
  // Utilities
  // ──────────────────────────────────────────────────────

  private formatBytes(bytes: number): string {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB', 'TB', 'PB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
  }

  getArraySummary(): any {
    const assignments = this.getAssignedDrives();
    const dataDrives = assignments.filter(d => d.role === 'data');
    const parityDrives = assignments.filter(d => d.role === 'parity' || d.role === 'parity2');
    const cacheDrives = assignments.filter(d => d.role === 'cache');
    const hotSpares = assignments.filter(d => d.role === 'hot_spare');

    let totalCapacity = 0;
    let usedCapacity = 0;

    for (const d of dataDrives) {
      const drive = this.drives.get(d.drive_id);
      if (drive) {
        totalCapacity += drive.size_bytes;
        usedCapacity += drive.usage_bytes || 0;
      }
    }

    return {
      config: this.arrayConfig,
      data_drives: dataDrives.length,
      parity_drives: parityDrives.length,
      cache_drives: cacheDrives.length,
      hot_spares: hotSpares.length,
      total_capacity: totalCapacity,
      total_capacity_human: this.formatBytes(totalCapacity),
      used_capacity: usedCapacity,
      used_capacity_human: this.formatBytes(usedCapacity),
      free_capacity: totalCapacity - usedCapacity,
      free_capacity_human: this.formatBytes(totalCapacity - usedCapacity),
      usage_percent: totalCapacity > 0 ? Math.round((usedCapacity / totalCapacity) * 100) : 0,
      parity_operation: this.parityOp || null,
      shares: this.getShares(),
    };
  }

  getArrayStatus(): any {
    const assignments = this.getAssignedDrives();

    const driveStatus = assignments.map(assignment => {
      const drive = this.drives.get(assignment.drive_id);
      const isPresent = drive && fs.existsSync(drive.device);
      const isMounted = drive?.mount_point ? true : false;

      return {
        drive_id: assignment.drive_id,
        device: drive?.device || assignment.device,
        model: drive?.model || 'Unknown',
        role: assignment.role,
        slot: assignment.slot,
        serial: drive?.serial || assignment.serial,
        present: isPresent,
        mounted: isMounted,
        mount_point: drive?.mount_point || null,
        status: assignment.status,
        health: drive?.health || 'unknown',
        size_human: drive?.size_human || 'Unknown',
      };
    });

    const dataDrives = driveStatus.filter(d => d.role === 'data');
    const parityDrives = driveStatus.filter(d => d.role === 'parity' || d.role === 'parity2');

    const missingDataDrives = dataDrives.filter(d => !d.present);
    const unmountedDataDrives = dataDrives.filter(d => d.present && !d.mounted);
    const missingParityDrives = parityDrives.filter(d => !d.present);

    const isDegraded = missingDataDrives.length > 0 || unmountedDataDrives.length > 0 || missingParityDrives.length > 0;
    const hasNoParity = missingParityDrives.length === parityDrives.length && parityDrives.length > 0;

    return {
      array_state: this.arrayConfig.state,
      is_degraded: isDegraded,
      has_no_parity: hasNoParity,
      data_drives_mounted: dataDrives.filter(d => d.mounted).length,
      data_drives_total: dataDrives.length,
      parity_drives_present: parityDrives.filter(d => d.present).length,
      parity_drives_total: parityDrives.length,
      missing_drives: driveStatus.filter(d => !d.present).map(d => ({ drive_id: d.drive_id, device: d.device, role: d.role })),
      unmounted_drives: driveStatus.filter(d => d.present && !d.mounted).map(d => ({ drive_id: d.drive_id, device: d.device, role: d.role })),
      errored_drives: driveStatus.filter(d => d.status === 'error').map(d => ({ drive_id: d.drive_id, device: d.device, role: d.role })),
      all_drives: driveStatus,
    };
  }
}
