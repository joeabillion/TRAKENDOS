import React from 'react'
import { NavLink } from 'react-router-dom'
import {
  LayoutDashboard,
  HardDrive,
  Container,
  Database,
  FolderOpen,
  Share2,
  Terminal,
  ScrollText,
  Zap,
  Settings,
  X,
} from 'lucide-react'
import clsx from 'clsx'
import { useWebSocket } from '../../context/WebSocketContext'

interface NavItem {
  path: string
  label: string
  icon: React.ReactNode
}

const navItems: NavItem[] = [
  { path: '/', label: 'Dashboard', icon: <LayoutDashboard size={18} /> },
  { path: '/array', label: 'Array', icon: <HardDrive size={18} /> },
  { path: '/docker', label: 'Docker', icon: <Container size={18} /> },
  { path: '/database', label: 'Database', icon: <Database size={18} /> },
  { path: '/files', label: 'Files', icon: <FolderOpen size={18} /> },
  { path: '/shares', label: 'Shares', icon: <Share2 size={18} /> },
  { path: '/terminal', label: 'Terminal', icon: <Terminal size={18} /> },
  { path: '/logs', label: 'Logs', icon: <ScrollText size={18} /> },
  { path: '/maya', label: 'Maya AI', icon: <Zap size={18} /> },
  { path: '/settings', label: 'Settings', icon: <Settings size={18} /> },
]

interface SidebarProps {
  /** Drawer state on < 1024px screens (ignored on desktop). */
  open?: boolean
  onClose?: () => void
}

export const Sidebar: React.FC<SidebarProps> = ({ open = false, onClose }) => {
  const { connected, reconnecting, systemStats } = useWebSocket()

  return (
    <aside className={clsx('app-sidebar', open && 'open')} aria-label="Primary navigation">
      {/* Logo */}
      <div className="h-topbar px-4 border-b border-trakend-border flex items-center justify-between flex-shrink-0">
        <div className="flex items-center gap-3 min-w-0">
          <img
            src="/logo/icon.png"
            alt=""
            className="w-7 h-7 object-contain flex-shrink-0"
            onError={(e) => {
              const target = e.target as HTMLImageElement
              if (target.src.endsWith('.png')) {
                target.src = '/logo/icon.svg'
              } else {
                target.style.display = 'none'
                const fallback = target.parentElement?.querySelector('.icon-fallback') as HTMLElement
                if (fallback) fallback.style.display = 'flex'
              }
            }}
          />
          <div
            className="icon-fallback hidden w-7 h-7 rounded items-center justify-center flex-shrink-0"
            style={{ background: 'linear-gradient(135deg, var(--color-accent), var(--color-accent-dark))' }}
          >
            <span className="text-white font-bold text-sm">T</span>
          </div>
          <h1 className="text-base font-bold text-trakend-text-primary truncate">Trakend OS</h1>
        </div>
        {onClose && (
          <button
            onClick={onClose}
            aria-label="Close navigation"
            className="lg:hidden p-1.5 rounded text-trakend-text-secondary hover:text-trakend-text-primary hover:bg-trakend-surface-light focus-ring"
          >
            <X size={16} />
          </button>
        )}
      </div>

      {/* Navigation */}
      <nav className="flex-1 overflow-y-auto py-3">
        <ul className="space-y-1 px-2">
          {navItems.map((item) => (
            <li key={item.path}>
              <NavLink
                to={item.path}
                end={item.path === '/'}
                className={({ isActive }) =>
                  clsx(
                    'flex items-center gap-3 px-3 py-2 rounded-md text-sm font-medium transition-colors focus-ring',
                    isActive
                      ? 'bg-trakend-accent text-white shadow'
                      : 'text-trakend-text-secondary hover:bg-trakend-surface-light hover:text-trakend-text-primary'
                  )
                }
              >
                <span className="flex-shrink-0">{item.icon}</span>
                <span>{item.label}</span>
              </NavLink>
            </li>
          ))}
        </ul>
      </nav>

      {/* Footer Status */}
      <div className="border-t border-trakend-border p-3">
        <div className="flex items-center gap-2 text-xs text-trakend-text-secondary">
          <span
            className={clsx(
              'w-2 h-2 rounded-full flex-shrink-0',
              connected ? 'bg-trakend-success animate-pulse' : reconnecting ? 'bg-trakend-warning animate-pulse' : 'bg-trakend-error'
            )}
          />
          <span className="truncate">
            {connected ? systemStats?.hostname || 'System online' : reconnecting ? 'Reconnecting…' : 'Disconnected'}
          </span>
        </div>
        {systemStats?.os && <div className="mt-1 text-[10px] text-trakend-text-muted truncate pl-4">{systemStats.os}</div>}
      </div>
    </aside>
  )
}

export default Sidebar
