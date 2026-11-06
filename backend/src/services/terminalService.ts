import { spawn, IPty } from 'node-pty';
import { execSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { EventLogger } from './eventLogger';
import { v4 as uuidv4 } from 'uuid';

export type ShellChoice = 'auto' | 'bash' | 'pwsh' | 'sh' | 'zsh';

export interface TerminalSession {
  id: string;
  name: string;
  pid: number;
  created_at: number;
  last_activity: number;
  shell: string;
  owner: string;
  cols: number;
  rows: number;
  attached: boolean;
  /** Milliseconds until the idle timeout fires if no further input arrives. */
  idle_remaining_ms: number;
  /** Name of the foreground process (e.g. 'bash', 'htop') as reported by the pty. */
  process: string;
}

export interface TerminalExit {
  exitCode: number;
  signal?: number;
}

interface ResolvedShell {
  cmd: string;
  args: string[];
  env: Record<string, string>;
  label: string;
}

interface InternalSession extends TerminalSession {
  pty: IPty;
  dataHandlers: Set<(data: string) => void>;
  exitHandlers: Set<(exit: TerminalExit) => void>;
  warningHandlers: Set<(secondsLeft: number) => void>;
  /** Ring buffer of recent output so a re-attaching client can repaint the screen. */
  buffer: string[];
  bufferBytes: number;
  /** Timestamp of the last *input* (keystroke/paste/resize) — drives the idle timeout. */
  last_input: number;
  idleTimer?: NodeJS.Timeout;
  idleWarnTimer?: NodeJS.Timeout;
  warned: boolean;
  /** Started when the last WebSocket detaches; closes the pty if nobody re-attaches. */
  detachTimer?: NodeJS.Timeout;
  killTimer?: NodeJS.Timeout;
  exited: boolean;
}

/**
 * Trakend OS terminal service.
 *
 * Goals:
 *   - Default to bash so users can paste standard bash one-liners (with `&&`,
 *     `\` line continuations, `for/do/done` loops, heredocs, etc.) without
 *     friction. The bash prompt is styled like PowerShell so it still feels
 *     modern, and most familiar PowerShell aliases are exposed (ls/dir/cls/gci).
 *   - Allow opting into pwsh (PowerShell Core) per session for users who want
 *     real cmdlets — pass shell: 'pwsh' when creating the session.
 *   - Persistent shared command history per shell type at /var/lib/trakend.
 *   - Safe lifecycle:
 *       * idle timeout (1h since the last keystroke, NOT an absolute lifetime)
 *         with an in-terminal warning 2 minutes before, any keystroke extends;
 *       * the pty survives a WebSocket drop for DETACH_GRACE_MS so a backend
 *         update / page reload can re-attach to the same shell;
 *       * leak-free teardown: SIGHUP the process group, SIGKILL after 3s.
 *   - Cap of MAX_SESSIONS_PER_USER live ptys per user.
 */
export class TerminalService {
  private sessions: Map<string, InternalSession> = new Map();
  private logger: EventLogger;

  readonly IDLE_TIMEOUT_MS = 60 * 60 * 1000; // 1 hour since last keystroke
  readonly IDLE_WARNING_MS = 2 * 60 * 1000; // warn 2 minutes before
  readonly DETACH_GRACE_MS = 5 * 60 * 1000; // keep pty alive 5 min after socket close
  readonly KILL_GRACE_MS = 3 * 1000; // SIGHUP -> SIGKILL after 3s
  readonly MAX_SESSIONS_PER_USER = 10;
  readonly REPLAY_BUFFER_BYTES = 256 * 1024; // ~256KB of recent output for re-attach

  private readonly HISTORY_DIR = '/var/lib/trakend/terminal-history';
  private resolvedShells: Map<ShellChoice, ResolvedShell> = new Map();
  private cachedAvailable: { value: ShellChoice; label: string; cmd: string }[] | null = null;

  constructor(logger: EventLogger) {
    this.logger = logger;
    this.ensureHistoryDir();
  }

  private ensureHistoryDir(): void {
    try {
      if (!fs.existsSync(this.HISTORY_DIR)) {
        fs.mkdirSync(this.HISTORY_DIR, { recursive: true, mode: 0o700 });
      }
    } catch (err) {
      this.logger.debug('SYSTEM', `terminal history dir unavailable: ${err}`);
    }
  }

  private which(cmd: string): string | null {
    try {
      const out = execSync(`command -v ${cmd} 2>/dev/null`, { encoding: 'utf8' }).trim();
      return out || null;
    } catch {
      return null;
    }
  }

  private baseEnv(): Record<string, string> {
    const env: Record<string, string> = {};
    for (const [k, v] of Object.entries(process.env)) {
      if (typeof v === 'string') env[k] = v;
    }
    return {
      ...env,
      TERM: 'xterm-256color',
      COLORTERM: 'truecolor',
      LANG: 'C.UTF-8',
      LC_ALL: 'C.UTF-8',
      LC_CTYPE: 'C.UTF-8',
      HOME: env.HOME || '/root',
    };
  }

  /** Pick a sensible working directory for new shells. */
  private defaultCwd(): string {
    const candidates = ['/root', '/home/trakend', process.env.HOME || '', os.homedir(), '/'];
    for (const c of candidates) {
      try {
        if (c && fs.existsSync(c) && fs.statSync(c).isDirectory()) {
          // /root is only usable when we are root (or it is readable)
          fs.accessSync(c, fs.constants.R_OK | fs.constants.X_OK);
          return c;
        }
      } catch {
        /* try next */
      }
    }
    return '/';
  }

  /**
   * Return the list of shells installed on this host for the frontend shell
   * picker. 'auto' is always first.
   */
  listAvailableShells(): { value: ShellChoice; label: string; cmd: string }[] {
    if (this.cachedAvailable) return this.cachedAvailable;
    const out: { value: ShellChoice; label: string; cmd: string }[] = [
      { value: 'auto', label: 'Default (Bash)', cmd: 'auto' },
    ];
    const bash = this.which('bash');
    if (bash) out.push({ value: 'bash', label: 'Bash', cmd: bash });
    const zsh = this.which('zsh');
    if (zsh) out.push({ value: 'zsh', label: 'Zsh', cmd: zsh });
    const pwsh = this.which('pwsh');
    if (pwsh) out.push({ value: 'pwsh', label: 'PowerShell', cmd: pwsh });
    if (this.which('sh') || fs.existsSync('/bin/sh')) out.push({ value: 'sh', label: 'sh (POSIX)', cmd: '/bin/sh' });
    this.cachedAvailable = out;
    return out;
  }

  /**
   * Resolve a shell choice to a runnable command. Cached per choice so the
   * profile/rcfile is written once per backend run.
   */
  private resolveShell(choice: ShellChoice = 'auto'): ResolvedShell {
    const cached = this.resolvedShells.get(choice);
    if (cached) return cached;

    const env = this.baseEnv();

    // 'auto' means: prefer bash for paste-friendliness, then pwsh, then sh.
    if (choice === 'auto') {
      const bash = this.which('bash');
      if (bash) return this.buildBash(bash, env, 'auto');
      const pwsh = this.which('pwsh');
      if (pwsh) return this.buildPwsh(pwsh, env, 'auto');
      const r: ResolvedShell = { cmd: '/bin/sh', args: [], env, label: 'sh' };
      this.resolvedShells.set('auto', r);
      return r;
    }

    if (choice === 'bash') {
      const bash = this.which('bash');
      if (bash) return this.buildBash(bash, env, 'bash');
    }

    if (choice === 'pwsh') {
      const pwsh = this.which('pwsh');
      if (pwsh) return this.buildPwsh(pwsh, env, 'pwsh');
    }

    if (choice === 'zsh') {
      const zsh = this.which('zsh');
      if (zsh) {
        const r: ResolvedShell = { cmd: zsh, args: ['-i'], env, label: 'zsh' };
        this.resolvedShells.set('zsh', r);
        return r;
      }
    }

    if (choice === 'sh') {
      const r: ResolvedShell = { cmd: '/bin/sh', args: [], env, label: 'sh' };
      this.resolvedShells.set('sh', r);
      return r;
    }

    // Requested shell not installed - fall back to auto
    this.logger.warn('SYSTEM', `Requested shell '${choice}' not found - falling back to default`);
    return this.resolveShell('auto');
  }

  private buildBash(bashPath: string, env: Record<string, string>, cacheKey: ShellChoice): ResolvedShell {
    const rcPath = this.writeBashRc();
    const resolved: ResolvedShell = {
      cmd: bashPath,
      args: ['--rcfile', rcPath, '-i'],
      env,
      label: 'bash',
    };
    this.resolvedShells.set(cacheKey, resolved);
    return resolved;
  }

  private buildPwsh(pwshPath: string, env: Record<string, string>, cacheKey: ShellChoice): ResolvedShell {
    const profilePath = this.writePwshProfile();
    const resolved: ResolvedShell = {
      cmd: pwshPath,
      args: ['-NoLogo', '-NoExit', '-File', profilePath],
      env: { ...env, POWERSHELL_TELEMETRY_OPTOUT: '1' },
      label: 'pwsh',
    };
    this.resolvedShells.set(cacheKey, resolved);
    return resolved;
  }

  /**
   * Write a PowerShell profile with a Trakend-themed prompt and a few
   * cross-shell aliases for users who explicitly opt into pwsh.
   */
  private writePwshProfile(): string {
    const profilePath = path.join(os.tmpdir(), 'trakend-pwsh-profile.ps1');
    const profile = `# Trakend OS PowerShell profile
function prompt {
    $loc = (Get-Location).Path
    $host.UI.RawUI.WindowTitle = "Trakend OS - $loc"
    Write-Host ""
    Write-Host "PS " -NoNewline -ForegroundColor Cyan
    Write-Host $loc -NoNewline -ForegroundColor Yellow
    Write-Host ">" -NoNewline -ForegroundColor Cyan
    return " "
}
$PSDefaultParameterValues['Out-File:Encoding'] = 'utf8'
Set-Alias -Name ll -Value Get-ChildItem -Force -ErrorAction SilentlyContinue
Set-Alias -Name la -Value Get-ChildItem -Force -ErrorAction SilentlyContinue
Set-Alias -Name which -Value Get-Command -Force -ErrorAction SilentlyContinue
function touch { param([string]$p) New-Item -ItemType File -Path $p -Force | Out-Null }
function .. { Set-Location .. }
function ... { Set-Location ../.. }
Write-Host "Trakend OS Terminal" -ForegroundColor Cyan
Write-Host "PowerShell $($PSVersionTable.PSVersion) on $([Environment]::OSVersion.VersionString)" -ForegroundColor DarkGray
Write-Host "Tip: paste bash commands? Open a Bash session instead (use shell picker)." -ForegroundColor DarkGray
Write-Host ""
`;
    try {
      fs.writeFileSync(profilePath, profile, { mode: 0o644 });
    } catch (err) {
      this.logger.debug('SYSTEM', `failed to write pwsh profile: ${err}`);
    }
    return profilePath;
  }

  /**
   * Write a bashrc that gives a PowerShell-styled prompt and ports the most
   * common cmdlets/aliases so muscle memory works across shells. Persistent
   * shared history lives under /var/lib/trakend/terminal-history.
   *
   * Bracketed paste is explicitly enabled so multi-line pastes land in the
   * line editor as one unit (readline >= 8.1 enables it by default, older
   * builds do not).
   */
  private writeBashRc(): string {
    const rcPath = path.join(os.tmpdir(), 'trakend-bashrc');
    const historyFile = path.join(this.HISTORY_DIR, 'bash_history');
    const rc = `# Trakend OS bash rc - PowerShell-styled
[ -f /etc/bash.bashrc ] && source /etc/bash.bashrc
[ -f "$HOME/.bashrc" ] && source "$HOME/.bashrc"

export CLICOLOR=1
export LS_COLORS="\${LS_COLORS:-di=1;36:ln=1;35:so=1;32:pi=1;33:ex=1;31}"
export HISTFILE="${historyFile}"
export HISTSIZE=10000
export HISTFILESIZE=50000
export HISTCONTROL=ignoredups:erasedups
export HISTTIMEFORMAT="%F %T "
shopt -s histappend checkwinsize cmdhist
bind 'set enable-bracketed-paste on' 2>/dev/null
PROMPT_COMMAND="history -a; history -n; \${PROMPT_COMMAND}"

if [ -f /etc/bash_completion ]; then
    . /etc/bash_completion
elif [ -f /usr/share/bash-completion/bash_completion ]; then
    . /usr/share/bash-completion/bash_completion
fi

_trakend_prompt() {
    local last=$?
    local cwd="\${PWD/#$HOME/~}"
    local marker=">"
    [ $last -ne 0 ] && marker="\\[\\e[31m\\]>\\[\\e[0m\\]"
    PS1="\\n\\[\\e[36m\\]PS \\[\\e[33m\\]\${cwd}\\[\\e[36m\\]\${marker}\\[\\e[0m\\] "
    # Keep the browser tab title in sync with the cwd
    printf '\\033]0;%s\\007' "Trakend: \${cwd}"
}
PROMPT_COMMAND="_trakend_prompt; \${PROMPT_COMMAND}"

alias cls='clear'
alias dir='ls -lh --color=auto'
alias ls='ls --color=auto'
alias ll='ls -lah --color=auto'
alias la='ls -lAh --color=auto'
alias type='cat'
alias gci='ls -lah --color=auto'
alias gc='cat'
alias write-host='echo'
alias get-process='ps -ef'
alias get-service='systemctl list-units --type=service'
alias ..='cd ..'
alias ...='cd ../..'
alias ....='cd ../../..'

echo -e "\\e[1;36mTrakend OS Terminal\\e[0m"
echo -e "\\e[2mBash $BASH_VERSION on $(uname -sr) - PowerShell-styled\\e[0m"
echo -e "\\e[2mPaste bash commands directly. Aliases: ls dir ll cls type gci .. ...\\e[0m"
echo ""
`;
    try {
      fs.writeFileSync(rcPath, rc, { mode: 0o644 });
    } catch (err) {
      this.logger.debug('SYSTEM', `failed to write bashrc: ${err}`);
    }
    return rcPath;
  }

  private toPublic(s: InternalSession): TerminalSession {
    return {
      id: s.id,
      name: s.name,
      pid: s.pid,
      created_at: s.created_at,
      last_activity: s.last_activity,
      shell: s.shell,
      owner: s.owner,
      cols: s.cols,
      rows: s.rows,
      attached: s.dataHandlers.size > 0,
      idle_remaining_ms: Math.max(0, this.IDLE_TIMEOUT_MS - (Date.now() - s.last_input)),
      process: this.foregroundProcess(s),
    };
  }

  private foregroundProcess(s: InternalSession): string {
    try {
      // node-pty reads /proc/<pid>/... for the controlling process name on Linux
      const name = (s.pty as any).process;
      if (typeof name === 'string' && name) return path.basename(name);
    } catch {
      /* ignore */
    }
    return s.shell;
  }

  countSessionsFor(owner: string): number {
    let n = 0;
    for (const s of this.sessions.values()) if (s.owner === owner) n++;
    return n;
  }

  /**
   * Create a terminal session. Optional `shell` selects bash/pwsh/zsh/sh,
   * defaults to 'auto' (bash if installed). `owner` is the authenticated user
   * id and is used to enforce MAX_SESSIONS_PER_USER.
   */
  createSession(
    name?: string,
    shellChoice: ShellChoice = 'auto',
    owner: string = 'default',
    size?: { cols?: number; rows?: number }
  ): TerminalSession {
    if (this.countSessionsFor(owner) >= this.MAX_SESSIONS_PER_USER) {
      throw new Error(
        `Terminal session limit reached (${this.MAX_SESSIONS_PER_USER}). Close an existing session first.`
      );
    }

    const id = uuidv4();
    const sessionName = name || `Terminal ${this.sessions.size + 1}`;
    const shell = this.resolveShell(shellChoice);
    const cols = this.clampCols(size?.cols);
    const rows = this.clampRows(size?.rows);

    try {
      const pty = spawn(shell.cmd, shell.args, {
        name: 'xterm-256color',
        cols,
        rows,
        cwd: this.defaultCwd(),
        env: shell.env,
      });

      const now = Date.now();
      const session: InternalSession = {
        id,
        name: sessionName,
        pid: pty.pid,
        created_at: now,
        last_activity: now,
        last_input: now,
        shell: shell.label,
        owner,
        cols,
        rows,
        attached: false,
        idle_remaining_ms: this.IDLE_TIMEOUT_MS,
        process: shell.label,
        pty,
        dataHandlers: new Set(),
        exitHandlers: new Set(),
        warningHandlers: new Set(),
        buffer: [],
        bufferBytes: 0,
        warned: false,
        exited: false,
      };

      this.sessions.set(id, session);

      // Wire pty events once, for the lifetime of the session.
      pty.onData((data: string) => {
        const s = this.sessions.get(id);
        if (!s) return;
        s.last_activity = Date.now();
        this.appendBuffer(s, data);
        for (const h of s.dataHandlers) {
          try {
            h(data);
          } catch (err) {
            this.logger.debug('SYSTEM', `terminal handler error: ${err}`);
          }
        }
      });

      pty.onExit(({ exitCode, signal }) => {
        const s = this.sessions.get(id);
        if (!s) return;
        s.exited = true;
        this.logger.info('SYSTEM', `Terminal pty exited: ${id} code=${exitCode} signal=${signal ?? ''}`);
        for (const h of s.exitHandlers) {
          try {
            h({ exitCode, signal });
          } catch {
            /* ignore */
          }
        }
        this.closeSession(id);
      });

      this.logger.info(
        'SYSTEM',
        `Terminal session created: ${sessionName} (${id}) shell=${shell.label} pid=${pty.pid} owner=${owner}`
      );

      this.scheduleIdleTimers(id);
      // Nobody is attached yet — if the client never connects, reap it.
      this.scheduleDetachClose(id);

      return this.toPublic(session);
    } catch (error) {
      this.logger.error('SYSTEM', `Failed to create terminal session: ${error}`);
      throw error;
    }
  }

  private clampCols(cols?: number): number {
    return Math.max(20, Math.min(500, Math.floor(cols || 0) || 120));
  }

  private clampRows(rows?: number): number {
    return Math.max(5, Math.min(200, Math.floor(rows || 0) || 32));
  }

  private appendBuffer(s: InternalSession, data: string): void {
    s.buffer.push(data);
    s.bufferBytes += data.length;
    while (s.bufferBytes > this.REPLAY_BUFFER_BYTES && s.buffer.length > 1) {
      const dropped = s.buffer.shift()!;
      s.bufferBytes -= dropped.length;
    }
  }

  /** Recent output (bounded) — used to repaint the screen when a client re-attaches. */
  getReplayBuffer(sessionId: string): string {
    const s = this.sessions.get(sessionId);
    if (!s) return '';
    return s.buffer.join('');
  }

  // ─── Idle timeout (input-based) ────────────────────────────────────────────

  private scheduleIdleTimers(sessionId: string): void {
    const session = this.sessions.get(sessionId);
    if (!session) return;
    if (session.idleTimer) clearTimeout(session.idleTimer);
    if (session.idleWarnTimer) clearTimeout(session.idleWarnTimer);
    session.warned = false;

    const warnIn = Math.max(1000, this.IDLE_TIMEOUT_MS - this.IDLE_WARNING_MS);
    session.idleWarnTimer = setTimeout(() => {
      const s = this.sessions.get(sessionId);
      if (!s || s.exited) return;
      const idleFor = Date.now() - s.last_input;
      if (idleFor < this.IDLE_TIMEOUT_MS - this.IDLE_WARNING_MS) {
        // Input arrived since scheduling — timers were rescheduled already.
        return;
      }
      s.warned = true;
      const secondsLeft = Math.round((this.IDLE_TIMEOUT_MS - idleFor) / 1000);
      const mins = Math.max(1, Math.round(secondsLeft / 60));
      const msg =
        `\r\n\x1b[33m[Trakend] This session has been idle for a while and will close in ` +
        `${mins} minute${mins === 1 ? '' : 's'}. Press any key to keep it alive.\x1b[0m\r\n`;
      for (const h of s.dataHandlers) {
        try {
          h(msg);
        } catch {
          /* ignore */
        }
      }
      for (const h of s.warningHandlers) {
        try {
          h(secondsLeft);
        } catch {
          /* ignore */
        }
      }
    }, warnIn);
    session.idleWarnTimer.unref?.();

    session.idleTimer = setTimeout(() => {
      const s = this.sessions.get(sessionId);
      if (!s) return;
      if (Date.now() - s.last_input >= this.IDLE_TIMEOUT_MS) {
        const msg = `\r\n\x1b[31m[Trakend] Session closed after 1 hour of inactivity.\x1b[0m\r\n`;
        for (const h of s.dataHandlers) {
          try {
            h(msg);
          } catch {
            /* ignore */
          }
        }
        this.logger.info('SYSTEM', `Terminal idle timeout: ${sessionId}`);
        this.closeSession(sessionId);
      } else {
        this.scheduleIdleTimers(sessionId);
      }
    }, this.IDLE_TIMEOUT_MS);
    session.idleTimer.unref?.();
  }

  private touchInput(session: InternalSession): void {
    const now = Date.now();
    session.last_input = now;
    session.last_activity = now;
    if (session.warned) {
      // User came back after the warning — reset timers so they get a fresh hour.
      this.scheduleIdleTimers(session.id);
    }
  }

  // ─── Detach grace (survive WS drops / backend restarts of the UI) ──────────

  private scheduleDetachClose(sessionId: string): void {
    const session = this.sessions.get(sessionId);
    if (!session) return;
    if (session.detachTimer) clearTimeout(session.detachTimer);
    session.detachTimer = setTimeout(() => {
      const s = this.sessions.get(sessionId);
      if (!s) return;
      if (s.dataHandlers.size === 0) {
        this.logger.info('SYSTEM', `Terminal session ${sessionId} had no client for 5 minutes — closing`);
        this.closeSession(sessionId);
      }
    }, this.DETACH_GRACE_MS);
    session.detachTimer.unref?.();
  }

  private cancelDetachClose(session: InternalSession): void {
    if (session.detachTimer) {
      clearTimeout(session.detachTimer);
      session.detachTimer = undefined;
    }
  }

  // ─── Teardown ──────────────────────────────────────────────────────────────

  /**
   * Close a session: SIGHUP the whole process group (the pty is its own
   * session leader so -pid reaches children like `tail -f`, editors, etc.),
   * then SIGKILL anything still alive 3 seconds later.
   */
  closeSession(sessionId: string): void {
    const session = this.sessions.get(sessionId);
    if (!session) return;

    // Remove from the map first so re-entrant calls (onExit) are no-ops.
    this.sessions.delete(sessionId);

    try {
      if (session.idleTimer) clearTimeout(session.idleTimer);
      if (session.idleWarnTimer) clearTimeout(session.idleWarnTimer);
      if (session.detachTimer) clearTimeout(session.detachTimer);
      session.dataHandlers.clear();
      session.exitHandlers.clear();
      session.warningHandlers.clear();

      if (!session.exited) {
        this.killTree(session.pid, 'SIGHUP');
        try {
          session.pty.kill('SIGHUP');
        } catch {
          /* ignore */
        }
        const pid = session.pid;
        session.killTimer = setTimeout(() => {
          if (this.isAlive(pid)) {
            this.logger.warn('SYSTEM', `Terminal pid ${pid} ignored SIGHUP — sending SIGKILL`);
            this.killTree(pid, 'SIGKILL');
            try {
              session.pty.kill('SIGKILL');
            } catch {
              /* ignore */
            }
          }
        }, this.KILL_GRACE_MS);
        session.killTimer.unref?.();
      }
    } catch (error) {
      this.logger.error('SYSTEM', `Failed to close terminal session: ${error}`);
    } finally {
      this.logger.info('SYSTEM', `Terminal session closed: ${sessionId}`);
    }
  }

  private isAlive(pid: number): boolean {
    try {
      process.kill(pid, 0);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Signal every process in the pty's session (node-pty calls setsid(), so the
   * shell's pid doubles as the session id). This reaches background jobs that
   * bash put in their own process groups (`sleep 500 &`, nohup'd daemons,
   * editors), not just the foreground group.
   */
  private killTree(pid: number, signal: NodeJS.Signals): void {
    // Guard: pid 0 / NaN would signal our own process group and take the backend down
    if (!Number.isInteger(pid) || pid <= 1) return;
    const members = this.sessionMembers(pid).filter(p => Number.isInteger(p) && p > 1);
    if (members.length === 0) members.push(pid);
    // Children first (reverse pid order is a decent approximation), shell last
    for (const p of members.sort((a, b) => b - a)) {
      try {
        process.kill(p, signal);
      } catch {
        /* already gone */
      }
    }
    // Also hit the foreground process group in case /proc was unavailable
    try {
      process.kill(-pid, signal);
    } catch {
      /* ignore */
    }
  }

  /** All pids whose session id is `sid`, read from /proc (Linux). */
  private sessionMembers(sid: number): number[] {
    const out: number[] = [];
    let entries: string[] = [];
    try {
      entries = fs.readdirSync('/proc');
    } catch {
      return out;
    }
    for (const name of entries) {
      if (!/^\d+$/.test(name)) continue;
      try {
        const stat = fs.readFileSync(`/proc/${name}/stat`, 'utf8');
        // "pid (comm) state ppid pgrp session ..." — comm may contain spaces/parens
        const rest = stat.slice(stat.lastIndexOf(')') + 2).split(' ');
        const session = Number(rest[3]);
        if (session === sid) out.push(Number(name));
      } catch {
        /* process vanished */
      }
    }
    return out;
  }

  // ─── Queries ───────────────────────────────────────────────────────────────

  getSessions(owner?: string): TerminalSession[] {
    return Array.from(this.sessions.values())
      .filter((s) => !owner || s.owner === owner)
      .map((s) => this.toPublic(s));
  }

  getSession(sessionId: string): TerminalSession | null {
    const s = this.sessions.get(sessionId);
    return s ? this.toPublic(s) : null;
  }

  hasSession(sessionId: string): boolean {
    return this.sessions.has(sessionId);
  }

  renameSession(sessionId: string, name: string): TerminalSession | null {
    const s = this.sessions.get(sessionId);
    if (!s) return null;
    s.name = String(name).slice(0, 64) || s.name;
    return this.toPublic(s);
  }

  // ─── I/O ───────────────────────────────────────────────────────────────────

  /**
   * Write raw input to the pty. Bracketed-paste markers (\x1b[200~ ... \x1b[201~)
   * and multi-line payloads are passed through untouched — the shell's line
   * editor decides how to treat them.
   */
  writeData(sessionId: string, data: string): void {
    const session = this.sessions.get(sessionId);
    if (!session) throw new Error(`Session ${sessionId} not found`);
    if (typeof data !== 'string' || data.length === 0) return;
    try {
      session.pty.write(data);
      this.touchInput(session);
    } catch (error) {
      this.logger.error('SYSTEM', `Failed to write to terminal: ${error}`);
      throw error;
    }
  }

  /** Attach an output listener. Returns a detach function. */
  onData(sessionId: string, handler: (data: string) => void): () => void {
    const session = this.sessions.get(sessionId);
    if (!session) throw new Error(`Session ${sessionId} not found`);

    session.dataHandlers.add(handler);
    this.cancelDetachClose(session);

    return () => {
      const s = this.sessions.get(sessionId);
      if (!s) return;
      s.dataHandlers.delete(handler);
      if (s.dataHandlers.size === 0) this.scheduleDetachClose(sessionId);
    };
  }

  onExit(sessionId: string, handler: (exit: TerminalExit) => void): () => void {
    const session = this.sessions.get(sessionId);
    if (!session) throw new Error(`Session ${sessionId} not found`);
    session.exitHandlers.add(handler);
    return () => {
      const s = this.sessions.get(sessionId);
      if (s) s.exitHandlers.delete(handler);
    };
  }

  onIdleWarning(sessionId: string, handler: (secondsLeft: number) => void): () => void {
    const session = this.sessions.get(sessionId);
    if (!session) throw new Error(`Session ${sessionId} not found`);
    session.warningHandlers.add(handler);
    return () => {
      const s = this.sessions.get(sessionId);
      if (s) s.warningHandlers.delete(handler);
    };
  }

  resize(sessionId: string, cols: number, rows: number): void {
    const session = this.sessions.get(sessionId);
    if (!session) throw new Error(`Session ${sessionId} not found`);
    try {
      const c = this.clampCols(cols);
      const r = this.clampRows(rows);
      if (c === session.cols && r === session.rows) return;
      session.pty.resize(c, r);
      session.cols = c;
      session.rows = r;
      session.last_activity = Date.now();
    } catch (error) {
      this.logger.error('SYSTEM', `Failed to resize terminal: ${error}`);
      throw error;
    }
  }

  closeAllSessions(): void {
    for (const id of Array.from(this.sessions.keys())) {
      this.closeSession(id);
    }
  }
}
