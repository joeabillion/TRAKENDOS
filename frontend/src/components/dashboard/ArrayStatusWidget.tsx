import React, { useState, useEffect } from 'react'
import { Link } from 'react-router-dom'
import { HardDrive, AlertTriangle } from 'lucide-react'
import api from '../../utils/api'
import { formatBytes } from '../../utils/formatters'
import { Badge, toneForStatus } from '../common/Badge'
import { SkeletonCard } from '../common/Skeleton'
import { EmptyState } from '../common/EmptyState'

// Matches GET /api/array/summary (see ArrayPage)
interface ArraySummary {
  config: {
    name: string
    state: string
    parity_state: string
  }
  data_drives: number
  parity_drives: number
  cache_drives: number
  total_capacity: number
  used_capacity: number
  usage_percent: number
  parity_operation: {
    type?: string
    status: string
    progress?: number
    speed_mbps?: number
    errors_found?: number
  } | null
}

interface ArrayDrive {
  id: string
  device: string
  model: string
  role: string
  slot?: number
  size_bytes: number
  usage_bytes?: number
  temperature: number
  health: string
  mount_point?: string
}

const PARITY_LABEL: Record<string, string> = {
  valid: 'Parity valid',
  invalid: 'Parity out of date',
  building: 'Building parity',
  checking: 'Checking parity',
  rebuilding: 'Rebuilding',
  none: 'No parity',
}

export const ArrayStatusWidget: React.FC = () => {
  const [summary, setSummary] = useState<ArraySummary | null>(null)
  const [drives, setDrives] = useState<ArrayDrive[]>([])
  const [error, setError] = useState<string | null>(null)
  const [loaded, setLoaded] = useState(false)

  useEffect(() => {
    let cancelled = false
    const fetchData = async () => {
      try {
        const [summaryRes, drivesRes] = await Promise.all([api.get('/array/summary'), api.get('/array/drives')])
        if (cancelled) return
        setSummary(summaryRes.data)
        setDrives(Array.isArray(drivesRes.data) ? drivesRes.data : [])
        setError(null)
      } catch (err: any) {
        if (cancelled) return
        setError(err?.response?.data?.error || 'Unable to fetch array data')
      } finally {
        if (!cancelled) setLoaded(true)
      }
    }
    fetchData()
    const interval = setInterval(fetchData, 10000)
    return () => {
      cancelled = true
      clearInterval(interval)
    }
  }, [])

  if (!loaded) return <SkeletonCard title="Array Status" tiles={3} bodyHeight={80} className="h-full" />

  const assigned = drives
    .filter((d) => d.role !== 'unassigned' && d.role !== 'hot_spare')
    .sort((a, b) => roleOrder(a.role) - roleOrder(b.role) || (a.slot || 0) - (b.slot || 0))
  const state = summary?.config?.state || 'unknown'
  const parityState = summary?.config?.parity_state || 'none'
  const op = summary?.parity_operation
  const arrayUp = state === 'running' || state === 'degraded'
  const unmounted = arrayUp ? assigned.filter((d) => d.role === 'data' && !d.mount_point) : []

  return (
    <div className="bg-trakend-surface border border-trakend-border rounded-lg p-4 h-full overflow-auto flex flex-col">
      <div className="flex items-center justify-between mb-3 gap-2">
        <h3 className="text-sm font-semibold text-trakend-text-primary">Array Status</h3>
        {summary && (
          <div className="flex items-center gap-1.5">
            <Badge tone={toneForStatus(state)} size="xs" dot>
              {state}
            </Badge>
            <Badge tone={toneForStatus(parityState)} size="xs">
              {PARITY_LABEL[parityState] || parityState}
            </Badge>
          </div>
        )}
      </div>

      {error ? (
        <EmptyState compact error title="Array data unavailable" description={error} />
      ) : summary ? (
        <div className="flex-1 min-h-0">
          {/* Capacity */}
          <div className="mb-3">
            <div className="flex justify-between text-xs text-trakend-text-secondary mb-1">
              <span>Capacity</span>
              <span>
                {formatBytes(summary.used_capacity)} / {formatBytes(summary.total_capacity)}
                {summary.total_capacity > 0 && <span className="ml-1">({summary.usage_percent}%)</span>}
              </span>
            </div>
            <div className="h-2 bg-trakend-dark rounded-full overflow-hidden">
              <div
                className={`h-full rounded-full transition-all ${summary.usage_percent > 90 ? 'bg-trakend-error' : summary.usage_percent > 75 ? 'bg-trakend-warning' : 'bg-trakend-accent'}`}
                style={{ width: `${Math.min(100, summary.usage_percent || 0)}%` }}
              />
            </div>
          </div>

          {/* Drive breakdown */}
          <div className="grid grid-cols-3 gap-2 mb-3 text-xs">
            <div className="bg-trakend-dark rounded p-2">
              <div className="text-trakend-text-secondary">Data</div>
              <div className="font-bold text-trakend-text-primary">{summary.data_drives}</div>
            </div>
            <div className="bg-trakend-dark rounded p-2">
              <div className="text-trakend-text-secondary">Parity</div>
              <div className="font-bold text-trakend-text-primary">{summary.parity_drives}</div>
            </div>
            <div className="bg-trakend-dark rounded p-2">
              <div className="text-trakend-text-secondary">Cache</div>
              <div className="font-bold text-trakend-text-primary">{summary.cache_drives}</div>
            </div>
          </div>

          {/* Problems */}
          {(state === 'error' || unmounted.length > 0) && (
            <Link
              to="/array"
              className="flex items-start gap-2 mb-3 px-3 py-2 rounded-lg bg-trakend-error/10 border border-trakend-error/30 text-xs text-trakend-error hover:bg-trakend-error/15 focus-ring"
            >
              <AlertTriangle size={14} className="flex-shrink-0 mt-px" />
              <span>
                {state === 'error' ? 'Array failed to start. ' : ''}
                {unmounted.length > 0 ? `${unmounted.length} data drive(s) not mounted. ` : ''}
                Open Array page →
              </span>
            </Link>
          )}

          {/* Parity operation */}
          {op && op.status === 'running' && (
            <div className="bg-trakend-dark rounded-lg p-3 mb-3">
              <div className="flex items-center justify-between mb-1">
                <span className="text-xs font-semibold text-trakend-accent uppercase">{op.type || 'parity'}</span>
                <span className="text-xs text-trakend-text-secondary">{(op.progress || 0).toFixed(1)}%</span>
              </div>
              <div className="h-2 bg-trakend-surface rounded-full overflow-hidden mb-1">
                <div className="h-full bg-trakend-accent rounded-full transition-all" style={{ width: `${op.progress || 0}%` }} />
              </div>
              <div className="flex justify-between text-[10px] text-trakend-text-secondary">
                <span>{op.speed_mbps || 0} MB/s</span>
                {(op.errors_found || 0) > 0 && <span className="text-trakend-error">{op.errors_found} errors</span>}
              </div>
            </div>
          )}

          {/* Drives */}
          {assigned.length > 0 ? (
            <div>
              <div className="text-xs text-trakend-text-secondary uppercase tracking-wide mb-1">Drives</div>
              {assigned.map((d) => {
                const healthTone = toneForStatus(d.health)
                const mounted = !!d.mount_point
                return (
                  <div key={d.id} className="flex items-center gap-2 py-1 text-xs border-b border-trakend-border/20 last:border-0">
                    <span
                      className={`w-2 h-2 rounded-full flex-shrink-0 ${
                        healthTone === 'success' ? 'bg-trakend-success' : healthTone === 'warning' ? 'bg-trakend-warning' : healthTone === 'error' ? 'bg-trakend-error' : 'bg-trakend-text-muted'
                      }`}
                      title={`Health: ${d.health}`}
                    />
                    <span className="text-trakend-text-primary w-14 flex-shrink-0 truncate">{labelFor(d)}</span>
                    <span className="text-trakend-text-secondary flex-1 truncate font-mono" title={d.model}>
                      {d.device.replace('/dev/', '')}
                    </span>
                    <span className="text-trakend-text-secondary">{formatBytes(d.size_bytes, 1)}</span>
                    {arrayUp && d.role !== 'parity' && d.role !== 'parity2' && (
                      <span className={mounted ? 'text-trakend-success' : 'text-trakend-error'} title={mounted ? d.mount_point : 'Not mounted'}>
                        {mounted ? 'mounted' : 'unmounted'}
                      </span>
                    )}
                    {d.temperature > 0 && (
                      <span className={d.temperature > 50 ? 'text-trakend-warning' : 'text-trakend-text-secondary'}>
                        {Math.round((d.temperature * 9) / 5 + 32)}°F
                      </span>
                    )}
                  </div>
                )
              })}
            </div>
          ) : (
            <EmptyState compact icon={<HardDrive size={22} />} title="No drives assigned" description="Assign drives on the Array page." />
          )}
        </div>
      ) : null}
    </div>
  )
}

function roleOrder(role: string): number {
  switch (role) {
    case 'parity':
      return 0
    case 'parity2':
      return 1
    case 'data':
      return 2
    case 'cache':
      return 3
    default:
      return 9
  }
}

function labelFor(d: ArrayDrive): string {
  if (d.role === 'parity') return 'Parity'
  if (d.role === 'parity2') return 'Parity 2'
  if (d.role === 'cache') return 'Cache'
  if (d.role === 'data') return d.slot ? `Disk ${d.slot}` : 'Data'
  return d.role
}
