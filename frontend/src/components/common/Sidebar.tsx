import React from 'react'
import { Link, useLocation } from 'react-router-dom'
import {
  LayoutDashboard,
  HardDrive,
  Container,
  Database,
  FolderOpen,
  Terminal,
  ScrollText,
  Zap,
  Settings,
  AlertCircle,
} from 'lucide-react'
import clsx from 'clsx'

interface NavItem {
  path: string
  label: string
  icon: React.ReactNode
}

const navItems: NavItem[] = [
  { path: '/', label: 'Dashboard', icon: <LayoutDashboard size={20} /> },
  { path: '/array', label: 'Array', icon: <HardDrive size={20} /> },
  { path: '/docker', label: 'Docker', icon: <Container size={20} /> },
  { path: '/database', label: 'Database', icon: <Database size={20} /> },
  { path: '/files', label: 'Files', icon: <FolderOpen size={20} /> },
  { path: '/terminal', label: 'Terminal', icon: <Terminal size={20} /> },
  { path: '/logs', label: 'Logs', icon: <ScrollText size={20} /> },
  { path: '/maya', label: 'Maya AI', icon: <Zap size={20} /> },
  { path: '/settings', label: 'Settings', icon: <Settings size={20} /> },
]

export const Sidebar: React.FC = () => {
  const location = useLocation()

  return (
    <aside className="w-64 bg-trakend-surface border-r border-trakend-border h-screen flex flex-col">
      {/* Logo */}
      <div className="p-6 border-b border-trakend-border">
        <div className="flex items-center gap-3">
          <img
            src="/logo/icon.png"
            alt="Trakend OS"
            className="w-8 h-8 object-contain"
            onError={(e) => {
              const target = e.target as HTMLImageElement
              if (target.src.endsWith('.png')) {
                target.src = '/logo/icon.svg'
              } else {
                // Fallback to styled letter
                target.style.display = 'none'
                const fallback = target.parentElement?.querySelector('.icon-fallback') as HTMLElement
                if (fallback) fallback.style.display = 'flex'
              }
            }}
          />
          <div className="icon-fallback hidden w-8 h-8 rounded items-center justify-center"
            style={{ background: 'linear-gradient(135deg, var(--color-accent), var(--color-accent-dark))' }}>
            <span className="text-white font-bold">T</span>
          </div>
          <h1 className="text-xl font-bold text-trakend-text-primary">Trakend OS</h1>
        </div>
      </div>

      {/* Navigation */}
      <nav className="flex-1 overflow-y-auto py-4">
        <ul className="space-y-2 px-3">
          {navItems.map((item) => (
            <li key={item.path}>
              <Link
                to={item.path}
                className={clsx(
                  'flex items-center gap-3 px-4 py-3 rounded-lg transition-all duration-200',
                  location.pathname === item.path
                    ? 'bg-trakend-accent text-white shadow-lg'
                    : 'text-trakend-text-secondary hover:bg-trakend-surface-light hover:text-trakend-text-primary'
                )}
              >
                {item.icon}
                <span className="text-sm font-medium">{item.label}</span>
              </Link>
            </li>
          ))}
        </ul>
      </nav>

      {/* Footer Status */}
      <div className="border-t border-trakend-border p-4">
        <div className="flex items-center gap-2 text-xs text-trakend-text-secondary">
          <div className="w-2 h-2 bg-trakend-success rounded-full animate-pulse"></div>
          <span>System Online</span>
        </div>
      </div>
    </aside>
  )
}
