import React from 'react'
import { useSystemStats } from '../../hooks/useSystemStats'
import { formatSpeed } from '../../utils/formatters'

export const NetworkWidget: React.FC = () => {
  const stats = useSystemStats()

  if (!stats || !stats.network || stats.network.length === 0) {
    return (
      <div className="bg-trakend-surface border border-trakend-border rounded-lg p-6">
        <div className="text-sm text-trakend-text-secondary">No network interfaces</div>
      </div>
    )
  }

  return (
    <div className="bg-trakend-surface border border-trakend-border rounded-lg p-6">
      <h3 className="text-lg font-semibold text-trakend-text-primary mb-3">
        Network <span className="text-sm font-normal text-trakend-text-secondary">({stats.network.length} interfaces)</span>
      </h3>

      <div className="space-y-2">
        {stats.network.map((iface, i) => (
          <div key={i} className="p-3 bg-trakend-dark rounded border border-trakend-border">
            <div className="flex items-center justify-between mb-1">
              <div className="min-w-0">
                <span className="font-semibold text-sm text-trakend-text-primary">{iface.name}</span>
                <span className="text-[11px] text-trakend-text-secondary ml-2 font-mono">{iface.ip}</span>
              </div>
              <div className="text-[11px] text-trakend-text-secondary">
                {iface.speed > 0 ? `${iface.speed} Mbps` : ''}
              </div>
            </div>
            <div className="flex gap-4 text-[11px]">
              <div className="flex items-center gap-1.5">
                <div className="w-1.5 h-1.5 rounded-full bg-trakend-accent"></div>
                <span className="text-trakend-text-secondary">Down</span>
                <span className="text-trakend-text-primary font-mono">{formatSpeed(iface.rxSpeed)}</span>
              </div>
              <div className="flex items-center gap-1.5">
                <div className="w-1.5 h-1.5 rounded-full bg-blue-400"></div>
                <span className="text-trakend-text-secondary">Up</span>
                <span className="text-trakend-text-primary font-mono">{formatSpeed(iface.txSpeed)}</span>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
