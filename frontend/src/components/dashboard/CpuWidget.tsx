import React from 'react'
import { BarChart, Bar, ResponsiveContainer, Cell } from 'recharts'
import { useSystemStats } from '../../hooks/useSystemStats'
import { formatTemperature, formatPercentage } from '../../utils/formatters'

export const CpuWidget: React.FC = () => {
  const stats = useSystemStats()

  if (!stats) {
    return (
      <div className="bg-trakend-surface border border-trakend-border rounded-lg p-6">
        <div className="text-sm text-trakend-text-secondary">Loading CPU data...</div>
      </div>
    )
  }

  const chartData = stats.cpu.perCoreUsage.map((usage, i) => ({
    core: `C${i}`,
    usage: Math.round(usage),
  }))

  return (
    <div className="bg-trakend-surface border border-trakend-border rounded-lg p-6">
      <h3 className="text-lg font-semibold text-trakend-text-primary mb-4">CPU</h3>

      {/* CPU Model and Specs */}
      <div className="mb-4 p-3 bg-trakend-dark rounded border border-trakend-border">
        <div className="text-sm text-trakend-text-secondary mb-1">Processor</div>
        <div className="text-sm font-mono text-trakend-text-primary truncate">{stats.cpu.model}</div>
        <div className="text-xs text-trakend-text-secondary mt-2">
          {stats.cpu.cores} Cores / {stats.cpu.threads} Threads
        </div>
      </div>

      {/* Overall Usage */}
      <div className="grid grid-cols-3 gap-3 mb-4">
        <div className="p-3 bg-trakend-dark rounded border border-trakend-border">
          <div className="text-xs text-trakend-text-secondary uppercase tracking-wide mb-1">Usage</div>
          <div className="text-xl font-bold text-trakend-accent">{formatPercentage(stats.cpu.usage)}</div>
        </div>
        <div className="p-3 bg-trakend-dark rounded border border-trakend-border">
          <div className="text-xs text-trakend-text-secondary uppercase tracking-wide mb-1">Temp</div>
          <div className="text-xl font-bold text-trakend-accent">{formatTemperature(stats.cpu.temperature)}</div>
        </div>
        <div className="p-3 bg-trakend-dark rounded border border-trakend-border">
          <div className="text-xs text-trakend-text-secondary uppercase tracking-wide mb-1">Clock</div>
          <div className="text-xl font-bold text-trakend-accent">{(stats.cpu.clockSpeed / 1000).toFixed(1)} GHz</div>
        </div>
      </div>

      {/* Per-Core Usage */}
      <div className="text-sm text-trakend-text-secondary mb-2">Per-Core Usage</div>
      <ResponsiveContainer width="100%" height={150}>
        <BarChart data={chartData} margin={{ top: 5, right: 5, left: -20, bottom: 5 }}>
          <Bar dataKey="usage" radius={[4, 4, 0, 0]}>
            {chartData.map((entry, index) => (
              <Cell
                key={`cell-${index}`}
                fill={entry.usage > 80 ? '#ff3860' : entry.usage > 50 ? '#ffa502' : '#00d4aa'}
              />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  )
}
