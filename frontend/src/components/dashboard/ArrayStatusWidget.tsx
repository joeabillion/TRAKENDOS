import React, { useState, useEffect } from 'react'
import api from '../../utils/api'

interface ArraySummary {
  state: string
  total_slots: number
  used_slots: number
  total_size_bytes: number
  used_size_bytes: number
  parity_operation?: {
    type: string
    status: string
    progress: number
    speed: string
    errors: number
    started_at: string
  }
}

interface ArrayDrive {
  id: string
  device: string
  role: string
  status: string
  size_bytes: number
  usage_bytes: number
  temperature: number
  health: string
}

export const ArrayStatusWidget: React.FC = () => {
  const [summary, setSummary] = useState<ArraySummary | null>(null)
  const [drives, setDrives] = useState<ArrayDrive[]>([])
  const [error, setError] = useState(false)

  useEffect(() => {
    const fetchData = async () => {
      try {
        const [summaryRes, drivesRes] = await Promise.all([
          api.get('/array/summary'),
          api.get('/array/drives'),
        ])
        setSummary(summaryRes.data)
        setDrives(drivesRes.data)
        setError(false)
      } catch {
        setError(true)
      }
    }
    fetchData()
    const interval = setInterval(fetchData, 10000)
    return () => clearInterval(interval)
  }, [])

  const formatBytes = (bytes: number) => {
    if (bytes === 0) return '0 B'
    const k = 1024
    const sizes = ['B', 'KB', 'MB', 'GB', 'TB']
    const i = Math.floor(Math.log(bytes) / Math.log(k))
    return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i]
  }

  const assignedDrives = drives.filter(d => d.role !== 'unassigned')
  const parityDrives = drives.filter(d => d.role === 'parity')
  const dataDrives = drives.filter(d => d.role === 'data')
  const cacheDrives = drives.filter(d => d.role === 'cache')
  const parity = summary?.parity_operation

  const stateColor = (state: string) => {
    if (state === 'running') return 'text-trakend-success'
    if (state === 'degraded') return 'text-trakend-warning'
    if (state === 'stopped') return 'text-trakend-text-secondary'
    return 'text-trakend-error'
  }

  return (
    <div className="bg-trakend-surface border border-trakend-border rounded-lg p-4 h-full overflow-auto">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-sm font-semibold text-trakend-text-primary">Array Status</h3>
        {summary && (
          <span className={`text-xs font-bold uppercase ${stateColor(summary.state)}`}>{summary.state}</span>
        )}
      </div>

      {error ? (
        <div className="text-xs text-trakend-text-secondary">Unable to fetch array data</div>
      ) : summary ? (
        <div>
          {/* Capacity */}
          <div className="mb-3">
            <div className="flex justify-between text-xs text-trakend-text-secondary mb-1">
              <span>Capacity</span>
              <span>{formatBytes(summary.used_size_bytes)} / {formatBytes(summary.total_size_bytes)}</span>
            </div>
            <div className="h-2 bg-trakend-dark rounded-full overflow-hidden">
              <div className="h-full bg-trakend-accent rounded-full transition-all"
                style={{ width: `${summary.total_size_bytes > 0 ? (summary.used_size_bytes / summary.total_size_bytes) * 100 : 0}%` }} />
            </div>
          </div>

          {/* Drive breakdown */}
          <div className="grid grid-cols-3 gap-2 mb-3 text-xs">
            <div className="bg-trakend-dark rounded p-2">
              <div className="text-trakend-text-secondary">Data</div>
              <div className="font-bold text-trakend-text-primary">{dataDrives.length}</div>
            </div>
            <div className="bg-trakend-dark rounded p-2">
              <div className="text-trakend-text-secondary">Parity</div>
              <div className="font-bold text-trakend-text-primary">{parityDrives.length}</div>
            </div>
            <div className="bg-trakend-dark rounded p-2">
              <div className="text-trakend-text-secondary">Cache</div>
              <div className="font-bold text-trakend-text-primary">{cacheDrives.length}</div>
            </div>
          </div>

          {/* Parity operation */}
          {parity && (
            <div className="bg-trakend-dark rounded-lg p-3 mb-3">
              <div className="flex items-center justify-between mb-1">
                <span className="text-xs font-semibold text-trakend-accent uppercase">{parity.type}</span>
                <span className="text-xs text-trakend-text-secondary">{parity.status}</span>
              </div>
              <div className="h-2 bg-trakend-surface rounded-full overflow-hidden mb-1">
                <div className="h-full bg-trakend-accent rounded-full transition-all" style={{ width: `${parity.progress}%` }} />
              </div>
              <div className="flex justify-between text-[10px] text-trakend-text-secondary">
                <span>{parity.progress.toFixed(1)}%</span>
                <span>{parity.speed}</span>
                {parity.errors > 0 && <span className="text-trakend-error">{parity.errors} errors</span>}
              </div>
            </div>
          )}

          {/* Drive health */}
          {assignedDrives.length > 0 && (
            <div>
              <div className="text-xs text-trakend-text-secondary uppercase tracking-wide mb-1">Drives</div>
              {assignedDrives.map(d => {
                const healthColor = d.health === 'good' ? 'bg-trakend-success' : d.health === 'warning' ? 'bg-trakend-warning' : 'bg-trakend-error'
                return (
                  <div key={d.id} className="flex items-center gap-2 py-1 text-xs border-b border-trakend-border/20">
                    <div className={`w-2 h-2 rounded-full ${healthColor}`} />
                    <span className="text-trakend-text-primary flex-1 truncate">{d.device}</span>
                    <span className="text-trakend-text-secondary">{d.role}</span>
                    <span className="text-trakend-text-secondary">{formatBytes(d.size_bytes)}</span>
                    {d.temperature > 0 && <span className={d.temperature > 50 ? 'text-trakend-warning' : 'text-trakend-text-secondary'}>{d.temperature}°C</span>}
                  </div>
                )
              })}
            </div>
          )}
        </div>
      ) : (
        <div className="text-xs text-trakend-text-secondary">Loading...</div>
      )}
    </div>
  )
}
