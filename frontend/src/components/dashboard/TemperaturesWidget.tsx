import React from 'react'
import { useSystemStats } from '../../hooks/useSystemStats'

export const TemperaturesWidget: React.FC = () => {
  const stats = useSystemStats()
  const temps = stats?.temperatures
  const fans = temps?.sensors?.filter(s => s.type === 'fan') || []
  const tempSensors = temps?.sensors?.filter(s => s.type === 'temp') || []
  const voltageSensors = temps?.sensors?.filter(s => s.type === 'voltage') || []

  const toF = (c: number) => Math.round(c * 9 / 5 + 32)

  const getTempColor = (val: number) => {
    if (val > 85) return 'text-trakend-error'
    if (val > 70) return 'text-trakend-warning'
    return 'text-trakend-success'
  }

  const getTempBarWidth = (val: number) => Math.min(100, (val / 100) * 100)

  return (
    <div className="bg-trakend-surface border border-trakend-border rounded-lg p-4 h-full overflow-auto">
      <h3 className="text-sm font-semibold text-trakend-text-primary mb-3">Temperatures & Fans</h3>

      {/* CPU Temperature */}
      {temps && (
        <div className="mb-4">
          <div className="flex items-center justify-between mb-1">
            <span className="text-xs text-trakend-text-secondary">CPU</span>
            <span className={`text-sm font-bold ${getTempColor(temps.cpu)}`}>{toF(temps.cpu)}°F</span>
          </div>
          <div className="h-2 bg-trakend-dark rounded-full overflow-hidden">
            <div className={`h-full rounded-full transition-all ${temps.cpu > 85 ? 'bg-trakend-error' : temps.cpu > 70 ? 'bg-trakend-warning' : 'bg-trakend-success'}`}
              style={{ width: `${getTempBarWidth(temps.cpu)}%` }} />
          </div>
          {temps.cpuCores.length > 0 && (
            <div className="mt-2 grid grid-cols-4 gap-1">
              {temps.cpuCores.map((core, i) => (
                <div key={i} className="text-center">
                  <div className="text-[10px] text-trakend-text-secondary">C{i}</div>
                  <div className={`text-xs font-medium ${getTempColor(core)}`}>{toF(core)}°</div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Other Temperature Sensors */}
      {tempSensors.length > 0 && (
        <div className="mb-4">
          <div className="text-xs text-trakend-text-secondary uppercase tracking-wide mb-2">Sensors</div>
          {tempSensors.map((s, i) => (
            <div key={i} className="flex items-center justify-between py-1 border-b border-trakend-border/30">
              <span className="text-xs text-trakend-text-secondary truncate max-w-[60%]">{s.label} <span className="opacity-50">({s.chip})</span></span>
              <span className={`text-xs font-medium ${getTempColor(s.value)}`}>{s.unit === '°C' ? `${toF(s.value)}°F` : `${s.value.toFixed(1)}${s.unit}`}</span>
            </div>
          ))}
        </div>
      )}

      {/* Fan Speeds */}
      {fans.length > 0 && (
        <div className="mb-4">
          <div className="text-xs text-trakend-text-secondary uppercase tracking-wide mb-2">Fans</div>
          {fans.map((f, i) => (
            <div key={i} className="flex items-center justify-between py-1 border-b border-trakend-border/30">
              <span className="text-xs text-trakend-text-secondary truncate max-w-[60%]">{f.label}</span>
              <span className={`text-xs font-medium ${f.value === 0 ? 'text-trakend-error' : 'text-trakend-accent'}`}>
                {f.value > 0 ? `${f.value.toFixed(0)} RPM` : 'Stopped'}
              </span>
            </div>
          ))}
        </div>
      )}

      {/* Voltages */}
      {voltageSensors.length > 0 && (
        <div>
          <div className="text-xs text-trakend-text-secondary uppercase tracking-wide mb-2">Voltages</div>
          <div className="grid grid-cols-2 gap-x-4 gap-y-1">
            {voltageSensors.map((v, i) => (
              <div key={i} className="flex items-center justify-between">
                <span className="text-[10px] text-trakend-text-secondary truncate">{v.label}</span>
                <span className="text-[10px] font-mono text-trakend-text-primary">{v.value.toFixed(2)}V</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {!temps && <div className="text-xs text-trakend-text-secondary">No sensor data</div>}
    </div>
  )
}
