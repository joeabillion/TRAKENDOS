import React, { useState, useRef, useEffect, useCallback } from 'react'
import { useSystemStats } from '../../hooks/useSystemStats'
import { formatBytes } from '../../utils/formatters'
import { CpuWidget } from './CpuWidget'
import { MemoryWidget } from './MemoryWidget'
import { StorageWidget } from './StorageWidget'
import { GpuWidget } from './GpuWidget'
import { NetworkWidget } from './NetworkWidget'
import { Server, Cpu, HardDrive, Box, Lock, Unlock, Move, Power, RotateCw, RotateCcw } from 'lucide-react'
import api from '../../utils/api'

const WIDGET_MAP: Record<string, { label: string; component: React.FC }> = {
  cpu: { label: 'CPU', component: CpuWidget },
  memory: { label: 'Memory', component: MemoryWidget },
  gpu: { label: 'GPU', component: GpuWidget },
  storage: { label: 'Storage', component: StorageWidget },
  network: { label: 'Network', component: NetworkWidget },
}

const WIDGET_KEYS = ['cpu', 'memory', 'gpu', 'storage', 'network']
const LAYOUT_KEY = 'trakend-dashboard-layout-v2'

interface WidgetLayout {
  x: number
  y: number
  w: number
  h: number
  z: number
}

function defaultLayouts(): Record<string, WidgetLayout> {
  return {
    cpu:     { x: 0,   y: 0,   w: 100, h: 400, z: 1 },
    network: { x: 0,   y: 410, w: 50,  h: 300, z: 1 },
    storage: { x: 50,  y: 410, w: 50,  h: 300, z: 1 },
    memory:  { x: 0,   y: 720, w: 50,  h: 250, z: 1 },
    gpu:     { x: 50,  y: 720, w: 50,  h: 250, z: 1 },
  }
}

function loadLayouts(): Record<string, WidgetLayout> {
  try {
    const saved = localStorage.getItem(LAYOUT_KEY)
    if (saved) {
      const parsed = JSON.parse(saved)
      if (typeof parsed === 'object' && parsed.cpu) return parsed
    }
  } catch { /* ignore */ }
  return defaultLayouts()
}

function saveLayouts(layouts: Record<string, WidgetLayout>) {
  localStorage.setItem(LAYOUT_KEY, JSON.stringify(layouts))
}

export const Dashboard: React.FC = () => {
  const stats = useSystemStats()
  const [layouts, setLayouts] = useState<Record<string, WidgetLayout>>(loadLayouts)
  const [locked, setLocked] = useState(true)
  const [showPowerConfirm, setShowPowerConfirm] = useState<'reboot' | 'shutdown' | null>(null)
  const [activeWidget, setActiveWidget] = useState<string | null>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const dragState = useRef<{ type: 'move' | 'resize'; key: string; startX: number; startY: number; origX: number; origY: number; origW: number; origH: number } | null>(null)

  useEffect(() => { saveLayouts(layouts) }, [layouts])

  const bringToFront = useCallback((key: string) => {
    setLayouts(prev => {
      const maxZ = Math.max(...Object.values(prev).map(l => l.z))
      if (prev[key].z === maxZ) return prev
      return { ...prev, [key]: { ...prev[key], z: maxZ + 1 } }
    })
    setActiveWidget(key)
  }, [])

  const handleMouseDown = useCallback((e: React.MouseEvent, key: string, type: 'move' | 'resize') => {
    if (locked) return
    e.preventDefault()
    e.stopPropagation()
    bringToFront(key)
    const container = containerRef.current
    if (!container) return
    const layout = layouts[key]
    const rect = container.getBoundingClientRect()
    dragState.current = {
      type,
      key,
      startX: e.clientX,
      startY: e.clientY,
      origX: (layout.x / 100) * rect.width,
      origY: layout.y,
      origW: (layout.w / 100) * rect.width,
      origH: layout.h,
    }

    const handleMouseMove = (ev: MouseEvent) => {
      if (!dragState.current || !containerRef.current) return
      const ds = dragState.current
      const r = containerRef.current.getBoundingClientRect()
      const dx = ev.clientX - ds.startX
      const dy = ev.clientY - ds.startY

      if (ds.type === 'move') {
        const newX = Math.max(0, Math.min(r.width - ds.origW, ds.origX + dx))
        const newY = Math.max(0, ds.origY + dy)
        setLayouts(prev => ({
          ...prev,
          [ds.key]: { ...prev[ds.key], x: (newX / r.width) * 100, y: newY },
        }))
      } else {
        const newW = Math.max(200, ds.origW + dx)
        const newH = Math.max(100, ds.origH + dy)
        setLayouts(prev => ({
          ...prev,
          [ds.key]: { ...prev[ds.key], w: (newW / r.width) * 100, h: newH },
        }))
      }
    }

    const handleMouseUp = () => {
      dragState.current = null
      window.removeEventListener('mousemove', handleMouseMove)
      window.removeEventListener('mouseup', handleMouseUp)
    }

    window.addEventListener('mousemove', handleMouseMove)
    window.addEventListener('mouseup', handleMouseUp)
  }, [locked, layouts, bringToFront])

  const resetLayout = useCallback(() => {
    setLayouts(defaultLayouts())
  }, [])

  // Calculate container height from widget positions
  const containerHeight = Math.max(800, ...Object.values(layouts).map(l => l.y + l.h + 20))

  return (
    <div className="bg-trakend-dark min-h-full w-full flex-1">
      <div className="p-4 w-full">
        {/* Quick Stats Row */}
        {stats && (
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
            <div className="bg-trakend-surface border border-trakend-border rounded-lg p-3">
              <div className="flex items-center gap-2 mb-1">
                <Server size={14} className="text-trakend-accent" />
                <span className="text-xs text-trakend-text-secondary uppercase tracking-wide">System</span>
              </div>
              <div className="text-sm font-bold text-trakend-text-primary truncate">{stats.hostname}</div>
              <div className="text-xs text-trakend-text-secondary font-mono truncate">{stats.os}</div>
            </div>
            <div className="bg-trakend-surface border border-trakend-border rounded-lg p-3">
              <div className="flex items-center gap-2 mb-1">
                <Cpu size={14} className="text-trakend-accent" />
                <span className="text-xs text-trakend-text-secondary uppercase tracking-wide">CPU</span>
              </div>
              <div className="text-sm font-bold text-trakend-text-primary">{stats.cpu.usage.toFixed(1)}%</div>
              <div className="text-xs text-trakend-text-secondary">{stats.cpu.cores}C / {stats.cpu.threads}T @ {((stats.cpu.clockSpeed || 0) / 1000).toFixed(1)} GHz</div>
            </div>
            <div className="bg-trakend-surface border border-trakend-border rounded-lg p-3">
              <div className="flex items-center gap-2 mb-1">
                <HardDrive size={14} className="text-trakend-accent" />
                <span className="text-xs text-trakend-text-secondary uppercase tracking-wide">Memory</span>
              </div>
              <div className="text-sm font-bold text-trakend-text-primary">{formatBytes(stats.memory.used)} / {formatBytes(stats.memory.total)}</div>
              <div className="text-xs text-trakend-text-secondary">{stats.memory.total > 0 ? ((stats.memory.used / stats.memory.total) * 100).toFixed(0) : 0}% used</div>
            </div>
            <div className="bg-trakend-surface border border-trakend-border rounded-lg p-3">
              <div className="flex items-center gap-2 mb-1">
                <Box size={14} className="text-trakend-accent" />
                <span className="text-xs text-trakend-text-secondary uppercase tracking-wide">Docker</span>
              </div>
              <div className="text-sm font-bold text-trakend-text-primary">{stats.docker.total} containers</div>
              <div className="text-xs">
                <span className="text-trakend-success">{stats.docker.running} running</span>
                {stats.docker.stopped > 0 && <span className="text-trakend-warning ml-2">{stats.docker.stopped} stopped</span>}
              </div>
            </div>
          </div>
        )}

        {/* Controls */}
        <div className="flex items-center justify-between mb-2">
          <div className="flex items-center gap-2">
            <button onClick={() => setShowPowerConfirm('reboot')}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium border border-trakend-border text-trakend-text-secondary hover:text-trakend-warning hover:border-trakend-warning transition-colors">
              <RotateCw size={13} /> Restart
            </button>
            <button onClick={() => setShowPowerConfirm('shutdown')}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium border border-trakend-border text-trakend-text-secondary hover:text-trakend-error hover:border-trakend-error transition-colors">
              <Power size={13} /> Shut Down
            </button>
          </div>
          <div className="flex items-center gap-2">
            {!locked && (
              <button onClick={resetLayout}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium border border-trakend-border text-trakend-text-secondary hover:text-trakend-text-primary transition-colors">
                <RotateCcw size={13} /> Reset Layout
              </button>
            )}
            <button onClick={() => setLocked(!locked)}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors"
              style={{
                background: locked ? 'transparent' : 'var(--color-accent)',
                color: locked ? 'var(--color-text-secondary)' : '#fff',
                border: locked ? '1px solid var(--color-border)' : '1px solid transparent',
              }}>
              {locked ? <Lock size={13} /> : <Unlock size={13} />}
              {locked ? 'Locked' : 'Unlocked — drag & resize widgets freely'}
            </button>
          </div>
        </div>

        {/* Free-form Widget Canvas */}
        <div ref={containerRef} className="relative w-full" style={{ height: containerHeight }}>
          {WIDGET_KEYS.map(key => {
            const w = WIDGET_MAP[key]
            if (!w) return null
            const Comp = w.component
            const layout = layouts[key]
            const isActive = activeWidget === key && !locked
            return (
              <div
                key={key}
                className="absolute overflow-auto"
                style={{
                  left: `${layout.x}%`,
                  top: layout.y,
                  width: `${layout.w}%`,
                  height: layout.h,
                  zIndex: layout.z,
                  outline: isActive ? '2px solid var(--color-accent)' : 'none',
                  borderRadius: '0.5rem',
                  transition: dragState.current?.key === key ? 'none' : 'outline 0.15s',
                }}
                onMouseDown={() => { if (!locked) bringToFront(key) }}
              >
                {/* Drag handle — top bar when unlocked */}
                {!locked && (
                  <div
                    className="absolute top-0 left-0 right-0 h-7 z-20 flex items-center gap-1 px-2 cursor-move rounded-t-lg"
                    style={{ background: 'rgba(0,0,0,0.5)' }}
                    onMouseDown={e => handleMouseDown(e, key, 'move')}
                  >
                    <Move size={12} className="text-trakend-text-secondary" />
                    <span className="text-[10px] text-trakend-text-secondary font-medium uppercase tracking-wide">{w.label}</span>
                  </div>
                )}
                {/* Resize handle — bottom-right corner */}
                {!locked && (
                  <div
                    className="absolute bottom-0 right-0 w-5 h-5 z-20 cursor-se-resize"
                    style={{ background: 'linear-gradient(135deg, transparent 50%, var(--color-accent) 50%)', borderRadius: '0 0 0.5rem 0' }}
                    onMouseDown={e => handleMouseDown(e, key, 'resize')}
                  />
                )}
                <Comp />
              </div>
            )
          })}
        </div>
      </div>

      {/* Power Confirmation Dialog */}
      {showPowerConfirm && (
        <div className="fixed inset-0 bg-black/75 flex items-center justify-center z-50">
          <div className="bg-trakend-surface border border-trakend-border rounded-lg p-6 max-w-sm w-full mx-4">
            <h2 className="text-lg font-semibold text-trakend-text-primary mb-2">
              {showPowerConfirm === 'reboot' ? 'Restart Server?' : 'Shut Down Server?'}
            </h2>
            <p className="text-sm text-trakend-text-secondary mb-6">
              {showPowerConfirm === 'reboot'
                ? 'The server will restart. You will lose connection temporarily.'
                : 'The server will shut down. You will need physical access to turn it back on.'}
            </p>
            <div className="flex gap-3 justify-end">
              <button onClick={() => setShowPowerConfirm(null)}
                className="px-4 py-2 rounded-lg text-sm bg-trakend-surface-light text-trakend-text-secondary hover:text-trakend-text-primary transition-colors">
                Cancel
              </button>
              <button
                onClick={async () => {
                  try { await api.post(`/system/${showPowerConfirm === 'reboot' ? 'reboot' : 'shutdown'}`) } catch {}
                  setShowPowerConfirm(null)
                }}
                className={`px-4 py-2 rounded-lg text-sm text-white transition-colors ${
                  showPowerConfirm === 'reboot' ? 'bg-trakend-warning hover:bg-opacity-90' : 'bg-trakend-error hover:bg-opacity-90'
                }`}>
                {showPowerConfirm === 'reboot' ? 'Restart Now' : 'Shut Down Now'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
