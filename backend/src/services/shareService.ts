import { exec } from 'child_process';
import { promisify } from 'util';
import fs from 'fs';
import fsp from 'fs/promises';
import path from 'path';
import Database from 'better-sqlite3';
import { EventLogger } from './eventLogger';

const execAsync = promisify(exec);

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
      const { stdout: ver } = await execAsync('smbd --version 2>/dev/null');
      result.installed = true;
      result.version = ver.trim();
    } catch {
      return result;
    }

    try {
      const { stdout: status } = await execAsync('systemctl is-active smbd 2>/dev/null');
      result.running = status.trim() === 'active';
    } catch {
      result.running = false;
    }

    try {
      const { stdout: conns } = await execAsync("smbstatus -b 2>/dev/null | grep -c '^[0-9]' || echo 0");
      result.connections = parseInt(conns.trim()) || 0;
    } catch {
      result.connections = 0;
    }

    return result;
  }

  async startSamba(): Promise<void> {
    await execAsync('systemctl start smbd nmbd 2>/dev/null');
    await execAsync('systemctl enable smbd nmbd 2>/dev/null');
    this.logger.info('SHARES', 'Samba services started');
  }

  async stopSamba(): Promise<void> {
    await execAsync('systemctl stop smbd nmbd 2>/dev/null');
    this.logger.info('SHARES', 'Samba services stopped');
  }

  async restartSamba(): Promise<void> {
    await execAsync('systemctl restart smbd nmbd 2>/dev/null');
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

  async createUser(username: string, password: string, homeDir?: string): Promise<ShareUser> {
    // Validate username (alphanumeric + underscore, 2-32 chars)
    if (!/^[a-zA-Z][a-zA-Z0-9_]{1,31}$/.test(username)) {
      throw new Error('Invalid username. Must be 2-32 chars, start with letter, alphanumeric + underscore only.');
    }

    const userHome = homeDir || `/data/shares/${username}`;

    // Create Linux system user
    try {
      await execAsync(`id ${username} 2>/dev/null`);
      // User exists — just update password
    } catch {
      // Create user with home directory
      await execAsync(`useradd -m -d "${userHome}" -s /usr/sbin/nologin ${username} 2>/dev/null || true`);
    }

    // Create home directory
    await fsp.mkdir(userHome, { recursive: true });
    await execAsync(`chown ${username}:${username} "${userHome}" 2>/dev/null || true`);
    await execAsync(`chmod 750 "${userHome}"`);

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
    await this.setSambaPassword(username, password);
    this.db.prepare("UPDATE share_users SET updated_at = datetime('now') WHERE username = ?").run(username);
    this.logger.info('SHARES', `Updated password for share user: ${username}`);
  }

  async toggleUser(username: string, enabled: boolean): Promise<void> {
    if (enabled) {
      await execAsync(`smbpasswd -e ${username} 2>/dev/null || true`);
    } else {
      await execAsync(`smbpasswd -d ${username} 2>/dev/null || true`);
    }
    this.db.prepare("UPDATE share_users SET enabled = ?, updated_at = datetime('now') WHERE username = ?")
      .run(enabled ? 1 : 0, username);
    this.logger.info('SHARES', `${enabled ? 'Enabled' : 'Disabled'} share user: ${username}`);
  }

  async deleteUser(username: string): Promise<void> {
    // Remove Samba password
    await execAsync(`smbpasswd -x ${username} 2>/dev/null || true`);

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
    // Use smbpasswd to set the password non-interactively
    await execAsync(`(echo "${password}"; echo "${password}") | smbpasswd -a -s ${username} 2>/dev/null`);
  }

  // ═══════════════════════════════════════════
  // Share Management
  // ═══════════════════════════════════════════

  getShares(): SambaShare[] {
    const rows = this.db.prepare('SELECT * FROM samba_shares ORDER BY name').all() as any[];
    return rows.map(r => ({
      id: r.id,
      name: r.name,
      path: r.path,
      comment: r.comment,
      browseable: !!r.browseable,
      readOnly: !!r.read_only,
      guestOk: !!r.guest_ok,
      validUsers: r.valid_users ? r.valid_users.split(',').filter((u: string) => u) : [],
      writableUsers: r.writable_users ? r.writable_users.split(',').filter((u: string) => u) : [],
      createdAt: r.created_at,
      updatedAt: r.updated_at,
    }));
  }

  getShare(name: string): SambaShare | null {
    const row = this.db.prepare('SELECT * FROM samba_shares WHERE name = ?').get(name) as any;
    if (!row) return null;
    return {
      id: row.id,
      name: row.name,
      path: row.path,
      comment: row.comment,
      browseable: !!row.browseable,
      readOnly: !!row.read_only,
      guestOk: !!row.guest_ok,
      validUsers: row.valid_users ? row.valid_users.split(',').filter((u: string) => u) : [],
      writableUsers: row.writable_users ? row.writable_users.split(',').filter((u: string) => u) : [],
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
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
  }): Promise<SambaShare> {
    // Validate share name
    if (!/^[a-zA-Z][a-zA-Z0-9_\- ]{0,63}$/.test(options.name)) {
      throw new Error('Invalid share name. Must start with letter, max 64 chars.');
    }

    // Ensure path exists
    await fsp.mkdir(options.path, { recursive: true });

    this.db.prepare(`
      INSERT INTO samba_shares (name, path, comment, browseable, read_only, guest_ok, valid_users, writable_users)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      options.name,
      options.path,
      options.comment || '',
      options.browseable !== false ? 1 : 0,
      options.readOnly ? 1 : 0,
      options.guestOk ? 1 : 0,
      (options.validUsers || []).join(','),
      (options.writableUsers || []).join(','),
    );

    this.logger.info('SHARES', `Created share: ${options.name} -> ${options.path}`);
    await this.regenerateConfig();

    return this.getShare(options.name)!;
  }

  async updateShare(name: string, updates: Partial<{
    path: string;
    comment: string;
    browseable: boolean;
    readOnly: boolean;
    guestOk: boolean;
    validUsers: string[];
    writableUsers: string[];
  }>): Promise<SambaShare> {
    const existing = this.getShare(name);
    if (!existing) throw new Error(`Share not found: ${name}`);

    const merged = {
      path: updates.path ?? existing.path,
      comment: updates.comment ?? existing.comment,
      browseable: updates.browseable ?? existing.browseable,
      readOnly: updates.readOnly ?? existing.readOnly,
      guestOk: updates.guestOk ?? existing.guestOk,
      validUsers: updates.validUsers ?? existing.validUsers,
      writableUsers: updates.writableUsers ?? existing.writableUsers,
    };

    this.db.prepare(`
      UPDATE samba_shares SET
        path = ?, comment = ?, browseable = ?, read_only = ?, guest_ok = ?,
        valid_users = ?, writable_users = ?, updated_at = datetime('now')
      WHERE name = ?
    `).run(
      merged.path, merged.comment,
      merged.browseable ? 1 : 0, merged.readOnly ? 1 : 0, merged.guestOk ? 1 : 0,
      merged.validUsers.join(','), merged.writableUsers.join(','),
      name,
    );

    this.logger.info('SHARES', `Updated share: ${name}`);
    await this.regenerateConfig();

    return this.getShare(name)!;
  }

  async deleteShare(name: string): Promise<void> {
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
      }
    }
  }

  // ═══════════════════════════════════════════
  // Samba Config Generation
  // ═══════════════════════════════════════════

  async regenerateConfig(): Promise<void> {
    const shares = this.getShares();

    let config = `# Trakend OS Samba Configuration
# Auto-generated — do not edit manually
# Changes made here will be overwritten

[global]
   workgroup = TRAKEND
   server string = Trakend OS Server
   server role = standalone server
   log file = /var/log/samba/log.%m
   max log size = 1000
   logging = file
   panic action = /usr/share/samba/panic-action %d
   obey pam restrictions = yes
   unix password sync = yes
   passwd program = /usr/bin/passwd %u
   passwd chat = *Enter\\snew\\s*\\spassword:* %n\\n *Retype\\snew\\s*\\spassword:* %n\\n *password\\supdated\\ssuccessfully* .
   pam password change = yes
   map to guest = bad user
   usershare allow guests = no
   security = user
   min protocol = SMB2
   ea support = yes
   vfs objects = fruit streams_xattr
   fruit:metadata = stream
   fruit:model = MacSamba
   fruit:posix_rename = yes
   fruit:veto_appledouble = no
   fruit:nfs_aces = no
   fruit:wipe_intentionally_left_blank_rfork = yes
   fruit:delete_empty_adfiles = yes
`;

    for (const share of shares) {
      config += `
[${share.name}]
   path = ${share.path}
   comment = ${share.comment}
   browseable = ${share.browseable ? 'yes' : 'no'}
   read only = ${share.readOnly ? 'yes' : 'no'}
   guest ok = ${share.guestOk ? 'yes' : 'no'}
   create mask = 0664
   directory mask = 0775
   force create mode = 0664
   force directory mode = 0775
`;

      if (share.validUsers.length > 0) {
        config += `   valid users = ${share.validUsers.join(' ')}\n`;
      }
      if (share.writableUsers.length > 0) {
        config += `   write list = ${share.writableUsers.join(' ')}\n`;
      }
    }

    // Write config
    try {
      await fsp.writeFile('/etc/samba/smb.conf', config);
      // Test config
      await execAsync('testparm -s 2>/dev/null || true');
      // Reload Samba
      await execAsync('systemctl reload smbd 2>/dev/null || true');
      this.logger.info('SHARES', 'Samba config regenerated and reloaded');
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
      const { stdout } = await execAsync('smbstatus -b -j 2>/dev/null || echo "[]"');
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
        const { stdout } = await execAsync("smbstatus -b 2>/dev/null | tail -n +5");
        return stdout.trim().split('\n').filter(l => l.trim()).map(line => {
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
      const { stdout } = await execAsync("smbstatus -L 2>/dev/null | tail -n +5");
      return stdout.trim().split('\n').filter(l => l.trim()).map(line => {
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
