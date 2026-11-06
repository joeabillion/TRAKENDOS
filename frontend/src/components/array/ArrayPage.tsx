import React, { useState, useEffect, useCallback } from 'react'
import {
  HardDrive, Shield, ShieldCheck, ShieldAlert, ShieldOff,
  Play, Square, RefreshCw, Plus, Trash2, AlertTriangle,
  CheckCircle, ThermometerSun,
  FolderOpen, Settings, ChevronDown, ChevronRight,
  RotateCcw, Search, Server
} from 'lucide-react'
import api from '../../utils/api'
import { Button } from '../common/Button'
import { useToast } from '../common/Toast'
import { useConfirm } from '../common/ConfirmDialog'
import { SkeletonCard } from '../common/Skeleton'
import { EmptyState } from '../common/EmptyState'

/** Pull a human-readable message out of an axios error (never dump raw JSON). */
function errMsg(err: any, fallback: string): string {
  const raw = err?.response?.data?.error || err?.response?.data?.message || err?.message
  if (!raw) return fallback
  return String(raw).replace(/^Error:\s*/, '')
}

/** "Failed: <id> (slot 3), <id> (slot 5)" -> ["<id> (slot 3)", "<id> (slot 5)"] */
function parseFailedSlots(message: string): string[] {
  const m = message.match(/Failed:\s*(.+)$/i)
  if (!m) return []
  return m[1].split(',').map((x) => x.trim()).filter(Boolean)
}

// ─── Types ────────────────────────────────────────────

interface PhysicalDrive {
  id: string
  device: string
  model: string
  serial: string
  size_bytes: number
  size_human: string
  transport: string
  rpm: number
  temperature: number
  health: 'healthy' | 'warning' | 'failing' | 'failed' | 'unknown'
  smart_passed: boolean
  role: 'data' | 'parity' | 'parity2' | 'cache' | 'hot_spare' | 'unassigned'
  slot?: number
  filesystem?: string
  mount_point?: string
  usage_bytes?: number
  spin_state: string
  power_on_hours: number
  reallocated_sectors: number
}

interface ArrayConfig {
  name: string
  mode: string
  state: string
  parity_state: string
  spin_down_delay: number
  reconstruct_write: boolean
  parity_check_schedule: string
  auto_start: boolean
  last_parity_check?: string
}

interface ParityOp {
  id?: string
  type?: string
  status: string
  progress?: number
  speed_mbps?: number
  estimated_finish?: number
  errors_found?: number
  target_drive?: string
}

interface Share {
  id: string
  name: string
  path: string
  pool: string
  use_cache: string
  allocation_method: string
  export_smb: boolean
  export_nfs: boolean
  smb_security: string
}

interface ArraySummary {
  config: ArrayConfig
  data_drives: number
  parity_drives: number
  cache_drives: number
  hot_spares: number
  total_capacity: number
  total_capacity_human: string
  used_capacity: number
  used_capacity_human: string
  free_capacity_human: string
  usage_percent: number
  parity_operation: ParityOp | null
  shares: Share[]
}

// ─── Subcomponents ────────────────────────────────────

const HealthBadge: React.FC<{ health: string }> = ({ health }) => {
  const colors: Record<string, string> = {
    healthy: 'bg-green-500/20 text-green-400',
    warning: 'bg-yellow-500/20 text-yellow-400',
    failing: 'bg-orange-500/20 text-orange-400',
    failed: 'bg-red-500/20 text-red-400',
    unknown: 'bg-gray-500/20 text-gray-400',
  }
  return (
    <span className={`px-2 py-0.5 rounded text-xs font-medium ${colors[health] || colors.unknown}`}>
      {health.toUpperCase()}
    </span>
  )
}

const RoleBadge: React.FC<{ role: string }> = ({ role }) => {
  const colors: Record<string, string> = {
    data: 'bg-blue-500/20 text-blue-400',
    parity: 'bg-purple-500/20 text-purple-400',
    parity2: 'bg-purple-500/20 text-purple-300',
    cache: 'bg-cyan-500/20 text-cyan-400',
    hot_spare: 'bg-yellow-500/20 text-yellow-400',
    unassigned: 'bg-gray-500/20 text-gray-400',
  }
  const labels: Record<string, string> = {
    data: 'Data',
    parity: 'Parity',
    parity2: 'Parity 2',
    cache: 'Cache',
    hot_spare: 'Hot Spare',
    unassigned: 'Unassigned',
  }
  return (
    <span className={`px-2 py-0.5 rounded text-xs font-medium ${colors[role] || colors.unassigned}`}>
      {labels[role] || role}
    </span>
  )
}

const StateBadge: React.FC<{ state: string }> = ({ state }) => {
  const colors: Record<string, string> = {
    running: 'bg-green-500/20 text-green-400',
    stopped: 'bg-gray-500/20 text-gray-400',
    degraded: 'bg-orange-500/20 text-orange-400',
    rebuilding: 'bg-yellow-500/20 text-yellow-400',
    starting: 'bg-blue-500/20 text-blue-400',
    stopping: 'bg-blue-500/20 text-blue-400',
    error: 'bg-red-500/20 text-red-400',
  }
  return (
    <span className={`px-2 py-1 rounded text-xs font-bold uppercase ${colors[state] || colors.stopped}`}>
      {state === 'degraded' && <AlertTriangle className="w-3 h-3 inline mr-1" />}
      {state === 'running' && <CheckCircle className="w-3 h-3 inline mr-1" />}
      {state}
    </span>
  )
}

// ─── Main Page ────────────────────────────────────────

const ArrayPage: React.FC = () => {
  const toast = useToast()
  const confirm = useConfirm()
  const [activeTab, setActiveTab] = useState<'drives' | 'parity' | 'shares' | 'settings'>('drives')
  const [drives, setDrives] = useState<PhysicalDrive[]>([])
  const [summary, setSummary] = useState<ArraySummary | null>(null)
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [scanning, setScanning] = useState(false)
  const [busy, setBusy] = useState<string | null>(null) // which action is in flight
  const [startError, setStartError] = useState<string | null>(null) // last POST /array/start failure
  const [parityStatus, setParityStatus] = useState<ParityOp | null>(null)
  const [assignDialog, setAssignDialog] = useState<{ drive: PhysicalDrive; open: boolean } | null>(null)
  const [shareDialog, setShareDialog] = useState(false)
  const [newShare, setNewShare] = useState({ name: '', pool: 'array', use_cache: 'no', allocation_method: 'highwater', export_smb: true })

  const fetchData = useCallback(async () => {
    try {
      const [drivesRes, summaryRes] = await Promise.all([
        api.get('/array/drives'),
        api.get('/array/summary'),
      ])
      setDrives(drivesRes.data)
      setSummary(summaryRes.data)
      setLoadError(null)
      // Live progress for building/checking comes from the dedicated status route
      const ps = summaryRes.data?.config?.parity_state
      if (ps === 'building' || ps === 'checking' || ps === 'rebuilding' || summaryRes.data?.parity_operation?.status === 'running') {
        try {
          const { data } = await api.get('/array/parity/status')
          setParityStatus(data && data.status !== 'idle' ? data : null)
        } catch { /* optional */ }
      } else {
        setParityStatus(null)
      }
    } catch (err: any) {
      setLoadError(errMsg(err, 'Failed to load array data'))
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    fetchData()
    const interval = setInterval(fetchData, 5000)
    return () => clearInterval(interval)
  }, [fetchData])

  /** Run an action with a busy flag and toast on failure. */
  const run = async (key: string, fn: () => Promise<void>, fallback: string) => {
    setBusy(key)
    try {
      await fn()
      await fetchData()
    } catch (err: any) {
      toast.error(errMsg(err, fallback))
      throw err
    } finally {
      setBusy(null)
    }
  }

  const scanDrives = async () => {
    setScanning(true)
    try {
      await api.post('/array/drives/scan')
      await fetchData()
      toast.success('Drive scan complete')
    } catch (err: any) {
      toast.error(errMsg(err, 'Drive scan failed'))
    } finally {
      setScanning(false)
    }
  }

  /** Start (or re-start after an error) — the backend mounts every assigned drive. */
  const startArray = async () => {
    setBusy('start')
    setStartError(null)
    try {
      await api.post('/array/start')
      toast.success('Array started')
      await fetchData()
    } catch (err: any) {
      const msg = errMsg(err, 'Failed to start array')
      setStartError(msg)
      toast.error(msg)
      await fetchData()
    } finally {
      setBusy(null)
    }
  }

  const stopArray = async () => {
    const ok = await confirm({
      title: 'Stop the array?',
      message: 'All shares and Docker containers using array storage will lose access until it is started again.',
      confirmLabel: 'Stop array',
      variant: 'danger',
    })
    if (!ok) return
    await run('stop', async () => { await api.post('/array/stop') }, 'Failed to stop array').catch(() => {})
  }

  const assignDrive = async (driveId: string, role: string, slot?: number) => {
    await run('assign', async () => {
      await api.post('/array/drives/assign', { driveId, role, slot })
      setAssignDialog(null)
    }, 'Failed to assign drive').catch(() => {})
  }

  const unassignDrive = async (driveId: string) => {
    const ok = await confirm({ title: 'Remove this drive from the array?', message: 'The drive is not erased; it simply stops being part of the array.', confirmLabel: 'Remove', variant: 'danger' })
    if (!ok) return
    await run('unassign', async () => { await api.post('/array/drives/unassign', { driveId }) }, 'Failed to unassign drive').catch(() => {})
  }

  const startParitySync = async () => {
    const ok = await confirm({
      title: 'Start parity sync?',
      message: 'Parity will be rebuilt from all data drives. This reads every drive end-to-end and can take many hours; the array stays usable.',
      confirmLabel: 'Start sync',
      variant: 'warning',
    })
    if (!ok) return
    await run('sync', async () => { await api.post('/array/parity/sync') }, 'Failed to start parity sync').catch(() => {})
  }

  const startParityCheck = async (correct: boolean = false) => {
    await run(correct ? 'check-correct' : 'check', async () => { await api.post('/array/parity/check', { correct }) }, 'Failed to start parity check').catch(() => {})
  }

  const cancelParity = async () => {
    const ok = await confirm({ title: 'Cancel the running parity operation?', message: 'Parity will be marked out of date until a sync completes.', confirmLabel: 'Cancel operation', variant: 'danger' })
    if (!ok) return
    await run('cancel', async () => { await api.post('/array/parity/cancel') }, 'Failed to cancel').catch(() => {})
  }

  const createShare = async () => {
    await run('share', async () => {
      await api.post('/array/shares', newShare)
      setShareDialog(false)
      setNewShare({ name: '', pool: 'array', use_cache: 'no', allocation_method: 'highwater', export_smb: true })
    }, 'Failed to create share').catch(() => {})
  }

  const deleteShare = async (id: string) => {
    const ok = await confirm({ title: 'Delete this share?', message: 'The share definition is removed. Files on disk are not deleted.', confirmLabel: 'Delete', variant: 'danger' })
    if (!ok) return
    await run('delete-share', async () => { await api.delete(`/array/shares/${id}`) }, 'Failed to delete share').catch(() => {})
  }

  if (loading) {
    return (
      <div className="p-6 space-y-4 w-full">
        <SkeletonCard tiles={0} bodyHeight={24} />
        <SkeletonCard tiles={4} bodyHeight={120} />
        <SkeletonCard tiles={0} bodyHeight={200} />
      </div>
    )
  }

  const config = summary?.config
  const assignedDrives = drives.filter(d => d.role !== 'unassigned')
  const unassignedDrives = drives.filter(d => d.role === 'unassigned')
  // Prefer the live status route while an operation is running
  const parityOp = parityStatus && parityStatus.status === 'running' ? parityStatus : summary?.parity_operation

  if (!config) {
    return (
      <div className="p-6 w-full">
        <EmptyState
          error
          title="Array service unavailable"
          description={loadError || 'The backend did not return an array configuration.'}
          action={<Button variant="primary" icon={<RefreshCw size={14} />} onClick={() => { setLoading(true); fetchData() }}>Retry</Button>}
        />
      </div>
    )
  }

  const arrayUp = config.state === 'running' || config.state === 'degraded'
  const unmountedData = arrayUp ? assignedDrives.filter(d => d.role === 'data' && !d.mount_point) : []
  const failedSlots = startError ? parseFailedSlots(startError) : []
  const parityIsStale = config.parity_state === 'invalid'
  const parityWorking = config.parity_state === 'building' || config.parity_state === 'checking' || config.parity_state === 'rebuilding'

  return (
    <div className="p-4 sm:p-6 space-y-6 w-full">
      {loadError && (
        <div className="banner banner-warning rounded-lg border">
          <AlertTriangle size={16} className="flex-shrink-0" />
          <span className="flex-1">Live refresh failed: {loadError}. Showing last known state.</span>
        </div>
      )}

      {/* Error state: startup aborted — list what failed and offer reconcile */}
      {config.state === 'error' && (
        <div className="p-4 bg-trakend-error/10 border border-trakend-error/50 rounded-lg flex items-start gap-3" role="alert">
          <AlertTriangle className="w-5 h-5 text-trakend-error flex-shrink-0 mt-0.5" />
          <div className="flex-1 min-w-0">
            <h3 className="font-semibold text-trakend-error">Array failed to start</h3>
            <p className="text-sm text-trakend-text-primary mt-0.5">
              {startError
                ? startError.replace(/\s*Failed:.*$/i, '')
                : 'One or more data drives could not be mounted, so the array was not brought online.'}
            </p>
            {(failedSlots.length > 0 || unmountedData.length > 0) && (
              <ul className="mt-2 space-y-1 text-sm">
                {(failedSlots.length > 0 ? failedSlots : unmountedData.map(d => `${d.model} (${d.device})${d.slot ? ` — slot ${d.slot}` : ''}`)).map((item, i) => (
                  <li key={i} className="flex items-center gap-2 text-trakend-error/90">
                    <span className="w-1.5 h-1.5 rounded-full bg-trakend-error flex-shrink-0" />
                    <code className="text-xs bg-trakend-dark px-1.5 py-0.5 rounded text-trakend-text-primary">{item}</code>
                  </li>
                ))}
              </ul>
            )}
            <p className="text-xs text-trakend-text-secondary mt-2">
              Check cabling / power for the listed drives, run a scan, then reconcile mounts to retry.
            </p>
          </div>
          <div className="flex flex-col gap-2 flex-shrink-0">
            <Button variant="primary" size="sm" icon={<RotateCcw size={14} />} loading={busy === 'start'} onClick={startArray}>
              Reconcile mounts
            </Button>
            <Button variant="secondary" size="sm" icon={<Search size={14} />} loading={scanning} onClick={scanDrives}>
              Scan drives
            </Button>
          </div>
        </div>
      )}

      {/* Degraded mode warning banner */}
      {config.state === 'degraded' && (
        <div className="p-4 bg-trakend-warning/10 border border-trakend-warning/50 rounded-lg flex items-start gap-3" role="alert">
          <AlertTriangle className="w-5 h-5 text-trakend-warning flex-shrink-0 mt-0.5" />
          <div className="flex-1">
            <h3 className="font-semibold text-trakend-warning">Array running in degraded mode</h3>
            <p className="text-sm text-trakend-text-primary mt-0.5">
              {unmountedData.length > 0
                ? `${unmountedData.length} data drive(s) are not mounted: ${unmountedData.map(d => d.slot ? `Disk ${d.slot}` : d.device).join(', ')}. `
                : 'One or more drives are missing or not mounted. '}
              Data protection may be compromised.
            </p>
          </div>
          <Button variant="secondary" size="sm" icon={<RotateCcw size={14} />} loading={busy === 'start'} onClick={startArray}>
            Reconcile mounts
          </Button>
        </div>
      )}

      {/* Parity honesty banner */}
      {parityIsStale && summary && summary.parity_drives > 0 && (
        <div className="p-3 bg-trakend-warning/10 border border-trakend-warning/40 rounded-lg flex items-center gap-3">
          <ShieldAlert className="w-5 h-5 text-trakend-warning flex-shrink-0" />
          <div className="flex-1 text-sm text-trakend-text-primary">
            <span className="font-semibold text-trakend-warning">Parity out of date</span> — the array is not protected until a parity sync completes.
          </div>
          <Button size="sm" variant="primary" icon={<RefreshCw size={14} />} loading={busy === 'sync'} disabled={config.state !== 'running' || parityOp?.status === 'running'} onClick={startParitySync}>
            Run sync
          </Button>
        </div>
      )}

      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-trakend-text-primary flex items-center gap-3">
            <Server className="w-7 h-7 text-trakend-accent" />
            Array Manager
          </h1>
          <p className="text-sm text-trakend-text-secondary mt-1">
            {config.name} — {summary?.data_drives || 0} data, {summary?.parity_drives || 0} parity, {summary?.cache_drives || 0} cache
          </p>
        </div>
        <div className="flex items-center gap-3">
          <StateBadge state={config.state} />
          {config.state === 'stopped' || config.state === 'error' ? (
            <Button variant="primary" icon={<Play size={16} />} loading={busy === 'start'} disabled={!!busy && busy !== 'start'} onClick={startArray}>
              {config.state === 'error' ? 'Retry start' : 'Start Array'}
            </Button>
          ) : (
            <Button variant="danger" icon={<Square size={16} />} loading={busy === 'stop'} disabled={(!!busy && busy !== 'stop') || config.state === 'starting' || config.state === 'stopping'} onClick={stopArray}>
              Stop Array
            </Button>
          )}
        </div>
      </div>

      {/* Capacity overview */}
      {summary && summary.total_capacity > 0 && (
        <div className="p-4 bg-trakend-surface border border-trakend-border rounded-lg">
          <div className="flex items-center justify-between mb-2">
            <span className="text-sm text-trakend-text-secondary">Array Capacity</span>
            <span className="text-sm text-trakend-text-primary">
              {summary.used_capacity_human} / {summary.total_capacity_human} ({summary.usage_percent}%)
            </span>
          </div>
          <div className="w-full h-3 bg-trakend-dark rounded-full overflow-hidden">
            <div
              className={`h-full rounded-full transition-all ${
                summary.usage_percent > 90 ? 'bg-red-500' :
                summary.usage_percent > 75 ? 'bg-yellow-500' : 'bg-trakend-accent'
              }`}
              style={{ width: `${summary.usage_percent}%` }}
            />
          </div>
          <div className="flex justify-between mt-1 text-xs text-trakend-text-secondary">
            <span>{summary.free_capacity_human} free</span>
            <span className={parityIsStale ? 'text-trakend-warning' : parityWorking ? 'text-trakend-info-light' : config.parity_state === 'valid' ? 'text-trakend-success' : ''}>
              Parity: {parityIsStale ? 'out of date — run sync' : parityWorking ? `${config.parity_state}${parityOp?.progress != null ? ` ${parityOp.progress.toFixed(0)}%` : ''}` : config?.parity_state || 'none'}
            </span>
          </div>
        </div>
      )}

      {/* Tab bar */}
      <div className="flex gap-1 p-1 bg-trakend-surface border border-trakend-border rounded-lg">
        {[
          { id: 'drives' as const, label: 'Drives', icon: HardDrive },
          { id: 'parity' as const, label: 'Parity', icon: Shield },
          { id: 'shares' as const, label: 'Shares', icon: FolderOpen },
          { id: 'settings' as const, label: 'Array Settings', icon: Settings },
        ].map(tab => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={`flex-1 flex items-center justify-center gap-2 px-4 py-2 rounded-md text-sm font-medium transition-colors ${
              activeTab === tab.id
                ? 'bg-trakend-accent text-white'
                : 'text-trakend-text-secondary hover:text-trakend-text-primary hover:bg-trakend-dark'
            }`}
          >
            <tab.icon className="w-4 h-4" />
            {tab.label}
          </button>
        ))}
      </div>

      {/* ─── Drives Tab ─── */}
      {activeTab === 'drives' && (
        <div className="space-y-6">
          {/* Assigned drives */}
          <div>
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-lg font-semibold text-trakend-text-primary">Array Drives</h2>
              <Button size="sm" variant="secondary" icon={<Search size={14} />} loading={scanning} onClick={scanDrives}>
                {scanning ? 'Scanning…' : 'Scan Drives'}
              </Button>
            </div>

            {assignedDrives.length === 0 ? (
              <div className="p-8 text-center bg-trakend-surface border border-trakend-border border-dashed rounded-lg">
                <HardDrive className="w-12 h-12 mx-auto text-trakend-text-secondary mb-3 opacity-50" />
                <p className="text-trakend-text-secondary">No drives assigned to the array yet.</p>
                <p className="text-sm text-trakend-text-secondary mt-1">Assign drives from the unassigned list below.</p>
              </div>
            ) : (
              <div className="space-y-2">
                {/* Parity drives first */}
                {assignedDrives.filter(d => d.role === 'parity' || d.role === 'parity2').map(drive => (
                  <DriveRow key={drive.id} drive={drive} onUnassign={() => unassignDrive(drive.id)} arrayStopped={config.state === 'stopped' || config.state === 'error'} arrayUp={arrayUp} />
                ))}
                {/* Then data drives sorted by slot */}
                {assignedDrives.filter(d => d.role === 'data').sort((a, b) => (a.slot || 0) - (b.slot || 0)).map(drive => (
                  <DriveRow key={drive.id} drive={drive} onUnassign={() => unassignDrive(drive.id)} arrayStopped={config.state === 'stopped' || config.state === 'error'} arrayUp={arrayUp} />
                ))}
                {/* Cache */}
                {assignedDrives.filter(d => d.role === 'cache').map(drive => (
                  <DriveRow key={drive.id} drive={drive} onUnassign={() => unassignDrive(drive.id)} arrayStopped={config.state === 'stopped' || config.state === 'error'} arrayUp={arrayUp} />
                ))}
                {/* Hot spares */}
                {assignedDrives.filter(d => d.role === 'hot_spare').map(drive => (
                  <DriveRow key={drive.id} drive={drive} onUnassign={() => unassignDrive(drive.id)} arrayStopped={config.state === 'stopped' || config.state === 'error'} arrayUp={arrayUp} />
                ))}
              </div>
            )}
          </div>

          {/* Unassigned drives */}
          {unassignedDrives.length > 0 && (
            <div>
              <h2 className="text-lg font-semibold text-trakend-text-primary mb-3">Unassigned Drives</h2>
              <div className="space-y-2">
                {unassignedDrives.map(drive => (
                  <DriveRow
                    key={drive.id}
                    drive={drive}
                    onAssign={() => setAssignDialog({ drive, open: true })}
                    arrayStopped={config.state === 'stopped' || config.state === 'error'}
                    arrayUp={arrayUp}
                  />
                ))}
              </div>
            </div>
          )}

          {drives.length === 0 && (
            <div className="p-8 text-center bg-trakend-surface border border-trakend-border rounded-lg">
              <HardDrive className="w-12 h-12 mx-auto text-trakend-text-secondary mb-3 opacity-50" />
              <p className="text-trakend-text-secondary">No drives detected.</p>
              <button onClick={scanDrives} className="mt-3 px-4 py-2 bg-trakend-accent text-white rounded-lg hover:bg-trakend-accent-dark">
                Scan for Drives
              </button>
            </div>
          )}
        </div>
      )}

      {/* ─── Parity Tab ─── */}
      {activeTab === 'parity' && (
        <div className="space-y-6">
          {/* Parity status card */}
          <div className="p-6 bg-trakend-surface border border-trakend-border rounded-lg">
            <div className="flex items-center gap-3 mb-4">
              {config.parity_state === 'valid' ? (
                <ShieldCheck className="w-8 h-8 text-green-400" />
              ) : config.parity_state === 'invalid' ? (
                <ShieldAlert className="w-8 h-8 text-orange-400" />
              ) : config.parity_state === 'building' || config.parity_state === 'checking' ? (
                <Shield className="w-8 h-8 text-blue-400 animate-pulse" />
              ) : (
                <ShieldOff className="w-8 h-8 text-gray-400" />
              )}
              <div>
                <h2 className="text-lg font-semibold text-trakend-text-primary">
                  {config.parity_state === 'valid' ? 'Parity valid'
                    : config.parity_state === 'invalid' ? <span className="text-trakend-warning">Parity out of date — run sync</span>
                    : config.parity_state === 'building' ? 'Building parity…'
                    : config.parity_state === 'checking' ? 'Checking parity…'
                    : config.parity_state === 'rebuilding' ? 'Rebuilding drive…'
                    : 'No parity configured'}
                </h2>
                <p className="text-sm text-trakend-text-secondary">
                  {summary?.parity_drives || 0} parity drive(s) assigned
                  {config.parity_state === 'valid' && config.last_parity_check &&
                    ` — Last check: ${new Date(config.last_parity_check).toLocaleDateString()}`
                  }
                </p>
              </div>
            </div>

            {/* Active parity operation */}
            {parityOp && parityOp.status === 'running' && (
              <div className="mt-4 p-4 bg-trakend-dark rounded-lg">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-sm font-medium text-trakend-text-primary">
                    {parityOp.type === 'sync' ? 'Parity Sync' :
                     parityOp.type === 'check' ? 'Parity Check' :
                     parityOp.type === 'rebuild' ? 'Drive Rebuild' : 'Parity Operation'}
                    {parityOp.target_drive && ` — ${parityOp.target_drive}`}
                  </span>
                  <Button size="xs" variant="danger" loading={busy === 'cancel'} onClick={cancelParity}>Cancel</Button>
                </div>
                <div className="w-full h-2 bg-trakend-surface rounded-full overflow-hidden">
                  <div className="h-full bg-trakend-accent rounded-full transition-all" style={{ width: `${parityOp.progress || 0}%` }} />
                </div>
                <div className="flex justify-between mt-1 text-xs text-trakend-text-secondary">
                  <span>{(parityOp.progress || 0).toFixed(1)}%</span>
                  <span>{parityOp.speed_mbps || 0} MB/s</span>
                  {parityOp.estimated_finish && (
                    <span>ETA: {new Date(parityOp.estimated_finish).toLocaleTimeString()}</span>
                  )}
                </div>
              </div>
            )}

            {/* Parity actions */}
            <div className="flex flex-wrap gap-3 mt-4">
              <Button variant="primary" icon={<RefreshCw size={16} />} loading={busy === 'sync'}
                disabled={config.state !== 'running' || parityOp?.status === 'running' || (!!busy && busy !== 'sync')}
                title={config.state !== 'running' ? 'Array must be running' : undefined}
                onClick={startParitySync}>
                Parity Sync
              </Button>
              <Button variant="secondary" icon={<Search size={16} />} loading={busy === 'check'}
                disabled={config.parity_state !== 'valid' || parityOp?.status === 'running' || (!!busy && busy !== 'check')}
                title={config.parity_state !== 'valid' ? 'Parity must be valid before it can be checked' : undefined}
                onClick={() => startParityCheck(false)}>
                Check Parity
              </Button>
              <Button variant="secondary" icon={<RotateCcw size={16} />} loading={busy === 'check-correct'}
                disabled={config.parity_state !== 'valid' || parityOp?.status === 'running' || (!!busy && busy !== 'check-correct')}
                title={config.parity_state !== 'valid' ? 'Parity must be valid before it can be checked' : undefined}
                onClick={() => startParityCheck(true)}>
                Check + Correct
              </Button>
            </div>
          </div>

          {/* Parity explainer */}
          <div className="p-4 bg-trakend-surface border border-trakend-border rounded-lg">
            <h3 className="text-sm font-semibold text-trakend-text-primary mb-2">How Parity Works</h3>
            <div className="text-xs text-trakend-text-secondary space-y-1">
              <p><strong>Parity Sync:</strong> Builds parity data from all data drives. Required after adding a parity drive or replacing a data drive.</p>
              <p><strong>Parity Check:</strong> Reads all drives and verifies parity integrity. Run monthly to catch silent corruption.</p>
              <p><strong>Check + Correct:</strong> Same as check, but automatically fixes any parity errors found.</p>
              <p><strong>Drive Rebuild:</strong> If a data drive fails, the parity drive can reconstruct all its data onto a replacement drive.</p>
              <p><strong>Dual Parity:</strong> With two parity drives, you can survive two simultaneous drive failures.</p>
            </div>
          </div>
        </div>
      )}

      {/* ─── Shares Tab ─── */}
      {activeTab === 'shares' && (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-semibold text-trakend-text-primary">User Shares</h2>
            <Button variant="primary" icon={<Plus size={16} />} onClick={() => setShareDialog(true)}>New Share</Button>
          </div>

          {summary?.shares && summary.shares.length > 0 ? (
            <div className="space-y-2">
              {summary.shares.map(share => (
                <div key={share.id} className="flex items-center justify-between p-4 bg-trakend-surface border border-trakend-border rounded-lg">
                  <div className="flex items-center gap-3">
                    <FolderOpen className="w-5 h-5 text-trakend-accent" />
                    <div>
                      <div className="font-medium text-trakend-text-primary">{share.name}</div>
                      <div className="text-xs text-trakend-text-secondary">
                        {share.path} — Pool: {share.pool} — Cache: {share.use_cache} — {share.allocation_method}
                      </div>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    {share.export_smb && <span className="px-2 py-0.5 rounded text-xs bg-blue-500/20 text-blue-400">SMB</span>}
                    {share.export_nfs && <span className="px-2 py-0.5 rounded text-xs bg-green-500/20 text-green-400">NFS</span>}
                    <Button size="sm" variant="ghost" iconOnly aria-label={`Delete share ${share.name}`} loading={busy === 'delete-share'} onClick={() => deleteShare(share.id)} icon={<Trash2 size={16} className="text-trakend-error" />} />
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="p-8 text-center bg-trakend-surface border border-trakend-border border-dashed rounded-lg">
              <FolderOpen className="w-12 h-12 mx-auto text-trakend-text-secondary mb-3 opacity-50" />
              <p className="text-trakend-text-secondary">No shares created yet.</p>
              <p className="text-xs text-trakend-text-secondary mt-1">Shares let you organize data across array drives with allocation policies.</p>
            </div>
          )}
        </div>
      )}

      {/* ─── Settings Tab ─── */}
      {activeTab === 'settings' && (
        <ArraySettings config={config} saving={busy === 'save'} onSave={async (updates) => {
          await run('save', async () => { await api.put('/array/config', updates); toast.success('Array settings saved') }, 'Failed to save settings').catch(() => {})
        }} />
      )}

      {/* ─── Assign Dialog ─── */}
      {assignDialog?.open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60">
          <div className="bg-trakend-surface border border-trakend-border rounded-xl p-6 w-96 shadow-2xl">
            <h3 className="text-lg font-semibold text-trakend-text-primary mb-2">Assign Drive</h3>
            <p className="text-sm text-trakend-text-secondary mb-4">
              {assignDialog.drive.model} — {assignDialog.drive.size_human}
            </p>
            <div className="space-y-2">
              {['data', 'parity', 'parity2', 'cache', 'hot_spare'].map(role => (
                <button
                  key={role}
                  onClick={() => assignDrive(assignDialog.drive.id, role)}
                  className="w-full flex items-center justify-between p-3 bg-trakend-dark hover:bg-trakend-border rounded-lg transition-colors"
                >
                  <div className="flex items-center gap-2">
                    <RoleBadge role={role} />
                    <span className="text-sm text-trakend-text-primary">
                      {role === 'data' ? 'Data Drive' :
                       role === 'parity' ? 'Parity Drive (Primary)' :
                       role === 'parity2' ? 'Parity Drive (Secondary)' :
                       role === 'cache' ? 'Cache Drive (SSD recommended)' :
                       'Hot Spare (auto-replace failed drive)'}
                    </span>
                  </div>
                  <ChevronRight className="w-4 h-4 text-trakend-text-secondary" />
                </button>
              ))}
            </div>
            <button onClick={() => setAssignDialog(null)} className="w-full mt-4 py-2 text-sm text-trakend-text-secondary hover:text-trakend-text-primary">
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* ─── Share Dialog ─── */}
      {shareDialog && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60">
          <div className="bg-trakend-surface border border-trakend-border rounded-xl p-6 w-[480px] shadow-2xl">
            <h3 className="text-lg font-semibold text-trakend-text-primary mb-4">Create Share</h3>
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-trakend-text-primary mb-1">Share Name</label>
                <input
                  type="text"
                  value={newShare.name}
                  onChange={e => setNewShare({ ...newShare, name: e.target.value })}
                  placeholder="e.g., media, backups, documents"
                  className="w-full px-3 py-2 bg-trakend-dark border border-trakend-border rounded-lg text-trakend-text-primary"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-trakend-text-primary mb-1">Storage Pool</label>
                <select value={newShare.pool} onChange={e => setNewShare({ ...newShare, pool: e.target.value })}
                  className="w-full px-3 py-2 bg-trakend-dark border border-trakend-border rounded-lg text-trakend-text-primary">
                  <option value="array">Array (spread across data drives)</option>
                  <option value="cache">Cache Only (SSD)</option>
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-trakend-text-primary mb-1">Use Cache</label>
                <select value={newShare.use_cache} onChange={e => setNewShare({ ...newShare, use_cache: e.target.value })}
                  className="w-full px-3 py-2 bg-trakend-dark border border-trakend-border rounded-lg text-trakend-text-primary">
                  <option value="no">No — Write directly to array</option>
                  <option value="yes">Yes — Write to cache, mover transfers to array</option>
                  <option value="prefer">Prefer — Use cache if space available</option>
                  <option value="only">Only — Cache only, never move to array</option>
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-trakend-text-primary mb-1">Allocation Method</label>
                <select value={newShare.allocation_method} onChange={e => setNewShare({ ...newShare, allocation_method: e.target.value })}
                  className="w-full px-3 py-2 bg-trakend-dark border border-trakend-border rounded-lg text-trakend-text-primary">
                  <option value="highwater">High Water — Fill drives evenly</option>
                  <option value="fillup">Fill Up — Fill one drive before moving to next</option>
                  <option value="mostfree">Most Free — Always use drive with most free space</option>
                </select>
              </div>
            </div>
            <div className="flex gap-3 mt-6">
              <button onClick={() => setShareDialog(false)} className="flex-1 py-2 text-sm text-trakend-text-secondary hover:text-trakend-text-primary border border-trakend-border rounded-lg">
                Cancel
              </button>
              <Button variant="primary" className="flex-1" loading={busy === 'share'} disabled={!newShare.name} onClick={createShare}>
                Create Share
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

// ─── Drive Row Component ──────────────────────────────

const DriveRow: React.FC<{
  drive: PhysicalDrive
  onAssign?: () => void
  onUnassign?: () => void
  arrayStopped?: boolean
  /** Array is running/degraded, so data drives are expected to be mounted. */
  arrayUp?: boolean
}> = ({ drive, onAssign, onUnassign, arrayStopped, arrayUp }) => {
  const [expanded, setExpanded] = useState(false)

  const usagePercent = drive.size_bytes > 0 && (drive.usage_bytes || 0) > 0
    ? Math.round(((drive.usage_bytes || 0) / drive.size_bytes) * 100)
    : 0

  // Determine drive status indicator
  const isParity = drive.role === 'parity' || drive.role === 'parity2'
  const expectMount = !!arrayUp && !isParity && drive.role !== 'unassigned' && drive.role !== 'hot_spare'
  const getStatusIndicator = () => {
    if (arrayStopped || drive.role === 'unassigned') {
      return <span className="w-2.5 h-2.5 rounded-full bg-gray-500 flex-shrink-0" title={arrayStopped ? 'Array stopped' : 'Unassigned'} />
    }
    if (expectMount && !drive.mount_point) {
      return <span className="w-2.5 h-2.5 rounded-full bg-red-500 flex-shrink-0" title="Not mounted or missing" />
    }
    if (drive.health === 'warning' || drive.health === 'failing') {
      return <span className="w-2.5 h-2.5 rounded-full bg-yellow-500 flex-shrink-0" title="Present but in warning/failing state" />
    }
    return <span className="w-2.5 h-2.5 rounded-full bg-green-500 flex-shrink-0" title="Healthy and mounted" />
  }

  return (
    <div className="bg-trakend-surface border border-trakend-border rounded-lg overflow-hidden">
      <div className="flex items-center gap-4 p-3 cursor-pointer hover:bg-trakend-dark/50" onClick={() => setExpanded(!expanded)}>
        {expanded ? <ChevronDown className="w-4 h-4 text-trakend-text-secondary" /> : <ChevronRight className="w-4 h-4 text-trakend-text-secondary" />}

        {getStatusIndicator()}

        <HardDrive className={`w-5 h-5 ${
          drive.role === 'parity' || drive.role === 'parity2' ? 'text-purple-400' :
          drive.role === 'cache' ? 'text-cyan-400' :
          drive.role === 'data' ? 'text-blue-400' :
          'text-gray-400'
        }`} />

        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            {drive.slot !== undefined && drive.slot > 0 && (
              <span className="text-xs font-mono text-trakend-text-secondary">Disk {drive.slot}</span>
            )}
            <span className="text-sm font-medium text-trakend-text-primary truncate">{drive.model}</span>
            <RoleBadge role={drive.role} />
            <HealthBadge health={drive.health} />
          </div>
          <div className="flex items-center gap-3 text-xs text-trakend-text-secondary mt-0.5">
            <span>{drive.device}</span>
            <span>{drive.size_human}</span>
            <span>{drive.transport.toUpperCase()}</span>
            {drive.rpm > 0 ? <span>{drive.rpm} RPM</span> : <span>SSD</span>}
            {expectMount && (
              drive.mount_point
                ? <span className="text-green-400 font-mono" title="Mounted at">{drive.mount_point}</span>
                : <span className="text-red-400 font-medium">Not mounted</span>
            )}
            {isParity && arrayUp && <span className="text-trakend-text-secondary">raw device (no filesystem)</span>}
            {drive.temperature > 0 && (
              <span className={drive.temperature > 50 ? 'text-orange-400' : ''}>
                <ThermometerSun className="w-3 h-3 inline mr-0.5" />{Math.round(drive.temperature * 9 / 5 + 32)}°F
              </span>
            )}
          </div>
        </div>

        {/* Usage bar for assigned data drives */}
        {drive.role === 'data' && drive.usage_bytes !== undefined && (
          <div className="w-32">
            <div className="w-full h-1.5 bg-trakend-dark rounded-full overflow-hidden">
              <div className={`h-full rounded-full ${usagePercent > 90 ? 'bg-red-500' : 'bg-trakend-accent'}`}
                style={{ width: `${usagePercent}%` }} />
            </div>
            <div className="text-xs text-trakend-text-secondary text-right mt-0.5">{usagePercent}%</div>
          </div>
        )}

        {/* Actions */}
        <div className="flex items-center gap-2" onClick={e => e.stopPropagation()}>
          {drive.role === 'unassigned' && onAssign && arrayStopped && (
            <Button size="xs" variant="primary" onClick={onAssign}>Assign</Button>
          )}
          {drive.role !== 'unassigned' && onUnassign && arrayStopped && (
            <Button size="xs" variant="danger" onClick={onUnassign}>Remove</Button>
          )}
          {!arrayStopped && (onAssign || onUnassign) && (
            <span className="text-[10px] text-trakend-text-secondary" title="Stop the array to change assignments">locked while running</span>
          )}
        </div>
      </div>

      {/* Expanded details */}
      {expanded && (
        <div className="px-4 pb-3 border-t border-trakend-border bg-trakend-dark/30">
          <div className="grid grid-cols-4 gap-4 py-3 text-xs">
            <div>
              <div className="text-trakend-text-secondary">Serial</div>
              <div className="text-trakend-text-primary font-mono">{drive.serial || 'N/A'}</div>
            </div>
            <div>
              <div className="text-trakend-text-secondary">Filesystem</div>
              <div className="text-trakend-text-primary">{drive.filesystem || 'None'}</div>
            </div>
            <div>
              <div className="text-trakend-text-secondary">Mount Status</div>
              <div className={drive.mount_point ? 'text-green-400 font-medium' : expectMount ? 'text-red-400 font-medium' : 'text-trakend-text-secondary'}>
                {drive.mount_point ? 'Mounted' : isParity ? 'N/A (parity)' : arrayStopped ? 'Array stopped' : expectMount ? 'Not mounted' : '—'}
              </div>
            </div>
            <div>
              <div className="text-trakend-text-secondary">Mount Point</div>
              <div className="text-trakend-text-primary font-mono">{drive.mount_point || '—'}</div>
            </div>
            <div>
              <div className="text-trakend-text-secondary">Power-On Hours</div>
              <div className="text-trakend-text-primary">{drive.power_on_hours.toLocaleString()}</div>
            </div>
            <div>
              <div className="text-trakend-text-secondary">Reallocated Sectors</div>
              <div className={`${drive.reallocated_sectors > 0 ? 'text-orange-400' : 'text-trakend-text-primary'}`}>
                {drive.reallocated_sectors}
              </div>
            </div>
            <div>
              <div className="text-trakend-text-secondary">SMART Status</div>
              <div className={drive.smart_passed ? 'text-green-400' : 'text-red-400'}>
                {drive.smart_passed ? 'PASSED' : 'FAILED'}
              </div>
            </div>
            <div>
              <div className="text-trakend-text-secondary">Spin State</div>
              <div className="text-trakend-text-primary">{drive.spin_state}</div>
            </div>
            <div>
              <div className="text-trakend-text-secondary">Temperature</div>
              <div className={`${drive.temperature > 50 ? 'text-orange-400' : drive.temperature > 40 ? 'text-yellow-400' : 'text-trakend-text-primary'}`}>
                {drive.temperature > 0 ? `${Math.round(drive.temperature * 9 / 5 + 32)}°F` : 'N/A'}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

// ─── Array Settings Component ─────────────────────────

const ArraySettings: React.FC<{
  config?: ArrayConfig | null
  saving?: boolean
  onSave: (updates: Partial<ArrayConfig>) => Promise<void>
}> = ({ config, saving, onSave }) => {
  const [mode, setMode] = useState(config?.mode || 'parity')
  const [spinDown, setSpinDown] = useState(config?.spin_down_delay || 30)
  const [turboWrite, setTurboWrite] = useState(config?.reconstruct_write || false)
  const [autoStart, setAutoStart] = useState(config?.auto_start ?? true)
  const [paritySchedule, setParitySchedule] = useState(config?.parity_check_schedule || '0 2 1 * *')

  return (
    <div className="max-w-2xl space-y-6">
      <div>
        <label className="block text-sm font-semibold text-trakend-text-primary mb-2">Array Mode</label>
        <select value={mode} onChange={e => setMode(e.target.value)}
          className="w-full px-4 py-2 bg-trakend-surface border border-trakend-border rounded-lg text-trakend-text-primary">
          <option value="parity">Parity (Unraid-style) — Protect against 1-2 drive failures</option>
          <option value="jbod">JBOD — Just a bunch of disks, no protection</option>
          <option value="raid5">RAID5 — Striped with parity, faster reads</option>
          <option value="raid6">RAID6 — Striped with dual parity</option>
          <option value="mirror">Mirror (RAID1) — Full drive duplication</option>
          <option value="stripe">Stripe (RAID0) — Maximum speed, no protection</option>
        </select>
        <p className="text-xs text-trakend-text-secondary mt-1">
          {mode === 'parity' && 'Each drive has its own filesystem. Parity drive protects against failure. Drives can be different sizes.'}
          {mode === 'jbod' && 'Drives are used independently. No parity protection. Maximum usable space.'}
          {mode === 'raid5' && 'Data is striped across drives with parity. All drives should be the same size. One drive can fail.'}
          {mode === 'raid6' && 'Like RAID5 but with dual parity. Two drives can fail simultaneously.'}
          {mode === 'mirror' && 'Every drive is mirrored. 50% usable space but maximum redundancy.'}
          {mode === 'stripe' && 'Data is striped for speed. Any drive failure loses ALL data. Not recommended.'}
        </p>
      </div>

      <div>
        <label className="block text-sm font-semibold text-trakend-text-primary mb-2">
          Spin-Down Delay: {spinDown === 0 ? 'Never' : `${spinDown} minutes`}
        </label>
        <input type="range" min={0} max={120} step={5} value={spinDown}
          onChange={e => setSpinDown(parseInt(e.target.value))}
          className="w-full" />
        <p className="text-xs text-trakend-text-secondary mt-1">
          Spin down idle drives to save power and reduce wear. 0 = never spin down.
        </p>
      </div>

      <label className="flex items-center gap-3 cursor-pointer">
        <input type="checkbox" checked={turboWrite} onChange={e => setTurboWrite(e.target.checked)} className="w-4 h-4" />
        <div>
          <span className="text-trakend-text-primary">Turbo Write Mode</span>
          <p className="text-xs text-trakend-text-secondary">
            Writes to all drives simultaneously instead of read-modify-write. Faster writes, but all drives must spin up.
          </p>
        </div>
      </label>

      <label className="flex items-center gap-3 cursor-pointer">
        <input type="checkbox" checked={autoStart} onChange={e => setAutoStart(e.target.checked)} className="w-4 h-4" />
        <div>
          <span className="text-trakend-text-primary">Auto-Start Array on Boot</span>
          <p className="text-xs text-trakend-text-secondary">Automatically start the array when Trakend OS boots up.</p>
        </div>
      </label>

      <div>
        <label className="block text-sm font-semibold text-trakend-text-primary mb-2">Parity Check Schedule</label>
        <select value={paritySchedule} onChange={e => setParitySchedule(e.target.value)}
          className="w-full px-4 py-2 bg-trakend-surface border border-trakend-border rounded-lg text-trakend-text-primary">
          <option value="0 2 * * 0">Weekly (Sunday 2am)</option>
          <option value="0 2 1 * *">Monthly (1st at 2am)</option>
          <option value="0 2 1 */3 *">Quarterly (1st of Jan/Apr/Jul/Oct at 2am)</option>
          <option value="">Never (manual only)</option>
        </select>
      </div>

      <Button
        variant="primary"
        loading={saving}
        onClick={() => onSave({
          mode: mode as ArrayConfig['mode'],
          spin_down_delay: spinDown,
          reconstruct_write: turboWrite,
          auto_start: autoStart,
          parity_check_schedule: paritySchedule,
        })}
      >
        Save Settings
      </Button>
    </div>
  )
}

export default ArrayPage
