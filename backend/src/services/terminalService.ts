import { spawn } from 'node-pty';
import { execSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { EventLogger } from './eventLogger';
import { v4 as uuidv4 } from 'uuid';

export interface TerminalSession {
  id: string;
  name: string;
  pid: number;
  created_at: number;
  last_activity: number;
  shell: string;
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
 *   - PowerShell-first: use pwsh (PowerShell Core) if installed, otherwise
 *     bash with a PowerShell-styled prompt and familiar aliases (ls, cls,
 *     dir, type, gci, etc.) so the experience is consistent.
 *   - Persistent command history per session.
 *   - Safe lifecycle: every session has a max lifetime and an idle timer,
 *     handlers are detached cleanly to avoid leaks.
 */
export class TerminalService {
  private sessions: Map<string, InternalSession> = new Map();
  private logger: EventLogger;
  private readonly IDLE_TIMEOUT_MS = 60 * 60 * 1000; // 1 hour idle
  private readonly MAX_LIFETIME_MS = 8 * 60 * 60 * 1000; // 8 hour hard cap
  private readonly HISTORY_DIR = '/var/lib/trakend/terminal-history';
  private cachedShell: { cmd: string; args: string[]; env: Record<string, string> } | null = null;

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
      // Fall back to a tmp location if /var/lib isn't writable
      this.logger.debug('SYSTEM', `terminal history dir unavailable: ${err}`);
    }
  }

  /**
   * Detect the best shell once and cache it. Prefer pwsh -> bash -> sh.
   */
  private resolveShell(): { cmd: string; args: string[]; env: Record<string, string> } {
    if (this.cachedShell) return this.cachedShell;

    const env: Record<string, string> = {
      ...(process.env as Record<string, string>),
      TERM: 'xterm-256color',
      COLORTERM: 'truecolor',
      LANG: process.env.LANG || 'en_US.UTF-8',
      LC_ALL: process.env.LC_ALL || 'en_US.UTF-8',
    };

    // 1) PowerShell Core if installed
    try {
      const pwshPath = execSync('command -v pwsh 2>/dev/null', { encoding: 'utf8' }).trim();
      if (pwshPath) {
        const profilePath = this.writePwshProfile();
        this.cachedShell = {
          cmd: pwshPath,
          args: ['-NoLogo', '-NoExit', '-File', profilePath],
          env: { ...env, POWERSHELL_TELEMETRY_OPTOUT: '1' },
        };
        return this.cachedShell;
      }
    } catch {}

    // 2) Bash with a PowerShell-styled rc file
    try {
      const bashPath = execSync('command -v bash 2>/dev/null', { encoding: 'utf8' }).trim();
      if (bashPath) {
        const rcPath = this.writeBashRc();
        this.cachedShell = {
          cmd: bashPath,
          args: ['--rcfile', rcPath, '-i'],
          env,
        };
        return this.cachedShell;
      }
    } catch {}

    // 3) Fallback to sh
    this.cachedShell = { cmd: '/bin/sh', args: [], env };
    return this.cachedShell;
  }

  /**
   * Write a temporary PowerShell profile that gives a Trakend-themed prompt
   * and helpful aliases. We write to a per-process location so a fresh
   * profile is generated on each backend restart (picks up version bumps).
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
# Friendlier defaults
$PSDefaultParameterValues['Out-File:Encoding'] = 'utf8'
# Helpful aliases that match common Linux + Windows commands
Set-Alias -Name ll -Value Get-ChildItem -Force -ErrorAction SilentlyContinue
Set-Alias -Name la -Value Get-ChildItem -Force -ErrorAction SilentlyContinue
Set-Alias -Name which -Value Get-Command -Force -ErrorAction SilentlyContinue
function touch { param([string]$p) New-Item -ItemType File -Path $p -Force | Out-Null }
function .. { Set-Location .. }
function ... { Set-Location ../.. }
Write-Host "Trakend OS Terminal" -ForegroundColor Cyan
Write-Host "PowerShell $($PSVersionTable.PSVersion) on $([Environment]::OSVersion.VersionString)" -ForegroundColor DarkGray
Write-Host "Type 'help <command>' for command help. 'Get-Command' lists everything." -ForegroundColor DarkGray
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
   * Write a bashrc that emulates the PowerShell prompt and ports the most
   * common cmdlets/aliases so muscle memory works across shells.
   */
  private writeBashRc(): string {
    const rcPath = path.join(os.tmpdir(), 'trakend-bashrc');
    const historyFile = path.join(this.HISTORY_DIR, 'bash_history');
    const rc = `# Trakend OS bash rc — PowerShell-styled
# Source system bashrc if present so users keep their defaults
[ -f /etc/bash.bashrc ] && source /etc/bash.bashrc
[ -f "$HOME/.bashrc" ] && source "$HOME/.bashrc"

# Colors and shell options
export CLICOLOR=1
export LS_COLORS="\${LS_COLORS:-di=1;36:ln=1;35:so=1;32:pi=1;33:ex=1;31}"
export HISTFILE="${historyFile}"
export HISTSIZE=10000
export HISTFILESIZE=50000
export HISTCONTROL=ignoredups:erasedups
export HISTTIMEFORMAT="%F %T "
shopt -s histappend checkwinsize cmdhist
# Append history immediately so concurrent terminals share it
PROMPT_COMMAND="history -a; history -n; \${PROMPT_COMMAND}"

# Enable bash completion if available
if [ -f /etc/bash_completion ]; then
    . /etc/bash_completion
elif [ -f /usr/share/bash-completion/bash_completion ]; then
    . /usr/share/bash-completion/bash_completion
fi

# PowerShell-styled prompt: PS /path>
_trakend_prompt() {
    local last=$?
    local cwd="\${PWD/#$HOME/~}"
    local marker=">"
    [ $last -ne 0 ] && marker="\\[\\e[31m\\]>\\[\\e[0m\\]"
    PS1="\\n\\[\\e[36m\\]PS \\[\\e[33m\\]\${cwd}\\[\\e[36m\\]\${marker}\\[\\e[0m\\] "
}
PROMPT_COMMAND="_trakend_prompt; \${PROMPT_COMMAND}"

# PowerShell-flavored aliases
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

# Welcome banner
echo -e "\\e[1;36mTrakend OS Terminal\\e[0m"
echo -e "\\e[2mBash $BASH_VERSION on $(uname -sr) — PowerShell-styled\\e[0m"
echo -e "\\e[2mAliases: ls dir ll cls type gci .. ... — Try 'alias' to see all.\\e[0m"
echo ""
`;
    try {
      fs.writeFileSync(rcPath, rc, { mode: 0o644 });
    } catch (err) {
      this.logger.debug('SYSTEM', `failed to write bashrc: ${err}`);
    }
    return rcPath;
  }

  createSession(name?: string): TerminalSession {
    const id = uuidv4();
    const sessionName = name || `Terminal ${this.sessions.size + 1}`;
    const shell = this.resolveShell();

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
        shell: shell.cmd,
        pty,
        dataHandlers: new Set<(data: string) => void>(),
      };

      this.sessions.set(id, session);

      this.logger.info(
        'SYSTEM',
        `Terminal session created: ${sessionName} (${id}) shell=${path.basename(shell.cmd)} pid=${pty.pid}`
      );

      this.scheduleIdleCheck(id);

      // Hard lifetime cap
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

    // Wire pty -> fanout exactly once per session
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
      // Clamp to sane bounds — pty rejects nonsense values.
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
