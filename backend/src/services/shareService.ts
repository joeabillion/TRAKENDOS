import { execFile } from 'child_process';
import { promisify } from 'util';
import fs from 'fs';
import fsp from 'fs/promises';
import os from 'os';
import path from 'path';
import Database from 'better-sqlite3';
import { EventLogger } from './eventLogger';

const execFileAsync = promisify(execFile);

/** Run a binary with argv (no shell). Returns '' on failure when allowFail is set. */
async function run(cmd: string, args: string[], allowFail = false): Promise<string> {
  try {
    const { stdout } = await execFileAsync(cmd, args, { encoding: 'utf-8', maxBuffer: 8 * 1024 * 1024 });
    return stdout;
  } catch (err) {
    if (allowFail) return '';
    throw err;
  }
}

export class ShareValidationError extends Error {
  status = 400;
  constructor(message: string) {
    super(message);
    this.name = 'ShareValidationError';
  }
}

// Paths
const SMB_CONF = '/etc/samba/smb.conf';
const TRAKEND_SHARES_CONF = '/etc/samba/trakend-shares.conf';
const INCLUDE_LINE = `include = ${TRAKEND_SHARES_CONF}`;
const AVAHI_DIR = '/etc/avahi/services';
const WSDD_BIN = '/usr/bin/wsdd';
const SAMBA_GROUP = 'sambashare';

/** Roots a share path may live under. */
const ALLOWED_SHARE_ROOTS = ['/mnt/disks/', '/data/shares/'];

/** Characters that would let a value break out of its smb.conf directive. */
const SMB_UNSAFE_CHARS = /[\x00-\x1f\x7f\[\];#]/;

export function validateShareName(name: unknown): string {
  if (typeof name !== 'string') throw new ShareValidationError('Share name is required');
  const trimmed = name.trim();
  if (!/^[a-zA-Z][a-zA-Z0-9_\- .]{0,63}$/.test(trimmed)) {
    throw new ShareValidationError(
      'Invalid share name. Must start with a letter and contain only letters, digits, space, dot, dash or underscore (max 64 chars).'
    );
  }
  if (['global', 'homes', 'printers', 'print$'].includes(trimmed.toLowerCase())) {
    throw new ShareValidationError(`"${trimmed}" is a reserved Samba section name`);
  }
  return trimmed;
}

export function validateShareText(value: unknown, label: string, maxLen = 256): string {
  if (value === undefined || value === null) return '';
  if (typeof value !== 'string') throw new ShareValidationError(`${label} must be a string`);
  if (value.length > maxLen) throw new ShareValidationError(`${label} is too long (max ${maxLen} chars)`);
  if (SMB_UNSAFE_CHARS.test(value)) {
    throw new ShareValidationError(`${label} contains characters that are not allowed ([ ] ; # or control characters)`);
  }
  return value;
}

export function validateSharePath(value: unknown): string {
  if (typeof value !== 'string' || value.trim() === '') throw new ShareValidationError('Share path is required');
  if (SMB_UNSAFE_CHARS.test(value)) {
    throw new ShareValidationError('Share path contains characters that are not allowed');
  }
  const resolved = path.resolve(value.trim());
  const ok = ALLOWED_SHARE_ROOTS.some((root) => resolved.startsWith(root) && resolved.length > root.length);
  if (!ok) {
    throw new ShareValidationError(`Share path must be inside ${ALLOWED_SHARE_ROOTS.join(' or ')}`);
  }
  return resolved;
}

function validateUserList(value: unknown, label: string): string[] {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) throw new ShareValidationError(`${label} must be an array of usernames`);
  const out: string[] = [];
  for (const u of value) {
    if (typeof u !== 'string') continue;
    const name = u.trim();
    if (!name) continue;
    if (!/^[a-zA-Z0-9_.@-]{1,64}$/.test(name)) {
      throw new ShareValidationError(`${label}: invalid username "${name}"`);
    }
    out.push(name);
  }
  return out;
}

function validateTmMaxSize(value: unknown): string | null {
  if (value === undefined || value === null || value === '') return null;
  if (typeof value !== 'string' && typeof value !== 'number') {
    throw new ShareValidationError('Time Machine max size must be a string like "500G"');
  }
  const str = String(value).trim().toUpperCase();
  if (!/^\d+(\.\d+)?[KMGT]?$/.test(str)) {
    throw new ShareValidationError('Time Machine max size must look like 500G, 2T or 1024M');
  }
  return str;
}

export interface ShareUser {
  id: number;
  username: string;
  homeDir: string;
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface SambaShare {
  id: number;
  name: string;
  path: string;
  comment: string;
  browseable: boolean;
  readOnly: boolean;
  guestOk: boolean;
  validUsers: string[];  // usernames who can access
  writableUsers: string[];  // usernames with write access
  timeMachine: boolean;
  tmMaxSize: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface SambaStatus {
  installed: boolean;
  running: boolean;
  version: string;
  connections: number;
}

export class ShareService {
  private db: Database.Database;
  private logger: EventLogger;

  constructor(db: Database.Database, logger: EventLogger) {
    this.db = db;
    this.logger = logger;
    this.initDB();
    // One-time import of shares defined by hand in smb.conf (fire and forget)
    this.importExistingShares().catch((err) => {
      this.logger.warn('SHARES', `Share import skipped: ${err}`);
    });
  }

  private initDB(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS share_users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        username TEXT UNIQUE NOT NULL,
        home_dir TEXT NOT NULL DEFAULT '',
        enabled INTEGER NOT NULL DEFAULT 1,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
      );

      CREATE TABLE IF NOT EXISTS samba_shares (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT UNIQUE NOT NULL,
        path TEXT NOT NULL,
        comment TEXT NOT NULL DEFAULT '',
        browseable INTEGER NOT NULL DEFAULT 1,
        read_only INTEGER NOT NULL DEFAULT 0,
        guest_ok INTEGER NOT NULL DEFAULT 0,
        valid_users TEXT NOT NULL DEFAULT '',
        writable_users TEXT NOT NULL DEFAULT '',
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
    `);

    // Schema migrations (idempotent; ALTER TABLE fails if the column already exists)
    for (const stmt of [
      'ALTER TABLE samba_shares ADD COLUMN time_machine INTEGER DEFAULT 0',
      'ALTER TABLE samba_shares ADD COLUMN tm_max_size TEXT',
      // 1 = row was imported from a hand-written smb.conf section that is still live there.
      // Such rows are NOT emitted into trakend-shares.conf (would duplicate the section);
      // the first UI edit/delete retires the hand-written section and takes ownership.
      'ALTER TABLE samba_shares ADD COLUMN imported INTEGER DEFAULT 0',
    ]) {
      try {
        this.db.exec(stmt);
      } catch {
        // column already present
      }
    }
  }

  // ═══════════════════════════════════════════
  // Samba Status & Configuration
  // ═══════════════════════════════════════════

  async getStatus(): Promise<SambaStatus> {
    const result: SambaStatus = {
      installed: false,
      running: false,
      version: '',
      connections: 0,
    };

    try {
      const ver = await run('smbd', ['--version']);
      result.installed = true;
      result.version = ver.trim();
    } catch {
      return result;
    }

    const status = await run('systemctl', ['is-active', 'smbd'], true);
    result.running = status.trim() === 'active';

    const conns = await run('smbstatus', ['-b'], true);
    result.connections = conns.split('\n').filter((l) => /^\d/.test(l)).length;

    return result;
  }

  /** Enable Windows network discovery (wsdd) and NetBIOS (nmbd) if available. Never throws. */
  private async enableDiscoveryServices(): Promise<void> {
    await run('systemctl', ['enable', '--now', 'nmbd'], true);
    if (fs.existsSync(WSDD_BIN)) {
      await run('systemctl', ['enable', '--now', 'wsdd'], true);
    }
  }

  async startSamba(): Promise<void> {
    await run('systemctl', ['start', 'smbd']);
    await run('systemctl', ['enable', 'smbd'], true);
    await this.enableDiscoveryServices();
    this.logger.info('SHARES', 'Samba services started');
  }

  async stopSamba(): Promise<void> {
    await run('systemctl', ['stop', 'smbd', 'nmbd'], true);
    if (fs.existsSync(WSDD_BIN)) {
      await run('systemctl', ['stop', 'wsdd'], true);
    }
    this.logger.info('SHARES', 'Samba services stopped');
  }

  async restartSamba(): Promise<void> {
    await run('systemctl', ['restart', 'smbd']);
    await run('systemctl', ['restart', 'nmbd'], true);
    this.logger.info('SHARES', 'Samba services restarted');
  }

  // ═══════════════════════════════════════════
  // User Management
  // ═══════════════════════════════════════════

  getUsers(): ShareUser[] {
    const rows = this.db.prepare('SELECT * FROM share_users ORDER BY username').all() as any[];
    return rows.map(r => ({
      id: r.id,
      username: r.username,
      homeDir: r.home_dir,
      enabled: !!r.enabled,
      createdAt: r.created_at,
      updatedAt: r.updated_at,
    }));
  }

  getUser(username: string): ShareUser | null {
    const row = this.db.prepare('SELECT * FROM share_users WHERE username = ?').get(username) as any;
    if (!row) return null;
    return {
      id: row.id,
      username: row.username,
      homeDir: row.home_dir,
      enabled: !!row.enabled,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  /** Make sure the shared group exists (groupadd -f is idempotent). */
  private async ensureSambaGroup(): Promise<void> {
    await run('groupadd', ['-f', SAMBA_GROUP], true);
  }

  async createUser(username: string, password: string, homeDir?: string): Promise<ShareUser> {
    // Validate username (alphanumeric + underscore/dash, 2-32 chars)
    if (!/^[a-zA-Z0-9_-]+$/.test(username) || username.length < 2 || username.length > 32) {
      throw new ShareValidationError('Invalid username. Must be 2-32 chars, alphanumeric, underscore, or dash only.');
    }
    if (typeof password !== 'string' || password.length === 0 || /[\r\n\0]/.test(password)) {
      throw new ShareValidationError('Invalid password');
    }

    const userHome = homeDir ? validateSharePath(homeDir) : `/data/shares/${username}`;

    await this.ensureSambaGroup();

    // Create Linux system user
    try {
      await execFileAsync('id', [username]);
      // User exists — just update password
    } catch {
      try {
        await execFileAsync('useradd', ['-m', '-d', userHome, '-s', '/usr/sbin/nologin', username]);
      } catch (e) {
        // User might exist, continue
      }
    }

    // Add user to the shared group so group-writable shares work
    await run('usermod', ['-aG', SAMBA_GROUP, username], true);

    // Create home directory
    await fsp.mkdir(userHome, { recursive: true });
    await run('chown', [`${username}:${username}`, userHome], true);
    await run('chmod', ['750', userHome], true);

    // Set Samba password
    await this.setSambaPassword(username, password);

    // Store in DB
    this.db.prepare(`
      INSERT OR REPLACE INTO share_users (username, home_dir, enabled, updated_at)
      VALUES (?, ?, 1, datetime('now'))
    `).run(username, userHome);

    this.logger.info('SHARES', `Created share user: ${username} (home: ${userHome})`);

    return this.getUser(username)!;
  }

  async updateUserPassword(username: string, password: string): Promise<void> {
    if (typeof password !== 'string' || password.length === 0 || /[\r\n\0]/.test(password)) {
      throw new ShareValidationError('Invalid password');
    }
    await this.setSambaPassword(username, password);
    this.db.prepare("UPDATE share_users SET updated_at = datetime('now') WHERE username = ?").run(username);
    this.logger.info('SHARES', `Updated password for share user: ${username}`);
  }

  async toggleUser(username: string, enabled: boolean): Promise<void> {
    await run('smbpasswd', [enabled ? '-e' : '-d', username], true);
    this.db.prepare("UPDATE share_users SET enabled = ?, updated_at = datetime('now') WHERE username = ?")
      .run(enabled ? 1 : 0, username);
    this.logger.info('SHARES', `${enabled ? 'Enabled' : 'Disabled'} share user: ${username}`);
  }

  async deleteUser(username: string): Promise<void> {
    // Remove Samba password
    await run('smbpasswd', ['-x', username], true);

    // Remove from DB (keep system user and files)
    this.db.prepare('DELETE FROM share_users WHERE username = ?').run(username);

    // Remove user from all shares
    const shares = this.getShares();
    for (const share of shares) {
      const validUsers = share.validUsers.filter(u => u !== username);
      const writableUsers = share.writableUsers.filter(u => u !== username);
      this.db.prepare(`
        UPDATE samba_shares SET valid_users = ?, writable_users = ?, updated_at = datetime('now')
        WHERE id = ?
      `).run(validUsers.join(','), writableUsers.join(','), share.id);
    }

    this.logger.info('SHARES', `Deleted share user: ${username}`);
    await this.regenerateConfig();
  }

  private async setSambaPassword(username: string, password: string): Promise<void> {
    // Use smbpasswd with stdin piping for password safety (no shell interpolation)
    await new Promise<void>((resolve) => {
      const proc = execFile('smbpasswd', ['-a', '-s', username], () => {
        // Some versions of smbpasswd may have non-zero exit codes for expected conditions
        resolve();
      });

      // Write password twice (required by smbpasswd -s format)
      if (proc.stdin) {
        proc.stdin.write(`${password}\n${password}\n`);
        proc.stdin.end();
      }
    });
  }

  // ═══════════════════════════════════════════
  // Share Management
  // ═══════════════════════════════════════════

  private rowToShare(r: any): SambaShare {
    return {
      id: r.id,
      name: r.name,
      path: r.path,
      comment: r.comment,
      browseable: !!r.browseable,
      readOnly: !!r.read_only,
      guestOk: !!r.guest_ok,
      validUsers: r.valid_users ? r.valid_users.split(',').filter((u: string) => u) : [],
      writableUsers: r.writable_users ? r.writable_users.split(',').filter((u: string) => u) : [],
      timeMachine: !!r.time_machine,
      tmMaxSize: r.tm_max_size || null,
      createdAt: r.created_at,
      updatedAt: r.updated_at,
    };
  }

  getShares(): SambaShare[] {
    const rows = this.db.prepare('SELECT * FROM samba_shares ORDER BY name').all() as any[];
    return rows.map((r) => this.rowToShare(r));
  }

  getShare(name: string): SambaShare | null {
    const row = this.db.prepare('SELECT * FROM samba_shares WHERE name = ?').get(name) as any;
    if (!row) return null;
    return this.rowToShare(row);
  }

  /** Create the directory for a share and give it group-writable sambashare ownership. */
  private async prepareShareDirectory(sharePath: string): Promise<void> {
    await fsp.mkdir(sharePath, { recursive: true });
    await this.ensureSambaGroup();
    await run('chown', [`root:${SAMBA_GROUP}`, sharePath], true);
    await run('chmod', ['2775', sharePath], true);
  }

  async createShare(options: {
    name: string;
    path: string;
    comment?: string;
    browseable?: boolean;
    readOnly?: boolean;
    guestOk?: boolean;
    validUsers?: string[];
    writableUsers?: string[];
    timeMachine?: boolean;
    tmMaxSize?: string | null;
  }): Promise<SambaShare> {
    const name = validateShareName(options.name);
    const sharePath = validateSharePath(options.path);
    const comment = validateShareText(options.comment, 'Comment');
    const validUsers = validateUserList(options.validUsers, 'validUsers');
    const writableUsers = validateUserList(options.writableUsers, 'writableUsers');
    const tmMaxSize = validateTmMaxSize(options.tmMaxSize);

    if (this.getShare(name)) {
      throw new ShareValidationError(`A share named "${name}" already exists`);
    }

    await this.prepareShareDirectory(sharePath);

    this.db.prepare(`
      INSERT INTO samba_shares (name, path, comment, browseable, read_only, guest_ok, valid_users, writable_users, time_machine, tm_max_size)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      name,
      sharePath,
      comment,
      options.browseable !== false ? 1 : 0,
      options.readOnly ? 1 : 0,
      options.guestOk ? 1 : 0,
      validUsers.join(','),
      writableUsers.join(','),
      options.timeMachine ? 1 : 0,
      tmMaxSize,
    );

    this.logger.info('SHARES', `Created share: ${name} -> ${sharePath}`);
    await this.regenerateConfig();

    return this.getShare(name)!;
  }

  async updateShare(name: string, updates: Partial<{
    path: string;
    comment: string;
    browseable: boolean;
    readOnly: boolean;
    guestOk: boolean;
    validUsers: string[];
    writableUsers: string[];
    timeMachine: boolean;
    tmMaxSize: string | null;
  }>): Promise<SambaShare> {
    const existing = this.getShare(name);
    if (!existing) throw new Error(`Share not found: ${name}`);
    await this.takeOwnershipIfImported(name);

    const newPath = updates.path !== undefined ? validateSharePath(updates.path) : existing.path;
    const merged = {
      path: newPath,
      comment: updates.comment !== undefined ? validateShareText(updates.comment, 'Comment') : existing.comment,
      browseable: updates.browseable ?? existing.browseable,
      readOnly: updates.readOnly ?? existing.readOnly,
      guestOk: updates.guestOk ?? existing.guestOk,
      validUsers: updates.validUsers !== undefined ? validateUserList(updates.validUsers, 'validUsers') : existing.validUsers,
      writableUsers:
        updates.writableUsers !== undefined ? validateUserList(updates.writableUsers, 'writableUsers') : existing.writableUsers,
      timeMachine: updates.timeMachine ?? existing.timeMachine,
      tmMaxSize: updates.tmMaxSize !== undefined ? validateTmMaxSize(updates.tmMaxSize) : existing.tmMaxSize,
    };

    if (newPath !== existing.path) {
      await this.prepareShareDirectory(newPath);
    }

    this.db.prepare(`
      UPDATE samba_shares SET
        path = ?, comment = ?, browseable = ?, read_only = ?, guest_ok = ?,
        valid_users = ?, writable_users = ?, time_machine = ?, tm_max_size = ?, updated_at = datetime('now')
      WHERE name = ?
    `).run(
      merged.path, merged.comment,
      merged.browseable ? 1 : 0, merged.readOnly ? 1 : 0, merged.guestOk ? 1 : 0,
      merged.validUsers.join(','), merged.writableUsers.join(','),
      merged.timeMachine ? 1 : 0, merged.tmMaxSize,
      name,
    );

    this.logger.info('SHARES', `Updated share: ${name}`);
    await this.regenerateConfig();

    return this.getShare(name)!;
  }

  async deleteShare(name: string): Promise<void> {
    await this.takeOwnershipIfImported(name);
    this.db.prepare('DELETE FROM samba_shares WHERE name = ?').run(name);
    this.logger.info('SHARES', `Deleted share: ${name}`);
    await this.regenerateConfig();
  }

  // ═══════════════════════════════════════════
  // Auto-create user home shares
  // ═══════════════════════════════════════════

  async ensureUserHomeShares(): Promise<void> {
    const users = this.getUsers();
    for (const user of users) {
      const shareName = `${user.username}_home`;
      if (!this.getShare(shareName)) {
        try {
          await this.createShare({
            name: shareName,
            path: user.homeDir,
            comment: `${user.username}'s home folder`,
            browseable: true,
            readOnly: false,
            guestOk: false,
            validUsers: [user.username],
            writableUsers: [user.username],
          });
        } catch (err) {
          this.logger.warn('SHARES', `Could not create home share for ${user.username}: ${err}`);
        }
      }
    }
  }

  // ═══════════════════════════════════════════
  // One-time import of hand-written shares
  // ═══════════════════════════════════════════

  /**
   * If the DB has no shares yet but /etc/samba/smb.conf defines share sections,
   * import them (via `testparm -s`, which resolves defaults/synonyms) so they show
   * up in the UI. Only sections literally present in smb.conf are imported.
   */
  async importExistingShares(): Promise<number> {
    const count = (this.db.prepare('SELECT COUNT(*) AS c FROM samba_shares').get() as any)?.c ?? 0;
    if (count > 0) return 0;
    if (!fs.existsSync(SMB_CONF)) return 0;

    const raw = await fsp.readFile(SMB_CONF, 'utf-8');
    const rawSections = new Set<string>();
    for (const line of raw.split('\n')) {
      const m = line.match(/^\s*\[([^\]]+)\]\s*$/);
      if (m) rawSections.add(m[1].trim());
    }
    const reserved = new Set(['global', 'homes', 'printers', 'print$']);
    const candidates = Array.from(rawSections).filter((s) => !reserved.has(s.toLowerCase()));
    if (candidates.length === 0) return 0;

    const parsed = await run('testparm', ['-s', '--suppress-prompt', SMB_CONF], true);
    if (!parsed.trim()) return 0;

    const sections = ShareService.parseSmbConf(parsed);
    let imported = 0;
    const insert = this.db.prepare(`
      INSERT OR IGNORE INTO samba_shares (name, path, comment, browseable, read_only, guest_ok, valid_users, writable_users, time_machine, tm_max_size, imported)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)
    `);

    const yes = (v: string | undefined, def: boolean): boolean => {
      if (v === undefined) return def;
      return /^(yes|true|1)$/i.test(v.trim());
    };
    const list = (v: string | undefined): string[] =>
      (v || '')
        .split(/[\s,]+/)
        .map((u) => u.replace(/^[@+&]+/, '').trim())
        .filter((u) => /^[a-zA-Z0-9_.@-]+$/.test(u));

    for (const name of candidates) {
      const params = sections.get(name);
      if (!params) continue;
      const sharePath = params.get('path');
      if (!sharePath) continue;

      try {
        insert.run(
          name,
          sharePath,
          params.get('comment') || '',
          yes(params.get('browseable'), true) ? 1 : 0,
          yes(params.get('read only'), true) ? 1 : 0,
          yes(params.get('guest ok'), false) ? 1 : 0,
          list(params.get('valid users')).join(','),
          list(params.get('write list')).join(','),
          yes(params.get('fruit:time machine'), false) ? 1 : 0,
          params.get('fruit:time machine max size') || null,
        );
        imported++;
      } catch (err) {
        this.logger.warn('SHARES', `Failed to import share ${name}: ${err}`);
      }
    }

    if (imported > 0) {
      this.logger.info('SHARES', `Imported ${imported} existing share(s) from ${SMB_CONF}`);
    }
    return imported;
  }

  /** Parse smb.conf / testparm output into section -> (key -> value). Keys lower-cased. */
  static parseSmbConf(text: string): Map<string, Map<string, string>> {
    const sections = new Map<string, Map<string, string>>();
    let current: Map<string, string> | null = null;
    for (const rawLine of text.split('\n')) {
      const line = rawLine.trim();
      if (!line || line.startsWith('#') || line.startsWith(';')) continue;
      const sec = line.match(/^\[([^\]]+)\]$/);
      if (sec) {
        current = new Map();
        sections.set(sec[1].trim(), current);
        continue;
      }
      if (!current) continue;
      const eq = line.indexOf('=');
      if (eq <= 0) continue;
      const key = line.slice(0, eq).trim().toLowerCase();
      const value = line.slice(eq + 1).trim();
      current.set(key, value);
    }
    return sections;
  }

  // ═══════════════════════════════════════════
  // Samba Config Generation
  // ═══════════════════════════════════════════

  private buildGlobalConfig(): string {
    const hostname = (os.hostname() || 'trakend').split('.')[0].replace(/[^A-Za-z0-9-]/g, '').slice(0, 15) || 'TRAKEND';
    return `# Trakend OS Samba configuration
# Created by Trakend OS because no smb.conf existed. Edit freely — Trakend only
# manages ${TRAKEND_SHARES_CONF}, which is pulled in by the include below.

[global]
   netbios name = ${hostname.toUpperCase()}
   server string = ${hostname} Home Server
   workgroup = WORKGROUP
   server role = standalone server
   security = user
   map to guest = Bad User
   server min protocol = SMB2
   log file = /var/log/samba/log.%m
   max log size = 1000
   logging = file
   ea support = yes
   vfs objects = catia fruit streams_xattr
   fruit:aapl = yes
   fruit:metadata = stream
   fruit:model = MacSamba
   fruit:posix_rename = yes
   fruit:veto_appledouble = no
   fruit:nfs_aces = no
   fruit:wipe_intentionally_left_blank_rfork = yes
   fruit:delete_empty_adfiles = yes
   ${INCLUDE_LINE}
`;
  }

  /**
   * Ensure smb.conf exists and its [global] section includes our managed file.
   * Never rewrites an existing [global]; only appends the include line (at the end
   * of [global], so later directives don't leak into an included share).
   */
  private async ensureSmbConfInclude(): Promise<void> {
    await fsp.mkdir(path.dirname(SMB_CONF), { recursive: true });

    if (!fs.existsSync(SMB_CONF)) {
      await fsp.writeFile(SMB_CONF, this.buildGlobalConfig());
      this.logger.info('SHARES', `Created ${SMB_CONF} with Trakend defaults`);
      return;
    }

    const content = await fsp.readFile(SMB_CONF, 'utf-8');
    const includeRe = new RegExp(`^\\s*include\\s*=\\s*${TRAKEND_SHARES_CONF.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*$`, 'm');
    if (includeRe.test(content)) return;

    const lines = content.split('\n');
    const globalIdx = lines.findIndex((l) => /^\s*\[global\]\s*$/i.test(l));

    if (globalIdx === -1) {
      // No [global] at all: prepend one that only carries the include
      const updated = `[global]\n   ${INCLUDE_LINE}\n\n${content}`;
      await fsp.writeFile(SMB_CONF, updated);
    } else {
      // Find the end of [global] (next section header or EOF)
      let insertAt = lines.length;
      for (let i = globalIdx + 1; i < lines.length; i++) {
        if (/^\s*\[[^\]]+\]\s*$/.test(lines[i])) {
          insertAt = i;
          break;
        }
      }
      // Back up over trailing blank lines so the include sits with the other directives
      while (insertAt > globalIdx + 1 && lines[insertAt - 1].trim() === '') insertAt--;
      lines.splice(insertAt, 0, `   ${INCLUDE_LINE}`);
      await fsp.writeFile(SMB_CONF, lines.join('\n'));
    }
    this.logger.info('SHARES', `Added "${INCLUDE_LINE}" to ${SMB_CONF}`);
  }

  private buildSharesConfig(shares: SambaShare[]): string {
    let config = `# Trakend OS managed shares
# Auto-generated from the Trakend database — do not edit manually.
# This file is included from ${SMB_CONF}; put global settings there instead.
`;

    for (const share of shares) {
      config += `
[${share.name}]
   path = ${share.path}
   comment = ${share.comment}
   browseable = ${share.browseable ? 'yes' : 'no'}
   read only = ${share.readOnly ? 'yes' : 'no'}
   guest ok = ${share.guestOk ? 'yes' : 'no'}
   force group = ${SAMBA_GROUP}
   create mask = 0664
   directory mask = 2775
   force create mode = 0664
   force directory mode = 2775
`;

      if (share.validUsers.length > 0) {
        config += `   valid users = ${share.validUsers.join(' ')}\n`;
      }
      if (share.writableUsers.length > 0) {
        config += `   write list = ${share.writableUsers.join(' ')}\n`;
      }
      if (share.timeMachine) {
        config += `   fruit:time machine = yes\n`;
        if (share.tmMaxSize) {
          config += `   fruit:time machine max size = ${share.tmMaxSize}\n`;
        }
      }
    }

    return config;
  }

  /** Publish SMB + Time Machine (adisk) over mDNS so macOS sees the server. Never throws. */
  private async writeAvahiServices(shares: SambaShare[]): Promise<void> {
    try {
      if (!fs.existsSync(path.dirname(AVAHI_DIR))) return; // avahi not installed
      await fsp.mkdir(AVAHI_DIR, { recursive: true });

      const smbService = `<?xml version="1.0" standalone='no'?>
<!DOCTYPE service-group SYSTEM "avahi-service.dtd">
<service-group>
  <name replace-wildcards="yes">%h</name>
  <service>
    <type>_smb._tcp</type>
    <port>445</port>
  </service>
  <service>
    <type>_device-info._tcp</type>
    <port>0</port>
    <txt-record>model=RackMac</txt-record>
  </service>
</service-group>
`;
      await fsp.writeFile(path.join(AVAHI_DIR, 'smb.service'), smbService);

      const tmShares = shares.filter((s) => s.timeMachine);
      const adiskPath = path.join(AVAHI_DIR, 'adisk.service');
      if (tmShares.length === 0) {
        try {
          await fsp.unlink(adiskPath);
        } catch {
          /* not present */
        }
      } else {
        const escapeXml = (v: string) => v.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
        const dkRecords = tmShares
          .map((s, i) => `    <txt-record>dk${i}=adVN=${escapeXml(s.name)},adVF=0x82</txt-record>`)
          .join('\n');
        const adisk = `<?xml version="1.0" standalone='no'?>
<!DOCTYPE service-group SYSTEM "avahi-service.dtd">
<service-group>
  <name replace-wildcards="yes">%h</name>
  <service>
    <type>_adisk._tcp</type>
    <port>9</port>
    <txt-record>sys=waMa=0,adVF=0x100</txt-record>
${dkRecords}
  </service>
</service-group>
`;
        await fsp.writeFile(adiskPath, adisk);
      }

      await run('systemctl', ['reload', 'avahi-daemon'], true);
    } catch (err) {
      this.logger.warn('SHARES', `Avahi service files not updated: ${err}`);
    }
  }

  /**
   * Comment out a hand-written [section] in smb.conf (backup first) so the generated
   * include file becomes the single definition. Returns true if a section was retired.
   */
  private async retireHandWrittenSection(name: string): Promise<boolean> {
    if (!fs.existsSync(SMB_CONF)) return false;
    const raw = await fsp.readFile(SMB_CONF, 'utf-8');
    const lines = raw.split('\n');
    const out: string[] = [];
    let inTarget = false;
    let retired = false;
    for (const line of lines) {
      const m = line.match(/^\s*\[([^\]]+)\]\s*$/);
      if (m) inTarget = m[1].trim().toLowerCase() === name.toLowerCase();
      if (inTarget) {
        retired = true;
        out.push(line.trim().startsWith('#') || line.trim() === '' ? line : `# [trakend-managed] ${line}`);
      } else {
        out.push(line);
      }
    }
    if (!retired) return false;
    await fsp.copyFile(SMB_CONF, `${SMB_CONF}.trakend.bak`);
    await fsp.writeFile(`${SMB_CONF}.tmp`, out.join('\n'));
    await fsp.rename(`${SMB_CONF}.tmp`, SMB_CONF);
    this.logger.info('SHARES', `Took ownership of hand-written share [${name}] (original commented out in ${SMB_CONF})`);
    return true;
  }

  /** Called before any UI mutation of a share: if it was imported, retire the original section. */
  private async takeOwnershipIfImported(name: string): Promise<void> {
    const row = this.db.prepare('SELECT imported FROM samba_shares WHERE name = ?').get(name) as any;
    if (!row || !row.imported) return;
    await this.retireHandWrittenSection(name);
    this.db.prepare('UPDATE samba_shares SET imported = 0 WHERE name = ?').run(name);
  }

  async regenerateConfig(): Promise<void> {
    // Imported rows are still defined in smb.conf itself — emitting them again would
    // produce a duplicate section that Samba silently merges.
    const shares = this.getShares().filter((s) => {
      const row = this.db.prepare('SELECT imported FROM samba_shares WHERE name = ?').get(s.name) as any;
      return !row?.imported;
    });

    try {
      await this.ensureSmbConfInclude();
      await fsp.writeFile(TRAKEND_SHARES_CONF, this.buildSharesConfig(shares));

      // Validate; log but don't fail hard if testparm is missing
      await run('testparm', ['-s', '--suppress-prompt'], true);

      // Reload Samba (restart if reload isn't possible, e.g. not yet running)
      try {
        await run('systemctl', ['reload', 'smbd']);
      } catch {
        await run('systemctl', ['restart', 'smbd'], true);
      }
      await this.enableDiscoveryServices();
      await this.writeAvahiServices(shares);

      this.logger.info('SHARES', `Samba shares config written to ${TRAKEND_SHARES_CONF} and reloaded`);
    } catch (error) {
      this.logger.error('SHARES', `Failed to write samba config: ${error}`);
      throw error;
    }
  }

  // ═══════════════════════════════════════════
  // Active Connections
  // ═══════════════════════════════════════════

  async getConnections(): Promise<Array<{
    pid: number;
    username: string;
    group: string;
    machine: string;
    protocol: string;
    connectedAt: string;
  }>> {
    try {
      const stdout = await run('smbstatus', ['-b', '-j']);
      const data = JSON.parse(stdout);
      if (!data.sessions) return [];

      return Object.values(data.sessions).map((s: any) => ({
        pid: s.session_id || 0,
        username: s.username || 'unknown',
        group: s.groupname || '',
        machine: s.remote_machine || '',
        protocol: s.protocol_ver || '',
        connectedAt: s.signing || '',
      }));
    } catch {
      // Fallback to text parsing
      try {
        const stdout = await run('smbstatus', ['-b']);
        return stdout
          .split('\n')
          .slice(4)
          .filter((l) => l.trim())
          .map((line) => {
            const parts = line.trim().split(/\s+/);
            return {
              pid: parseInt(parts[0]) || 0,
              username: parts[1] || 'unknown',
              group: parts[2] || '',
              machine: parts[3] || '',
              protocol: parts[4] || '',
              connectedAt: '',
            };
          });
      } catch {
        return [];
      }
    }
  }

  async getOpenFiles(): Promise<Array<{
    pid: number;
    username: string;
    file: string;
    accessMode: string;
  }>> {
    try {
      const stdout = await run('smbstatus', ['-L']);
      return stdout
        .split('\n')
        .slice(4)
        .filter((l) => l.trim())
        .map((line) => {
          const parts = line.trim().split(/\s+/);
          return {
            pid: parseInt(parts[0]) || 0,
            username: parts[1] || '',
            accessMode: parts[2] || '',
            file: parts.slice(5).join(' ') || '',
          };
        });
    } catch {
      return [];
    }
  }
}
