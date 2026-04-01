import React from 'react'
import { GaugeChart } from '../common/GaugeChart'
import { useSystemStats } from '../../hooks/useSystemStats'
import { formatBytes, formatPercentage } from '../../utils/formatters'

export const MemoryWidget: React.FC = () => {
  const stats = useSystemStats()

  if (!stats) {
    return (
      <div className="bg-trakend-surface border border-trakend-border rounded-lg p-6">
        <div className="text-sm text-trakend-text-secondary">Loading memory data...</div>
      </div>
    )
  }

  return (
    <div className="bg-trakend-surface border border-trakend-border rounded-lg p-6">
      <h3 className="text-lg font-semibold text-trakend-text-primary mb-4">Memory</h3>

      {/* Gauge */}
      <div className="flex justify-center mb-6">
        <div className="relative w-40 h-40">
          <GaugeChart
            value={stats.memory.used}
            max={stats.memory.total}
            size={140}
            color="#ff6b35"
            label="RAM Usage"
          />
        </div>
      </div>

      {/* Memory Stats */}
      <div className="grid grid-cols-3 gap-3 mb-4">
        <div className="p-3 bg-trakend-dark rounded border border-trakend-border">
          <div className="text-xs text-trakend-text-secondary uppercase tracking-wide mb-1">Total</div>
          <div className="text-sm font-bold text-trakend-text-primary">{formatBytes(stats.memory.total)}</div>
        </div>
        <div className="p-3 bg-trakend-dark rounded border border-trakend-border">
          <div className="text-xs text-trakend-text-secondary uppercase tracking-wide mb-1">Used</div>
          <div className="text-sm font-bold text-trakend-accent">{formatBytes(stats.memory.used)}</div>
        </div>
        <div className="p-3 bg-trakend-dark rounded border border-trakend-border">
          <div className="text-xs text-trakend-text-secondary uppercase tracking-wide mb-1">Free</div>
          <div className="text-sm font-bold text-trakend-success">{formatBytes(stats.memory.free)}</div>
        </div>
      </div>

      {/* Memory Sticks */}
      {stats.memory.sticks.length > 0 && (
        <div className="border-t border-trakend-border pt-4">
          <div className="text-xs text-trakend-text-secondary uppercase tracking-wide mb-3">Memory Modules</div>
          <div className="space-y-2">
            {stats.memory.sticks.map((stick, i) => (
              <div key={i} className="p-2 bg-trakend-dark rounded text-xs">
                <div className="flex justify-between items-center">
                  <span className="text-trakend-text-secondary">{stick.type}</span>
                  <span className="text-trakend-text-primary font-mono">{formatBytes(stick.size)}</span>
                </div>
                <div className="text-trakend-text-secondary mt-1">{stick.speed}</div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
