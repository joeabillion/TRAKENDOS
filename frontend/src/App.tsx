import { useState, useEffect, useCallback } from 'react'
import { BrowserRouter as Router, Routes, Route, useLocation } from 'react-router-dom'
import { ThemeProvider } from './context/ThemeContext'
import { WebSocketProvider, useWebSocket } from './context/WebSocketContext'
import { ToastProvider } from './components/common/Toast'
import { ConfirmProvider } from './components/common/ConfirmDialog'
import { Sidebar } from './components/common/Sidebar'
import { TopBar } from './components/common/TopBar'
import { Dashboard } from './components/dashboard/Dashboard'
import { DockerPage } from './components/docker/DockerPage'
import { DatabasePage } from './components/database/DatabasePage'
import { TerminalPage } from './components/terminal/TerminalPage'
import { LogsPage } from './components/logs/LogsPage'
import { MayaPage } from './components/maya/MayaPage'
import { SettingsPage } from './components/settings/SettingsPage'
import ArrayPage from './components/array/ArrayPage'
import { FileBrowserPage } from './components/files/FileBrowserPage'
import { SharesPage } from './components/shares/SharesPage'
import { BootScreen } from './components/auth/BootScreen'
import { LoginPage, LoginResult } from './components/auth/LoginPage'
import api from './utils/api'
import { Loader2, WifiOff } from 'lucide-react'

type AppState = 'booting' | 'login' | 'authenticated'

/** Single app-wide banner shown while the stats socket is down (widgets stay quiet). */
function ConnectionBanner() {
  const { connected, reconnecting, reconnectAttempt, reconnectNow } = useWebSocket()
  if (connected) return null
  return (
    <div className="banner banner-warning" role="status" aria-live="polite">
      {reconnecting ? <Loader2 size={14} className="animate-spin flex-shrink-0" /> : <WifiOff size={14} className="flex-shrink-0" />}
      <span className="flex-1">
        {reconnecting ? 'Reconnecting to server…' : 'Connecting to server…'}
        {reconnectAttempt > 1 && <span className="opacity-75"> (attempt {reconnectAttempt})</span>}
      </span>
      <button onClick={reconnectNow} className="text-xs font-medium underline underline-offset-2 hover:opacity-80 focus-ring rounded">
        Retry now
      </button>
    </div>
  )
}

function AppLayout() {
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const location = useLocation()

  // Close the drawer on navigation (mobile)
  useEffect(() => {
    setSidebarOpen(false)
  }, [location.pathname])

  // Escape closes the drawer
  useEffect(() => {
    if (!sidebarOpen) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setSidebarOpen(false)
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [sidebarOpen])

  return (
    <div className="app-shell">
      {sidebarOpen && <div className="app-sidebar-backdrop lg:hidden" onClick={() => setSidebarOpen(false)} aria-hidden />}
      <Sidebar open={sidebarOpen} onClose={() => setSidebarOpen(false)} />
      <div className="app-main">
        <TopBar onToggleSidebar={() => setSidebarOpen((o) => !o)} />
        <ConnectionBanner />
        <main className="app-content" id="main-content">
          <Routes>
            <Route path="/" element={<Dashboard />} />
            <Route path="/array" element={<ArrayPage />} />
            <Route path="/docker" element={<DockerPage />} />
            <Route path="/database" element={<DatabasePage />} />
            <Route path="/files" element={<FileBrowserPage />} />
            <Route path="/shares" element={<SharesPage />} />
            <Route path="/terminal" element={<TerminalPage />} />
            <Route path="/logs" element={<LogsPage />} />
            <Route path="/maya" element={<MayaPage />} />
            <Route path="/settings" element={<SettingsPage />} />
          </Routes>
        </main>
      </div>
    </div>
  )
}

export default function App() {
  const [appState, setAppState] = useState<AppState>('booting')

  // Check for existing session on mount
  useEffect(() => {
    const savedToken = localStorage.getItem('auth-token')
    if (savedToken) {
      api.defaults.headers.common['Authorization'] = `Bearer ${savedToken}`
    }
  }, [])

  const handleBootComplete = () => {
    const savedToken = localStorage.getItem('auth-token')
    setAppState(savedToken ? 'authenticated' : 'login')
  }

  /**
   * Returns the login payload so the LoginPage can show a
   * "default credentials in use" banner when `mustChangePassword` is set.
   * Call `proceed()` to enter the app.
   */
  const handleLogin = useCallback(async (username: string, password: string): Promise<LoginResult> => {
    try {
      const response = await api.post('/auth/login', { username, password })
      const newToken = response.data.token
      localStorage.setItem('auth-token', newToken)
      api.defaults.headers.common['Authorization'] = `Bearer ${newToken}`
      return {
        mustChangePassword: !!response.data.mustChangePassword,
        proceed: () => setAppState('authenticated'),
      }
    } catch (err: any) {
      throw new Error(err?.response?.data?.message || err?.response?.data?.error || 'Authentication failed')
    }
  }, [])

  return (
    <ThemeProvider>
      <ToastProvider>
        {appState === 'booting' && <BootScreen onBootComplete={handleBootComplete} />}

        {appState === 'login' && <LoginPage onLogin={handleLogin} />}

        {appState === 'authenticated' && (
          <WebSocketProvider>
            <ConfirmProvider>
              <Router>
                <AppLayout />
              </Router>
            </ConfirmProvider>
          </WebSocketProvider>
        )}
      </ToastProvider>
    </ThemeProvider>
  )
}
