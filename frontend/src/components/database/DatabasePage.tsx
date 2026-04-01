import React, { useState, useEffect } from 'react'
import { ChevronDown, ChevronRight, Plus, Play, Download, Trash2, Power, RotateCw, Users, Activity } from 'lucide-react'
import { useMysql, DatabaseInfo, TableSchema, QueryResult, ServerStatus, MySQLUser, ProcessListItem } from '../../hooks/useMysql'

type TabType = 'query' | 'browser' | 'users' | 'status'

interface ExpandedDatabases {
  [key: string]: boolean
}

export const DatabasePage: React.FC = () => {
  const mysql = useMysql()
  const [activeTab, setActiveTab] = useState<TabType>('query')
  const [databases, setDatabases] = useState<DatabaseInfo[]>([])
  const [selectedDatabase, setSelectedDatabase] = useState<string | null>(null)
  const [selectedTable, setSelectedTable] = useState<string | null>(null)
  const [expandedDatabases, setExpandedDatabases] = useState<ExpandedDatabases>({})
  const [dbTables, setDbTables] = useState<{ [key: string]: string[] }>({})
  const [serverStatus, setServerStatus] = useState<ServerStatus | null>(null)
  const [query, setQuery] = useState('SELECT * FROM table_name LIMIT 100;')
  const [queryResult, setQueryResult] = useState<QueryResult | null>(null)
  const [tableSchema, setTableSchema] = useState<TableSchema | null>(null)
  const [tableData, setTableData] = useState<any>(null)
  const [queryHistory, setQueryHistory] = useState<string[]>([])
  const [users, setUsers] = useState<MySQLUser[]>([])
  const [processes, setProcesses] = useState<ProcessListItem[]>([])
  const [showNewDatabaseDialog, setShowNewDatabaseDialog] = useState(false)
  const [newDatabaseName, setNewDatabaseName] = useState('')
  const [newUserForm, setNewUserForm] = useState({ username: '', host: 'localhost', password: '' })
  const [isServerRunning, setIsServerRunning] = useState(false)

  // Load initial data
  useEffect(() => {
    loadDatabases()
    loadServerStatus()
  }, [])

  const loadDatabases = async () => {
    const dbs = await mysql.listDatabases()
    setDatabases(dbs)
    if (dbs.length > 0 && !selectedDatabase) {
      setSelectedDatabase(dbs[0].name)
    }
  }

  const loadServerStatus = async () => {
    const status = await mysql.getServerStatus()
    setServerStatus(status)
    setIsServerRunning(status ? true : false)
  }

  const loadTableList = async (dbName: string) => {
    if (dbTables[dbName]) return
    const tables = await mysql.listTables(dbName)
    setDbTables((prev) => ({ ...prev, [dbName]: tables }))
  }

  const toggleDatabase = async (dbName: string) => {
    setExpandedDatabases((prev) => ({ ...prev, [dbName]: !prev[dbName] }))
    if (!expandedDatabases[dbName]) {
      await loadTableList(dbName)
    }
  }

  const handleDatabaseSelect = (dbName: string) => {
    setSelectedDatabase(dbName)
    if (!expandedDatabases[dbName]) {
      toggleDatabase(dbName)
    }
  }

  const handleTableSelect = async (table: string) => {
    setSelectedTable(table)
    if (selectedDatabase) {
      const schema = await mysql.getTableSchema(selectedDatabase, table)
      setTableSchema(schema)
      const data = await mysql.getTableData(selectedDatabase, table, 100)
      setTableData(data)
      setActiveTab('browser')
    }
  }

  const executeQuery = async () => {
    if (!selectedDatabase) return
    const result = await mysql.executeQuery(selectedDatabase, query)
    if (result) {
      setQueryResult(result)
      setQueryHistory((prev) => [query, ...prev].slice(0, 20))
    }
  }

  const loadUsers = async () => {
    const userList = await mysql.listUsers()
    setUsers(userList)
  }

  const loadProcesses = async () => {
    const processList = await mysql.getProcessList()
    setProcesses(processList)
  }

  const handleServerStart = async () => {
    const success = await mysql.startServer()
    if (success) {
      setIsServerRunning(true)
      await loadServerStatus()
    }
  }

  const handleServerStop = async () => {
    const success = await mysql.stopServer()
    if (success) {
      setIsServerRunning(false)
      await loadServerStatus()
    }
  }

  const handleServerRestart = async () => {
    const success = await mysql.restartServer()
    if (success) {
      await loadServerStatus()
    }
  }

  const handleCreateDatabase = async () => {
    if (newDatabaseName.trim()) {
      const success = await mysql.createDatabase(newDatabaseName)
      if (success) {
        setNewDatabaseName('')
        setShowNewDatabaseDialog(false)
        await loadDatabases()
      }
    }
  }

  const handleCreateUser = async () => {
    if (newUserForm.username && newUserForm.password) {
      const success = await mysql.createUser(newUserForm.username, newUserForm.host, newUserForm.password)
      if (success) {
        setNewUserForm({ username: '', host: 'localhost', password: '' })
        await loadUsers()
      }
    }
  }

  const handleDeleteUser = async (username: string, host: string) => {
    if (confirm(`Delete user ${username}@${host}?`)) {
      const success = await mysql.dropUser(username, host)
      if (success) {
        await loadUsers()
      }
    }
  }

  const handleKillProcess = async (id: number) => {
    const success = await mysql.killProcess(id)
    if (success) {
      await loadProcesses()
    }
  }

  const exportResults = () => {
    if (!queryResult) return

    const headers = queryResult.columns.join(',')
    const rows = queryResult.rows
      .map((row) => queryResult.columns.map((col) => JSON.stringify(row[col] ?? '')).join(','))
      .join('\n')

    const csv = [headers, rows].join('\n')
    const blob = new Blob([csv], { type: 'text/csv' })
    const url = window.URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = 'query-results.csv'
    a.click()
    window.URL.revokeObjectURL(url)
  }

  return (
    <div className="flex-1 bg-trakend-dark h-screen flex flex-col overflow-hidden">
      <div className="flex h-full overflow-hidden">
        {/* Left Sidebar */}
        <div className="w-80 bg-trakend-surface border-r border-trakend-border flex flex-col overflow-hidden">
          {/* Server Status */}
          <div className="p-4 border-b border-trakend-border">
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-2">
                <div className={`w-3 h-3 rounded-full ${isServerRunning ? 'bg-trakend-success animate-pulse' : 'bg-trakend-error'}`}></div>
                <span className="text-sm font-semibold text-trakend-text-primary">MariaDB</span>
              </div>
              <span className="text-xs text-trakend-text-secondary">{isServerRunning ? 'Running' : 'Stopped'}</span>
            </div>
            <div className="flex gap-2">
              <button
                onClick={handleServerStart}
                disabled={isServerRunning || mysql.loading}
                className="flex-1 px-2 py-1 text-xs rounded-lg bg-trakend-success text-white hover:bg-opacity-90 transition-colors disabled:opacity-50"
              >
                <Play size={14} className="inline mr-1" />
                Start
              </button>
              <button
                onClick={handleServerStop}
                disabled={!isServerRunning || mysql.loading}
                className="flex-1 px-2 py-1 text-xs rounded-lg bg-trakend-error text-white hover:bg-opacity-90 transition-colors disabled:opacity-50"
              >
                <Power size={14} className="inline mr-1" />
                Stop
              </button>
              <button
                onClick={handleServerRestart}
                disabled={!isServerRunning || mysql.loading}
                className="flex-1 px-2 py-1 text-xs rounded-lg bg-trakend-accent text-white hover:bg-opacity-90 transition-colors disabled:opacity-50"
              >
                <RotateCw size={14} className="inline" />
              </button>
            </div>
          </div>

          {/* Databases List */}
          <div className="flex-1 overflow-y-auto p-2">
            <div className="text-xs uppercase tracking-wide text-trakend-text-secondary font-semibold mb-2 px-2">Databases</div>
            {databases.map((db) => (
              <div key={db.name}>
                <button
                  onClick={() => handleDatabaseSelect(db.name)}
                  className={`w-full text-left px-3 py-2 text-sm rounded-lg transition-colors flex items-center gap-2 mb-1 ${
                    selectedDatabase === db.name
                      ? 'bg-trakend-accent text-white'
                      : 'text-trakend-text-secondary hover:text-trakend-text-primary hover:bg-trakend-surface-light'
                  }`}
                >
                  <button
                    onClick={(e) => {
                      e.stopPropagation()
                      toggleDatabase(db.name)
                    }}
                    className="p-0 hover:bg-trakend-dark rounded"
                  >
                    {expandedDatabases[db.name] ? (
                      <ChevronDown size={16} />
                    ) : (
                      <ChevronRight size={16} />
                    )}
                  </button>
                  <span className="flex-1">{db.name}</span>
                  <span className="text-xs opacity-75">{db.tables}</span>
                </button>

                {/* Tables */}
                {expandedDatabases[db.name] && dbTables[db.name] && (
                  <div className="pl-4 space-y-1">
                    {dbTables[db.name].map((table) => (
                      <button
                        key={table}
                        onClick={() => handleTableSelect(table)}
                        className={`w-full text-left px-3 py-1 text-xs rounded transition-colors ${
                          selectedTable === table && selectedDatabase === db.name
                            ? 'bg-trakend-accent text-white'
                            : 'text-trakend-text-secondary hover:text-trakend-text-primary hover:bg-trakend-surface-light'
                        }`}
                      >
                        📊 {table}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>

          {/* Sidebar Actions */}
          <div className="p-3 border-t border-trakend-border space-y-2">
            <button
              onClick={() => setShowNewDatabaseDialog(true)}
              className="w-full flex items-center gap-2 px-3 py-2 text-sm rounded-lg bg-trakend-accent text-white hover:bg-opacity-90 transition-colors"
            >
              <Plus size={16} />
              New Database
            </button>
          </div>
        </div>

        {/* Main Content */}
        <div className="flex-1 flex flex-col overflow-hidden">
          {/* Tab Bar */}
          <div className="bg-trakend-surface border-b border-trakend-border px-4 py-3 flex gap-6">
            <button
              onClick={() => setActiveTab('query')}
              className={`text-sm font-medium pb-2 border-b-2 transition-colors ${
                activeTab === 'query'
                  ? 'text-trakend-accent border-trakend-accent'
                  : 'text-trakend-text-secondary border-transparent hover:text-trakend-text-primary'
              }`}
            >
              Query Editor
            </button>
            <button
              onClick={() => {
                setActiveTab('browser')
                if (selectedDatabase && selectedTable) {
                  loadTableList(selectedDatabase)
                }
              }}
              className={`text-sm font-medium pb-2 border-b-2 transition-colors ${
                activeTab === 'browser'
                  ? 'text-trakend-accent border-trakend-accent'
                  : 'text-trakend-text-secondary border-transparent hover:text-trakend-text-primary'
              }`}
            >
              Table Browser
            </button>
            <button
              onClick={() => {
                setActiveTab('users')
                loadUsers()
              }}
              className={`text-sm font-medium pb-2 border-b-2 transition-colors ${
                activeTab === 'users'
                  ? 'text-trakend-accent border-trakend-accent'
                  : 'text-trakend-text-secondary border-transparent hover:text-trakend-text-primary'
              }`}
            >
              Users & Permissions
            </button>
            <button
              onClick={() => {
                setActiveTab('status')
                loadServerStatus()
                loadProcesses()
              }}
              className={`text-sm font-medium pb-2 border-b-2 transition-colors ${
                activeTab === 'status'
                  ? 'text-trakend-accent border-trakend-accent'
                  : 'text-trakend-text-secondary border-transparent hover:text-trakend-text-primary'
              }`}
            >
              Server Status
            </button>
          </div>

          {/* Tab Content */}
          <div className="flex-1 overflow-auto p-4">
            {/* Query Editor Tab */}
            {activeTab === 'query' && (
              <div className="space-y-4">
                <div>
                  <label className="text-xs text-trakend-text-secondary uppercase tracking-wide block mb-2">
                    Database
                  </label>
                  <select
                    value={selectedDatabase || ''}
                    onChange={(e) => setSelectedDatabase(e.target.value)}
                    className="w-full px-3 py-2 rounded-lg bg-trakend-surface border border-trakend-border text-trakend-text-primary text-sm focus:outline-none focus:border-trakend-accent"
                  >
                    <option value="">Select database</option>
                    {databases.map((db) => (
                      <option key={db.name} value={db.name}>
                        {db.name}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="text-xs text-trakend-text-secondary uppercase tracking-wide block mb-2">
                    SQL Query
                  </label>
                  <textarea
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    className="w-full h-32 px-3 py-2 rounded-lg bg-trakend-dark border border-trakend-border text-trakend-text-primary font-mono text-sm focus:outline-none focus:border-trakend-accent resize-none"
                    placeholder="Enter SQL query..."
                  />
                </div>

                <div className="flex gap-2">
                  <button
                    onClick={executeQuery}
                    disabled={mysql.loading}
                    className="flex items-center gap-2 px-4 py-2 rounded-lg bg-trakend-accent text-white hover:bg-opacity-90 transition-colors disabled:opacity-50"
                  >
                    <Play size={16} />
                    Execute
                  </button>
                  <button
                    onClick={() => setQuery('')}
                    className="flex items-center gap-2 px-4 py-2 rounded-lg bg-trakend-surface-light text-trakend-text-secondary hover:text-trakend-text-primary transition-colors"
                  >
                    Clear
                  </button>
                  <button
                    onClick={exportResults}
                    disabled={!queryResult}
                    className="flex items-center gap-2 px-4 py-2 rounded-lg bg-trakend-surface-light text-trakend-text-secondary hover:text-trakend-text-primary transition-colors disabled:opacity-50"
                  >
                    <Download size={16} />
                    Export
                  </button>

                  {queryHistory.length > 0 && (
                    <select
                      onChange={(e) => {
                        if (e.target.value) setQuery(e.target.value)
                      }}
                      className="px-3 py-2 rounded-lg bg-trakend-surface border border-trakend-border text-trakend-text-primary text-sm focus:outline-none focus:border-trakend-accent"
                    >
                      <option value="">Query History</option>
                      {queryHistory.map((q, i) => (
                        <option key={i} value={q}>
                          {q.substring(0, 50)}...
                        </option>
                      ))}
                    </select>
                  )}
                </div>

                {mysql.error && (
                  <div className="p-3 rounded-lg bg-trakend-error/10 border border-trakend-error text-trakend-error text-sm">
                    {mysql.error}
                  </div>
                )}

                {queryResult && (
                  <div className="bg-trakend-surface border border-trakend-border rounded-lg overflow-hidden">
                    <div className="bg-trakend-dark p-3 border-b border-trakend-border text-xs text-trakend-text-secondary">
                      {queryResult.affectedRows !== undefined
                        ? `${queryResult.affectedRows} rows affected`
                        : `${queryResult.rows.length} rows returned`}
                    </div>
                    <div className="overflow-x-auto">
                      <table className="w-full">
                        <thead>
                          <tr className="border-b border-trakend-border bg-trakend-dark">
                            {queryResult.columns.map((col) => (
                              <th
                                key={col}
                                className="text-left px-4 py-3 text-xs font-semibold text-trakend-text-secondary uppercase tracking-wide"
                              >
                                {col}
                              </th>
                            ))}
                          </tr>
                        </thead>
                        <tbody>
                          {queryResult.rows.slice(0, 100).map((row, i) => (
                            <tr key={i} className="border-b border-trakend-border hover:bg-trakend-dark transition-colors">
                              {queryResult.columns.map((col) => (
                                <td key={col} className="px-4 py-3 text-sm text-trakend-text-primary font-mono max-w-xs truncate">
                                  {String(row[col] ?? '')}
                                </td>
                              ))}
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* Table Browser Tab */}
            {activeTab === 'browser' && selectedTable && tableSchema && (
              <div className="space-y-4">
                <h2 className="text-lg font-semibold text-trakend-text-primary">
                  {selectedDatabase}.{selectedTable}
                </h2>

                <div>
                  <h3 className="text-sm font-semibold text-trakend-text-primary mb-3">Schema</h3>
                  <div className="bg-trakend-surface border border-trakend-border rounded-lg overflow-hidden">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="border-b border-trakend-border bg-trakend-dark">
                          <th className="text-left px-4 py-2 text-xs font-semibold text-trakend-text-secondary">Column</th>
                          <th className="text-left px-4 py-2 text-xs font-semibold text-trakend-text-secondary">Type</th>
                          <th className="text-left px-4 py-2 text-xs font-semibold text-trakend-text-secondary">Null</th>
                          <th className="text-left px-4 py-2 text-xs font-semibold text-trakend-text-secondary">Key</th>
                          <th className="text-left px-4 py-2 text-xs font-semibold text-trakend-text-secondary">Default</th>
                        </tr>
                      </thead>
                      <tbody>
                        {tableSchema.columns.map((col) => (
                          <tr key={col.name} className="border-b border-trakend-border hover:bg-trakend-dark transition-colors">
                            <td className="px-4 py-2 text-trakend-text-primary font-mono">{col.name}</td>
                            <td className="px-4 py-2 text-trakend-text-secondary text-xs">{col.type}</td>
                            <td className="px-4 py-2 text-trakend-text-secondary text-xs">{col.nullable ? 'YES' : 'NO'}</td>
                            <td className="px-4 py-2 text-trakend-text-secondary text-xs">{col.key || '-'}</td>
                            <td className="px-4 py-2 text-trakend-text-secondary text-xs font-mono">{col.defaultValue || '-'}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>

                {tableData && (
                  <div>
                    <h3 className="text-sm font-semibold text-trakend-text-primary mb-3">
                      Data ({tableData.totalRows} rows)
                    </h3>
                    <div className="bg-trakend-surface border border-trakend-border rounded-lg overflow-hidden">
                      <div className="overflow-x-auto">
                        <table className="w-full text-sm">
                          <thead>
                            <tr className="border-b border-trakend-border bg-trakend-dark">
                              {tableSchema.columns.map((col) => (
                                <th
                                  key={col.name}
                                  className="text-left px-4 py-2 text-xs font-semibold text-trakend-text-secondary whitespace-nowrap"
                                >
                                  {col.name}
                                </th>
                              ))}
                            </tr>
                          </thead>
                          <tbody>
                            {tableData.data.map((row: any, i: number) => (
                              <tr key={i} className="border-b border-trakend-border hover:bg-trakend-dark transition-colors">
                                {tableSchema.columns.map((col) => (
                                  <td
                                    key={col.name}
                                    className="px-4 py-2 text-trakend-text-primary text-xs font-mono max-w-xs truncate"
                                  >
                                    {String(row[col.name] ?? '')}
                                  </td>
                                ))}
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* Users & Permissions Tab */}
            {activeTab === 'users' && (
              <div className="space-y-4">
                <div className="bg-trakend-surface border border-trakend-border rounded-lg p-4">
                  <h3 className="text-sm font-semibold text-trakend-text-primary mb-4">Create New User</h3>
                  <div className="grid grid-cols-3 gap-3 mb-3">
                    <input
                      type="text"
                      placeholder="Username"
                      value={newUserForm.username}
                      onChange={(e) => setNewUserForm({ ...newUserForm, username: e.target.value })}
                      className="px-3 py-2 rounded-lg bg-trakend-dark border border-trakend-border text-trakend-text-primary text-sm focus:outline-none focus:border-trakend-accent"
                    />
                    <input
                      type="text"
                      placeholder="Host"
                      value={newUserForm.host}
                      onChange={(e) => setNewUserForm({ ...newUserForm, host: e.target.value })}
                      className="px-3 py-2 rounded-lg bg-trakend-dark border border-trakend-border text-trakend-text-primary text-sm focus:outline-none focus:border-trakend-accent"
                    />
                    <input
                      type="password"
                      placeholder="Password"
                      value={newUserForm.password}
                      onChange={(e) => setNewUserForm({ ...newUserForm, password: e.target.value })}
                      className="px-3 py-2 rounded-lg bg-trakend-dark border border-trakend-border text-trakend-text-primary text-sm focus:outline-none focus:border-trakend-accent"
                    />
                  </div>
                  <button
                    onClick={handleCreateUser}
                    className="px-4 py-2 rounded-lg bg-trakend-accent text-white hover:bg-opacity-90 transition-colors text-sm font-medium"
                  >
                    <Plus size={16} className="inline mr-2" />
                    Create User
                  </button>
                </div>

                <div className="bg-trakend-surface border border-trakend-border rounded-lg overflow-hidden">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-trakend-border bg-trakend-dark">
                        <th className="text-left px-4 py-3 text-xs font-semibold text-trakend-text-secondary">User</th>
                        <th className="text-left px-4 py-3 text-xs font-semibold text-trakend-text-secondary">Host</th>
                        <th className="text-right px-4 py-3 text-xs font-semibold text-trakend-text-secondary">Actions</th>
                      </tr>
                    </thead>
                    <tbody>
                      {users.map((user) => (
                        <tr key={`${user.user}@${user.host}`} className="border-b border-trakend-border hover:bg-trakend-dark transition-colors">
                          <td className="px-4 py-3 text-trakend-text-primary font-mono">{user.user}</td>
                          <td className="px-4 py-3 text-trakend-text-primary font-mono">{user.host}</td>
                          <td className="px-4 py-3 text-right">
                            <button
                              onClick={() => handleDeleteUser(user.user, user.host)}
                              className="px-3 py-1 rounded text-xs bg-trakend-error/20 text-trakend-error hover:bg-trakend-error/30 transition-colors"
                            >
                              <Trash2 size={14} className="inline mr-1" />
                              Delete
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            {/* Server Status Tab */}
            {activeTab === 'status' && serverStatus && (
              <div className="space-y-4">
                <div className="grid grid-cols-2 gap-4">
                  <div className="bg-trakend-surface border border-trakend-border rounded-lg p-4">
                    <p className="text-xs text-trakend-text-secondary uppercase tracking-wide mb-1">Version</p>
                    <p className="text-lg font-mono text-trakend-text-primary">{serverStatus.version}</p>
                  </div>
                  <div className="bg-trakend-surface border border-trakend-border rounded-lg p-4">
                    <p className="text-xs text-trakend-text-secondary uppercase tracking-wide mb-1">Uptime</p>
                    <p className="text-lg font-mono text-trakend-text-primary">
                      {Math.floor(serverStatus.uptime / 3600)}h {Math.floor((serverStatus.uptime % 3600) / 60)}m
                    </p>
                  </div>
                  <div className="bg-trakend-surface border border-trakend-border rounded-lg p-4">
                    <p className="text-xs text-trakend-text-secondary uppercase tracking-wide mb-1">Connections</p>
                    <p className="text-lg font-mono text-trakend-text-primary">
                      {serverStatus.connections} / {serverStatus.maxConnections}
                    </p>
                  </div>
                  <div className="bg-trakend-surface border border-trakend-border rounded-lg p-4">
                    <p className="text-xs text-trakend-text-secondary uppercase tracking-wide mb-1">Queries/sec</p>
                    <p className="text-lg font-mono text-trakend-text-primary">{serverStatus.queriesPerSecond.toFixed(2)}</p>
                  </div>
                </div>

                <div>
                  <h3 className="text-sm font-semibold text-trakend-text-primary mb-3">Process List</h3>
                  <div className="bg-trakend-surface border border-trakend-border rounded-lg overflow-hidden">
                    <div className="overflow-x-auto">
                      <table className="w-full text-xs">
                        <thead>
                          <tr className="border-b border-trakend-border bg-trakend-dark">
                            <th className="text-left px-3 py-2 font-semibold text-trakend-text-secondary">ID</th>
                            <th className="text-left px-3 py-2 font-semibold text-trakend-text-secondary">User</th>
                            <th className="text-left px-3 py-2 font-semibold text-trakend-text-secondary">Host</th>
                            <th className="text-left px-3 py-2 font-semibold text-trakend-text-secondary">Command</th>
                            <th className="text-left px-3 py-2 font-semibold text-trakend-text-secondary">Time</th>
                            <th className="text-left px-3 py-2 font-semibold text-trakend-text-secondary">State</th>
                            <th className="text-right px-3 py-2 font-semibold text-trakend-text-secondary">Actions</th>
                          </tr>
                        </thead>
                        <tbody>
                          {processes.map((proc) => (
                            <tr key={proc.id} className="border-b border-trakend-border hover:bg-trakend-dark transition-colors">
                              <td className="px-3 py-2 text-trakend-text-primary font-mono">{proc.id}</td>
                              <td className="px-3 py-2 text-trakend-text-primary">{proc.user}</td>
                              <td className="px-3 py-2 text-trakend-text-primary font-mono">{proc.host}</td>
                              <td className="px-3 py-2 text-trakend-text-secondary">{proc.command}</td>
                              <td className="px-3 py-2 text-trakend-text-primary font-mono">{proc.time}s</td>
                              <td className="px-3 py-2 text-trakend-text-secondary text-xs">{proc.state || '-'}</td>
                              <td className="px-3 py-2 text-right">
                                <button
                                  onClick={() => handleKillProcess(proc.id)}
                                  className="px-2 py-1 rounded text-xs bg-trakend-error/20 text-trakend-error hover:bg-trakend-error/30 transition-colors"
                                >
                                  Kill
                                </button>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* New Database Dialog */}
      {showNewDatabaseDialog && (
        <div className="fixed inset-0 bg-black/75 flex items-center justify-center z-50">
          <div className="bg-trakend-surface border border-trakend-border rounded-lg p-6 max-w-md w-full mx-4">
            <h2 className="text-lg font-semibold text-trakend-text-primary mb-4">Create New Database</h2>
            <input
              type="text"
              placeholder="Database name"
              value={newDatabaseName}
              onChange={(e) => setNewDatabaseName(e.target.value)}
              className="w-full px-3 py-2 rounded-lg bg-trakend-dark border border-trakend-border text-trakend-text-primary mb-4 focus:outline-none focus:border-trakend-accent"
            />
            <div className="flex gap-3 justify-end">
              <button
                onClick={() => setShowNewDatabaseDialog(false)}
                className="px-4 py-2 rounded-lg bg-trakend-surface-light text-trakend-text-secondary hover:text-trakend-text-primary transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handleCreateDatabase}
                className="px-4 py-2 rounded-lg bg-trakend-accent text-white hover:bg-opacity-90 transition-colors"
              >
                Create
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
