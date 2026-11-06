import React, { useCallback, useEffect, useRef, useState } from 'react'
import { RefreshCw, Download, GitBranch, AlertTriangle, CheckCircle, XCircle, Loader2, Cpu } from 'lucide-react'
import api from '../../utils/api'
import { useSystemStats } from '../../hooks/useSystemStats'
import { isPinnedDriver } from '../dashboard/GpuWidget'

interface UpdateCommit {
  hash: string
  message: string
  author: string
  date: string
}

interface UpdateHistoryRow {
  id: string
  version: string
  from_version: string
  status: 'pending' | 'in_progress' | 'completed' | 'failed'
  timestamp: number
  completed_at?: number
  error?: string
  changelog?: string
}

interface UpdateStatus {
  isGitRepo: boolean
  currentHash: string
  currentVersion: string
  currentBranch: string
  lastCheck: number
  updateAvailable: boolean
  commitsBehind: number
  latestVersion: string
  commits: UpdateCommit[]
  lastUpdate: UpdateHistoryRow | null
  updateInProgress: boolean
  repoUrl: string
}

interface CheckResult {
  currentVersion: string
  latestVersion: string
  hasUpdate: boolean
  commits: UpdateCommit[]
  lastChecked: number
  commitsBehind?: number
  currentHash?: string
  latestHash?: string
  branch?: string
  isGitRepo?: boolean
}

type ApplyPhase = 'idle' | 'confirm' | 'applying' | 'restarting' | 'done' | 'error'

const fmtTime = (ts?: number) => (ts ? new Date(ts).toLocaleString() : 'never')
const shortHash = (h?: string) => (h ? h.substring(0, 7) : '')
const errMsg = (e: any): string => e?.response?.data?.error || e?.message || String(e)

const HEALTH_POLL_MS = 3000
const HEALTH_POLL_MAX_MS = 10 * 60 * 1000

export const UpdatesSettings: React.FC = () => {
  const stats = useSystemStats()

  const [status, setStatus] = useState<UpdateStatus | null>(null)
  const [statusError, setStatusError] = useState<string | null>(null)
  const [loadingStatus, setLoadingStatus] = useState(true)

  const [checking, setChecking] = useState(false)
  const [checkResult, setCheckResult] = useState<CheckResult | null>(null)
  const [checkError, setCheckError] = useState<string | null>(null)

  const [history, setHistory] = useState<UpdateHistoryRow[]>([])

  const [phase, setPhase] = useState<ApplyPhase>('idle')
  const [applyError, setApplyError] = useState<string | null>(null)
  const [restartElapsed, setRestartElapsed] = useState(0)

  const [initializing, setInitializing] = useState(false)
  const [initError, setInitError] = useState<string | null>(null)

  const pollTimer = useRef<number | null>(null)

  const loadStatus = useCallback(async () => {
    try {
      const res = await api.get<UpdateStatus>('/updates/status')
      setStatus(res.data)
      setStatusError(null)
    } catch (e) {
      setStatusError(errMsg(e))
    } finally {
      setLoadingStatus(false)
    }
  }, [])

  const loadHistory = useCallback(async () => {
    try {
      const res = await api.get<UpdateHistoryRow[]>('/updates/history', { params: { limit: 20 } })
      setHistory(Array.isArray(res.data) ? res.data : [])
    } catch {
      // history is non-critical
    }
  }, [])

  useEffect(() => {
    loadStatus()
    loadHistory()
    return () => {
      if (pollTimer.current) window.clearTimeout(pollTimer.current)
    }
  }, [loadStatus, loadHistory])

  const handleCheck = async () => {
    setChecking(true)
    setCheckError(null)
    try {
      const res = await api.get<CheckResult>('/updates/check', { timeout: 90000 })
      setCheckResult(res.data)
      await loadStatus()
    } catch (e) {
      setCheckError(errMsg(e))
    } finally {
      setChecking(false)
    }
  }

  const pollHealthUntilBack = useCallback(() => {
    const started = Date.now()
    const tick = async () => {
      setRestartElapsed(Math.round((Date.now() - started) / 1000))
      try {
        // /health is outside /api, so bypass the axios baseURL.
        const res = await fetch('/health', { cache: 'no-store' })
        if (res.ok) {
          setPhase('done')
          await loadStatus()
          await loadHistory()
          setCheckResult(null)
          return
        }
      } catch {
        // still down
      }
      if (Date.now() - started > HEALTH_POLL_MAX_MS) {
        setPhase('error')
        setApplyError('Server did not come back within 10 minutes. Check `journalctl -u trakend-os` on the host.')
        return
      }
      pollTimer.current = window.setTimeout(tick, HEALTH_POLL_MS)
    }
    pollTimer.current = window.setTimeout(tick, HEALTH_POLL_MS)
  }, [loadStatus, loadHistory])

  const handleApply = async () => {
    setPhase('applying')
    setApplyError(null)
    try {
      // The backend pulls, rebuilds both packages and verifies the artifacts before
      // responding; that can take several minutes.
      await api.post('/updates/apply', {}, { timeout: 20 * 60 * 1000 })
      // Success: the backend exits in ~3 s and systemd restarts it.
      setPhase('restarting')
      pollHealthUntilBack()
    } catch (e: any) {
      if (e?.response) {
        // Backend answered: the update failed and was rolled back; the service is still up.
        setPhase('error')
        setApplyError(errMsg(e))
        await loadHistory()
        await loadStatus()
      } else {
        // No response (connection dropped) — most likely the server already restarted.
        setPhase('restarting')
        pollHealthUntilBack()
      }
    }
  }

  const handleInitRepo = async () => {
    if (!window.confirm('Initialize git-based updates in /opt/trakend/os?\n\nThis will fetch the server-live branch and force the working tree to match it. Local edits to tracked files will be overwritten. Runtime data under /data is not touched.')) return
    setInitializing(true)
    setInitError(null)
    try {
      await api.post('/updates/init-repo', {}, { timeout: 5 * 60 * 1000 })
      await loadStatus()
    } catch (e) {
      setInitError(errMsg(e))
    } finally {
      setInitializing(false)
    }
  }

  // Prefer the fresh check result, fall back to cached status.
  const updateAvailable = checkResult ? checkResult.hasUpdate : !!status?.updateAvailable
  const commitsBehind = checkResult?.commitsBehind ?? status?.commitsBehind ?? 0
  const commits: UpdateCommit[] = checkResult?.commits ?? status?.commits ?? []
  const latestVersion = checkResult?.latestVersion || status?.latestVersion || ''
  const busy = phase === 'applying' || phase === 'restarting'

  // GPU driver line (read-only, from live system stats)
  const gpus = (stats?.gpu || []) as Array<{ name: string; driver?: string; driverVersion?: string; driverError?: string }>
  const gpu = gpus[0]
  const gpuDriver = gpu ? gpu.driverVersion || gpu.driver || '' : ''

  return (
    <div className="max-w-3xl space-y-6">
      {/* Current version */}
      <div className="p-4 bg-trakend-surface border border-trakend-border rounded-lg">
        <div className="flex items-start justify-between gap-4">
          <div>
            <div className="text-sm font-semibold text-trakend-text-primary mb-1">Current Version</div>
            {loadingStatus ? (
              <div className="text-trakend-text-secondary text-sm flex items-center gap-2"><Loader2 size={14} className="animate-spin" /> Loading…</div>
            ) : statusError ? (
              <div className="text-trakend-error text-sm">Failed to load status: {statusError}</div>
            ) : (
              <>
                <div className="text-2xl font-bold text-trakend-accent">{status?.currentVersion || 'unknown'}</div>
                {status?.isGitRepo && (
                  <div className="text-xs text-trakend-text-secondary mt-2 flex items-center gap-3 flex-wrap">
                    <span className="flex items-center gap-1"><GitBranch size={12} /> {status.currentBranch || '?'}</span>
                    <span className="font-mono">{shortHash(status.currentHash)}</span>
                    <span>Last check: {fmtTime(status.lastCheck)}</span>
                  </div>
                )}
              </>
            )}
          </div>
          {status?.isGitRepo && (
            <button
              onClick={handleCheck}
              disabled={checking || busy}
              className="flex items-center gap-2 px-4 py-2 rounded-lg bg-trakend-accent text-white hover:bg-trakend-accent-dark transition-colors disabled:opacity-50 shrink-0"
            >
              <RefreshCw size={16} className={checking ? 'animate-spin' : ''} />
              {checking ? 'Checking…' : 'Check for Updates'}
            </button>
          )}
        </div>
      </div>

      {/* Not a git repo → initialize */}
      {!loadingStatus && status && !status.isGitRepo && (
        <div className="p-4 bg-trakend-surface border border-trakend-warning rounded-lg space-y-3">
          <div className="flex items-start gap-2">
            <AlertTriangle size={18} className="text-trakend-warning shrink-0 mt-0.5" />
            <div>
              <div className="text-sm font-semibold text-trakend-text-primary">Updates are not initialized</div>
              <p className="text-xs text-trakend-text-secondary mt-1">
                This install was not shipped with a git checkout. Initialize it to enable in-place updates from{' '}
                <span className="font-mono">{status.repoUrl || 'the configured repository'}</span> (branch <span className="font-mono">server-live</span>).
              </p>
            </div>
          </div>
          {initError && <div className="text-xs text-trakend-error">{initError}</div>}
          <button
            onClick={handleInitRepo}
            disabled={initializing}
            className="flex items-center gap-2 px-4 py-2 rounded-lg bg-trakend-accent text-white hover:bg-trakend-accent-dark transition-colors disabled:opacity-50"
          >
            {initializing ? <Loader2 size={16} className="animate-spin" /> : <GitBranch size={16} />}
            {initializing ? 'Initializing…' : 'Initialize updates'}
          </button>
        </div>
      )}

      {/* Check result */}
      {checkError && <div className="text-sm text-trakend-error">Check failed: {checkError}</div>}

      {status?.isGitRepo && !busy && (
        <div className="p-4 bg-trakend-surface border border-trakend-border rounded-lg space-y-3">
          {updateAvailable ? (
            <>
              <div className="flex items-center justify-between gap-4">
                <div>
                  <div className="text-sm font-semibold text-trakend-text-primary flex items-center gap-2">
                    <Download size={16} className="text-trakend-accent" />
                    Update available: {latestVersion}
                  </div>
                  <div className="text-xs text-trakend-text-secondary mt-1">
                    {commitsBehind} commit{commitsBehind === 1 ? '' : 's'} behind{' '}
                    <span className="font-mono">origin/{checkResult?.branch || status.currentBranch}</span>
                  </div>
                </div>
                <button
                  onClick={() => setPhase('confirm')}
                  disabled={status.updateInProgress}
                  className="flex items-center gap-2 px-4 py-2 rounded-lg bg-trakend-success text-white hover:opacity-90 transition-opacity disabled:opacity-50 shrink-0"
                >
                  <Download size={16} /> Install Update
                </button>
              </div>
              {commits.length > 0 && (
                <div className="max-h-56 overflow-y-auto border border-trakend-border rounded divide-y divide-trakend-border">
                  {commits.map((c) => (
                    <div key={c.hash} className="px-3 py-2 text-xs flex gap-3">
                      <span className="font-mono text-trakend-accent shrink-0">{c.hash}</span>
                      <span className="text-trakend-text-primary flex-1 truncate" title={c.message}>{c.message}</span>
                      <span className="text-trakend-text-secondary shrink-0 hidden sm:block">{c.author}</span>
                    </div>
                  ))}
                </div>
              )}
            </>
          ) : (
            <div className="flex items-center gap-2 text-sm text-trakend-text-secondary">
              <CheckCircle size={16} className="text-trakend-success" />
              {checkResult || status.lastCheck ? 'You are up to date.' : 'Not checked yet — click "Check for Updates".'}
            </div>
          )}
        </div>
      )}

      {/* Confirm dialog */}
      {phase === 'confirm' && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60" onClick={() => setPhase('idle')}>
          <div className="bg-trakend-surface border border-trakend-border rounded-lg p-6 max-w-md w-full mx-4 space-y-4" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-lg font-semibold text-trakend-text-primary">Install update {latestVersion}?</h3>
            <ul className="text-sm text-trakend-text-secondary list-disc pl-5 space-y-1">
              <li>The code is pulled with <span className="font-mono">git pull --ff-only</span> and both packages are rebuilt.</li>
              <li>If the build fails, the previous version is restored automatically and the service keeps running.</li>
              <li>On success the service restarts; the web UI will be unavailable for roughly 10–30 seconds.</li>
              <li>Docker containers, the array and shares are not affected. The GPU driver is never touched.</li>
            </ul>
            <div className="flex justify-end gap-3">
              <button onClick={() => setPhase('idle')} className="px-4 py-2 rounded-lg border border-trakend-border text-trakend-text-primary hover:bg-trakend-surface-light">Cancel</button>
              <button onClick={handleApply} className="px-4 py-2 rounded-lg bg-trakend-success text-white hover:opacity-90">Install &amp; restart</button>
            </div>
          </div>
        </div>
      )}

      {/* Progress */}
      {phase === 'applying' && (
        <div className="p-4 bg-trakend-surface border border-trakend-accent rounded-lg flex items-start gap-3">
          <Loader2 size={20} className="animate-spin text-trakend-accent shrink-0 mt-0.5" />
          <div>
            <div className="text-sm font-semibold text-trakend-text-primary">Installing update…</div>
            <p className="text-xs text-trakend-text-secondary mt-1">Pulling, installing dependencies and building backend + frontend. This can take a few minutes. Do not close this page.</p>
          </div>
        </div>
      )}
      {phase === 'restarting' && (
        <div className="p-4 bg-trakend-surface border border-trakend-accent rounded-lg flex items-start gap-3">
          <Loader2 size={20} className="animate-spin text-trakend-accent shrink-0 mt-0.5" />
          <div>
            <div className="text-sm font-semibold text-trakend-text-primary">Update installed — server restarting, reconnecting…</div>
            <p className="text-xs text-trakend-text-secondary mt-1">Waiting for /health ({restartElapsed}s). The page will refresh its status automatically.</p>
          </div>
        </div>
      )}
      {phase === 'done' && (
        <div className="p-4 bg-trakend-surface border border-trakend-success rounded-lg flex items-start gap-3">
          <CheckCircle size={20} className="text-trakend-success shrink-0 mt-0.5" />
          <div>
            <div className="text-sm font-semibold text-trakend-text-primary">Server is back online.</div>
            <p className="text-xs text-trakend-text-secondary mt-1">
              Now running {status?.currentVersion} ({shortHash(status?.currentHash)}).{' '}
              <button className="underline" onClick={() => window.location.reload()}>Reload the page</button> to load the new UI.
            </p>
          </div>
        </div>
      )}
      {phase === 'error' && (
        <div className="p-4 bg-trakend-surface border border-trakend-error rounded-lg flex items-start gap-3">
          <XCircle size={20} className="text-trakend-error shrink-0 mt-0.5" />
          <div className="min-w-0">
            <div className="text-sm font-semibold text-trakend-text-primary">Update failed</div>
            <pre className="text-xs text-trakend-error mt-1 whitespace-pre-wrap break-words max-h-48 overflow-y-auto">{applyError}</pre>
            <button className="text-xs underline text-trakend-text-secondary mt-2" onClick={() => setPhase('idle')}>Dismiss</button>
          </div>
        </div>
      )}

      {/* GPU driver (read-only) */}
      <div className="p-4 bg-trakend-surface border border-trakend-border rounded-lg">
        <div className="text-sm font-semibold text-trakend-text-primary mb-2 flex items-center gap-2"><Cpu size={16} /> GPU driver</div>
        {!gpu ? (
          <div className="text-sm text-trakend-text-secondary">No GPU detected</div>
        ) : gpu.driverError ? (
          <div className="text-sm text-trakend-error">Driver error: {gpu.driverError}</div>
        ) : (
          <div className="text-sm text-trakend-text-primary flex items-center gap-2 flex-wrap">
            <span>{gpu.name}</span>
            <span className="text-trakend-text-secondary">—</span>
            <span className="font-mono">{gpuDriver || 'unknown version'}</span>
            {isPinnedDriver(gpuDriver) && (
              <span
                title="NVIDIA 580 branch is pinned via /etc/apt/preferences.d/99-trakend-nvidia-pin and apt-mark hold"
                className="text-[9px] uppercase font-bold px-1.5 py-0.5 rounded text-trakend-success border border-trakend-success"
              >
                pinned
              </span>
            )}
          </div>
        )}
        <p className="text-xs text-trakend-text-secondary mt-2">
          Driver and kernel packages are never changed by Trakend OS updates. See <span className="font-mono">installer/GPU-DRIVER.md</span> for manual driver maintenance.
        </p>
      </div>

      {/* History */}
      <div className="pt-4 border-t border-trakend-border">
        <h3 className="text-sm font-semibold text-trakend-text-primary mb-3">Update History</h3>
        {history.length === 0 ? (
          <div className="text-xs text-trakend-text-secondary">No updates have been applied on this server.</div>
        ) : (
          <div className="space-y-2">
            {history.map((h) => (
              <div key={h.id} className="p-3 bg-trakend-surface border border-trakend-border rounded text-sm">
                <div className="flex items-center justify-between gap-3">
                  <div className="text-trakend-text-primary flex items-center gap-2 min-w-0">
                    {h.status === 'completed' && <CheckCircle size={14} className="text-trakend-success shrink-0" />}
                    {h.status === 'failed' && <XCircle size={14} className="text-trakend-error shrink-0" />}
                    {(h.status === 'in_progress' || h.status === 'pending') && <Loader2 size={14} className="animate-spin text-trakend-accent shrink-0" />}
                    <span className="truncate">{h.from_version} → {h.version}</span>
                  </div>
                  <span className="text-xs text-trakend-text-secondary shrink-0">{fmtTime(h.timestamp)}</span>
                </div>
                {h.error && <pre className="text-xs text-trakend-error mt-1 whitespace-pre-wrap break-words max-h-24 overflow-y-auto">{h.error}</pre>}
                {h.changelog && !h.error && (
                  <details className="mt-1">
                    <summary className="text-xs text-trakend-text-secondary cursor-pointer">Changelog</summary>
                    <pre className="text-xs text-trakend-text-secondary mt-1 whitespace-pre-wrap">{h.changelog}</pre>
                  </details>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
