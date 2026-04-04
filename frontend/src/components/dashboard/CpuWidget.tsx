import React from 'react'
import { useSystemStats } from '../../hooks/useSystemStats'

export const CpuWidget: React.FC = () => {
  const stats = useSystemStats()

  if (!stats) {
    return (
      <div className="bg-trakend-surface border border-trakend-border rounded-lg p-6">
        <div className="text-sm text-trakend-text-secondary">Loading CPU data...</div>
      </div>
    )
  }

  const cores = stats.cpu.cores
  const threads = stats.cpu.threads
  const hasHT = threads > cores

  return (
    <div className="bg-trakend-surface border border-trakend-border rounded-lg p-6">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-lg font-semibold text-trakend-text-primary">CPU</h3>
        <span className="text-xs text-trakend-text-secondary font-mono">{stats.cpu.model}</span>
      </div>

      {/* Overall Stats */}
      <div className="grid grid-cols-3 gap-3 mb-4">
        <div className="p-3 bg-trakend-dark rounded border border-trakend-border text-center">
          <div className="text-xs text-trakend-text-secondary uppercase tracking-wide mb-1">Usage</div>
          <div className={`text-xl font-bold ${stats.cpu.usage > 80 ? 'text-trakend-error' : stats.cpu.usage > 50 ? 'text-trakend-warning' : 'text-trakend-accent'}`}>
            {stats.cpu.usage.toFixed(1)}%
          </div>
        </div>
        <div className="p-3 bg-trakend-dark rounded border border-trakend-border text-center">
          <div className="text-xs text-trakend-text-secondary uppercase tracking-wide mb-1">Temp</div>
          <div className={`text-xl font-bold ${stats.cpu.temperature > 80 ? 'text-trakend-error' : stats.cpu.temperature > 60 ? 'text-trakend-warning' : 'text-trakend-accent'}`}>
            {stats.cpu.temperature > 0 ? `${stats.cpu.temperature}°C` : '--'}
          </div>
        </div>
        <div className="p-3 bg-trakend-dark rounded border border-trakend-border text-center">
          <div className="text-xs text-trakend-text-secondary uppercase tracking-wide mb-1">Clock</div>
          <div className="text-xl font-bold text-trakend-accent">{((stats.cpu.clockSpeed || 0) / 1000).toFixed(1)} GHz</div>
        </div>
      </div>

      {/* Per-Thread Usage Grid */}
      <div className="text-xs text-trakend-text-secondary uppercase tracking-wide mb-2">
        {cores} Cores / {threads} Threads {hasHT && '(Hyper-Threaded)'}
      </div>
      <div className="grid grid-cols-8 gap-1">
        {stats.cpu.perCoreUsage.map((usage, i) => {
          const coreNum = hasHT ? Math.floor(i / 2) : i
          const isHT = hasHT && i % 2 === 1
          const label = hasHT ? `C${coreNum}${isHT ? 'T1' : 'T0'}` : `C${i}`
          const color = usage > 80 ? 'bg-trakend-error' : usage > 50 ? 'bg-trakend-warning' : 'bg-trakend-accent'
          const textColor = usage > 80 ? 'text-trakend-error' : usage > 50 ? 'text-trakend-warning' : 'text-trakend-accent'

          return (
            <div key={i} className="flex flex-col items-center" title={`${label}: ${Math.round(usage)}%`}>
              <div className="w-full h-16 bg-trakend-dark rounded overflow-hidden flex flex-col-reverse">
                <div className={`${color} w-full transition-all duration-300 rounded-b`} style={{ height: `${Math.max(usage, 2)}%` }} />
              </div>
              <span className={`text-[9px] mt-1 ${textColor} font-mono`}>{Math.round(usage)}</span>
              <span className="text-[8px] text-trakend-text-secondary font-mono">{label}</span>
            </div>
          )
        })}
      </div>
    </div>
  )
}
