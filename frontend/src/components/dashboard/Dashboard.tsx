import React from 'react'
import { useSystemStats } from '../../hooks/useSystemStats'
import { formatBytes } from '../../utils/formatters'
import { CpuWidget } from './CpuWidget'
import { MemoryWidget } from './MemoryWidget'
import { StorageWidget } from './StorageWidget'
import { GpuWidget } from './GpuWidget'
import { NetworkWidget } from './NetworkWidget'
import { Server, Cpu, HardDrive, Box } from 'lucide-react'

export const Dashboard: React.FC = () => {
  const stats = useSystemStats()

  return (
    <div className="flex-1 overflow-y-auto bg-trakend-dark">
      <div className="p-6 w-full">
        {/* Quick Stats Row */}
        {stats && (
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
            <div className="bg-trakend-surface border border-trakend-border rounded-lg p-4">
              <div className="flex items-center gap-2 mb-1">
                <Server size={14} className="text-trakend-accent" />
                <span className="text-xs text-trakend-text-secondary uppercase tracking-wide">System</span>
              </div>
              <div className="text-sm font-bold text-trakend-text-primary truncate">{stats.hostname}</div>
              <div className="text-xs text-trakend-text-secondary font-mono truncate">{stats.os}</div>
            </div>

            <div className="bg-trakend-surface border border-trakend-border rounded-lg p-4">
              <div className="flex items-center gap-2 mb-1">
                <Cpu size={14} className="text-trakend-accent" />
                <span className="text-xs text-trakend-text-secondary uppercase tracking-wide">CPU</span>
              </div>
              <div className="text-sm font-bold text-trakend-text-primary">{stats.cpu.usage.toFixed(1)}%</div>
              <div className="text-xs text-trakend-text-secondary">{stats.cpu.cores}C / {stats.cpu.threads}T @ {((stats.cpu.clockSpeed || 0) / 1000).toFixed(1)} GHz</div>
            </div>

            <div className="bg-trakend-surface border border-trakend-border rounded-lg p-4">
              <div className="flex items-center gap-2 mb-1">
                <HardDrive size={14} className="text-trakend-accent" />
                <span className="text-xs text-trakend-text-secondary uppercase tracking-wide">Memory</span>
              </div>
              <div className="text-sm font-bold text-trakend-text-primary">
                {formatBytes(stats.memory.used)} / {formatBytes(stats.memory.total)}
              </div>
              <div className="text-xs text-trakend-text-secondary">
                {stats.memory.total > 0 ? ((stats.memory.used / stats.memory.total) * 100).toFixed(0) : 0}% used
              </div>
            </div>

            <div className="bg-trakend-surface border border-trakend-border rounded-lg p-4">
              <div className="flex items-center gap-2 mb-1">
                <Box size={14} className="text-trakend-accent" />
                <span className="text-xs text-trakend-text-secondary uppercase tracking-wide">Docker</span>
              </div>
              <div className="text-sm font-bold text-trakend-text-primary">{stats.docker.total} containers</div>
              <div className="text-xs">
                <span className="text-trakend-success">{stats.docker.running} running</span>
                {stats.docker.stopped > 0 && (
                  <span className="text-trakend-warning ml-2">{stats.docker.stopped} stopped</span>
                )}
              </div>
            </div>
          </div>
        )}

        {/* Main Widgets - 3 column on wide screens */}
        <div className="grid grid-cols-1 lg:grid-cols-2 xl:grid-cols-3 gap-6 mb-6">
          <CpuWidget />
          <MemoryWidget />
          <GpuWidget />
        </div>

        {/* Storage + Network - Full Width */}
        <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
          <StorageWidget />
          <NetworkWidget />
        </div>
      </div>
    </div>
  )
}
