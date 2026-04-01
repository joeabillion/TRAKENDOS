import React, { useEffect, useState } from 'react'
import { Send, Zap, Search, Cpu, Trash2, AlertCircle } from 'lucide-react'
import { useMaya, MayaStatus } from '../../hooks/useMaya'
import { useWebSocket } from '../../context/WebSocketContext'
import { formatRelativeTime } from '../../utils/formatters'
import { GaugeChart } from '../common/GaugeChart'

export const MayaPage: React.FC = () => {
  const { getStatus, investigate, deepScan, optimize, findDuplicates, chat } = useMaya()
  const { mayaNotifications } = useWebSocket()
  const [mayaStatus, setMayaStatus] = useState<MayaStatus | null>(null)
  const [loading, setLoading] = useState(false)
  const [chatMessage, setChatMessage] = useState('')
  const [chatHistory, setChatHistory] = useState<Array<{ role: 'user' | 'maya'; message: string }>>([])

  // Load Maya status
  useEffect(() => {
    const loadStatus = async () => {
      const status = await getStatus()
      setMayaStatus(status)
    }
    loadStatus()
    const interval = setInterval(loadStatus, 5000)
    return () => clearInterval(interval)
  }, [getStatus])

  const handleAction = async (action: () => Promise<any>) => {
    setLoading(true)
    try {
      const result = await action()
      if (result) {
        // Show toast or notification
      }
    } finally {
      setLoading(false)
    }
  }

  const handleSendMessage = async () => {
    if (!chatMessage.trim()) return

    const userMsg = chatMessage
    setChatMessage('')
    setChatHistory((prev) => [...prev, { role: 'user', message: userMsg }])

    try {
      const response = await chat(userMsg)
      setChatHistory((prev) => [...prev, { role: 'maya', message: response }])
    } catch (error) {
      console.error('Chat error:', error)
    }
  }

  return (
    <div className="flex-1 bg-trakend-dark h-screen flex flex-col overflow-hidden">
      <div className="flex h-full gap-4 overflow-hidden">
        {/* Left Panel - Controls & Status */}
        <div className="w-80 bg-trakend-surface border-r border-trakend-border flex flex-col overflow-hidden">
          {/* Header */}
          <div className="border-b border-trakend-border p-6">
            <div className="flex items-center gap-3 mb-4">
              <Zap size={24} className="text-trakend-accent" />
              <h1 className="text-2xl font-bold text-trakend-text-primary">Maya AI</h1>
            </div>
            <p className="text-sm text-trakend-text-secondary">Intelligent system management assistant</p>
          </div>

          {/* Status Card */}
          {mayaStatus && (
            <div className="p-4 border-b border-trakend-border">
              <div className="flex items-center justify-between mb-4">
                <span className="text-sm text-trakend-text-secondary uppercase tracking-wide">Status</span>
                <div className="flex items-center gap-2">
                  <div
                    className={`w-2 h-2 rounded-full ${
                      mayaStatus.online ? 'bg-trakend-success animate-pulse' : 'bg-trakend-error'
                    }`}
                  ></div>
                  <span className={mayaStatus.online ? 'text-trakend-success' : 'text-trakend-error'}>
                    {mayaStatus.online ? 'Online' : 'Offline'}
                  </span>
                </div>
              </div>

              <div className="flex flex-col items-center mb-4">
                <div className="relative w-32 h-32">
                  <GaugeChart value={mayaStatus.healthScore} max={100} size={128} color="#ff6b35" />
                </div>
              </div>

              {mayaStatus.currentTask && (
                <div className="bg-trakend-dark rounded p-3 text-xs">
                  <div className="text-trakend-text-secondary mb-1">Current Task</div>
                  <div className="text-trakend-text-primary font-semibold mb-2">{mayaStatus.currentTask.type}</div>
                  <div className="w-full h-2 bg-trakend-border rounded-full overflow-hidden">
                    <div
                      className="h-full bg-trakend-accent transition-all duration-300"
                      style={{ width: `${mayaStatus.currentTask.progress}%` }}
                    ></div>
                  </div>
                  <div className="text-trakend-text-secondary mt-2 text-right">
                    {mayaStatus.currentTask.progress}%
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Action Buttons */}
          <div className="p-4 border-b border-trakend-border space-y-2 flex-shrink-0">
            <button
              onClick={() => handleAction(investigate)}
              disabled={loading}
              className="w-full flex items-center gap-2 px-4 py-2 rounded-lg bg-trakend-dark text-trakend-text-secondary hover:text-trakend-text-primary hover:bg-trakend-surface-light transition-colors disabled:opacity-50 text-sm"
            >
              <AlertCircle size={16} />
              Investigate
            </button>
            <button
              onClick={() => handleAction(deepScan)}
              disabled={loading}
              className="w-full flex items-center gap-2 px-4 py-2 rounded-lg bg-trakend-dark text-trakend-text-secondary hover:text-trakend-text-primary hover:bg-trakend-surface-light transition-colors disabled:opacity-50 text-sm"
            >
              <Search size={16} />
              Deep Scan
            </button>
            <button
              onClick={() => handleAction(optimize)}
              disabled={loading}
              className="w-full flex items-center gap-2 px-4 py-2 rounded-lg bg-trakend-dark text-trakend-text-secondary hover:text-trakend-text-primary hover:bg-trakend-surface-light transition-colors disabled:opacity-50 text-sm"
            >
              <Cpu size={16} />
              Optimize
            </button>
            <button
              onClick={() => handleAction(findDuplicates)}
              disabled={loading}
              className="w-full flex items-center gap-2 px-4 py-2 rounded-lg bg-trakend-dark text-trakend-text-secondary hover:text-trakend-text-primary hover:bg-trakend-surface-light transition-colors disabled:opacity-50 text-sm"
            >
              <Trash2 size={16} />
              Find Duplicates
            </button>
          </div>

          {/* Notifications */}
          <div className="flex-1 overflow-y-auto p-4">
            <h3 className="text-sm font-semibold text-trakend-text-secondary uppercase tracking-wide mb-3">
              Notifications
            </h3>
            <div className="space-y-2">
              {mayaNotifications.slice(0, 5).map((notif) => (
                <div key={notif.id} className={`p-2 rounded text-xs badge ${notif.type === 'error' ? 'badge-error' : 'badge-info'}`}>
                  <div className="font-semibold">{notif.title}</div>
                  <div className="text-xs mt-1">{notif.message}</div>
                  <div className="text-xs mt-1">{formatRelativeTime(new Date(notif.timestamp))}</div>
                </div>
              ))}
              {mayaNotifications.length === 0 && (
                <div className="text-center py-8 text-trakend-text-secondary">
                  <div className="text-2xl mb-2">✓</div>
                  <p className="text-xs">All clear!</p>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Right Panel - Chat */}
        <div className="flex-1 flex flex-col overflow-hidden">
          {/* Chat History */}
          <div className="flex-1 overflow-y-auto p-6 space-y-4">
            {chatHistory.length === 0 ? (
              <div className="flex items-center justify-center h-full">
                <div className="text-center">
                  <Zap size={48} className="text-trakend-accent mx-auto mb-4 opacity-50" />
                  <h2 className="text-xl font-semibold text-trakend-text-primary mb-2">Start a Conversation</h2>
                  <p className="text-trakend-text-secondary">Ask Maya for help managing your system</p>
                </div>
              </div>
            ) : (
              chatHistory.map((msg, i) => (
                <div key={i} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                  <div
                    className={`max-w-sm px-4 py-3 rounded-lg ${
                      msg.role === 'user'
                        ? 'bg-trakend-accent text-white'
                        : 'bg-trakend-surface text-trakend-text-primary border border-trakend-border'
                    }`}
                  >
                    <p className="text-sm">{msg.message}</p>
                  </div>
                </div>
              ))
            )}
          </div>

          {/* Chat Input */}
          <div className="border-t border-trakend-border bg-trakend-surface p-4">
            <div className="flex gap-3">
              <input
                type="text"
                value={chatMessage}
                onChange={(e) => setChatMessage(e.target.value)}
                onKeyPress={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault()
                    handleSendMessage()
                  }
                }}
                placeholder="Ask Maya something..."
                className="flex-1 bg-trakend-dark border border-trakend-border rounded-lg px-4 py-2 text-trakend-text-primary placeholder-trakend-text-secondary focus:outline-none focus:border-trakend-accent"
              />
              <button
                onClick={handleSendMessage}
                disabled={!chatMessage.trim()}
                className="px-4 py-2 rounded-lg bg-trakend-accent text-white hover:bg-trakend-accent-dark transition-colors disabled:opacity-50 flex items-center gap-2"
              >
                <Send size={16} />
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
