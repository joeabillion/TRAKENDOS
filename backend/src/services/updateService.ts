import { execSync } from 'child_process';
import Database from 'better-sqlite3';
import { v4 as uuidv4 } from 'uuid';
import * as cron from 'node-cron';
import { EventLogger } from './eventLogger';
import { MayaService } from './mayaService';

export interface UpdateInfo {
  currentVersion: string;
  latestVersion: string;
  latestTag?: string;
  hasUpdate: boolean;
  commits: Array<{ hash: string; message: string; author: string; date: string }>;
  lastChecked: number;
}

export interface UpdateHistory {
  id: string;
  version: string;
  from_version: string;
  status: 'pending' | 'in_progress' | 'completed' | 'failed';
  timestamp: number;
  completed_at?: number;
  error?: string;
  changelog?: string;
}

export class UpdateService {
  private db: Database.Database;
  private logger: EventLogger;
  private mayaService?: MayaService;
  private repoPath: string;
  private gitUrl: string;
  private cronJob?: cron.ScheduledTask;
  private lastCheckResult?: UpdateInfo;
  private lastCheckTime: number = 0;

  constructor(db: Database.Database, logger: EventLogger, repoPath: string, gitUrl: string) {
    this.db = db;
    this.logger = logger;
    this.repoPath = repoPath;
    this.gitUrl = gitUrl;
    this.initializeTable();
  }

  /**
   * Set Maya reference so update service can send notifications through her
   */
  setMayaService(maya: MayaService): void {
    this.mayaService = maya;
  }

  /**
   * Start daily automatic update checks.
   * Runs once on startup, then every 24 hours (configurable).
   */
  startDailyCheck(intervalHours: number = 24): void {
    // Run immediately on startup (after 30 second delay to let services initialize)
    setTimeout(() => {
      this.performScheduledCheck();
    }, 30000);

    // Schedule recurring check — every N hours
    // Cron: "0 */N * * *" means at minute 0 of every Nth hour
    const cronExpr = `0 */${Math.max(1, intervalHours)} * * *`;
    this.cronJob = cron.schedule(cronExpr, () => {
      this.performScheduledCheck();
    });

    this.logger.info('SYSTEM', `Update auto-check scheduled every ${intervalHours} hours`);
  }

  /**
   * Stop the daily check cron job
   */
  stopDailyCheck(): void {
    if (this.cronJob) {
      this.cronJob.stop();
      this.cronJob = undefined;
      this.logger.info('SYSTEM', 'Update auto-check stopped');
    }
  }

  /**
   * Performs a scheduled check and sends Maya notification if update available
   */
  private async performScheduledCheck(): Promise<void> {
    try {
      const updateInfo = await this.checkForUpdates();

      if (updateInfo.hasUpdate && this.mayaService) {
        const commitSummary = updateInfo.commits
          .slice(0, 5)
          .map((c) => `• ${c.message}`)
          .join('\n');

        const moreCount = Math.max(0, updateInfo.commits.length - 5);
        const moreText = moreCount > 0 ? `\n...and ${moreCount} more commits` : '';

        this.mayaService.createNotification(
          'info',
          'Trakend OS Update Available',
          `Version ${updateInfo.latestVersion} is available (current: ${updateInfo.currentVersion}).\n\nChangelog:\n${commitSummary}${moreText}\n\nGo to Settings > Updates to install.`,
          'medium',
          { type: 'optimize', target: 'update' }
        );

        this.logger.info('SYSTEM', `Update available: ${updateInfo.currentVersion} -> ${updateInfo.latestVersion}`);
      } else {
        this.logger.debug('SYSTEM', 'No updates available');
      }
    } catch (error) {
      this.logger.warn('SYSTEM', `Scheduled update check failed: ${error}`);
    }
  }

  private initializeTable(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS update_history (
        id TEXT PRIMARY KEY,
        version TEXT NOT NULL,
        from_version TEXT NOT NULL,
        status TEXT NOT NULL,
        timestamp INTEGER NOT NULL,
        completed_at INTEGER,
        error TEXT,
        changelog TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_updates_timestamp ON update_history(timestamp);
    `);
  }

  async getCurrentVersion(): Promise<string> {
    try {
      const tag = execSync(`git -C ${this.repoPath} describe --tags --always`, {
        encoding: 'utf-8',
      }).trim();
      return tag || '1.0.000';
    } catch {
      return '1.0.000';
    }
  }

  async checkForUpdates(): Promise<UpdateInfo> {
    try {
      const currentVersion = await this.getCurrentVersion();

      // Fetch latest info from remote
      execSync(`git -C ${this.repoPath} fetch origin`, { stdio: 'pipe', timeout: 30000 });

      let latestVersion = currentVersion;
      let latestTag = '';

      try {
        latestTag = execSync(`git -C ${this.repoPath} describe --tags origin/main --abbrev=0`, {
          encoding: 'utf-8',
        }).trim();
        latestVersion = latestTag;
      } catch {
        const latestCommit = execSync(`git -C ${this.repoPath} rev-parse origin/main`, {
          encoding: 'utf-8',
        }).trim();
        latestVersion = latestCommit.substring(0, 8);
      }

      const hasUpdate = currentVersion !== latestVersion;
      const commits: UpdateInfo['commits'] = [];

      if (hasUpdate) {
        try {
          const commitLog = execSync(
            `git -C ${this.repoPath} log ${currentVersion}..origin/main --oneline --format='%H|%s|%an|%ai'`,
            { encoding: 'utf-8' }
          );
          const lines = commitLog.trim().split('\n').filter((l) => l);
          for (const line of lines) {
            const parts = line.split('|');
            commits.push({
              hash: (parts[0] || '').substring(0, 8),
              message: parts[1] || '',
              author: parts[2] || '',
              date: parts[3] || '',
            });
          }
        } catch {
          // No commits found between versions
        }
      }

      this.lastCheckTime = Date.now();
      this.lastCheckResult = {
        currentVersion,
        latestVersion,
        latestTag,
        hasUpdate,
        commits,
        lastChecked: this.lastCheckTime,
      };

      this.logger.info('SYSTEM', `Update check completed. Current: ${currentVersion}, Latest: ${latestVersion}`, {
        hasUpdate,
      });

      return this.lastCheckResult;
    } catch (error) {
      this.logger.error('SYSTEM', `Failed to check for updates: ${error}`);
      throw error;
    }
  }

  /**
   * Get the cached result of the last update check (avoids hitting git repeatedly)
   */
  getLastCheckResult(): UpdateInfo | null {
    return this.lastCheckResult || null;
  }

  /**
   * Get timestamp of last update check
   */
  getLastCheckTime(): number {
    return this.lastCheckTime;
  }

  async applyUpdate(): Promise<UpdateHistory> {
    const updateId = uuidv4();

    try {
      const currentVersion = await this.getCurrentVersion();
      const updateInfo = await this.checkForUpdates();

      if (!updateInfo.hasUpdate) {
        throw new Error('No update available');
      }

      const updateRecord: UpdateHistory = {
        id: updateId,
        version: updateInfo.latestVersion,
        from_version: currentVersion,
        status: 'in_progress',
        timestamp: Date.now(),
        changelog: updateInfo.commits.map((c) => `${c.hash}: ${c.message}`).join('\n'),
      };

      this.saveUpdate(updateRecord);

      this.logger.info('SYSTEM', 'Applying update...', {
        from: currentVersion,
        to: updateInfo.latestVersion,
      });

      // Notify Maya
      if (this.mayaService) {
        this.mayaService.createNotification(
          'info',
          'Update In Progress',
          `Updating from ${currentVersion} to ${updateInfo.latestVersion}. The server will restart shortly.`,
          'high'
        );
      }

      // Pull latest changes
      execSync(`git -C ${this.repoPath} pull origin main`, { stdio: 'pipe', timeout: 120000 });

      // Rebuild backend
      try {
        execSync(`npm install --prefix ${this.repoPath}/backend`, { stdio: 'pipe', timeout: 120000 });
        execSync(`npm run build --prefix ${this.repoPath}/backend`, { stdio: 'pipe', timeout: 120000 });
      } catch (buildErr) {
        this.logger.warn('SYSTEM', `Post-update build step had issues: ${buildErr}`);
      }

      // Rebuild frontend
      try {
        execSync(`npm install --prefix ${this.repoPath}/frontend`, { stdio: 'pipe', timeout: 120000 });
        execSync(`npm run build --prefix ${this.repoPath}/frontend`, { stdio: 'pipe', timeout: 120000 });
      } catch (buildErr) {
        this.logger.warn('SYSTEM', `Frontend rebuild had issues: ${buildErr}`);
      }

      updateRecord.status = 'completed';
      updateRecord.completed_at = Date.now();
      this.saveUpdate(updateRecord);

      this.logger.info('SYSTEM', 'Update applied successfully. Restarting...', {
        from: currentVersion,
        to: updateInfo.latestVersion,
      });

      // Schedule restart (systemd will auto-restart the service)
      setTimeout(() => {
        process.exit(0);
      }, 3000);

      return updateRecord;
    } catch (error) {
      this.logger.error('SYSTEM', `Update failed: ${error}`);

      if (this.mayaService) {
        this.mayaService.createNotification(
          'error',
          'Update Failed',
          `Failed to update: ${error}. The system is still running on the previous version.`,
          'high'
        );
      }

      const failedUpdate: UpdateHistory = {
        id: updateId,
        version: 'unknown',
        from_version: await this.getCurrentVersion(),
        status: 'failed',
        timestamp: Date.now(),
        completed_at: Date.now(),
        error: String(error),
      };

      this.saveUpdate(failedUpdate);
      throw error;
    }
  }

  private saveUpdate(update: UpdateHistory): void {
    const existing = this.db.prepare('SELECT id FROM update_history WHERE id = ?').get(update.id);

    if (existing) {
      this.db.prepare(`
        UPDATE update_history
        SET status = ?, completed_at = ?, error = ?
        WHERE id = ?
      `).run(update.status, update.completed_at || null, update.error || null, update.id);
    } else {
      this.db.prepare(`
        INSERT INTO update_history (id, version, from_version, status, timestamp, completed_at, error, changelog)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        update.id,
        update.version,
        update.from_version,
        update.status,
        update.timestamp,
        update.completed_at || null,
        update.error || null,
        update.changelog || null
      );
    }
  }

  getHistory(limit: number = 50): UpdateHistory[] {
    return this.db
      .prepare('SELECT * FROM update_history ORDER BY timestamp DESC LIMIT ?')
      .all(limit) as UpdateHistory[];
  }
}
