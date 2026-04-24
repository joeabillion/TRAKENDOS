import React from 'react'
import { useSystemStats } from '../../hooks/useSystemStats'

export const GpuWidget: React.FC = () => {
  const stats = useSystemStats()

  if (!stats || !stats.gpu || stats.gpu.length === 0) {
    return (
      <div className="bg-trakend-surface border border-trakend-border rounded-lg p-6">
        <h3 className="text-lg font-semibold text-trakend-text-primary mb-4">GPU</h3>
        <div className="text-sm text-trakend-text-secondary">No GPU detected</div>
      </div>
    )
  }

  const formatVram = (mb: number) => {
    if (mb >= 1024) return `${(mb / 1024).toFixed(1)} GB`
    return `${mb} MB`
  }

  return (
    <div className="bg-trakend-surface border border-trakend-border rounded-lg p-6">
      <h3 className="text-lg font-semibold text-trakend-text-primary mb-4">GPU ({stats.gpu.length})</h3>

      <div className="space-y-3">
        {stats.gpu.map((gpu, i) => {
          const vramPct = gpu.vramTotal > 0 ? (gpu.vramUsed / gpu.vramTotal) * 100 : 0
          const vramColor = vramPct > 80 ? 'bg-trakend-error' : vramPct > 60 ? 'bg-trakend-warning' : 'bg-trakend-info'

          return (
            <div key={i} className="p-3 bg-trakend-dark rounded border border-trakend-border">
              {/* GPU Name + Driver */}
              <div className="flex items-center justify-between mb-2">
                <span className="text-sm font-semibold text-trakend-text-primary truncate">{gpu.name}</span>
                {gpu.driver && <span className="text-[10px] text-trakend-text-secondary ml-2 shrink-0">v{gpu.driver}</span>}
              </div>

              {/* Stats Row */}
              <div className="grid grid-cols-3 gap-2 mb-2">
                <div className="text-center">
                  <div className="text-[10px] text-trakend-text-secondary uppercase">Util</div>
                  <div className={`text-sm font-bold ${gpu.utilization > 80 ? 'text-trakend-error' : 'text-trakend-accent'}`}>
                    {gpu.utilization}%
                  </div>
                </div>
                <div className="text-center">
                  <div className="text-[10px] text-trakend-text-secondary uppercase">Temp</div>
                  <div className={`text-sm font-bold ${gpu.temperature > 80 ? 'text-trakend-error' : gpu.temperature > 60 ? 'text-trakend-warning' : 'text-trakend-accent'}`}>
                    {gpu.temperature > 0 ? `${Math.round(gpu.temperature * 9 / 5 + 32)}°F` : '--'}
                  </div>
                </div>
                <div className="text-center">
                  <div className="text-[10px] text-trakend-text-secondary uppercase">VRAM</div>
                  <div className="text-sm font-bold text-trakend-info">{formatVram(gpu.vramUsed)}</div>
                </div>
              </div>

              {/* VRAM Bar */}
              <div className="flex items-center gap-2">
                <div className="flex-1 h-2 bg-trakend-surface rounded-full overflow-hidden">
                  <div className={`h-full ${vramColor} rounded-full transition-all duration-300`} style={{ width: `${vramPct}%` }} />
                </div>
                <span className="text-[10px] text-trakend-text-secondary shrink-0">
                  {formatVram(gpu.vramUsed)} / {formatVram(gpu.vramTotal)}
                </span>
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
