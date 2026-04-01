import Database from 'better-sqlite3';
import { v4 as uuidv4 } from 'uuid';

export interface SettingsRecord {
  id: string;
  key: string;
  value: string;
  category: string;
  created_at: number;
  updated_at: number;
}

export interface SSHSettings {
  port: number;
  enabled: boolean;
  permitRootLogin: boolean;
  passwordAuth: boolean;
  pubkeyAuth: boolean;
  allowedUsers: string[];
}

export interface DockerSettings {
  daemon_socket: string;
  log_driver: string;
  storage_driver: string;
  max_concurrent_downloads: number;
  max_concurrent_uploads: number;
}

export interface ThemeSettings {
  mode: 'light' | 'dark' | 'auto';
  primaryColor: string;
  accentColor: string;
  fontSize: number;
}

export interface GeneralSettings {
  hostname: string;
  timezone: string;
  ntp_enabled: boolean;
  ntp_servers: string[];
}

export interface MayaSettings {
  enabled: boolean;
  ollama_url: string;
  model: string;
  auto_repair: boolean;
  auto_optimize: boolean;
}

export interface UpdateSettings {
  auto_check: boolean;
  auto_update: boolean;
  check_interval_hours: number;
  update_channel: 'stable' | 'beta' | 'dev';
}

export class SettingsModel {
  private db: Database.Database;

  constructor(db: Database.Database) {
    this.db = db;
    this.initializeTable();
  }

  private initializeTable(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS settings (
        id TEXT PRIMARY KEY,
        key TEXT NOT NULL UNIQUE,
        value TEXT NOT NULL,
        category TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_settings_category ON settings(category);
    `);
  }

  get(key: string): SettingsRecord | null {
    const stmt = this.db.prepare('SELECT * FROM settings WHERE key = ?');
    return stmt.get(key) as SettingsRecord | null;
  }

  getByCategory(category: string): SettingsRecord[] {
    const stmt = this.db.prepare('SELECT * FROM settings WHERE category = ? ORDER BY key');
    return stmt.all(category) as SettingsRecord[];
  }

  set(key: string, value: string, category: string): SettingsRecord {
    const now = Date.now();
    const existing = this.get(key);

    if (existing) {
      const stmt = this.db.prepare(`
        UPDATE settings SET value = ?, updated_at = ? WHERE key = ?
      `);
      stmt.run(value, now, key);
      return { ...existing, value, updated_at: now };
    }

    const id = uuidv4();
    const stmt = this.db.prepare(`
      INSERT INTO settings (id, key, value, category, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `);
    stmt.run(id, key, value, category, now, now);

    return { id, key, value, category, created_at: now, updated_at: now };
  }

  delete(key: string): boolean {
    const stmt = this.db.prepare('DELETE FROM settings WHERE key = ?');
    const result = stmt.run(key);
    return result.changes > 0;
  }

  getSSHSettings(): SSHSettings {
    const defaults: SSHSettings = {
      port: 22,
      enabled: true,
      permitRootLogin: false,
      passwordAuth: true,
      pubkeyAuth: true,
      allowedUsers: [],
    };

    try {
      const port = this.get('ssh_port');
      const enabled = this.get('ssh_enabled');
      const permitRoot = this.get('ssh_permit_root_login');
      const passwordAuth = this.get('ssh_password_auth');
      const pubkeyAuth = this.get('ssh_pubkey_auth');
      const allowedUsers = this.get('ssh_allowed_users');

      return {
        port: port ? parseInt(port.value, 10) : defaults.port,
        enabled: enabled ? enabled.value === 'true' : defaults.enabled,
        permitRootLogin: permitRoot ? permitRoot.value === 'true' : defaults.permitRootLogin,
        passwordAuth: passwordAuth ? passwordAuth.value === 'true' : defaults.passwordAuth,
        pubkeyAuth: pubkeyAuth ? pubkeyAuth.value === 'true' : defaults.pubkeyAuth,
        allowedUsers: allowedUsers ? JSON.parse(allowedUsers.value) : defaults.allowedUsers,
      };
    } catch {
      return defaults;
    }
  }

  setSSHSettings(settings: SSHSettings): void {
    this.set('ssh_port', settings.port.toString(), 'ssh');
    this.set('ssh_enabled', settings.enabled.toString(), 'ssh');
    this.set('ssh_permit_root_login', settings.permitRootLogin.toString(), 'ssh');
    this.set('ssh_password_auth', settings.passwordAuth.toString(), 'ssh');
    this.set('ssh_pubkey_auth', settings.pubkeyAuth.toString(), 'ssh');
    this.set('ssh_allowed_users', JSON.stringify(settings.allowedUsers), 'ssh');
  }

  getDockerSettings(): DockerSettings {
    const defaults: DockerSettings = {
      daemon_socket: '/var/run/docker.sock',
      log_driver: 'json-file',
      storage_driver: 'overlay2',
      max_concurrent_downloads: 3,
      max_concurrent_uploads: 5,
    };

    try {
      const socket = this.get('docker_socket');
      const logDriver = this.get('docker_log_driver');
      const storageDriver = this.get('docker_storage_driver');
      const maxDownloads = this.get('docker_max_downloads');
      const maxUploads = this.get('docker_max_uploads');

      return {
        daemon_socket: socket?.value || defaults.daemon_socket,
        log_driver: logDriver?.value || defaults.log_driver,
        storage_driver: storageDriver?.value || defaults.storage_driver,
        max_concurrent_downloads: maxDownloads ? parseInt(maxDownloads.value, 10) : defaults.max_concurrent_downloads,
        max_concurrent_uploads: maxUploads ? parseInt(maxUploads.value, 10) : defaults.max_concurrent_uploads,
      };
    } catch {
      return defaults;
    }
  }

  setDockerSettings(settings: DockerSettings): void {
    this.set('docker_socket', settings.daemon_socket, 'docker');
    this.set('docker_log_driver', settings.log_driver, 'docker');
    this.set('docker_storage_driver', settings.storage_driver, 'docker');
    this.set('docker_max_downloads', settings.max_concurrent_downloads.toString(), 'docker');
    this.set('docker_max_uploads', settings.max_concurrent_uploads.toString(), 'docker');
  }

  getThemeSettings(): ThemeSettings {
    const defaults: ThemeSettings = {
      mode: 'auto',
      primaryColor: '#3b82f6',
      accentColor: '#8b5cf6',
      fontSize: 14,
    };

    try {
      const mode = this.get('theme_mode');
      const primary = this.get('theme_primary_color');
      const accent = this.get('theme_accent_color');
      const fontSize = this.get('theme_font_size');

      return {
        mode: (mode?.value as 'light' | 'dark' | 'auto') || defaults.mode,
        primaryColor: primary?.value || defaults.primaryColor,
        accentColor: accent?.value || defaults.accentColor,
        fontSize: fontSize ? parseInt(fontSize.value, 10) : defaults.fontSize,
      };
    } catch {
      return defaults;
    }
  }

  setThemeSettings(settings: ThemeSettings): void {
    this.set('theme_mode', settings.mode, 'theme');
    this.set('theme_primary_color', settings.primaryColor, 'theme');
    this.set('theme_accent_color', settings.accentColor, 'theme');
    this.set('theme_font_size', settings.fontSize.toString(), 'theme');
  }

  getGeneralSettings(): GeneralSettings {
    const defaults: GeneralSettings = {
      hostname: 'trakend-os',
      timezone: 'UTC',
      ntp_enabled: true,
      ntp_servers: ['0.pool.ntp.org', '1.pool.ntp.org'],
    };

    try {
      const hostname = this.get('general_hostname');
      const timezone = this.get('general_timezone');
      const ntpEnabled = this.get('general_ntp_enabled');
      const ntpServers = this.get('general_ntp_servers');

      return {
        hostname: hostname?.value || defaults.hostname,
        timezone: timezone?.value || defaults.timezone,
        ntp_enabled: ntpEnabled ? ntpEnabled.value === 'true' : defaults.ntp_enabled,
        ntp_servers: ntpServers ? JSON.parse(ntpServers.value) : defaults.ntp_servers,
      };
    } catch {
      return defaults;
    }
  }

  setGeneralSettings(settings: GeneralSettings): void {
    this.set('general_hostname', settings.hostname, 'general');
    this.set('general_timezone', settings.timezone, 'general');
    this.set('general_ntp_enabled', settings.ntp_enabled.toString(), 'general');
    this.set('general_ntp_servers', JSON.stringify(settings.ntp_servers), 'general');
  }

  getMayaSettings(): MayaSettings {
    const defaults: MayaSettings = {
      enabled: true,
      ollama_url: 'http://localhost:11434',
      model: 'neural-chat',
      auto_repair: false,
      auto_optimize: false,
    };

    try {
      const enabled = this.get('maya_enabled');
      const ollamaUrl = this.get('maya_ollama_url');
      const model = this.get('maya_model');
      const autoRepair = this.get('maya_auto_repair');
      const autoOptimize = this.get('maya_auto_optimize');

      return {
        enabled: enabled ? enabled.value === 'true' : defaults.enabled,
        ollama_url: ollamaUrl?.value || defaults.ollama_url,
        model: model?.value || defaults.model,
        auto_repair: autoRepair ? autoRepair.value === 'true' : defaults.auto_repair,
        auto_optimize: autoOptimize ? autoOptimize.value === 'true' : defaults.auto_optimize,
      };
    } catch {
      return defaults;
    }
  }

  setMayaSettings(settings: MayaSettings): void {
    this.set('maya_enabled', settings.enabled.toString(), 'maya');
    this.set('maya_ollama_url', settings.ollama_url, 'maya');
    this.set('maya_model', settings.model, 'maya');
    this.set('maya_auto_repair', settings.auto_repair.toString(), 'maya');
    this.set('maya_auto_optimize', settings.auto_optimize.toString(), 'maya');
  }

  getUpdateSettings(): UpdateSettings {
    const defaults: UpdateSettings = {
      auto_check: true,
      auto_update: false,
      check_interval_hours: 24,
      update_channel: 'stable',
    };

    try {
      const autoCheck = this.get('updates_auto_check');
      const autoUpdate = this.get('updates_auto_update');
      const interval = this.get('updates_check_interval');
      const channel = this.get('updates_channel');

      return {
        auto_check: autoCheck ? autoCheck.value === 'true' : defaults.auto_check,
        auto_update: autoUpdate ? autoUpdate.value === 'true' : defaults.auto_update,
        check_interval_hours: interval ? parseInt(interval.value, 10) : defaults.check_interval_hours,
        update_channel: (channel?.value as 'stable' | 'beta' | 'dev') || defaults.update_channel,
      };
    } catch {
      return defaults;
    }
  }

  setUpdateSettings(settings: UpdateSettings): void {
    this.set('updates_auto_check', settings.auto_check.toString(), 'updates');
    this.set('updates_auto_update', settings.auto_update.toString(), 'updates');
    this.set('updates_check_interval', settings.check_interval_hours.toString(), 'updates');
    this.set('updates_channel', settings.update_channel, 'updates');
  }
}
