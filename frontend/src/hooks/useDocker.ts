import { useCallback, useState } from 'react'
import api from '../utils/api'

export interface Container {
  id: string
  name: string
  image: string
  state: string
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

export interface DockerImage {
  id: string
  repoTags: string[]
  size: number
  created: number
  virtualSize?: number
  dangling?: boolean
  containersUsing?: number
}

export interface DockerNetwork {
  name: string
  id: string
  driver: string
  scope: string
  containers: Record<string, any>
  options: Record<string, string>
}

export interface DockerVolume {
  name: string
  driver: string
  mountpoint: string
  labels: Record<string, string>
  options: Record<string, string>
  containersUsing?: number
}

export interface DockerSettings {
  daemonConfig: Record<string, any>
  storageUsage: {
    imagesSize: number
    containersSize: number
    volumesSize: number
    buildCacheSize: number
  }
  dataRoot: string
}

export const useDocker = () => {
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const getContainers = useCallback(async (): Promise<Container[]> => {
    setLoading(true)
    setError(null)
    try {
      const response = await api.get('/docker/containers?all=true')
      return (response.data || []).map((c: any) => ({
        id: c.id,
        name: c.name,
        image: c.image,
        state: c.state || 'unknown',
        status: c.status || c.state || 'unknown',
        cpuUsage: c.cpuUsage || 0,
        memoryUsage: c.memoryUsage || 0,
        ports: (c.ports || []).map((p: any) => ({
          containerPort: p.privatePort || p.containerPort || 0,
          hostPort: p.publicPort || p.hostPort || 0,
          protocol: p.type || p.protocol || 'tcp',
        })),
        uptime: c.startedAt || c.uptime || 0,
        created: c.created ? new Date(c.created).toISOString() : '',
      }))
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
      await api.post(`/docker/containers/${containerId}/remove`, { force: true })
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

  const getSettings = useCallback(async (): Promise<DockerSettings | null> => {
    try {
      const response = await api.get('/docker/settings')
      return response.data
    } catch (err) {
      console.error('Failed to fetch settings:', err)
      return null
    }
  }, [])

  const updateSettings = useCallback(async (settings: any): Promise<boolean> => {
    setLoading(true)
    setError(null)
    try {
      await api.put('/docker/settings', settings)
      return true
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to update settings'
      setError(message)
      return false
    } finally {
      setLoading(false)
    }
  }, [])

  const getImages = useCallback(async (): Promise<DockerImage[]> => {
    try {
      const response = await api.get('/docker/images')
      return response.data || []
    } catch (err) {
      console.error('Failed to fetch images:', err)
      return []
    }
  }, [])

  const removeImage = useCallback(async (imageId: string, force = false): Promise<boolean> => {
    setLoading(true)
    setError(null)
    try {
      await api.delete(`/docker/images/${imageId}?force=${force}`)
      return true
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to remove image'
      setError(message)
      return false
    } finally {
      setLoading(false)
    }
  }, [])

  const getNetworks = useCallback(async (): Promise<DockerNetwork[]> => {
    try {
      const response = await api.get('/docker/networks')
      return response.data || []
    } catch (err) {
      console.error('Failed to fetch networks:', err)
      return []
    }
  }, [])

  const getVolumes = useCallback(async (): Promise<DockerVolume[]> => {
    try {
      const response = await api.get('/docker/volumes')
      return response.data || []
    } catch (err) {
      console.error('Failed to fetch volumes:', err)
      return []
    }
  }, [])

  const removeVolume = useCallback(async (volumeName: string): Promise<boolean> => {
    setLoading(true)
    setError(null)
    try {
      await api.delete(`/docker/volumes/${volumeName}`)
      return true
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to remove volume'
      setError(message)
      return false
    } finally {
      setLoading(false)
    }
  }, [])

  const forceRemoveContainer = useCallback(async (containerId: string): Promise<boolean> => {
    setLoading(true)
    setError(null)
    try {
      await api.post(`/docker/containers/${containerId}/force-remove`)
      return true
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to force remove container'
      setError(message)
      return false
    } finally {
      setLoading(false)
    }
  }, [])

  const migrateStorage = useCallback(
    async (newPath: string, onProgress?: (message: string) => void): Promise<boolean> => {
      setLoading(true)
      setError(null)
      try {
        const response = await fetch('/api/docker/storage/migrate', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${localStorage.getItem('token') || ''}`,
          },
          body: JSON.stringify({ newPath }),
        })

        if (!response.ok) {
          throw new Error('Migration failed')
        }

        const reader = response.body?.getReader()
        if (!reader) throw new Error('No response body')

        const decoder = new TextDecoder()
        let buffer = ''

        while (true) {
          const { done, value } = await reader.read()
          if (done) break

          buffer += decoder.decode(value, { stream: true })
          const lines = buffer.split('\n')
          buffer = lines.pop() || ''

          for (const line of lines) {
            if (line.startsWith('data: ')) {
              const data = JSON.parse(line.slice(6))
              if (onProgress) {
                onProgress(data.message)
              }
            }
          }
        }

        setLoading(false)
        return true
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Failed to migrate storage'
        setError(message)
        setLoading(false)
        return false
      }
    },
    []
  )

  const fullBackup = useCallback(
    async (destPath = '/data/backups/docker/', onProgress?: (message: string) => void): Promise<boolean> => {
      setLoading(true)
      setError(null)
      try {
        const response = await fetch('/api/docker/backup', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${localStorage.getItem('token') || ''}`,
          },
          body: JSON.stringify({ destPath }),
        })

        if (!response.ok) {
          throw new Error('Backup failed')
        }

        const reader = response.body?.getReader()
        if (!reader) throw new Error('No response body')

        const decoder = new TextDecoder()
        let buffer = ''

        while (true) {
          const { done, value } = await reader.read()
          if (done) break

          buffer += decoder.decode(value, { stream: true })
          const lines = buffer.split('\n')
          buffer = lines.pop() || ''

          for (const line of lines) {
            if (line.startsWith('data: ')) {
              const data = JSON.parse(line.slice(6))
              if (data.complete) {
                setLoading(false)
                return true
              } else if (onProgress) {
                onProgress(data.message)
              }
            }
          }
        }

        setLoading(false)
        return true
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Failed to create backup'
        setError(message)
        setLoading(false)
        return false
      }
    },
    []
  )

  const fullRestore = useCallback(
    async (backupPath: string, onProgress?: (message: string) => void): Promise<boolean> => {
      setLoading(true)
      setError(null)
      try {
        const response = await fetch('/api/docker/restore', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${localStorage.getItem('token') || ''}`,
          },
          body: JSON.stringify({ backupPath }),
        })

        if (!response.ok) {
          throw new Error('Restore failed')
        }

        const reader = response.body?.getReader()
        if (!reader) throw new Error('No response body')

        const decoder = new TextDecoder()
        let buffer = ''

        while (true) {
          const { done, value } = await reader.read()
          if (done) break

          buffer += decoder.decode(value, { stream: true })
          const lines = buffer.split('\n')
          buffer = lines.pop() || ''

          for (const line of lines) {
            if (line.startsWith('data: ')) {
              const data = JSON.parse(line.slice(6))
              if (data.complete) {
                setLoading(false)
                return true
              } else if (onProgress) {
                onProgress(data.message)
              }
            }
          }
        }

        setLoading(false)
        return true
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Failed to restore backup'
        setError(message)
        setLoading(false)
        return false
      }
    },
    []
  )

  const inspectContainer = useCallback(async (containerId: string): Promise<any> => {
    try {
      const response = await api.get(`/docker/containers/${containerId}/inspect`)
      return response.data
    } catch (err) {
      console.error('Failed to inspect container:', err)
      return null
    }
  }, [])

  const execContainer = useCallback(async (containerId: string): Promise<string | null> => {
    try {
      const response = await api.post(`/docker/containers/${containerId}/exec`)
      return response.data.execId
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to create exec session'
      setError(message)
      return null
    }
  }, [])

  const recreateContainer = useCallback(async (containerId: string, config: any): Promise<string | null> => {
    setLoading(true)
    setError(null)
    try {
      const response = await api.post(`/docker/containers/${containerId}/recreate`, { config })
      return response.data.containerId
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to recreate container'
      setError(message)
      return null
    } finally {
      setLoading(false)
    }
  }, [])

  const pruneSystem = useCallback(async (): Promise<boolean> => {
    setLoading(true)
    setError(null)
    try {
      await api.post('/docker/system/prune')
      return true
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to prune system'
      setError(message)
      return false
    } finally {
      setLoading(false)
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
    getSettings,
    updateSettings,
    getImages,
    removeImage,
    getNetworks,
    getVolumes,
    removeVolume,
    forceRemoveContainer,
    migrateStorage,
    fullBackup,
    fullRestore,
    pruneSystem,
    inspectContainer,
    execContainer,
    recreateContainer,
  }
}
