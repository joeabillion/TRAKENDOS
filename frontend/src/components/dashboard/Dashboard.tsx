import React, { useState, useCallback, useRef, useEffect } from 'react'
import { useSystemStats } from '../../hooks/useSystemStats'
import { formatBytes } from '../../utils/formatters'
import { CpuWidget } from './CpuWidget'
import { MemoryWidget } from './MemoryWidget'
import { StorageWidget } from './StorageWidget'
import { GpuWidget } from './GpuWidget'
import { NetworkWidget } from './NetworkWidget'
import { Server, Cpu, HardDrive, Box, Lock, Unlock, GripVertical, Maximize2, Minimize2 } from 'lucide-react'

const WIDGET_MAP: Record<string, { label: string; component: React.FC }> = {
  cpu: { label: 'CPU', component: CpuWidget },
  memory: { label: 'Memory', component: MemoryWidget },
  gpu: { label: 'GPU', component: GpuWidget },
  storage: { label: 'Storage', component: StorageWidget },
  network: { label: 'Network', component: NetworkWidget },
}

const DEFAULT_ORDER = ['cpu', 'memory', 'gpu', 'storage', 'network']
const STORAGE_KEY = 'trakend-dashboard-widget-order'
const SIZES_KEY = 'trakend-dashboard-widget-sizes'

type WidgetSize = 1 | 2 | 3

const DEFAULT_SIZES: Record<string, WidgetSize> = {
  cpu: 1, memory: 1, gpu: 1, storage: 1, network: 1,
}

function loadOrder(): string[] {
  try {
    const saved = localStorage.getItem(STORAGE_KEY)
    if (saved) {
      const parsed = JSON.parse(saved) as string[]
      if (Array.isArray(parsed) && parsed.every(k => k in WIDGET_MAP)) return parsed
    }
  } catch { /* ignore */ }
  return [...DEFAULT_ORDER]
}

function saveOrder(order: string[]) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(order))
}

function loadSizes(): Record<string, WidgetSize> {
  try {
    const saved = localStorage.getItem(SIZES_KEY)
    if (saved) {
      const parsed = JSON.parse(saved)
      if (typeof parsed === 'object') return { ...DEFAULT_SIZES, ...parsed }
    }
  } catch { /* ignore */ }
  return { ...DEFAULT_SIZES }
}

function saveSizes(sizes: Record<string, WidgetSize>) {
  localStorage.setItem(SIZES_KEY, JSON.stringify(sizes))
}

const COL_SPAN_CLASS: Record<WidgetSize, string> = {
  1: '',
  2: 'lg:col-span-2',
  3: 'lg:col-span-2 xl:col-span-3',
}

export const Dashboard: React.FC = () => {
  const stats = useSystemStats()
  const [widgetOrder, setWidgetOrder] = useState<string[]>(loadOrder)
  const [widgetSizes, setWidgetSizes] = useState<Record<string, WidgetSize>>(loadSizes)
  const [locked, setLocked] = useState(true)
  const [dragIdx, setDragIdx] = useState<number | null>(null)
  const [overIdx, setOverIdx] = useState<number | null>(null)
  const dragNode = useRef<HTMLDivElement | null>(null)

  useEffect(() => { saveOrder(widgetOrder) }, [widgetOrder])
  useEffect(() => { saveSizes(widgetSizes) }, [widgetSizes])

  const cycleSize = useCallback((key: string) => {
    setWidgetSizes(prev => {
      const current = prev[key] || 1
      const next: WidgetSize = current === 1 ? 2 : current === 2 ? 3 : 1
      return { ...prev, [key]: next }
    })
  }, [])

  const handleDragStart = useCallback((e: React.DragEvent, idx: number) => {
    if (locked) return
    setDragIdx(idx)
    dragNode.current = e.currentTarget as HTMLDivElement
    e.dataTransfer.effectAllowed = 'move'
    e.dataTransfer.setData('text/plain', String(idx))
    requestAnimationFrame(() => {
      if (dragNode.current) dragNode.current.style.opacity = '0.4'
    })
  }, [locked])

  const handleDragEnd = useCallback(() => {
    if (dragNode.current) dragNode.current.style.opacity = '1'
    setDragIdx(null)
    setOverIdx(null)
    dragNode.current = null
  }, [])

  const handleDragOver = useCallback((e: React.DragEvent, idx: number) => {
    e.preventDefault()
    e.dataTransfer.dropEffect = 'move'
    if (dragIdx !== null && idx !== dragIdx) setOverIdx(idx)
  }, [dragIdx])

  const handleDrop = useCallback((e: React.DragEvent, idx: number) => {
    e.preventDefault()
    if (dragIdx === null || dragIdx === idx) return
    setWidgetOrder(prev => {
      const next = [...prev]
      const [moved] = next.splice(dragIdx, 1)
      next.splice(idx, 0, moved)
      return next
    })
    setDragIdx(null)
    setOverIdx(null)
  }, [dragIdx])

  return (
    <div className="bg-trakend-dark min-h-full">
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

        {/* Lock / Unlock toggle */}
        <div className="flex items-center justify-end mb-3">
          <button
            onClick={() => setLocked(!locked)}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors"
            style={{
              background: locked ? 'transparent' : 'var(--color-accent)',
              color: locked ? 'var(--color-text-secondary)' : '#fff',
              border: locked ? '1px solid var(--color-border)' : '1px solid transparent',
            }}
            title={locked ? 'Unlock widgets to rearrange & resize' : 'Lock widgets in place'}
          >
            {locked ? <Lock size={13} /> : <Unlock size={13} />}
            {locked ? 'Locked' : 'Unlocked — drag to rearrange, click resize to change size'}
          </button>
        </div>

        {/* Widgets Grid */}
        <div className="grid grid-cols-1 lg:grid-cols-2 xl:grid-cols-3 gap-6 items-start">
          {widgetOrder.map((key, idx) => {
            const w = WIDGET_MAP[key]
            if (!w) return null
            const Comp = w.component
            const size = widgetSizes[key] || 1
            const sizeLabel = size === 1 ? '1x' : size === 2 ? '2x' : '3x (full)'
            return (
              <div
                key={key}
                draggable={!locked}
                onDragStart={e => handleDragStart(e, idx)}
                onDragEnd={handleDragEnd}
                onDragOver={e => handleDragOver(e, idx)}
                onDrop={e => handleDrop(e, idx)}
                className={`relative group ${COL_SPAN_CLASS[size]}`}
                style={{
                  transition: 'transform 0.15s, box-shadow 0.15s',
                  transform: overIdx === idx && dragIdx !== null ? 'scale(1.02)' : 'scale(1)',
                  boxShadow: overIdx === idx && dragIdx !== null ? '0 0 0 2px var(--color-accent)' : 'none',
                  borderRadius: '0.5rem',
                }}
              >
                {!locked && (
                  <div className="absolute top-2 left-2 z-10 flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                    <div className="cursor-grab active:cursor-grabbing bg-trakend-dark/80 rounded p-1">
                      <GripVertical size={16} className="text-trakend-text-secondary" />
                    </div>
                    <button
                      onClick={(e) => { e.stopPropagation(); cycleSize(key) }}
                      className="bg-trakend-dark/80 rounded p-1 hover:bg-trakend-accent/40 transition-colors"
                      title={`Resize widget (current: ${sizeLabel})`}
                    >
                      {size < 3
                        ? <Maximize2 size={14} className="text-trakend-text-secondary" />
                        : <Minimize2 size={14} className="text-trakend-text-secondary" />}
                    </button>
                    <span className="text-[10px] text-trakend-text-secondary bg-trakend-dark/80 rounded px-1.5 py-0.5 font-mono">{sizeLabel}</span>
                  </div>
                )}
                <Comp />
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}
