import React from 'react'
import { useSystemStats } from '../../hooks/useSystemStats'

// The shared SystemStats GPU type (context/WebSocketContext.tsx) does not yet carry these
// optional fields emitted by the backend; widen it locally so the widget can render them.
type GpuExtra = { driverError?: string; driverVersion?: string }

/** The production fleet runs Tesla P40 cards pinned to the NVIDIA 580 driver branch. */
export const PINNED_DRIVER_BRANCH = '580.'

export const isPinnedDriver = (version?: string): boolean =>
  !!version && version.startsWith(PINNED_DRIVER_BRANCH)

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
        {stats.gpu.map((rawGpu, i) => {
          const gpu = rawGpu as typeof rawGpu & GpuExtra
          const driverVersion = gpu.driverVersion || gpu.driver || ''
          const pinned = isPinnedDriver(driverVersion)

          if (gpu.driverError) {
            return (
              <div key={i} className="p-3 bg-trakend-dark rounded border border-trakend-error">
                <div className="flex items-center justify-between mb-1">
                  <span className="text-sm font-semibold text-trakend-error truncate">{gpu.name}</span>
                  <span className="text-[10px] uppercase font-bold text-trakend-error ml-2 shrink-0">Driver error</span>
                </div>
                <div className="text-xs text-trakend-error break-words">Driver error: {gpu.driverError}</div>
                <div className="text-[10px] text-trakend-text-secondary mt-1">
                  nvidia-smi is installed but cannot talk to the driver. Check the kernel module (580 branch) and
                  <code className="ml-1">journalctl -k | grep -i nvidia</code>.
                </div>
              </div>
            )
          }

          const vramPct = gpu.vramTotal > 0 ? (gpu.vramUsed / gpu.vramTotal) * 100 : 0
          const vramColor = vramPct > 80 ? 'bg-trakend-error' : vramPct > 60 ? 'bg-trakend-warning' : 'bg-trakend-info'

          return (
            <div key={i} className="p-3 bg-trakend-dark rounded border border-trakend-border">
              {/* GPU Name + Driver */}
              <div className="flex items-center justify-between mb-2">
                <span className="text-sm font-semibold text-trakend-text-primary truncate">{gpu.name}</span>
                {driverVersion && (
                  <span className="flex items-center gap-1 ml-2 shrink-0">
                    <span className="text-[10px] text-trakend-text-secondary">v{driverVersion}</span>
                    {pinned && (
                      <span
                        title="Driver branch 580 is pinned via apt preferences; it will not auto-upgrade"
                        className="text-[9px] uppercase font-bold px-1.5 py-0.5 rounded text-trakend-success border border-trakend-success"
                      >
                        pinned
                      </span>
                    )}
                  </span>
                )}
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
