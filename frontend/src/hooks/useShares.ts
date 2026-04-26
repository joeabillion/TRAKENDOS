import { useCallback, useState } from 'react'
import api from '../utils/api'

export interface ShareUser {
  id: number
  username: string
  homeDir: string
  enabled: boolean
  createdAt: string
  updatedAt: string
}

export interface SambaShare {
  id: number
  name: string
  path: string
  comment: string
  browseable: boolean
  readOnly: boolean
  guestOk: boolean
  validUsers: string[]
  writableUsers: string[]
  createdAt: string
  updatedAt: string
}

export interface SambaStatus {
  installed: boolean
  running: boolean
  version: string
  connections: number
}

export interface SambaConnection {
  pid: number
  username: string
  group: string
  machine: string
  protocol: string
  connectedAt: string
}

export const useShares = () => {
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Status operations
  const getStatus = useCallback(async (): Promise<SambaStatus | null> => {
    setLoading(true)
    setError(null)
    try {
      const response = await api.get('/shares/status')
      return response.data
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to fetch Samba status'
      setError(message)
      return null
    } finally {
      setLoading(false)
    }
  }, [])

  const startSamba = useCallback(async (): Promise<boolean> => {
    setLoading(true)
    setError(null)
    try {
      await api.post('/shares/start')
      return true
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to start Samba'
      setError(message)
      return false
    } finally {
      setLoading(false)
    }
  }, [])

  const stopSamba = useCallback(async (): Promise<boolean> => {
    setLoading(true)
    setError(null)
    try {
      await api.post('/shares/stop')
      return true
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to stop Samba'
      setError(message)
      return false
    } finally {
      setLoading(false)
    }
  }, [])

  const restartSamba = useCallback(async (): Promise<boolean> => {
    setLoading(true)
    setError(null)
    try {
      await api.post('/shares/restart')
      return true
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to restart Samba'
      setError(message)
      return false
    } finally {
      setLoading(false)
    }
  }, [])

  // User operations
  const getUsers = useCallback(async (): Promise<ShareUser[]> => {
    setLoading(true)
    setError(null)
    try {
      const response = await api.get('/shares/users')
      return response.data
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to fetch users'
      setError(message)
      return []
    } finally {
      setLoading(false)
    }
  }, [])

  const createUser = useCallback(
    async (username: string, password: string, homeDir?: string): Promise<ShareUser | null> => {
      setLoading(true)
      setError(null)
      try {
        const response = await api.post('/shares/users', { username, password, homeDir })
        return response.data
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Failed to create user'
        setError(message)
        return null
      } finally {
        setLoading(false)
      }
    },
    []
  )

  const updateUserPassword = useCallback(async (username: string, password: string): Promise<boolean> => {
    setLoading(true)
    setError(null)
    try {
      await api.put(`/shares/users/${username}/password`, { password })
      return true
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to update password'
      setError(message)
      return false
    } finally {
      setLoading(false)
    }
  }, [])

  const toggleUser = useCallback(async (username: string, enabled: boolean): Promise<boolean> => {
    setLoading(true)
    setError(null)
    try {
      await api.put(`/shares/users/${username}/toggle`, { enabled })
      return true
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to toggle user'
      setError(message)
      return false
    } finally {
      setLoading(false)
    }
  }, [])

  const deleteUser = useCallback(async (username: string): Promise<boolean> => {
    setLoading(true)
    setError(null)
    try {
      await api.delete(`/shares/users/${username}`)
      return true
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to delete user'
      setError(message)
      return false
    } finally {
      setLoading(false)
    }
  }, [])

  // Share operations
  const getShares = useCallback(async (): Promise<SambaShare[]> => {
    setLoading(true)
    setError(null)
    try {
      const response = await api.get('/shares/list')
      return response.data
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to fetch shares'
      setError(message)
      return []
    } finally {
      setLoading(false)
    }
  }, [])

  const createShare = useCallback(
    async (options: {
      name: string
      path: string
      comment?: string
      browseable?: boolean
      readOnly?: boolean
      guestOk?: boolean
      validUsers?: string[]
      writableUsers?: string[]
    }): Promise<SambaShare | null> => {
      setLoading(true)
      setError(null)
      try {
        const response = await api.post('/shares/create', options)
        return response.data
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Failed to create share'
        setError(message)
        return null
      } finally {
        setLoading(false)
      }
    },
    []
  )

  const updateShare = useCallback(
    async (
      name: string,
      updates: Partial<{
        path: string
        comment: string
        browseable: boolean
        readOnly: boolean
        guestOk: boolean
        validUsers: string[]
        writableUsers: string[]
      }>
    ): Promise<SambaShare | null> => {
      setLoading(true)
      setError(null)
      try {
        const response = await api.put(`/shares/${name}`, updates)
        return response.data
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Failed to update share'
        setError(message)
        return null
      } finally {
        setLoading(false)
      }
    },
    []
  )

  const deleteShare = useCallback(async (name: string): Promise<boolean> => {
    setLoading(true)
    setError(null)
    try {
      await api.delete(`/shares/${name}`)
      return true
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to delete share'
      setError(message)
      return false
    } finally {
      setLoading(false)
    }
  }, [])

  const getConnections = useCallback(async (): Promise<SambaConnection[]> => {
    setLoading(true)
    setError(null)
    try {
      const response = await api.get('/shares/connections')
      return response.data || []
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to fetch connections'
      setError(message)
      return []
    } finally {
      setLoading(false)
    }
  }, [])

  return {
    loading,
    error,
    getStatus,
    startSamba,
    stopSamba,
    restartSamba,
    getUsers,
    createUser,
    updateUserPassword,
    toggleUser,
    deleteUser,
    getShares,
    createShare,
    updateShare,
    deleteShare,
    getConnections,
  }
}
