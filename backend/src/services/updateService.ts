import { execFileSync, ExecFileSyncOptions } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
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
  commitsBehind?: number;
  currentHash?: string;
  latestHash?: string;
  branch?: string;
  isGitRepo?: boolean;
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

export interface UpdateStatus {
  isGitRepo: boolean;
  currentHash: string;
  currentVersion: string;
  currentBranch: string;
  lastCheck: number;
  updateAvailable: boolean;
  commitsBehind: number;
  latestVersion: string;
  commits: UpdateInfo['commits'];
  lastUpdate: UpdateHistory | null;
  updateInProgress: boolean;
  repoUrl: string;
}

/** Paths that, if touched by an update, could affect the GPU driver / kernel / boot. Logged as WARN. */
const SENSITIVE_PATH_RE = /(apt|modprobe|nvidia|cuda|dkms|grub|fstab)/i;

const STEP_TIMEOUT_MS = 10 * 60 * 1000; // 10 minutes per build/install step
const GIT_TIMEOUT_MS = 2 * 60 * 1000;

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
  private updateInProgress: boolean = false;

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
        const latestHash = updateInfo.latestHash || '';

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

  // ---------------------------------------------------------------------------
  // Process helpers — argv arrays only, never shell interpolation
  // ---------------------------------------------------------------------------

  private git(args: string[], timeout: number = GIT_TIMEOUT_MS): string {
    return execFileSync('git', ['-C', this.repoPath, ...args], {
      encoding: 'utf-8',
      stdio: 'pipe',
      timeout,
      maxBuffer: 16 * 1024 * 1024,
    }).toString().trim();
  }

  private run(cmd: string, args: string[], cwd: string, timeout: number = STEP_TIMEOUT_MS): string {
    const opts: ExecFileSyncOptions = {
      cwd,
      encoding: 'utf-8',
      stdio: 'pipe',
      timeout,
      maxBuffer: 64 * 1024 * 1024,
      env: { ...process.env, CI: 'true', NODE_ENV: 'production' },
    };
    return execFileSync(cmd, args, opts).toString();
  }

  private describeError(err: any): string {
    if (!err) return 'unknown error';
    const stderr = err.stderr ? String(err.stderr).trim() : '';
    const stdout = err.stdout ? String(err.stdout).trim() : '';
    const tail = (s: string) => s.split('\n').slice(-15).join('\n');
    const parts = [err.message ? String(err.message).split('\n')[0] : String(err)];
    if (stderr) parts.push(tail(stderr));
    else if (stdout) parts.push(tail(stdout));
    return parts.join('\n');
  }

  // ---------------------------------------------------------------------------
  // Git introspection
  // ---------------------------------------------------------------------------

  getCurrentBranch(): string {
    try {
      const branch = this.git(['rev-parse', '--abbrev-ref', 'HEAD'], 5000);
      if (branch && branch !== 'HEAD') return branch;
    } catch {}
    return DEFAULT_CONFIG.GIT.BRANCH || 'main';
  }

  private getFullHash(ref: string): string {
    return this.git(['rev-parse', '--verify', `${ref}^{commit}`], 10000);
  }

  getCurrentHash(): string {
    try {
      return this.getFullHash('HEAD');
    } catch {
      return '';
    }
  }

  async getCurrentVersion(): Promise<string> {
    try {
      const tag = this.git(['describe', '--tags', '--always'], 10000);
      return tag || '1.0.000';
    } catch {
      return '1.0.000';
    }
  }

  isGitRepo(): boolean {
    try {
      if (!fs.existsSync(path.join(this.repoPath, '.git'))) return false;
      const out = this.git(['rev-parse', '--is-inside-work-tree'], 5000);
      return out === 'true';
    } catch {
      return false;
    }
  }

  /**
   * Bootstrap a git checkout inside an ISO-installed /opt/trakend/os that was
   * shipped without .git. Safe to call only when the directory is NOT already a
   * repo. Existing working-tree files are kept; the checkout is forced onto
   * origin/<branch> so the tree matches the remote exactly.
   */
  async initRepo(branch: string = 'server-live'): Promise<{ branch: string; hash: string }> {
    if (this.isGitRepo()) {
      throw new Error('Repository is already initialized');
    }
    if (!/^[A-Za-z0-9._\/-]+$/.test(branch)) {
      throw new Error(`Invalid branch name: ${branch}`);
    }
    if (!this.gitUrl) {
      throw new Error('No GIT_REPO_URL configured');
    }
    if (this.updateInProgress) {
      throw new Error('An update is already in progress');
    }

    this.logger.info('SYSTEM', `Initializing git repository in ${this.repoPath} from ${this.gitUrl} (${branch})`);

    try {
      this.git(['init'], 30000);
      // Mark as safe for root-owned trees under systemd
      try {
        execFileSync('git', ['config', '--global', '--add', 'safe.directory', this.repoPath], {
          stdio: 'pipe', timeout: 10000,
        });
      } catch {}
      try {
        this.git(['remote', 'remove', 'origin'], 10000);
      } catch {}
      this.git(['remote', 'add', 'origin', this.gitUrl], 10000);
      this.git(['fetch', '--depth=50', 'origin', branch], 5 * 60 * 1000);
      // Checkout -B replaces the working tree with the remote version; anything local
      // (e.g. node_modules, dist, .env) is untracked/ignored and stays.
      this.git(['checkout', '-B', branch, `origin/${branch}`, '--force'], 60000);
      this.git(['branch', `--set-upstream-to=origin/${branch}`, branch], 10000);
      const hash = this.getFullHash('HEAD');
      this.logger.info('SYSTEM', `Repository initialized on ${branch} @ ${hash.substring(0, 7)}`);
      this.lastCheckResult = undefined;
      return { branch, hash };
    } catch (err) {
      const msg = this.describeError(err);
      this.logger.error('SYSTEM', `Repository initialization failed: ${msg}`);
      // Do not leave a half-initialized .git lying around; it would make isGitRepo() true.
      try {
        fs.rmSync(path.join(this.repoPath, '.git'), { recursive: true, force: true });
      } catch {}
      throw new Error(`init-repo failed: ${msg}`);
    }
  }

  // ---------------------------------------------------------------------------
  // Check
  // ---------------------------------------------------------------------------

  async checkForUpdates(): Promise<UpdateInfo> {
    try {
      if (!this.isGitRepo()) {
        this.logger.debug('SYSTEM', 'No git repository found - skipping update check');
        const noRepo: UpdateInfo = {
          currentVersion: '1.0.000',
          latestVersion: '1.0.000',
          hasUpdate: false,
          commits: [],
          lastChecked: Date.now(),
          commitsBehind: 0,
          isGitRepo: false,
        };
        this.lastCheckTime = noRepo.lastChecked;
        this.lastCheckResult = noRepo;
        return noRepo;
      }

      const branch = this.getCurrentBranch();
      const remoteRef = `origin/${branch}`;

      try {
        this.git(['fetch', 'origin', branch], 60000);
      } catch (fetchErr) {
        this.logger.debug('SYSTEM', `git fetch failed (offline?): ${this.describeError(fetchErr)}`);
        if (this.lastCheckResult) return this.lastCheckResult;
      }

      let currentHash = '';
      let latestHash = '';
      try {
        currentHash = this.getFullHash('HEAD');
        latestHash = this.getFullHash(remoteRef);
      } catch (refErr) {
        this.logger.debug('SYSTEM', `Failed to resolve refs: ${this.describeError(refErr)}`);
        const cur = await this.getCurrentVersion();
        const noUpdate: UpdateInfo = {
          currentVersion: cur,
          latestVersion: cur,
          hasUpdate: false,
          commits: [],
          lastChecked: Date.now(),
          commitsBehind: 0,
          currentHash: this.getCurrentHash(),
          branch,
          isGitRepo: true,
        };
        this.lastCheckTime = noUpdate.lastChecked;
        this.lastCheckResult = noUpdate;
        return noUpdate;
      }

      let commitsBehind = 0;
      try {
        commitsBehind = parseInt(this.git(['rev-list', '--count', `${currentHash}..${latestHash}`], 15000), 10) || 0;
      } catch {}

      // "Update available" means the remote is strictly ahead. If we are ahead of
      // remote (local commits) or diverged, ff-only pull would fail, so don't offer it.
      const hasUpdate = currentHash !== latestHash && commitsBehind > 0;

      const currentVersion = await this.getCurrentVersion();
      let latestVersion = currentVersion;
      let latestTag = '';
      if (hasUpdate) {
        try {
          latestTag = this.git(['describe', '--tags', '--abbrev=0', remoteRef], 10000);
          latestVersion = latestTag || latestHash.substring(0, 7);
        } catch {
          latestVersion = latestHash.substring(0, 7);
        }
      }

      const commits: UpdateInfo['commits'] = [];
      if (hasUpdate) {
        try {
          const commitLog = this.git(
            ['log', `${currentHash}..${latestHash}`, '--format=%H%x1f%s%x1f%an%x1f%ai', '--max-count=200'],
            15000
          );
          const lines = commitLog.split('\n').filter((l) => l);
          for (const line of lines) {
            const parts = line.split('\x1f');
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
        commitsBehind,
        currentHash,
        latestHash,
        branch,
        isGitRepo: true,
      };

      this.logger.info(
        'SYSTEM',
        `Update check completed (branch=${branch}). Current: ${currentVersion} (${currentHash.substring(0, 7)}), Latest: ${latestVersion} (${latestHash.substring(0, 7)}), behind=${commitsBehind}`,
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

  isUpdateInProgress(): boolean {
    return this.updateInProgress;
  }

  async getStatus(): Promise<UpdateStatus> {
    const isRepo = this.isGitRepo();
    const cached = this.lastCheckResult;
    const history = this.getHistory(1);
    return {
      isGitRepo: isRepo,
      currentHash: isRepo ? this.getCurrentHash() : '',
      currentVersion: isRepo ? await this.getCurrentVersion() : '1.0.000',
      currentBranch: isRepo ? this.getCurrentBranch() : '',
      lastCheck: this.lastCheckTime,
      updateAvailable: !!(cached && cached.hasUpdate),
      commitsBehind: cached?.commitsBehind || 0,
      latestVersion: cached?.latestVersion || '',
      commits: cached?.commits || [],
      lastUpdate: history.length > 0 ? history[0] : null,
      updateInProgress: this.updateInProgress,
      repoUrl: this.gitUrl,
    };
  }

  // ---------------------------------------------------------------------------
  // Safety check
  // ---------------------------------------------------------------------------

  /**
   * Warn (never block) when an incoming update touches paths that could affect
   * the GPU driver, kernel, boot, or mounts. The fleet runs Tesla P40 on the
   * NVIDIA 580 branch and must not be auto-touched by code pushes.
   */
  private warnOnSensitivePaths(fromHash: string, toRef: string): string[] {
    try {
      const out = this.git(['diff', '--name-only', fromHash, toRef], 30000);
      const changed = out.split('\n').filter((l) => l);
      const sensitive = changed.filter((p) => SENSITIVE_PATH_RE.test(p));
      if (sensitive.length > 0) {
        this.logger.warn(
          'SYSTEM',
          `Incoming update touches ${sensitive.length} file(s) related to apt/modprobe/nvidia/cuda/dkms/grub/fstab. These are NOT applied automatically to the OS, but review them: ${sensitive.join(', ')}`,
          { files: sensitive }
        );
      }
      return sensitive;
    } catch (err) {
      this.logger.debug('SYSTEM', `Pre-update diff check failed: ${this.describeError(err)}`);
      return [];
    }
  }

  // ---------------------------------------------------------------------------
  // Build helpers
  // ---------------------------------------------------------------------------

  private npmInstall(dir: string, label: string): void {
    const hasLock = fs.existsSync(path.join(dir, 'package-lock.json'));
    // Dev deps are required to build (tsc / vite), so no --omit=dev here.
    const args = hasLock ? ['ci', '--no-audit', '--no-fund'] : ['install', '--no-audit', '--no-fund'];
    this.logger.info('SYSTEM', `[update] ${label}: npm ${args[0]}`);
    try {
      this.run('npm', args, dir);
    } catch (err) {
      if (hasLock) {
        // Lockfile may be out of sync with package.json after the pull — fall back once.
        this.logger.warn('SYSTEM', `[update] ${label}: npm ci failed, falling back to npm install: ${this.describeError(err)}`);
        this.run('npm', ['install', '--no-audit', '--no-fund'], dir);
      } else {
        throw err;
      }
    }
  }

  private buildBackend(): void {
    const dir = path.join(this.repoPath, 'backend');
    this.npmInstall(dir, 'backend');
    this.logger.info('SYSTEM', '[update] backend: npm run build');
    this.run('npm', ['run', 'build'], dir);
    const entry = path.join(dir, 'dist', 'index.js');
    if (!fs.existsSync(entry)) {
      throw new Error(`Backend build produced no ${entry}`);
    }
    this.logger.info('SYSTEM', '[update] backend: node --check dist/index.js');
    this.run('node', ['--check', entry], dir, 60000);
  }

  private buildFrontend(): void {
    const dir = path.join(this.repoPath, 'frontend');
    this.npmInstall(dir, 'frontend');
    this.logger.info('SYSTEM', '[update] frontend: npm run build');
    this.run('npm', ['run', 'build'], dir);
    const entry = path.join(dir, 'dist', 'index.html');
    if (!fs.existsSync(entry)) {
      throw new Error(`Frontend build produced no ${entry}`);
    }
  }

  private buildAll(): void {
    this.buildBackend();
    this.buildFrontend();
  }

  // ---------------------------------------------------------------------------
  // Apply
  // ---------------------------------------------------------------------------

  /**
   * Apply the pending update.
   *
   * Sequence: record HEAD → git pull --ff-only → build backend (assert dist/index.js,
   * node --check) → build frontend (assert dist/index.html). On ANY failure the
   * tree is reset to the previous HEAD and rebuilt, the history row is marked
   * 'failed' and the error is thrown. The process is NEVER exited on failure —
   * that is what caused the systemd crash-loop with a missing dist/.
   *
   * On success the process exits 0 after 3 s so systemd (Restart=always) brings
   * the new build up.
   */
  async applyUpdate(): Promise<UpdateHistory> {
    if (this.updateInProgress) {
      throw new Error('An update is already in progress');
    }
    if (!this.isGitRepo()) {
      throw new Error('Not a git repository — initialize updates first (POST /api/updates/init-repo)');
    }

    const updateId = uuidv4();
    this.updateInProgress = true;

    let prevHash = '';
    let currentVersion = '';
    let updateRecord: UpdateHistory | null = null;

    try {
      currentVersion = await this.getCurrentVersion();
      const updateInfo = await this.checkForUpdates();

      if (!updateInfo.hasUpdate) {
        throw new Error('No update available');
      }

      const branch = this.getCurrentBranch();
      prevHash = this.getFullHash('HEAD');
      const targetHash = updateInfo.latestHash || this.getFullHash(`origin/${branch}`);

      updateRecord = {
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
        prevHash: prevHash.substring(0, 7),
        targetHash: targetHash.substring(0, 7),
        branch,
      });

      if (this.mayaService) {
        this.mayaService.createNotification(
          'info',
          'Update In Progress',
          `Updating from ${currentVersion} to ${updateInfo.latestVersion}. The server will restart shortly.`,
          'high'
        );
      }

      // Pre-update safety check (warn only)
      this.warnOnSensitivePaths(prevHash, `origin/${branch}`);

      // Refuse to clobber uncommitted local changes to tracked files; ff-only would fail anyway.
      const dirty = this.git(['status', '--porcelain', '--untracked-files=no'], 30000);
      if (dirty) {
        throw new Error(`Working tree has local modifications; refusing to update:\n${dirty.split('\n').slice(0, 10).join('\n')}`);
      }

      this.logger.info('SYSTEM', `[update] git pull --ff-only origin ${branch}`);
      this.git(['pull', '--ff-only', 'origin', branch], GIT_TIMEOUT_MS);

      this.buildBackend();
      this.buildFrontend();

      // Success
      try {
        execFileSync('systemctl', ['daemon-reload'], { stdio: 'pipe', timeout: 30000 });
      } catch (e) {
        this.logger.debug('SYSTEM', `systemctl daemon-reload failed (ignored): ${this.describeError(e)}`);
      }

      updateRecord.status = 'completed';
      updateRecord.completed_at = Date.now();
      this.saveUpdate(updateRecord);
      this.lastCheckResult = undefined;

      this.logger.info('SYSTEM', 'Update applied successfully. Restarting in 3s...', {
        from: currentVersion,
        to: updateInfo.latestVersion,
      });

      if (this.mayaService) {
        this.mayaService.createNotification(
          'success',
          'Update Installed',
          `Trakend OS was updated to ${updateInfo.latestVersion}. The server is restarting.`,
          'medium'
        );
      }

      setTimeout(() => {
        process.exit(0);
      }, 3000);

      return updateRecord;
    } catch (error) {
      const errMsg = this.describeError(error);
      this.logger.error('SYSTEM', `Update failed: ${errMsg}`);

      // Roll back if we got as far as recording the previous HEAD.
      let rollbackNote = '';
      if (prevHash) {
        try {
          const nowHash = this.getCurrentHash();
          if (nowHash && nowHash !== prevHash) {
            this.logger.warn('SYSTEM', `[update] rolling back ${nowHash.substring(0, 7)} -> ${prevHash.substring(0, 7)}`);
            this.git(['reset', '--hard', prevHash], GIT_TIMEOUT_MS);
          }
          // Always rebuild: a failed build step may have left dist/ half-written.
          this.buildAll();
          rollbackNote = ` Rolled back to ${prevHash.substring(0, 7)} and rebuilt; the running service is unaffected.`;
          this.logger.info('SYSTEM', `[update] rollback to ${prevHash.substring(0, 7)} complete`);
        } catch (rbErr) {
          rollbackNote = ` ROLLBACK FAILED: ${this.describeError(rbErr)}. Do NOT restart trakend-os until dist/ is rebuilt manually.`;
          this.logger.error('SYSTEM', `[update] rollback failed: ${this.describeError(rbErr)}`);
        }
      }

      if (this.mayaService) {
        this.mayaService.createNotification(
          'error',
          'Update Failed',
          `Failed to update: ${errMsg.split('\n')[0]}.${rollbackNote || ' The system is still running on the previous version.'}`,
          'high'
        );
      }

      const failedUpdate: UpdateHistory = updateRecord
        ? { ...updateRecord, status: 'failed', completed_at: Date.now(), error: errMsg + rollbackNote }
        : {
            id: updateId,
            version: 'unknown',
            from_version: currentVersion || (await this.getCurrentVersion()),
            status: 'failed',
            timestamp: Date.now(),
            completed_at: Date.now(),
            error: errMsg + rollbackNote,
          };
      this.saveUpdate(failedUpdate);

      throw new Error(errMsg + rollbackNote);
    } finally {
      this.updateInProgress = false;
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
