import React, { useState, useCallback, useEffect } from 'react'
import { useSystemStats } from '../../hooks/useSystemStats'
import { formatBytes } from '../../utils/formatters'
import { CpuWidget } from './CpuWidget'
import { MemoryWidget } from './MemoryWidget'
import { StorageWidget } from './StorageWidget'
import { GpuWidget } from './GpuWidget'
import { NetworkWidget } from './NetworkWidget'
import { ProcessesWidget } from './ProcessesWidget'
import { DiskIOWidget } from './DiskIOWidget'
import { TemperaturesWidget } from './TemperaturesWidget'
import { SwapWidget } from './SwapWidget'
import { DockerContainersWidget } from './DockerContainersWidget'
import { ArrayStatusWidget } from './ArrayStatusWidget'
import { Server, Cpu, HardDrive, Box, Lock, Unlock, Power, RotateCw, RotateCcw, ChevronUp, ChevronDown, Eye, EyeOff, Maximize2, Minimize2 } from 'lucide-react'
import api from '../../utils/api'
import { Button } from '../common/Button'
import { ConfirmDialog } from '../common/ConfirmDialog'
import { Skeleton } from '../common/Skeleton'
import { useToast } from '../common/Toast'
import clsx from 'clsx'

const WIDGET_MAP: Record<string, { label: string; component: React.FC }> = {
  cpu: { label: 'CPU', component: CpuWidget },
  temperatures: { label: 'Temps & Fans', component: TemperaturesWidget },
  memory: { label: 'Memory', component: MemoryWidget },
  swap: { label: 'Swap', component: SwapWidget },
  gpu: { label: 'GPU', component: GpuWidget },
  network: { label: 'Network', component: NetworkWidget },
  diskio: { label: 'Disk I/O', component: DiskIOWidget },
  storage: { label: 'Storage', component: StorageWidget },
  array_status: { label: 'Array Status', component: ArrayStatusWidget },
  docker_containers: { label: 'Docker Containers', component: DockerContainersWidget },
  processes: { label: 'Processes', component: ProcessesWidget },
}

const DEFAULT_ORDER = ['cpu', 'temperatures', 'memory', 'swap', 'gpu', 'network', 'diskio', 'storage', 'array_status', 'docker_containers', 'processes']
const DEFAULT_WIDE = new Set(['cpu', 'temperatures', 'storage', 'docker_containers', 'processes'])
const LAYOUT_KEY = 'trakend-dashboard-grid-v3'

interface GridLayout {
  order: string[]
  hidden: string[]
  wide: string[]
}

function defaultLayout(): GridLayout {
  return { order: [...DEFAULT_ORDER], hidden: [], wide: [...DEFAULT_WIDE] }
}

function loadLayout(): GridLayout {
  const def = defaultLayout()
  try {
    const raw = localStorage.getItem(LAYOUT_KEY)
    if (!raw) return def
    const parsed = JSON.parse(raw)
    const order: string[] = Array.isArray(parsed.order) ? parsed.order.filter((k: string) => WIDGET_MAP[k]) : def.order
    // append any widgets added since the layout was saved
    for (const k of DEFAULT_ORDER) if (!order.includes(k)) order.push(k)
    return {
      order,
      hidden: Array.isArray(parsed.hidden) ? parsed.hidden.filter((k: string) => WIDGET_MAP[k]) : [],
      wide: Array.isArray(parsed.wide) ? parsed.wide.filter((k: string) => WIDGET_MAP[k]) : def.wide,
    }
  } catch {
    return def
  }
}

export const Dashboard: React.FC = () => {
  const stats = useSystemStats()
  const toast = useToast()
  const [layout, setLayout] = useState<GridLayout>(loadLayout)
  const [locked, setLocked] = useState(true)
  const [powerAction, setPowerAction] = useState<'reboot' | 'shutdown' | null>(null)
  const [powerBusy, setPowerBusy] = useState(false)

  useEffect(() => {
    localStorage.setItem(LAYOUT_KEY, JSON.stringify(layout))
  }, [layout])

  const move = useCallback((key: string, dir: -1 | 1) => {
    setLayout((prev) => {
      const order = [...prev.order]
      const i = order.indexOf(key)
      const j = i + dir
      if (i < 0 || j < 0 || j >= order.length) return prev
      ;[order[i], order[j]] = [order[j], order[i]]
      return { ...prev, order }
    })
  }, [])

  const toggleHidden = useCallback((key: string) => {
    setLayout((prev) => ({
      ...prev,
      hidden: prev.hidden.includes(key) ? prev.hidden.filter((k) => k !== key) : [...prev.hidden, key],
    }))
  }, [])

  const toggleWide = useCallback((key: string) => {
    setLayout((prev) => ({
      ...prev,
      wide: prev.wide.includes(key) ? prev.wide.filter((k) => k !== key) : [...prev.wide, key],
    }))
  }, [])

  const runPower = async () => {
    if (!powerAction) return
    setPowerBusy(true)
    try {
      await api.post(`/system/${powerAction}`)
      toast.info(powerAction === 'reboot' ? 'Server is restarting…' : 'Server is shutting down…')
      setPowerAction(null)
    } catch (err: any) {
      toast.error(err?.response?.data?.error || err?.message || `Failed to ${powerAction}`)
    } finally {
      setPowerBusy(false)
    }
  }

  const visible = layout.order.filter((k) => !layout.hidden.includes(k))
  const hiddenWidgets = layout.order.filter((k) => layout.hidden.includes(k))

  return (
    <div className="bg-trakend-dark w-full flex-1 p-4 sm:p-6 space-y-4">
      {/* Quick Stats Row */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <QuickStat icon={<Server size={14} />} label="System" loading={!stats}>
          {stats && (
            <>
              <div className="text-sm font-bold text-trakend-text-primary truncate">{stats.hostname}</div>
              <div className="text-xs text-trakend-text-secondary font-mono truncate">{stats.os}</div>
            </>
          )}
        </QuickStat>
        <QuickStat icon={<Cpu size={14} />} label="CPU" loading={!stats}>
          {stats && (
            <>
              <div className="text-sm font-bold text-trakend-text-primary">{stats.cpu.usage.toFixed(1)}%</div>
              <div className="text-xs text-trakend-text-secondary">
                {stats.cpu.cores}C / {stats.cpu.threads}T @ {((stats.cpu.clockSpeed || 0) / 1000).toFixed(1)} GHz
              </div>
            </>
          )}
        </QuickStat>
        <QuickStat icon={<HardDrive size={14} />} label="Memory" loading={!stats}>
          {stats && (
            <>
              <div className="text-sm font-bold text-trakend-text-primary">
                {formatBytes(stats.memory.used)} / {formatBytes(stats.memory.total)}
              </div>
              <div className="text-xs text-trakend-text-secondary">
                {stats.memory.total > 0 ? ((stats.memory.used / stats.memory.total) * 100).toFixed(0) : 0}% used
              </div>
            </>
          )}
        </QuickStat>
        <QuickStat icon={<Box size={14} />} label="Docker" loading={!stats}>
          {stats && (
            <>
              <div className="text-sm font-bold text-trakend-text-primary">{stats.docker.total} containers</div>
              <div className="text-xs">
                <span className="text-trakend-success">{stats.docker.running} running</span>
                {stats.docker.stopped > 0 && <span className="text-trakend-warning ml-2">{stats.docker.stopped} stopped</span>}
              </div>
            </>
          )}
        </QuickStat>
      </div>

      {/* Controls */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Button size="sm" variant="secondary" icon={<RotateCw size={13} />} onClick={() => setPowerAction('reboot')}>
            Restart
          </Button>
          <Button size="sm" variant="danger" icon={<Power size={13} />} onClick={() => setPowerAction('shutdown')}>
            Shut Down
          </Button>
        </div>
        <div className="flex items-center gap-2">
          {!locked && (
            <Button size="sm" variant="ghost" icon={<RotateCcw size={13} />} onClick={() => setLayout(defaultLayout())}>
              Reset layout
            </Button>
          )}
          {!locked && hiddenWidgets.length > 0 && (
            <div className="flex items-center gap-1 text-xs text-trakend-text-secondary">
              Hidden:
              {hiddenWidgets.map((k) => (
                <button
                  key={k}
                  onClick={() => toggleHidden(k)}
                  className="px-2 py-0.5 rounded border border-trakend-border hover:border-trakend-accent hover:text-trakend-text-primary focus-ring"
                  title="Show widget"
                >
                  {WIDGET_MAP[k].label}
                </button>
              ))}
            </div>
          )}
          <Button
            size="sm"
            variant={locked ? 'secondary' : 'primary'}
            icon={locked ? <Lock size={13} /> : <Unlock size={13} />}
            onClick={() => setLocked((l) => !l)}
            aria-pressed={!locked}
          >
            {locked ? 'Customize' : 'Done'}
          </Button>
        </div>
      </div>

      {/* Responsive widget grid */}
      <div className="widget-grid">
        {visible.map((key, idx) => {
          const w = WIDGET_MAP[key]
          if (!w) return null
          const Comp = w.component
          const wide = layout.wide.includes(key)
          return (
            <section
              key={key}
              aria-label={w.label}
              className={clsx('relative min-w-0', wide && 'span-2', !locked && 'ring-1 ring-trakend-accent/40 rounded-lg')}
            >
              {!locked && (
                <div className="absolute top-2 right-2 z-10 flex items-center gap-0.5 bg-trakend-dark/90 border border-trakend-border rounded-md p-0.5 shadow">
                  <Button size="xs" variant="ghost" iconOnly aria-label="Move up" disabled={idx === 0} onClick={() => move(key, -1)} icon={<ChevronUp size={12} />} />
                  <Button size="xs" variant="ghost" iconOnly aria-label="Move down" disabled={idx === visible.length - 1} onClick={() => move(key, 1)} icon={<ChevronDown size={12} />} />
                  <Button size="xs" variant="ghost" iconOnly aria-label={wide ? 'Make narrow' : 'Make wide'} onClick={() => toggleWide(key)} icon={wide ? <Minimize2 size={12} /> : <Maximize2 size={12} />} />
                  <Button size="xs" variant="ghost" iconOnly aria-label="Hide widget" onClick={() => toggleHidden(key)} icon={<EyeOff size={12} />} />
                </div>
              )}
              <Comp />
            </section>
          )
        })}
        {visible.length === 0 && (
          <div className="col-span-full text-center text-sm text-trakend-text-secondary py-12 flex flex-col items-center gap-2">
            <Eye size={24} className="opacity-40" />
            All widgets are hidden. Click Customize to show them again.
          </div>
        )}
      </div>

      <ConfirmDialog
        open={!!powerAction}
        variant="danger"
        loading={powerBusy}
        title={powerAction === 'reboot' ? 'Restart server?' : 'Shut down server?'}
        message={
          powerAction === 'reboot'
            ? 'The server will restart. Open terminals and running jobs will be interrupted and you will lose connection for a minute or two.'
            : 'The server will power off. You will need physical access (or Wake-on-LAN) to turn it back on.'
        }
        confirmLabel={powerAction === 'reboot' ? 'Restart now' : 'Shut down now'}
        onConfirm={runPower}
        onCancel={() => !powerBusy && setPowerAction(null)}
      />
    </div>
  )
}

const QuickStat: React.FC<{ icon: React.ReactNode; label: string; loading?: boolean; children?: React.ReactNode }> = ({ icon, label, loading, children }) => (
  <div className="bg-trakend-surface border border-trakend-border rounded-lg p-3 min-w-0">
    <div className="flex items-center gap-2 mb-1">
      <span className="text-trakend-accent">{icon}</span>
      <span className="text-xs text-trakend-text-secondary uppercase tracking-wide">{label}</span>
    </div>
    {loading ? (
      <div className="space-y-1.5 pt-0.5">
        <Skeleton className="h-3.5 w-3/4" />
        <Skeleton className="h-3 w-1/2" />
      </div>
    ) : (
      children
    )}
  </div>
)
