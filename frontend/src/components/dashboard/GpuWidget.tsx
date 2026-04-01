import React from 'react'
import { GaugeChart } from '../common/GaugeChart'
import { useSystemStats } from '../../hooks/useSystemStats'
import { formatBytes, formatTemperature, formatPercentage } from '../../utils/formatters'

export const GpuWidget: React.FC = () => {
  const stats = useSystemStats()

  if (!stats || !stats.gpu || stats.gpu.length === 0) {
    return (
      <div className="bg-trakend-surface border border-trakend-border rounded-lg p-6">
        <div className="text-sm text-trakend-text-secondary">No GPU detected</div>
      </div>
    )
  }

  return (
    <div className="bg-trakend-surface border border-trakend-border rounded-lg p-6">
      <h3 className="text-lg font-semibold text-trakend-text-primary mb-4">GPU</h3>

      <div className="space-y-4">
        {stats.gpu.map((gpu, i) => {
          const vramUsagePercent = (gpu.vramUsed / gpu.vramTotal) * 100

          return (
            <div key={i} className="p-4 bg-trakend-dark rounded border border-trakend-border">
              {/* GPU Header */}
              <div className="mb-3">
                <div className="font-semibold text-trakend-text-primary">{gpu.name}</div>
                <div className="text-xs text-trakend-text-secondary">Driver: {gpu.driver}</div>
              </div>

              {/* Stats Grid */}
              <div className="grid grid-cols-2 gap-3">
                {/* VRAM Usage */}
                <div className="flex flex-col items-center">
                  <div className="relative w-24 h-24 mb-2">
                    <GaugeChart
                      value={gpu.vramUsed}
                      max={gpu.vramTotal}
                      size={100}
                      color="#3273dc"
                      label="VRAM"
                    />
                  </div>
                  <div className="text-xs text-trakend-text-secondary text-center">
                    {formatBytes(gpu.vramUsed)} / {formatBytes(gpu.vramTotal)}
                  </div>
                </div>

                {/* Other Stats */}
                <div className="space-y-2">
                  <div className="p-2 bg-trakend-surface rounded border border-trakend-border">
                    <div className="text-xs text-trakend-text-secondary uppercase tracking-wide">Utilization</div>
                    <div className="text-lg font-bold text-trakend-accent">{formatPercentage(gpu.utilization)}</div>
                  </div>
                  <div className="p-2 bg-trakend-surface rounded border border-trakend-border">
                    <div className="text-xs text-trakend-text-secondary uppercase tracking-wide">Temperature</div>
                    <div className="text-lg font-bold text-trakend-accent">{formatTemperature(gpu.temperature)}</div>
                  </div>
                </div>
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
