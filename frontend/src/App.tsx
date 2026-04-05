import React, { useState, useEffect } from 'react'
import { BrowserRouter as Router, Routes, Route } from 'react-router-dom'
import { ThemeProvider } from './context/ThemeContext'
import { WebSocketProvider } from './context/WebSocketContext'
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
import { BootScreen } from './components/auth/BootScreen'
import { LoginPage } from './components/auth/LoginPage'
import api from './utils/api'

type AppState = 'booting' | 'login' | 'authenticated'

function AppLayout() {
  return (
    <div className="flex h-screen bg-trakend-dark overflow-hidden">
      <Sidebar />
      <div className="flex-1 flex flex-col overflow-hidden">
        <TopBar />
        <main className="flex-1 overflow-auto flex flex-col min-w-0">
          <Routes>
            <Route path="/" element={<Dashboard />} />
            <Route path="/array" element={<ArrayPage />} />
            <Route path="/docker" element={<DockerPage />} />
            <Route path="/database" element={<DatabasePage />} />
            <Route path="/files" element={<FileBrowserPage />} />
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
  const [token, setToken] = useState<string | null>(null)

  // Check for existing session on mount
  useEffect(() => {
    const savedToken = localStorage.getItem('auth-token')
    if (savedToken) {
      setToken(savedToken)
      api.defaults.headers.common['Authorization'] = `Bearer ${savedToken}`
    }
  }, [])

  const handleBootComplete = () => {
    // After boot, check if we have a valid token
    const savedToken = localStorage.getItem('auth-token')
    if (savedToken) {
      setToken(savedToken)
      setAppState('authenticated')
    } else {
      setAppState('login')
    }
  }

  const handleLogin = async (username: string, password: string) => {
    try {
      const response = await api.post('/auth/login', { username, password })
      const newToken = response.data.token
      setToken(newToken)
      localStorage.setItem('auth-token', newToken)
      // Set token on api instance
      api.defaults.headers.common['Authorization'] = `Bearer ${newToken}`
      setAppState('authenticated')
    } catch (err: any) {
      throw new Error(err?.response?.data?.message || 'Authentication failed')
    }
  }

  return (
    <ThemeProvider>
      {appState === 'booting' && <BootScreen onBootComplete={handleBootComplete} />}

      {appState === 'login' && <LoginPage onLogin={handleLogin} />}

      {appState === 'authenticated' && (
        <WebSocketProvider>
          <Router>
            <AppLayout />
          </Router>
        </WebSocketProvider>
      )}
    </ThemeProvider>
  )
}
