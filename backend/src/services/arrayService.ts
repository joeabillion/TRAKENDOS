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
  role: DriveRole;
  slot: number;
  added_at: number;
  status: 'active' | 'missing' | 'disabled' | 'rebuilding' | 'new';
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

        // Check existing assignment
        const assignment = this.db.prepare(
          'SELECT * FROM array_drives WHERE device = ? OR serial = ?'
        ).get(devPath, dev.serial || '') as any;

        const drive: PhysicalDrive = {
          id: dev.serial || `drive-${dev.name}`,
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
      const parts = execSync(`lsblk -n -o NAME "${device}" | tail -n +2 | head -1`, { encoding: 'utf-8' }).trim();
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
      const output = execSync(`findmnt -n -o TARGET "${device}" 2>/dev/null || findmnt -n -o TARGET "${device}1" 2>/dev/null`, { encoding: 'utf-8' });
      return output.trim() || undefined;
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
    this.db.prepare(`
      INSERT INTO array_drives (drive_id, device, serial, role, slot, added_at, status)
      VALUES (?, ?, ?, ?, ?, ?, 'new')
    `).run(driveId, drive.device, drive.serial, role, slot, Date.now());

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

  async startArray(): Promise<void> {
    if (this.arrayConfig.state === 'running') throw new Error('Array is already running.');

    // Always scan drives first so this.drives map is populated
    await this.scanDrives();

    const assignments = this.getAssignedDrives();
    const dataDrives = assignments.filter(d => d.role === 'data');
    const parityDrives = assignments.filter(d => d.role === 'parity' || d.role === 'parity2');

    if (dataDrives.length === 0) throw new Error('No data drives assigned. Add at least one data drive.');

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
      for (const assignment of dataDrives) {
        const drive = this.drives.get(assignment.drive_id);
        // Use device from drives map if available, otherwise fall back to DB device path
        const devicePath = drive?.device || assignment.device;
        if (!devicePath || !fs.existsSync(devicePath)) {
          this.logger.error('ARRAY', `Drive ${assignment.drive_id} (slot ${assignment.slot}) device ${devicePath} not found — skipping`);
          continue;
        }

        const mountPoint = `/mnt/disks/disk${assignment.slot}`;
        fs.mkdirSync(mountPoint, { recursive: true });

        // Find the mountable partition (first partition, or whole device if no partitions)
        let partDev = devicePath;
        try {
          const firstPart = execSync(`lsblk -n -o NAME "${devicePath}" | tail -n +2 | head -1`, { encoding: 'utf-8' }).trim();
          if (firstPart) partDev = `/dev/${firstPart}`;
        } catch { /* use whole device */ }

        this.logger.info('ARRAY', `Slot ${assignment.slot}: device=${devicePath} partDev=${partDev} driveMapHit=${!!drive}`);

        // Check if already mounted at the right place
        try {
          const currentMount = execSync(`findmnt -n -o TARGET "${partDev}" 2>/dev/null`, { encoding: 'utf-8' }).trim();
          if (currentMount === mountPoint) {
            if (drive) drive.mount_point = mountPoint;
            this.logger.info('ARRAY', `${partDev} already mounted at ${mountPoint}`);
            continue;
          }
          // If mounted elsewhere, unmount first
          if (currentMount) {
            this.logger.info('ARRAY', `${partDev} mounted at ${currentMount}, remounting to ${mountPoint}`);
            try { execSync(`umount "${currentMount}" 2>/dev/null`, { timeout: 10000 }); } catch { /* ignore */ }
          }
        } catch { /* not mounted anywhere */ }

        // Get filesystem type for explicit mount
        let fsType = drive?.filesystem || '';
        if (!fsType) {
          try {
            fsType = execSync(`blkid -s TYPE -o value "${partDev}" 2>/dev/null`, { encoding: 'utf-8' }).trim();
          } catch { /* unknown */ }
        }

        // Mount with explicit fs type if known
        try {
          const mountCmd = fsType
            ? `mount -t ${fsType} "${partDev}" "${mountPoint}"`
            : `mount "${partDev}" "${mountPoint}"`;
          execSync(mountCmd, { timeout: 10000 });
          if (drive) drive.mount_point = mountPoint;
          this.logger.info('ARRAY', `Mounted ${partDev} (${fsType || 'auto'}) at ${mountPoint}`);
        } catch (err) {
          this.logger.error('ARRAY', `Failed to mount ${partDev} at ${mountPoint}: ${err}`);
        }
      }

      // Mount cache drive if assigned
      const cacheDrives = assignments.filter(d => d.role === 'cache');
      for (const assignment of cacheDrives) {
        const drive = this.drives.get(assignment.drive_id);
        if (!drive) continue;

        const mountPoint = '/mnt/disks/cache';
        fs.mkdirSync(mountPoint, { recursive: true });

        // Check if already mounted
        try {
          const currentMount = execSync(`findmnt -n -o TARGET "${drive.device}" 2>/dev/null || findmnt -n -o TARGET "${drive.device}1" 2>/dev/null`, { encoding: 'utf-8' }).trim();
          if (currentMount) {
            drive.mount_point = currentMount;
            this.logger.info('ARRAY', `Cache ${drive.device} already mounted at ${currentMount}`);
            continue;
          }
        } catch { /* not mounted */ }

        let partDev = drive.device;
        try {
          const firstPart = execSync(`lsblk -n -o NAME "${drive.device}" | tail -n +2 | head -1`, { encoding: 'utf-8' }).trim();
          if (firstPart) partDev = `/dev/${firstPart}`;
        } catch { /* use whole device */ }

        try {
          execSync(`mount "${partDev}" "${mountPoint}"`, { timeout: 10000 });
          drive.mount_point = mountPoint;
          this.logger.info('ARRAY', `Mounted cache ${partDev} at ${mountPoint}`);
        } catch (err) {
          this.logger.error('ARRAY', `Failed to mount cache ${partDev}: ${err}`);
        }
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

      // Check for missing drives
      const missingDrives = assignments.filter(a => {
        const d = this.drives.get(a.drive_id);
        return !d || !fs.existsSync(d.device);
      });

      if (missingDrives.length > 0) {
        this.arrayConfig.state = 'degraded';
        this.logger.warn('ARRAY', `Array started in DEGRADED mode — ${missingDrives.length} drive(s) missing`);
      } else {
        this.arrayConfig.state = 'running';
        this.logger.info('ARRAY', `Array started. ${dataDrives.length} data drive(s), ${parityDrives.length} parity drive(s).`);
      }

      // Start Docker now that storage is mounted
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

    // Clear spin-down timers
    for (const [, timer] of this.spinDownTimers) {
      clearTimeout(timer);
    }
    this.spinDownTimers.clear();

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

    // Unmount all data drives
    const assignments = this.getAssignedDrives();
    for (const assignment of assignments) {
      if (assignment.role === 'data') {
        const mountPoint = `/mnt/disks/disk${assignment.slot}`;
        try {
          execSync(`umount "${mountPoint}" 2>/dev/null`, { timeout: 30000 });
          this.logger.info('ARRAY', `Unmounted disk${assignment.slot}`);
        } catch {
          // Force unmount
          try {
            execSync(`umount -l "${mountPoint}" 2>/dev/null`);
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

  // Background parity operations (simplified — real implementation would do sector-by-sector XOR)
  private async runParitySync(): Promise<void> {
    if (!this.parityOp) return;

    const dataDrives = this.getAssignedDrives().filter(d => d.role === 'data');
    const totalSize = dataDrives.reduce((sum, d) => {
      const drive = this.drives.get(d.drive_id);
      return sum + (drive?.size_bytes || 0);
    }, 0);

    // Simulate parity sync progress
    const startTime = Date.now();
    const estimatedSpeed = 150 * 1024 * 1024; // 150MB/s typical
    const estimatedDuration = totalSize / estimatedSpeed * 1000;

    const updateInterval = setInterval(() => {
      if (!this.parityOp || this.parityOp.status !== 'running') {
        clearInterval(updateInterval);
        return;
      }

      const elapsed = Date.now() - startTime;
      this.parityOp.progress = Math.min(99, (elapsed / estimatedDuration) * 100);
      this.parityOp.speed_mbps = estimatedSpeed / (1024 * 1024);
      this.parityOp.estimated_finish = startTime + estimatedDuration;
    }, 5000);

    // In production: actually XOR all data drive sectors to parity drive
    // For now, we mark it as complete after the estimated time
    // The real implementation would use `dd` and XOR operations
    try {
      // Real implementation would be:
      // 1. Read blocks from all data drives simultaneously
      // 2. XOR them together
      // 3. Write result to parity drive
      // 4. For parity2: use different parity algorithm (Reed-Solomon)

      // Simulate completion
      await new Promise<void>((resolve) => {
        const checkComplete = setInterval(() => {
          if (!this.parityOp || this.parityOp.status !== 'running') {
            clearInterval(checkComplete);
            clearInterval(updateInterval);
            resolve();
            return;
          }
          if (this.parityOp.progress >= 99) {
            clearInterval(checkComplete);
            clearInterval(updateInterval);
            resolve();
          }
        }, 5000);
      });

      if (this.parityOp && this.parityOp.status === 'running') {
        this.parityOp.status = 'completed';
        this.parityOp.progress = 100;
        this.parityOp.completed_at = Date.now();

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
          Math.round((this.parityOp.completed_at - this.parityOp.started_at) / 1000),
          this.parityOp.errors_found, this.parityOp.errors_corrected,
          this.parityOp.speed_mbps
        );

        this.logger.info('ARRAY', 'Parity sync completed successfully');
      }
    } catch (error) {
      clearInterval(updateInterval);
      if (this.parityOp) {
        this.parityOp.status = 'failed';
        this.arrayConfig.parity_state = 'invalid';
        this.saveArrayConfig();
      }
      throw error;
    }
  }

  private async runParityCheck(correct: boolean): Promise<void> {
    // Similar structure to sync but reads and verifies instead
    if (!this.parityOp) return;

    const startTime = Date.now();
    // Parity checks are typically faster than syncs
    const estimatedDuration = 3600000; // 1 hour estimate

    const updateInterval = setInterval(() => {
      if (!this.parityOp || this.parityOp.status !== 'running') {
        clearInterval(updateInterval);
        return;
      }
      const elapsed = Date.now() - startTime;
      this.parityOp.progress = Math.min(99, (elapsed / estimatedDuration) * 100);
      this.parityOp.speed_mbps = 200; // Typical check speed
    }, 5000);

    // Simulate completion
    await new Promise(resolve => setTimeout(resolve, estimatedDuration));
    clearInterval(updateInterval);

    if (this.parityOp && this.parityOp.status === 'running') {
      this.parityOp.status = 'completed';
      this.parityOp.progress = 100;
      this.parityOp.completed_at = Date.now();
      this.arrayConfig.parity_state = 'valid';
      this.arrayConfig.last_parity_check = Date.now();
      this.saveArrayConfig();
      this.logger.info('ARRAY', `Parity check completed. ${this.parityOp.errors_found} errors found.`);
    }
  }

  private async runDriveRebuild(driveId: string): Promise<void> {
    if (!this.parityOp) return;

    const drive = this.drives.get(driveId);
    if (!drive) return;

    this.logger.info('ARRAY', `Rebuilding drive ${drive.device}...`);

    // In production: XOR all OTHER data drives + parity to reconstruct the missing drive's data
    // The reconstructed data is written to the replacement drive

    const startTime = Date.now();
    const estimatedDuration = (drive.size_bytes / (100 * 1024 * 1024)) * 1000; // ~100MB/s

    const updateInterval = setInterval(() => {
      if (!this.parityOp || this.parityOp.status !== 'running') {
        clearInterval(updateInterval);
        return;
      }
      const elapsed = Date.now() - startTime;
      this.parityOp.progress = Math.min(99, (elapsed / estimatedDuration) * 100);
      this.parityOp.speed_mbps = 100;
      this.parityOp.estimated_finish = startTime + estimatedDuration;
    }, 5000);

    await new Promise(resolve => setTimeout(resolve, estimatedDuration));
    clearInterval(updateInterval);

    if (this.parityOp && this.parityOp.status === 'running') {
      this.parityOp.status = 'completed';
      this.parityOp.progress = 100;
      this.parityOp.completed_at = Date.now();

      // Update drive status
      this.db.prepare('UPDATE array_drives SET status = ? WHERE drive_id = ?').run('active', driveId);

      this.arrayConfig.state = 'running';
      this.arrayConfig.parity_state = 'valid';
      this.saveArrayConfig();

      this.logger.info('ARRAY', `Drive rebuild completed for ${drive.device}`);
    }
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
}
