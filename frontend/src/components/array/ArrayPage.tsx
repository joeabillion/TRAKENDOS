import React, { useState, useEffect, useCallback } from 'react'
import {
  HardDrive, Shield, ShieldCheck, ShieldAlert, ShieldOff,
  Play, Square, RefreshCw, Plus, Trash2, AlertTriangle,
  CheckCircle, XCircle, Clock, Zap, ThermometerSun,
  Database, FolderOpen, Settings, ChevronDown, ChevronRight,
  Activity, RotateCcw, Search, Server
} from 'lucide-react'
import api from '../../utils/api'
import { formatBytes, formatDuration } from '../../utils/formatters'

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
  const [activeTab, setActiveTab] = useState<'drives' | 'parity' | 'shares' | 'settings'>('drives')
  const [drives, setDrives] = useState<PhysicalDrive[]>([])
  const [summary, setSummary] = useState<ArraySummary | null>(null)
  const [loading, setLoading] = useState(true)
  const [scanning, setScanning] = useState(false)
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
    } catch (err) {
      console.error('Failed to fetch array data:', err)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    fetchData()
    const interval = setInterval(fetchData, 5000)
    return () => clearInterval(interval)
  }, [fetchData])

  const scanDrives = async () => {
    setScanning(true)
    try {
      await api.post('/array/drives/scan')
      await fetchData()
    } finally {
      setScanning(false)
    }
  }

  const startArray = async () => {
    try {
      await api.post('/array/start')
      await fetchData()
    } catch (err: any) {
      alert(err.response?.data?.error || 'Failed to start array')
    }
  }

  const stopArray = async () => {
    if (!confirm('Stop the array? All shares and Docker containers using array storage will be affected.')) return
    try {
      await api.post('/array/stop')
      await fetchData()
    } catch (err: any) {
      alert(err.response?.data?.error || 'Failed to stop array')
    }
  }

  const assignDrive = async (driveId: string, role: string, slot?: number) => {
    try {
      await api.post('/array/drives/assign', { driveId, role, slot })
      setAssignDialog(null)
      await fetchData()
    } catch (err: any) {
      alert(err.response?.data?.error || 'Failed to assign drive')
    }
  }

  const unassignDrive = async (driveId: string) => {
    if (!confirm('Remove this drive from the array?')) return
    try {
      await api.post('/array/drives/unassign', { driveId })
      await fetchData()
    } catch (err: any) {
      alert(err.response?.data?.error || 'Failed to unassign drive')
    }
  }

  const startParitySync = async () => {
    try {
      await api.post('/array/parity/sync')
      await fetchData()
    } catch (err: any) {
      alert(err.response?.data?.error || 'Failed to start parity sync')
    }
  }

  const startParityCheck = async (correct: boolean = false) => {
    try {
      await api.post('/array/parity/check', { correct })
      await fetchData()
    } catch (err: any) {
      alert(err.response?.data?.error || 'Failed to start parity check')
    }
  }

  const cancelParity = async () => {
    try {
      await api.post('/array/parity/cancel')
      await fetchData()
    } catch (err: any) {
      alert(err.response?.data?.error || 'Failed to cancel')
    }
  }

  const createShare = async () => {
    try {
      await api.post('/array/shares', newShare)
      setShareDialog(false)
      setNewShare({ name: '', pool: 'array', use_cache: 'no', allocation_method: 'highwater', export_smb: true })
      await fetchData()
    } catch (err: any) {
      alert(err.response?.data?.error || 'Failed to create share')
    }
  }

  const deleteShare = async (id: string) => {
    if (!confirm('Delete this share?')) return
    try {
      await api.delete(`/api/array/shares/${id}`)
      await fetchData()
    } catch (err: any) {
      alert(err.response?.data?.error || 'Failed to delete share')
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <RefreshCw className="w-8 h-8 text-trakend-accent animate-spin" />
      </div>
    )
  }

  const config = summary?.config
  const assignedDrives = drives.filter(d => d.role !== 'unassigned')
  const unassignedDrives = drives.filter(d => d.role === 'unassigned')
  const parityOp = summary?.parity_operation

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-trakend-text-primary flex items-center gap-3">
            <Server className="w-7 h-7 text-trakend-accent" />
            Array Manager
          </h1>
          <p className="text-sm text-trakend-text-secondary mt-1">
            {config?.name || 'Trakend Array'} — {summary?.data_drives || 0} data, {summary?.parity_drives || 0} parity, {summary?.cache_drives || 0} cache
          </p>
        </div>
        <div className="flex items-center gap-3">
          <StateBadge state={config?.state || 'stopped'} />
          {config?.state === 'stopped' ? (
            <button onClick={startArray} className="flex items-center gap-2 px-4 py-2 bg-green-600 hover:bg-green-700 text-white rounded-lg transition-colors">
              <Play className="w-4 h-4" /> Start Array
            </button>
          ) : (
            <button onClick={stopArray} className="flex items-center gap-2 px-4 py-2 bg-red-600 hover:bg-red-700 text-white rounded-lg transition-colors">
              <Square className="w-4 h-4" /> Stop Array
            </button>
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
          <div className="w-full h-3 bg-trakend-bg rounded-full overflow-hidden">
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
            <span>Parity: {config?.parity_state || 'none'}</span>
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
                : 'text-trakend-text-secondary hover:text-trakend-text-primary hover:bg-trakend-bg'
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
              <button onClick={scanDrives} disabled={scanning} className="flex items-center gap-2 px-3 py-1.5 text-sm bg-trakend-surface border border-trakend-border rounded-lg hover:bg-trakend-bg transition-colors">
                <Search className={`w-4 h-4 ${scanning ? 'animate-spin' : ''}`} />
                {scanning ? 'Scanning...' : 'Scan Drives'}
              </button>
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
                  <DriveRow key={drive.id} drive={drive} onUnassign={() => unassignDrive(drive.id)} arrayStopped={config?.state === 'stopped'} />
                ))}
                {/* Then data drives sorted by slot */}
                {assignedDrives.filter(d => d.role === 'data').sort((a, b) => (a.slot || 0) - (b.slot || 0)).map(drive => (
                  <DriveRow key={drive.id} drive={drive} onUnassign={() => unassignDrive(drive.id)} arrayStopped={config?.state === 'stopped'} />
                ))}
                {/* Cache */}
                {assignedDrives.filter(d => d.role === 'cache').map(drive => (
                  <DriveRow key={drive.id} drive={drive} onUnassign={() => unassignDrive(drive.id)} arrayStopped={config?.state === 'stopped'} />
                ))}
                {/* Hot spares */}
                {assignedDrives.filter(d => d.role === 'hot_spare').map(drive => (
                  <DriveRow key={drive.id} drive={drive} onUnassign={() => unassignDrive(drive.id)} arrayStopped={config?.state === 'stopped'} />
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
                    arrayStopped={config?.state === 'stopped'}
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
              {config?.parity_state === 'valid' ? (
                <ShieldCheck className="w-8 h-8 text-green-400" />
              ) : config?.parity_state === 'invalid' ? (
                <ShieldAlert className="w-8 h-8 text-orange-400" />
              ) : config?.parity_state === 'building' || config?.parity_state === 'checking' ? (
                <Shield className="w-8 h-8 text-blue-400 animate-pulse" />
              ) : (
                <ShieldOff className="w-8 h-8 text-gray-400" />
              )}
              <div>
                <h2 className="text-lg font-semibold text-trakend-text-primary">
                  Parity Status: {config?.parity_state?.toUpperCase() || 'NONE'}
                </h2>
                <p className="text-sm text-trakend-text-secondary">
                  {summary?.parity_drives || 0} parity drive(s) assigned
                  {config?.parity_state === 'valid' && config?.last_parity_check &&
                    ` — Last check: ${new Date(config.last_parity_check).toLocaleDateString()}`
                  }
                </p>
              </div>
            </div>

            {/* Active parity operation */}
            {parityOp && parityOp.status === 'running' && (
              <div className="mt-4 p-4 bg-trakend-bg rounded-lg">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-sm font-medium text-trakend-text-primary">
                    {parityOp.type === 'sync' ? 'Parity Sync' :
                     parityOp.type === 'check' ? 'Parity Check' :
                     parityOp.type === 'rebuild' ? 'Drive Rebuild' : 'Parity Operation'}
                    {parityOp.target_drive && ` — ${parityOp.target_drive}`}
                  </span>
                  <button onClick={cancelParity} className="text-xs text-red-400 hover:text-red-300">Cancel</button>
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
            <div className="flex gap-3 mt-4">
              <button
                onClick={startParitySync}
                disabled={config?.state !== 'running' || !!parityOp?.status?.match(/running/)}
                className="flex items-center gap-2 px-4 py-2 bg-purple-600 hover:bg-purple-700 text-white rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <RefreshCw className="w-4 h-4" /> Parity Sync
              </button>
              <button
                onClick={() => startParityCheck(false)}
                disabled={config?.parity_state !== 'valid' || !!parityOp?.status?.match(/running/)}
                className="flex items-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <Search className="w-4 h-4" /> Check Parity
              </button>
              <button
                onClick={() => startParityCheck(true)}
                disabled={config?.parity_state !== 'valid' || !!parityOp?.status?.match(/running/)}
                className="flex items-center gap-2 px-4 py-2 bg-orange-600 hover:bg-orange-700 text-white rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <RotateCcw className="w-4 h-4" /> Check + Correct
              </button>
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
            <button onClick={() => setShareDialog(true)} className="flex items-center gap-2 px-4 py-2 bg-trakend-accent text-white rounded-lg hover:bg-trakend-accent-dark">
              <Plus className="w-4 h-4" /> New Share
            </button>
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
                    <button onClick={() => deleteShare(share.id)} className="p-1 text-red-400 hover:text-red-300">
                      <Trash2 className="w-4 h-4" />
                    </button>
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
        <ArraySettings config={config} onSave={async (updates) => {
          try {
            await api.put('/array/config', updates)
            await fetchData()
          } catch (err: any) {
            alert(err.response?.data?.error || 'Failed to save')
          }
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
                  className="w-full flex items-center justify-between p-3 bg-trakend-bg hover:bg-trakend-border rounded-lg transition-colors"
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
                  className="w-full px-3 py-2 bg-trakend-bg border border-trakend-border rounded-lg text-trakend-text-primary"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-trakend-text-primary mb-1">Storage Pool</label>
                <select value={newShare.pool} onChange={e => setNewShare({ ...newShare, pool: e.target.value })}
                  className="w-full px-3 py-2 bg-trakend-bg border border-trakend-border rounded-lg text-trakend-text-primary">
                  <option value="array">Array (spread across data drives)</option>
                  <option value="cache">Cache Only (SSD)</option>
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-trakend-text-primary mb-1">Use Cache</label>
                <select value={newShare.use_cache} onChange={e => setNewShare({ ...newShare, use_cache: e.target.value })}
                  className="w-full px-3 py-2 bg-trakend-bg border border-trakend-border rounded-lg text-trakend-text-primary">
                  <option value="no">No — Write directly to array</option>
                  <option value="yes">Yes — Write to cache, mover transfers to array</option>
                  <option value="prefer">Prefer — Use cache if space available</option>
                  <option value="only">Only — Cache only, never move to array</option>
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-trakend-text-primary mb-1">Allocation Method</label>
                <select value={newShare.allocation_method} onChange={e => setNewShare({ ...newShare, allocation_method: e.target.value })}
                  className="w-full px-3 py-2 bg-trakend-bg border border-trakend-border rounded-lg text-trakend-text-primary">
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
              <button onClick={createShare} disabled={!newShare.name} className="flex-1 py-2 text-sm bg-trakend-accent text-white rounded-lg hover:bg-trakend-accent-dark disabled:opacity-50">
                Create Share
              </button>
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
}> = ({ drive, onAssign, onUnassign, arrayStopped }) => {
  const [expanded, setExpanded] = useState(false)

  const usagePercent = drive.size_bytes > 0 && drive.usage_bytes
    ? Math.round((drive.usage_bytes / drive.size_bytes) * 100)
    : 0

  return (
    <div className="bg-trakend-surface border border-trakend-border rounded-lg overflow-hidden">
      <div className="flex items-center gap-4 p-3 cursor-pointer hover:bg-trakend-bg/50" onClick={() => setExpanded(!expanded)}>
        {expanded ? <ChevronDown className="w-4 h-4 text-trakend-text-secondary" /> : <ChevronRight className="w-4 h-4 text-trakend-text-secondary" />}

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
            {drive.temperature > 0 && (
              <span className={drive.temperature > 50 ? 'text-orange-400' : ''}>
                <ThermometerSun className="w-3 h-3 inline mr-0.5" />{drive.temperature}°C
              </span>
            )}
          </div>
        </div>

        {/* Usage bar for assigned data drives */}
        {drive.role === 'data' && drive.usage_bytes !== undefined && (
          <div className="w-32">
            <div className="w-full h-1.5 bg-trakend-bg rounded-full overflow-hidden">
              <div className={`h-full rounded-full ${usagePercent > 90 ? 'bg-red-500' : 'bg-trakend-accent'}`}
                style={{ width: `${usagePercent}%` }} />
            </div>
            <div className="text-xs text-trakend-text-secondary text-right mt-0.5">{usagePercent}%</div>
          </div>
        )}

        {/* Actions */}
        <div className="flex items-center gap-2" onClick={e => e.stopPropagation()}>
          {drive.role === 'unassigned' && onAssign && arrayStopped && (
            <button onClick={onAssign} className="px-3 py-1 text-xs bg-trakend-accent text-white rounded hover:bg-trakend-accent-dark">
              Assign
            </button>
          )}
          {drive.role !== 'unassigned' && onUnassign && arrayStopped && (
            <button onClick={onUnassign} className="px-3 py-1 text-xs text-red-400 border border-red-400/30 rounded hover:bg-red-400/10">
              Remove
            </button>
          )}
        </div>
      </div>

      {/* Expanded details */}
      {expanded && (
        <div className="px-4 pb-3 border-t border-trakend-border bg-trakend-bg/30">
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
              <div className="text-trakend-text-secondary">Mount Point</div>
              <div className="text-trakend-text-primary font-mono">{drive.mount_point || 'Not mounted'}</div>
            </div>
            <div>
              <div className="text-trakend-text-secondary">Spin State</div>
              <div className="text-trakend-text-primary">{drive.spin_state}</div>
            </div>
            <div>
              <div className="text-trakend-text-secondary">Temperature</div>
              <div className={`${drive.temperature > 50 ? 'text-orange-400' : drive.temperature > 40 ? 'text-yellow-400' : 'text-trakend-text-primary'}`}>
                {drive.temperature > 0 ? `${drive.temperature}°C` : 'N/A'}
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
  onSave: (updates: Partial<ArrayConfig>) => Promise<void>
}> = ({ config, onSave }) => {
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

      <button
        onClick={() => onSave({
          mode: mode as ArrayConfig['mode'],
          spin_down_delay: spinDown,
          reconstruct_write: turboWrite,
          auto_start: autoStart,
          parity_check_schedule: paritySchedule,
        })}
        className="px-6 py-2 bg-trakend-accent text-white rounded-lg hover:bg-trakend-accent-dark"
      >
        Save Settings
      </button>
    </div>
  )
}

export default ArrayPage
