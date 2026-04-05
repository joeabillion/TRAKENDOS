import { useCallback, useState } from 'react'
import api from '../utils/api'

export interface MayaTask {
  id: string
  type: 'investigate' | 'scan' | 'optimize' | 'find-duplicates'
  status: 'pending' | 'running' | 'completed' | 'failed'
  progress: number
  startTime: string
  endTime?: string
  results?: Record<string, unknown>
}

export interface MayaStatus {
  online: boolean
  currentTask: MayaTask | null
  healthScore: number
  lastCheckTime: string
}

export const useMaya = () => {
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const getStatus = useCallback(async (): Promise<MayaStatus | null> => {
    setLoading(true)
    setError(null)
    try {
      const response = await api.get('/maya/status')
      const d = response.data
      return {
        online: d.enabled ?? true,
        currentTask: d.lastAction ? {
          id: d.lastAction.id,
          type: d.lastAction.type,
          status: d.lastAction.status,
          progress: d.lastAction.status === 'completed' ? 100 : 50,
          startTime: new Date(d.lastAction.created_at).toISOString(),
          endTime: d.lastAction.completed_at ? new Date(d.lastAction.completed_at).toISOString() : undefined,
        } : null,
        healthScore: Math.max(0, Math.min(100, 100 - (d.notificationCount || 0) * 10)),
        lastCheckTime: new Date().toISOString(),
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to fetch Maya status'
      setError(message)
      return null
    } finally {
      setLoading(false)
    }
  }, [])

  const investigate = useCallback(async (): Promise<MayaTask | null> => {
    setLoading(true)
    setError(null)
    try {
      const response = await api.post('/maya/investigate')
      return response.data
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to start investigation'
      setError(message)
      return null
    } finally {
      setLoading(false)
    }
  }, [])

  const deepScan = useCallback(async (): Promise<MayaTask | null> => {
    setLoading(true)
    setError(null)
    try {
      const response = await api.post('/maya/scan')
      return response.data
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to start deep scan'
      setError(message)
      return null
    } finally {
      setLoading(false)
    }
  }, [])

  const optimize = useCallback(async (): Promise<MayaTask | null> => {
    setLoading(true)
    setError(null)
    try {
      const response = await api.post('/maya/optimize')
      return response.data
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to start optimization'
      setError(message)
      return null
    } finally {
      setLoading(false)
    }
  }, [])

  const findDuplicates = useCallback(async (): Promise<MayaTask | null> => {
    setLoading(true)
    setError(null)
    try {
      const response = await api.post('/maya/duplicates')
      return response.data
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to start duplicate search'
      setError(message)
      return null
    } finally {
      setLoading(false)
    }
  }, [])

  const chat = useCallback(async (message: string): Promise<string> => {
    try {
      const response = await api.post('/maya/chat', { message }, { timeout: 120000 })
      return response.data.response || ''
    } catch (err) {
      console.error('Failed to send message to Maya:', err)
      return 'Sorry, I encountered an error processing your request. The AI model may be loading — please try again in a moment.'
    }
  }, [])

  return {
    loading,
    error,
    getStatus,
    investigate,
    deepScan,
    optimize,
    findDuplicates,
    chat,
  }
}
