import { useCallback, useState } from 'react'
import api from '../utils/api'

export interface DatabaseInfo {
  name: string
  tables: number
}

export interface TableSchema {
  name: string
  columns: ColumnInfo[]
  indexes: IndexInfo[]
}

export interface ColumnInfo {
  name: string
  type: string
  nullable: boolean
  defaultValue: string | null
  key: string
  extra: string
}

export interface IndexInfo {
  name: string
  columns: string[]
  unique: boolean
  primary: boolean
}

export interface QueryResult {
  columns: string[]
  rows: Record<string, unknown>[]
  affectedRows?: number
  lastInsertId?: number
}

export interface TableData {
  schema: TableSchema
  data: Record<string, unknown>[]
  totalRows: number
}

export interface ServerStatus {
  version: string
  uptime: number
  connections: number
  maxConnections: number
  queriesPerSecond: number
  threadsConnected: number
  threadsRunning: number
}

export interface MySQLUser {
  user: string
  host: string
}

export interface ProcessListItem {
  id: number
  user: string
  host: string
  db: string | null
  command: string
  time: number
  state: string | null
  info: string | null
}

export const useMysql = () => {
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Server operations
  const getServerStatus = useCallback(async (): Promise<ServerStatus | null> => {
    setLoading(true)
    setError(null)
    try {
      const response = await api.get('/mysql/server/status')
      const d = response.data
      return {
        version: d.version || 'MariaDB',
        uptime: d.uptime || 0,
        connections: d.connections || 0,
        maxConnections: d.maxConnections || d.connections || 0,
        queriesPerSecond: d.questions && d.uptime ? d.questions / d.uptime : 0,
        threadsConnected: d.connections || 0,
        threadsRunning: d.threads || 0,
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to fetch server status'
      setError(message)
      return null
    } finally {
      setLoading(false)
    }
  }, [])

  const startServer = useCallback(async (): Promise<boolean> => {
    setLoading(true)
    setError(null)
    try {
      await api.post('/mysql/server/start')
      return true
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to start server'
      setError(message)
      return false
    } finally {
      setLoading(false)
    }
  }, [])

  const stopServer = useCallback(async (): Promise<boolean> => {
    setLoading(true)
    setError(null)
    try {
      await api.post('/mysql/server/stop')
      return true
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to stop server'
      setError(message)
      return false
    } finally {
      setLoading(false)
    }
  }, [])

  const restartServer = useCallback(async (): Promise<boolean> => {
    setLoading(true)
    setError(null)
    try {
      await api.post('/mysql/server/restart')
      return true
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to restart server'
      setError(message)
      return false
    } finally {
      setLoading(false)
    }
  }, [])

  // Database operations
  const listDatabases = useCallback(async (): Promise<DatabaseInfo[]> => {
    setLoading(true)
    setError(null)
    try {
      const response = await api.get('/mysql/databases')
      return response.data
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to fetch databases'
      setError(message)
      return []
    } finally {
      setLoading(false)
    }
  }, [])

  const createDatabase = useCallback(async (name: string, charset = 'utf8mb4'): Promise<boolean> => {
    setLoading(true)
    setError(null)
    try {
      await api.post('/mysql/databases', { name, charset })
      return true
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to create database'
      setError(message)
      return false
    } finally {
      setLoading(false)
    }
  }, [])

  const dropDatabase = useCallback(async (name: string): Promise<boolean> => {
    setLoading(true)
    setError(null)
    try {
      await api.delete(`/database/databases/${name}`)
      return true
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to drop database'
      setError(message)
      return false
    } finally {
      setLoading(false)
    }
  }, [])

  // Table operations
  const listTables = useCallback(async (database: string): Promise<string[]> => {
    setLoading(true)
    setError(null)
    try {
      const response = await api.get(`/database/databases/${database}/tables`)
      return response.data
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to fetch tables'
      setError(message)
      return []
    } finally {
      setLoading(false)
    }
  }, [])

  const getTableSchema = useCallback(async (database: string, table: string): Promise<TableSchema | null> => {
    setLoading(true)
    setError(null)
    try {
      const response = await api.get(`/database/databases/${database}/tables/${table}/schema`)
      return response.data
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to fetch table schema'
      setError(message)
      return null
    } finally {
      setLoading(false)
    }
  }, [])

  const getTableData = useCallback(
    async (database: string, table: string, limit = 100, offset = 0): Promise<TableData | null> => {
      setLoading(true)
      setError(null)
      try {
        const response = await api.get(`/database/databases/${database}/tables/${table}/data`, {
          params: { limit, offset },
        })
        return response.data
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Failed to fetch table data'
        setError(message)
        return null
      } finally {
        setLoading(false)
      }
    },
    []
  )

  // Query operations
  const executeQuery = useCallback(async (database: string, query: string): Promise<QueryResult | null> => {
    setLoading(true)
    setError(null)
    try {
      const response = await api.post('/mysql/query', { database, sql: query })
      return response.data
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Query execution failed'
      setError(message)
      return null
    } finally {
      setLoading(false)
    }
  }, [])

  // User operations
  const listUsers = useCallback(async (): Promise<MySQLUser[]> => {
    setLoading(true)
    setError(null)
    try {
      const response = await api.get('/mysql/users')
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
    async (username: string, host: string, password: string): Promise<boolean> => {
      setLoading(true)
      setError(null)
      try {
        await api.post('/mysql/users', { user: username, host, password })
        return true
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Failed to create user'
        setError(message)
        return false
      } finally {
        setLoading(false)
      }
    },
    []
  )

  const dropUser = useCallback(async (username: string, host: string): Promise<boolean> => {
    setLoading(true)
    setError(null)
    try {
      // Use encodeURIComponent to safely encode the user@host portion of the URL
      const encodedUser = encodeURIComponent(`${username}@${host}`)
      await api.delete(`/database/users/${encodedUser}`)
      return true
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to drop user'
      setError(message)
      return false
    } finally {
      setLoading(false)
    }
  }, [])

  const getGrants = useCallback(async (username: string, host: string): Promise<string[]> => {
    setLoading(true)
    setError(null)
    try {
      // Use encodeURIComponent to safely encode the user@host portion of the URL
      const encodedUser = encodeURIComponent(`${username}@${host}`)
      const response = await api.get(`/database/users/${encodedUser}/grants`)
      return response.data
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to fetch grants'
      setError(message)
      return []
    } finally {
      setLoading(false)
    }
  }, [])

  // Process operations
  const getProcessList = useCallback(async (): Promise<ProcessListItem[]> => {
    setLoading(true)
    setError(null)
    try {
      const response = await api.get('/mysql/processes')
      return response.data
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to fetch process list'
      setError(message)
      return []
    } finally {
      setLoading(false)
    }
  }, [])

  const killProcess = useCallback(async (id: number): Promise<boolean> => {
    setLoading(true)
    setError(null)
    try {
      await api.post(`/database/processes/${id}/kill`)
      return true
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to kill process'
      setError(message)
      return false
    } finally {
      setLoading(false)
    }
  }, [])

  return {
    loading,
    error,
    getServerStatus,
    startServer,
    stopServer,
    restartServer,
    listDatabases,
    createDatabase,
    dropDatabase,
    listTables,
    getTableSchema,
    getTableData,
    executeQuery,
    listUsers,
    createUser,
    dropUser,
    getGrants,
    getProcessList,
    killProcess,
  }
}
