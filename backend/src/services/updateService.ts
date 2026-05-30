import { execSync } from 'child_process';
import Database from 'better-sqlite3';
import { v4 as uuidv4 } from 'uuid';
import * as cron from 'node-cron';
import { EventLogger } from './eventLogger';
import { MayaService } from './mayaService';
import { DEFAULT_CONFIG } from '../config/default';

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
  private lastNotifiedHash: string = '';

  constructor(db: Database.Database, logger: EventLogger, repoPath: string, gitUrl: string) {
    this.db = db;
    this.logger = logger;
    this.repoPath = repoPath;
    this.gitUrl = gitUrl;
    this.initializeTable();
  }

  setMayaService(maya: MayaService): void {
    this.mayaService = maya;
  }

  startDailyCheck(intervalHours: number = 24): void {
    setTimeout(() => {
      this.performScheduledCheck();
    }, 30000);

    const cronExpr = `0 */${Math.max(1, intervalHours)} * * *`;
    this.cronJob = cron.schedule(cronExpr, () => {
      this.performScheduledCheck();
    });

    this.logger.info('SYSTEM', `Update auto-check scheduled every ${intervalHours} hours`);
  }

  stopDailyCheck(): void {
    if (this.cronJob) {
      this.cronJob.stop();
      this.cronJob = undefined;
      this.logger.info('SYSTEM', 'Update auto-check stopped');
    }
  }

  private async performScheduledCheck(): Promise<void> {
    try {
      const updateInfo = await this.checkForUpdates();

      if (updateInfo.hasUpdate && this.mayaService) {
        let latestHash = '';
        try {
          const branch = this.getCurrentBranch();
          latestHash = this.getFullHash(`origin/${branch}`);
        } catch {}

        if (latestHash && latestHash === this.lastNotifiedHash) {
          this.logger.debug('SYSTEM', 'Update available but already notified - skipping duplicate notification');
          return;
        }

        const commitSummary = updateInfo.commits
          .slice(0, 5)
          .map((c) => `- ${c.message}`)
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

        this.lastNotifiedHash = latestHash;
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

  private getCurrentBranch(): string {
    try {
      const branch = execSync(`git -C "${this.repoPath}" rev-parse --abbrev-ref HEAD`, {
        encoding: 'utf-8',
        stdio: 'pipe',
        timeout: 5000,
      }).trim();
      if (branch && branch !== 'HEAD') return branch;
    } catch {}
    return DEFAULT_CONFIG.GIT.BRANCH || 'main';
  }

  private getFullHash(ref: string): string {
    return execSync(`git -C "${this.repoPath}" rev-parse "${ref}"`, {
      encoding: 'utf-8',
      stdio: 'pipe',
      timeout: 10000,
    }).trim();
  }

  async getCurrentVersion(): Promise<string> {
    try {
      const tag = execSync(`git -C "${this.repoPath}" describe --tags --always`, {
        encoding: 'utf-8',
      }).trim();
      return tag || '1.0.000';
    } catch {
      return '1.0.000';
    }
  }

  private isGitRepo(): boolean {
    try {
      execSync(`git -C "${this.repoPath}" rev-parse --is-inside-work-tree`, {
        encoding: 'utf-8',
        stdio: 'pipe',
        timeout: 5000,
      });
      return true;
    } catch {
      return false;
    }
  }

  async checkForUpdates(): Promise<UpdateInfo> {
    try {
      if (!this.isGitRepo()) {
        this.logger.debug('SYSTEM', 'No git repository found - skipping update check');
        return {
          currentVersion: '1.0.000',
          latestVersion: '1.0.000',
          hasUpdate: false,
          commits: [],
          lastChecked: Date.now(),
        };
      }

      const branch = this.getCurrentBranch();
      const remoteRef = `origin/${branch}`;

      try {
        execSync(`git -C "${this.repoPath}" fetch origin`, { stdio: 'pipe', timeout: 30000 });
      } catch (fetchErr) {
        this.logger.debug('SYSTEM', `git fetch failed (offline?): ${fetchErr}`);
        if (this.lastCheckResult) return this.lastCheckResult;
      }

      let currentHash = '';
      let latestHash = '';
      try {
        currentHash = this.getFullHash('HEAD');
        latestHash = this.getFullHash(remoteRef);
      } catch (refErr) {
        this.logger.debug('SYSTEM', `Failed to resolve refs: ${refErr}`);
        const cur = await this.getCurrentVersion();
        const noUpdate: UpdateInfo = {
          currentVersion: cur,
          latestVersion: cur,
          hasUpdate: false,
          commits: [],
          lastChecked: Date.now(),
        };
        this.lastCheckTime = noUpdate.lastChecked;
        this.lastCheckResult = noUpdate;
        return noUpdate;
      }

      const hasUpdate = currentHash !== latestHash;

      const currentVersion = await this.getCurrentVersion();
      let latestVersion = currentVersion;
      let latestTag = '';
      if (hasUpdate) {
        try {
          latestTag = execSync(`git -C "${this.repoPath}" describe --tags "${remoteRef}" --abbrev=0`, {
            encoding: 'utf-8',
            stdio: 'pipe',
          }).trim();
          latestVersion = latestTag || latestHash.substring(0, 7);
        } catch {
          latestVersion = latestHash.substring(0, 7);
        }
      } else {
        latestVersion = currentVersion;
      }

      const commits: UpdateInfo['commits'] = [];
      if (hasUpdate) {
        try {
          const commitLog = execSync(
            `git -C "${this.repoPath}" log ${currentHash}..${latestHash} --oneline --format='%H|%s|%an|%ai'`,
            { encoding: 'utf-8', stdio: 'pipe' }
          );
          const lines = commitLog.trim().split('\n').filter((l) => l);
          for (const line of lines) {
            const parts = line.split('|');
            commits.push({
              hash: (parts[0] || '').substring(0, 7),
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

      this.logger.info(
        'SYSTEM',
        `Update check completed (branch=${branch}). Current: ${currentVersion} (${currentHash.substring(0, 7)}), Latest: ${latestVersion} (${latestHash.substring(0, 7)})`,
        { hasUpdate }
      );

      return this.lastCheckResult;
    } catch (error) {
      this.logger.error('SYSTEM', `Failed to check for updates: ${error}`);
      throw error;
    }
  }

  getLastCheckResult(): UpdateInfo | null {
    return this.lastCheckResult || null;
  }

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

      if (this.mayaService) {
        this.mayaService.createNotification(
          'info',
          'Update In Progress',
          `Updating from ${currentVersion} to ${updateInfo.latestVersion}. The server will restart shortly.`,
          'high'
        );
      }

      const branch = this.getCurrentBranch();
      execSync(`git -C "${this.repoPath}" pull --ff-only origin "${branch}"`, {
        stdio: 'pipe',
        timeout: 120000,
      });

      try {
        execSync(`npm install --prefix "${this.repoPath}/backend"`, { stdio: 'pipe', timeout: 120000 });
        execSync(`npm run build --prefix "${this.repoPath}/backend"`, { stdio: 'pipe', timeout: 120000 });
      } catch (buildErr) {
        this.logger.warn('SYSTEM', `Post-update build step had issues: ${buildErr}`);
      }

      try {
        execSync(`npm install --prefix "${this.repoPath}/frontend"`, { stdio: 'pipe', timeout: 120000 });
        execSync(`npm run build --prefix "${this.repoPath}/frontend"`, { stdio: 'pipe', timeout: 120000 });
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
