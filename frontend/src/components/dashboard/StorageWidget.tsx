import React from 'react'
import { HardDrive, Database, Shield } from 'lucide-react'
import { useSystemStats } from '../../hooks/useSystemStats'
import { formatBytes, formatTemperature, formatPercentage, formatSpeed } from '../../utils/formatters'

function getDriveRole(drive: any): { label: string; priority: number } {
  const role = (drive.role || '').toLowerCase()
  const name = (drive.name || '').toLowerCase()
  const mount = (drive.mount || '').toLowerCase()

  // Use backend-assigned role first
  if (role === 'parity') return { label: 'Parity', priority: 0 }
  if (role === 'cache') return { label: 'Cache', priority: 1 }
  if (role === 'os') return { label: 'OS', priority: 2 }
  if (role === 'data') {
    const diskNum = mount.match(/disk(\d+)/)?.[1]
    return { label: diskNum ? `Disk ${diskNum}` : 'Data', priority: 4 }
  }

  // Fallback heuristics from mount path / name
  if (name.includes('parity') || mount.includes('parity')) return { label: 'Parity', priority: 0 }
  if (mount.includes('cache') || name.includes('cache')) return { label: 'Cache', priority: 1 }
  if (mount === '/' || mount === '/boot') return { label: 'OS', priority: 2 }
  if (mount.includes('/data')) return { label: 'Data', priority: 3 }
  if (mount.includes('/mnt/disks') || mount.includes('/mnt/disk')) {
    const diskNum = mount.match(/disk(\d+)/)?.[1]
    return { label: diskNum ? `Disk ${diskNum}` : 'Disk', priority: 4 }
  }

  // Use device name as fallback label (e.g. sda, sdb, nvme0n1)
  const devShort = name.replace('/dev/', '')
  return { label: devShort || '', priority: 10 }
}

export const StorageWidget: React.FC = () => {
  const stats = useSystemStats()

  if (!stats || !stats.storage || stats.storage.length === 0) {
    return (
      <div className="bg-trakend-surface border border-trakend-border rounded-lg p-6">
        <div className="text-sm text-trakend-text-secondary">Loading storage data...</div>
      </div>
    )
  }

  const sortedDrives = [...stats.storage].sort((a, b) => getDriveRole(a).priority - getDriveRole(b).priority)

  return (
    <div className="bg-trakend-surface border border-trakend-border rounded-lg p-6">
      <h3 className="text-lg font-semibold text-trakend-text-primary mb-4">
        Storage <span className="text-sm font-normal text-trakend-text-secondary">({sortedDrives.length} drives)</span>
      </h3>

      <div className="space-y-3">
        {sortedDrives.map((drive, i) => {
          const usagePercent = drive.size > 0 ? (drive.used / drive.size) * 100 : 0
          const healthColor =
            drive.health === 'good' ? 'text-trakend-success' : drive.health === 'warning' ? 'text-trakend-warning' : 'text-trakend-error'
          const role = getDriveRole(drive)
          const isParity = role.label === 'Parity'
          const isCache = role.label === 'Cache'

          return (
            <div key={i} className={`p-3 bg-trakend-dark rounded border ${isParity ? 'border-yellow-600/40' : isCache ? 'border-blue-600/40' : 'border-trakend-border'}`}>
              <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-2 min-w-0">
                  {isParity ? <Shield size={16} className="text-yellow-500 flex-shrink-0" /> :
                   isCache ? <Database size={16} className="text-blue-400 flex-shrink-0" /> :
                   <HardDrive size={16} className="text-trakend-accent flex-shrink-0" />}
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="font-semibold text-sm text-trakend-text-primary truncate">{drive.name}</span>
                      {role.label && (
                        <span className={`text-[10px] px-1.5 py-0.5 rounded font-bold uppercase ${
                          isParity ? 'bg-yellow-900/40 text-yellow-400' :
                          isCache ? 'bg-blue-900/40 text-blue-400' :
                          'bg-trakend-surface text-trakend-text-secondary'
                        }`}>{role.label}</span>
                      )}
                    </div>
                    <div className="text-[11px] text-trakend-text-secondary font-mono truncate">
                      {drive.type?.toUpperCase() || 'HDD'} • {formatBytes(drive.size)}
                      {(drive as any).mount && (drive as any).mount !== 'unknown' && <> • <span className="text-trakend-accent">{(drive as any).mount}</span></>}
                    </div>
                  </div>
                </div>
                <div className={`font-semibold text-xs ${healthColor}`}>{drive.health?.toUpperCase() || 'OK'}</div>
              </div>

              {!isParity && drive.size > 0 && (
                <div className="mb-2">
                  <div className="flex justify-between items-center text-[11px] mb-0.5">
                    <span className="text-trakend-text-secondary">
                      {formatBytes(drive.used)} / {formatBytes(drive.size)}
                    </span>
                    <span className="text-trakend-accent font-semibold">{formatPercentage(usagePercent)}</span>
                  </div>
                  <div className="w-full h-1.5 bg-trakend-border rounded-full overflow-hidden">
                    <div
                      className={`h-full rounded-full transition-all duration-300 ${
                        usagePercent > 90 ? 'bg-trakend-error' : usagePercent > 70 ? 'bg-trakend-warning' : 'bg-trakend-success'
                      }`}
                      style={{ width: `${Math.min(usagePercent, 100)}%` }}
                    />
                  </div>
                </div>
              )}

              <div className="flex gap-4 text-[11px]">
                <div>
                  <span className="text-trakend-text-secondary">Temp </span>
                  <span className="text-trakend-text-primary font-mono">{formatTemperature(drive.temp)}</span>
                </div>
                <div>
                  <span className="text-trakend-text-secondary">R </span>
                  <span className="text-trakend-text-primary font-mono">{formatSpeed(drive.readSpeed)}</span>
                </div>
                <div>
                  <span className="text-trakend-text-secondary">W </span>
                  <span className="text-trakend-text-primary font-mono">{formatSpeed(drive.writeSpeed)}</span>
                </div>
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
