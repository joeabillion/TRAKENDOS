import { spawn } from 'node-pty';
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
}

interface ResolvedShell {
  cmd: string;
  args: string[];
  env: Record<string, string>;
  label: string;
}

interface InternalSession extends TerminalSession {
  pty: any;
  dataHandlers: Set<(data: string) => void>;
  cleanupTimer?: NodeJS.Timeout;
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
 *   - Safe lifecycle: idle timeout, hard 8h lifetime cap, leak-free pty cleanup.
 */
export class TerminalService {
  private sessions: Map<string, InternalSession> = new Map();
  private logger: EventLogger;
  private readonly IDLE_TIMEOUT_MS = 60 * 60 * 1000; // 1 hour idle
  private readonly MAX_LIFETIME_MS = 8 * 60 * 60 * 1000; // 8 hour hard cap
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
    return {
      ...(process.env as Record<string, string>),
      TERM: 'xterm-256color',
      COLORTERM: 'truecolor',
      LANG: process.env.LANG || 'en_US.UTF-8',
      LC_ALL: process.env.LC_ALL || 'en_US.UTF-8',
    };
  }

  /**
   * Return the list of shells installed on this host, for a future shell-picker
   * UI in the frontend. 'auto' is always first.
   */
  listAvailableShells(): { value: ShellChoice; label: string; cmd: string }[] {
    if (this.cachedAvailable) return this.cachedAvailable;
    const out: { value: ShellChoice; label: string; cmd: string }[] = [
      { value: 'auto', label: 'Default (Bash)', cmd: 'auto' },
    ];
    const bash = this.which('bash');
    if (bash) out.push({ value: 'bash', label: 'Bash (PowerShell-styled)', cmd: bash });
    const pwsh = this.which('pwsh');
    if (pwsh) out.push({ value: 'pwsh', label: 'PowerShell Core', cmd: pwsh });
    const zsh = this.which('zsh');
    if (zsh) out.push({ value: 'zsh', label: 'Zsh', cmd: zsh });
    if (this.which('sh')) out.push({ value: 'sh', label: 'Sh', cmd: '/bin/sh' });
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

  /**
   * Create a terminal session. Optional `shell` selects bash/pwsh/zsh/sh,
   * defaults to 'auto' (bash if installed).
   */
  createSession(name?: string, shellChoice: ShellChoice = 'auto'): TerminalSession {
    const id = uuidv4();
    const sessionName = name || `Terminal ${this.sessions.size + 1}`;
    const shell = this.resolveShell(shellChoice);

    try {
      const pty = spawn(shell.cmd, shell.args, {
        name: 'xterm-256color',
        cols: 120,
        rows: 32,
        cwd: process.env.HOME || '/root',
        env: shell.env as any,
      });

      const session: InternalSession = {
        id,
        name: sessionName,
        pid: pty.pid,
        created_at: Date.now(),
        last_activity: Date.now(),
        shell: shell.label,
        pty,
        dataHandlers: new Set<(data: string) => void>(),
      };

      this.sessions.set(id, session);

      this.logger.info(
        'SYSTEM',
        `Terminal session created: ${sessionName} (${id}) shell=${shell.label} pid=${pty.pid}`
      );

      this.scheduleIdleCheck(id);

      setTimeout(() => {
        if (this.sessions.has(id)) {
          this.logger.info('SYSTEM', `Terminal session lifetime cap reached: ${id}`);
          this.closeSession(id);
        }
      }, this.MAX_LIFETIME_MS).unref();

      return {
        id: session.id,
        name: session.name,
        pid: session.pid,
        created_at: session.created_at,
        last_activity: session.last_activity,
        shell: session.shell,
      };
    } catch (error) {
      this.logger.error('SYSTEM', `Failed to create terminal session: ${error}`);
      throw error;
    }
  }

  private scheduleIdleCheck(sessionId: string): void {
    const session = this.sessions.get(sessionId);
    if (!session) return;
    if (session.cleanupTimer) clearTimeout(session.cleanupTimer);
    session.cleanupTimer = setTimeout(() => {
      const s = this.sessions.get(sessionId);
      if (!s) return;
      if (Date.now() - s.last_activity > this.IDLE_TIMEOUT_MS) {
        this.logger.info('SYSTEM', `Terminal idle timeout: ${sessionId}`);
        this.closeSession(sessionId);
      } else {
        this.scheduleIdleCheck(sessionId);
      }
    }, this.IDLE_TIMEOUT_MS);
    session.cleanupTimer.unref?.();
  }

  closeSession(sessionId: string): void {
    const session = this.sessions.get(sessionId);
    if (!session) return;

    try {
      if (session.cleanupTimer) clearTimeout(session.cleanupTimer);
      session.dataHandlers.clear();
      if (session.pty) {
        try { session.pty.kill(); } catch {}
      }
    } catch (error) {
      this.logger.error('SYSTEM', `Failed to close terminal session: ${error}`);
    } finally {
      this.sessions.delete(sessionId);
      this.logger.info('SYSTEM', `Terminal session closed: ${sessionId}`);
    }
  }

  getSessions(): TerminalSession[] {
    return Array.from(this.sessions.values()).map((s) => ({
      id: s.id,
      name: s.name,
      pid: s.pid,
      created_at: s.created_at,
      last_activity: s.last_activity,
      shell: s.shell,
    }));
  }

  hasSession(sessionId: string): boolean {
    return this.sessions.has(sessionId);
  }

  writeData(sessionId: string, data: string): void {
    const session = this.sessions.get(sessionId);
    if (!session) throw new Error(`Session ${sessionId} not found`);
    try {
      session.pty.write(data);
      session.last_activity = Date.now();
    } catch (error) {
      this.logger.error('SYSTEM', `Failed to write to terminal: ${error}`);
      throw error;
    }
  }

  onData(sessionId: string, handler: (data: string) => void): () => void {
    const session = this.sessions.get(sessionId);
    if (!session) throw new Error(`Session ${sessionId} not found`);

    session.dataHandlers.add(handler);

    if (session.dataHandlers.size === 1) {
      session.pty.on('data', (data: string) => {
        const s = this.sessions.get(sessionId);
        if (!s) return;
        s.last_activity = Date.now();
        for (const h of s.dataHandlers) {
          try { h(data); } catch (err) {
            this.logger.debug('SYSTEM', `terminal handler error: ${err}`);
          }
        }
      });

      session.pty.on('exit', () => {
        this.logger.info('SYSTEM', `Terminal pty exited: ${sessionId}`);
        this.closeSession(sessionId);
      });
    }

    return () => {
      const s = this.sessions.get(sessionId);
      if (s) s.dataHandlers.delete(handler);
    };
  }

  resize(sessionId: string, cols: number, rows: number): void {
    const session = this.sessions.get(sessionId);
    if (!session) throw new Error(`Session ${sessionId} not found`);
    try {
      const c = Math.max(20, Math.min(500, Math.floor(cols) || 80));
      const r = Math.max(5, Math.min(200, Math.floor(rows) || 24));
      session.pty.resize(c, r);
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
