import React from 'react'
import { useSystemStats } from '../../hooks/useSystemStats'
import { formatBytes } from '../../utils/formatters'

export const MemoryWidget: React.FC = () => {
  const stats = useSystemStats()

  if (!stats) {
    return (
      <div className="bg-trakend-surface border border-trakend-border rounded-lg p-6">
        <div className="text-sm text-trakend-text-secondary">Loading memory data...</div>
      </div>
    )
  }

  const pct = stats.memory.total > 0 ? (stats.memory.used / stats.memory.total) * 100 : 0
  const pctColor = pct > 80 ? 'text-trakend-error' : pct > 60 ? 'text-trakend-warning' : 'text-trakend-accent'
  const barColor = pct > 80 ? 'bg-trakend-error' : pct > 60 ? 'bg-trakend-warning' : 'bg-trakend-accent'

  return (
    <div className="bg-trakend-surface border border-trakend-border rounded-lg p-6">
      <h3 className="text-lg font-semibold text-trakend-text-primary mb-4">Memory</h3>

      {/* Usage bar */}
      <div className="mb-4">
        <div className="flex justify-between items-end mb-2">
          <span className={`text-3xl font-bold ${pctColor}`}>{pct.toFixed(0)}%</span>
          <span className="text-sm text-trakend-text-secondary">
            {formatBytes(stats.memory.used)} / {formatBytes(stats.memory.total)}
          </span>
        </div>
        <div className="w-full h-3 bg-trakend-dark rounded-full overflow-hidden">
          <div className={`h-full ${barColor} rounded-full transition-all duration-500`} style={{ width: `${pct}%` }} />
        </div>
      </div>

      {/* Memory Stats */}
      <div className="grid grid-cols-2 gap-3">
        <div className="p-3 bg-trakend-dark rounded border border-trakend-border">
          <div className="text-xs text-trakend-text-secondary uppercase tracking-wide mb-1">Active</div>
          <div className="text-sm font-bold text-trakend-text-primary">{formatBytes(stats.memory.used)}</div>
        </div>
        <div className="p-3 bg-trakend-dark rounded border border-trakend-border">
          <div className="text-xs text-trakend-text-secondary uppercase tracking-wide mb-1">Available</div>
          <div className="text-sm font-bold text-trakend-success">{formatBytes(stats.memory.available || stats.memory.free)}</div>
        </div>
        <div className="p-3 bg-trakend-dark rounded border border-trakend-border">
          <div className="text-xs text-trakend-text-secondary uppercase tracking-wide mb-1">Buff/Cache</div>
          <div className="text-sm font-bold text-trakend-info">{formatBytes((stats.memory.buffered || 0) + (stats.memory.cached || 0))}</div>
        </div>
        <div className="p-3 bg-trakend-dark rounded border border-trakend-border">
          <div className="text-xs text-trakend-text-secondary uppercase tracking-wide mb-1">Total</div>
          <div className="text-sm font-bold text-trakend-text-primary">{formatBytes(stats.memory.total)}</div>
        </div>
      </div>
    </div>
  )
}
