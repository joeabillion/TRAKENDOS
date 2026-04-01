import { useCallback, useState } from 'react'
import api from '../utils/api'

export interface Container {
  id: string
  name: string
  image: string
  status: string
  cpuUsage: number
  memoryUsage: number
  ports: Array<{
    containerPort: number
    hostPort: number
    protocol: string
  }>
  uptime: number
  created: string
}

export interface ContainerStats {
  cpuUsage: number
  memoryUsage: number
  networkRx: number
  networkTx: number
}

export const useDocker = () => {
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const getContainers = useCallback(async (): Promise<Container[]> => {
    setLoading(true)
    setError(null)
    try {
      const response = await api.get('/docker/containers')
      return response.data
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to fetch containers'
      setError(message)
      return []
    } finally {
      setLoading(false)
    }
  }, [])

  const getContainerStats = useCallback(async (containerId: string): Promise<ContainerStats | null> => {
    try {
      const response = await api.get(`/docker/containers/${containerId}/stats`)
      return response.data
    } catch (err) {
      console.error('Failed to fetch container stats:', err)
      return null
    }
  }, [])

  const startContainer = useCallback(async (containerId: string): Promise<boolean> => {
    setLoading(true)
    setError(null)
    try {
      await api.post(`/docker/containers/${containerId}/start`)
      return true
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to start container'
      setError(message)
      return false
    } finally {
      setLoading(false)
    }
  }, [])

  const stopContainer = useCallback(async (containerId: string): Promise<boolean> => {
    setLoading(true)
    setError(null)
    try {
      await api.post(`/docker/containers/${containerId}/stop`)
      return true
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to stop container'
      setError(message)
      return false
    } finally {
      setLoading(false)
    }
  }, [])

  const restartContainer = useCallback(async (containerId: string): Promise<boolean> => {
    setLoading(true)
    setError(null)
    try {
      await api.post(`/docker/containers/${containerId}/restart`)
      return true
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to restart container'
      setError(message)
      return false
    } finally {
      setLoading(false)
    }
  }, [])

  const removeContainer = useCallback(async (containerId: string): Promise<boolean> => {
    setLoading(true)
    setError(null)
    try {
      await api.delete(`/docker/containers/${containerId}`)
      return true
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to remove container'
      setError(message)
      return false
    } finally {
      setLoading(false)
    }
  }, [])

  const getLogs = useCallback(async (containerId: string, lines = 100): Promise<string> => {
    try {
      const response = await api.get(`/docker/containers/${containerId}/logs?lines=${lines}`)
      return response.data.logs || ''
    } catch (err) {
      console.error('Failed to fetch logs:', err)
      return ''
    }
  }, [])

  return {
    loading,
    error,
    getContainers,
    getContainerStats,
    startContainer,
    stopContainer,
    restartContainer,
    removeContainer,
    getLogs,
  }
}
