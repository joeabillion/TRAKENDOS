import React, { useEffect, useState } from 'react'
import {
  X, Save, RefreshCw, Globe, HardDrive, Cpu, MemoryStick,
  Network, Settings, Tag, Terminal, Layers
} from 'lucide-react'
import { useDocker } from '../../hooks/useDocker'

interface ContainerSettingsModalProps {
  containerId: string
  containerName: string
  onClose: () => void
  onRefresh: () => void
}

type SettingsTab = 'overview' | 'ports' | 'volumes' | 'env' | 'network' | 'resources' | 'advanced'

interface PortMapping {
  containerPort: string
  hostPort: string
  protocol: string
}

interface VolumeMount {
  source: string
  destination: string
  mode: string
}

interface EnvVar {
  key: string
  value: string
}

export const ContainerSettingsModal: React.FC<ContainerSettingsModalProps> = ({
  containerId,
  containerName,
  onClose,
  onRefresh,
}) => {
  const { inspectContainer, recreateContainer } = useDocker()
  const [activeTab, setActiveTab] = useState<SettingsTab>('overview')
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [inspectData, setInspectData] = useState<any>(null)
  const [error, setError] = useState('')

  // Editable state
  const [restartPolicy, setRestartPolicy] = useState('no')
  const [ports, setPorts] = useState<PortMapping[]>([])
  const [volumes, setVolumes] = useState<VolumeMount[]>([])
  const [envVars, setEnvVars] = useState<EnvVar[]>([])
  const [cpuLimit, setCpuLimit] = useState(0)
  const [memoryLimit, setMemoryLimit] = useState(0)
  const [hasChanges, setHasChanges] = useState(false)

  useEffect(() => {
    loadInspect()
  }, [containerId])

  const loadInspect = async () => {
    setLoading(true)
    setError('')
    const data = await inspectContainer(containerId)
    if (!data) {
      setError('Failed to inspect container')
      setLoading(false)
      return
    }
    setInspectData(data)

    // Parse restart policy
    setRestartPolicy(data.HostConfig?.RestartPolicy?.Name || 'no')

    // Parse port bindings
    const bindings = data.HostConfig?.PortBindings || {}
    const parsedPorts: PortMapping[] = []
    for (const [containerPort, hostBindings] of Object.entries(bindings)) {
      const [port, protocol] = containerPort.split('/')
      for (const binding of (hostBindings as any[]) || []) {
        parsedPorts.push({
          containerPort: port,
          hostPort: binding.HostPort || '',
          protocol: protocol || 'tcp',
        })
      }
    }
    setPorts(parsedPorts)

    // Parse volumes
    const mounts = data.Mounts || []
    setVolumes(mounts.map((m: any) => ({
      source: m.Source || '',
      destination: m.Destination || '',
      mode: m.RW ? 'rw' : 'ro',
    })))

    // Parse env vars
    const env = data.Config?.Env || []
    setEnvVars(env.map((e: string) => {
      const idx = e.indexOf('=')
      return { key: e.substring(0, idx), value: e.substring(idx + 1) }
    }))

    // Parse resource limits
    setCpuLimit((data.HostConfig?.NanoCpus || 0) / 1e9)
    setMemoryLimit(Math.round((data.HostConfig?.Memory || 0) / (1024 * 1024)))

    setLoading(false)
  }

  const markChanged = () => setHasChanges(true)

  const handleSave = async () => {
    setSaving(true)
    setError('')

    // Build port bindings
    const portBindings: Record<string, any[]> = {}
    for (const p of ports) {
      const key = `${p.containerPort}/${p.protocol}`
      if (!portBindings[key]) portBindings[key] = []
      portBindings[key].push({ HostPort: p.hostPort })
    }

    // Build env array
    const envArray = envVars.map(e => `${e.key}=${e.value}`)

    // Build binds array
    const binds = volumes.map(v => `${v.source}:${v.destination}:${v.mode}`)

    const config = {
      name: inspectData?.Name?.replace(/^\//, '') || containerName,
      image: inspectData?.Config?.Image,
      cmd: inspectData?.Config?.Cmd,
      env: envArray,
      portBindings,
      binds,
      restartPolicy: { Name: restartPolicy, MaximumRetryCount: restartPolicy === 'on-failure' ? 5 : 0 },
      memoryLimit: memoryLimit > 0 ? memoryLimit * 1024 * 1024 : 0,
      cpuLimit: cpuLimit > 0 ? cpuLimit : 0,
      networkMode: inspectData?.HostConfig?.NetworkMode || 'bridge',
    }

    const result = await recreateContainer(containerId, config)
    setSaving(false)

    if (result) {
      onRefresh()
      onClose()
    } else {
      setError('Failed to apply changes. Container may need manual intervention.')
    }
  }

  // Port helpers
  const addPort = () => { setPorts([...ports, { containerPort: '', hostPort: '', protocol: 'tcp' }]); markChanged() }
  const removePort = (i: number) => { setPorts(ports.filter((_, idx) => idx !== i)); markChanged() }
  const updatePort = (i: number, field: keyof PortMapping, val: string) => {
    const next = [...ports]; next[i] = { ...next[i], [field]: val }; setPorts(next); markChanged()
  }

  // Volume helpers
  const addVolume = () => { setVolumes([...volumes, { source: '', destination: '', mode: 'rw' }]); markChanged() }
  const removeVolume = (i: number) => { setVolumes(volumes.filter((_, idx) => idx !== i)); markChanged() }
  const updateVolume = (i: number, field: keyof VolumeMount, val: string) => {
    const next = [...volumes]; next[i] = { ...next[i], [field]: val }; setVolumes(next); markChanged()
  }

  // Env helpers
  const addEnv = () => { setEnvVars([...envVars, { key: '', value: '' }]); markChanged() }
  const removeEnv = (i: number) => { setEnvVars(envVars.filter((_, idx) => idx !== i)); markChanged() }
  const updateEnv = (i: number, field: keyof EnvVar, val: string) => {
    const next = [...envVars]; next[i] = { ...next[i], [field]: val }; setEnvVars(next); markChanged()
  }

  const tabs: { id: SettingsTab; label: string; icon: React.ReactNode }[] = [
    { id: 'overview', label: 'Overview', icon: <Layers size={16} /> },
    { id: 'ports', label: 'Ports', icon: <Globe size={16} /> },
    { id: 'volumes', label: 'Volumes', icon: <HardDrive size={16} /> },
    { id: 'env', label: 'Environment', icon: <Terminal size={16} /> },
    { id: 'network', label: 'Network', icon: <Network size={16} /> },
    { id: 'resources', label: 'Resources', icon: <Cpu size={16} /> },
    { id: 'advanced', label: 'Advanced', icon: <Tag size={16} /> },
  ]

  const formatBytes = (bytes: number) => {
    if (!bytes) return '0 B'
    const k = 1024
    const sizes = ['B', 'KB', 'MB', 'GB', 'TB']
    const i = Math.floor(Math.log(bytes) / Math.log(k))
    return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i]
  }

  if (loading) {
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70">
        <div className="bg-trakend-dark rounded-xl p-8 text-center">
          <RefreshCw size={32} className="animate-spin text-trakend-accent mx-auto mb-4" />
          <p className="text-trakend-text-secondary">Loading container settings...</p>
        </div>
      </div>
    )
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4">
      <div className="bg-trakend-dark rounded-xl border border-trakend-border w-full max-w-4xl max-h-[90vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-trakend-border">
          <div className="flex items-center gap-3">
            <Settings size={20} className="text-trakend-accent" />
            <div>
              <h2 className="text-lg font-bold text-trakend-text-primary">Container Settings</h2>
              <p className="text-sm text-trakend-text-secondary">{containerName} ({containerId.substring(0, 12)})</p>
            </div>
          </div>
          <button onClick={onClose} className="p-1.5 rounded hover:bg-trakend-surface text-trakend-text-secondary hover:text-trakend-text-primary">
            <X size={20} />
          </button>
        </div>

        {/* Tabs */}
        <div className="flex border-b border-trakend-border px-6 overflow-x-auto">
          {tabs.map(tab => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`flex items-center gap-2 px-4 py-3 text-sm font-medium border-b-2 transition-colors whitespace-nowrap ${
                activeTab === tab.id
                  ? 'border-trakend-accent text-trakend-accent'
                  : 'border-transparent text-trakend-text-secondary hover:text-trakend-text-primary'
              }`}
            >
              {tab.icon} {tab.label}
            </button>
          ))}
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-6">
          {error && (
            <div className="mb-4 p-3 rounded-lg bg-red-500/10 border border-red-500/30 text-red-400 text-sm">{error}</div>
          )}

          {/* Overview Tab */}
          {activeTab === 'overview' && inspectData && (
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="text-xs text-trakend-text-secondary uppercase">Name</label>
                  <p className="text-trakend-text-primary font-medium">{inspectData.Name?.replace(/^\//, '')}</p>
                </div>
                <div>
                  <label className="text-xs text-trakend-text-secondary uppercase">Image</label>
                  <p className="text-trakend-text-primary font-medium">{inspectData.Config?.Image}</p>
                </div>
                <div>
                  <label className="text-xs text-trakend-text-secondary uppercase">Status</label>
                  <p className="text-trakend-text-primary font-medium">
                    <span className={`inline-block w-2 h-2 rounded-full mr-2 ${inspectData.State?.Running ? 'bg-green-400' : 'bg-gray-400'}`} />
                    {inspectData.State?.Status}
                  </p>
                </div>
                <div>
                  <label className="text-xs text-trakend-text-secondary uppercase">Created</label>
                  <p className="text-trakend-text-primary font-medium">{new Date(inspectData.Created).toLocaleString()}</p>
                </div>
                <div>
                  <label className="text-xs text-trakend-text-secondary uppercase">Command</label>
                  <p className="text-trakend-text-primary font-mono text-sm">{(inspectData.Config?.Cmd || []).join(' ') || inspectData.Config?.Entrypoint?.join(' ') || 'N/A'}</p>
                </div>
                <div>
                  <label className="text-xs text-trakend-text-secondary uppercase mb-1 block">Restart Policy</label>
                  <select
                    value={restartPolicy}
                    onChange={e => { setRestartPolicy(e.target.value); markChanged() }}
                    className="w-full bg-trakend-surface border border-trakend-border rounded-lg px-3 py-2 text-sm text-trakend-text-primary"
                  >
                    <option value="no">No</option>
                    <option value="always">Always</option>
                    <option value="unless-stopped">Unless Stopped</option>
                    <option value="on-failure">On Failure</option>
                  </select>
                </div>
              </div>
            </div>
          )}

          {/* Ports Tab */}
          {activeTab === 'ports' && (
            <div className="space-y-4">
              <div className="flex justify-between items-center">
                <h3 className="text-sm font-medium text-trakend-text-primary">Port Mappings</h3>
                <button onClick={addPort} className="px-3 py-1.5 rounded-lg bg-trakend-accent text-white text-sm hover:bg-opacity-80">+ Add Port</button>
              </div>
              {ports.length === 0 ? (
                <p className="text-trakend-text-secondary text-sm py-4 text-center">No port mappings configured</p>
              ) : (
                <div className="space-y-2">
                  <div className="grid grid-cols-[1fr_1fr_100px_40px] gap-2 text-xs text-trakend-text-secondary uppercase px-1">
                    <span>Host Port</span><span>Container Port</span><span>Protocol</span><span></span>
                  </div>
                  {ports.map((p, i) => (
                    <div key={i} className="grid grid-cols-[1fr_1fr_100px_40px] gap-2">
                      <input value={p.hostPort} onChange={e => updatePort(i, 'hostPort', e.target.value)} placeholder="8080" className="bg-trakend-surface border border-trakend-border rounded px-3 py-2 text-sm text-trakend-text-primary" />
                      <input value={p.containerPort} onChange={e => updatePort(i, 'containerPort', e.target.value)} placeholder="80" className="bg-trakend-surface border border-trakend-border rounded px-3 py-2 text-sm text-trakend-text-primary" />
                      <select value={p.protocol} onChange={e => updatePort(i, 'protocol', e.target.value)} className="bg-trakend-surface border border-trakend-border rounded px-2 py-2 text-sm text-trakend-text-primary">
                        <option value="tcp">TCP</option>
                        <option value="udp">UDP</option>
                      </select>
                      <button onClick={() => removePort(i)} className="text-red-400 hover:text-red-300 text-sm">
                        <X size={16} />
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Volumes Tab */}
          {activeTab === 'volumes' && (
            <div className="space-y-4">
              <div className="flex justify-between items-center">
                <h3 className="text-sm font-medium text-trakend-text-primary">Volume Mounts</h3>
                <button onClick={addVolume} className="px-3 py-1.5 rounded-lg bg-trakend-accent text-white text-sm hover:bg-opacity-80">+ Add Volume</button>
              </div>
              {volumes.length === 0 ? (
                <p className="text-trakend-text-secondary text-sm py-4 text-center">No volumes mounted</p>
              ) : (
                <div className="space-y-2">
                  <div className="grid grid-cols-[1fr_1fr_80px_40px] gap-2 text-xs text-trakend-text-secondary uppercase px-1">
                    <span>Host Path</span><span>Container Path</span><span>Mode</span><span></span>
                  </div>
                  {volumes.map((v, i) => (
                    <div key={i} className="grid grid-cols-[1fr_1fr_80px_40px] gap-2">
                      <input value={v.source} onChange={e => updateVolume(i, 'source', e.target.value)} placeholder="/host/path" className="bg-trakend-surface border border-trakend-border rounded px-3 py-2 text-sm text-trakend-text-primary" />
                      <input value={v.destination} onChange={e => updateVolume(i, 'destination', e.target.value)} placeholder="/container/path" className="bg-trakend-surface border border-trakend-border rounded px-3 py-2 text-sm text-trakend-text-primary" />
                      <select value={v.mode} onChange={e => updateVolume(i, 'mode', e.target.value)} className="bg-trakend-surface border border-trakend-border rounded px-2 py-2 text-sm text-trakend-text-primary">
                        <option value="rw">RW</option>
                        <option value="ro">RO</option>
                      </select>
                      <button onClick={() => removeVolume(i)} className="text-red-400 hover:text-red-300">
                        <X size={16} />
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Environment Tab */}
          {activeTab === 'env' && (
            <div className="space-y-4">
              <div className="flex justify-between items-center">
                <h3 className="text-sm font-medium text-trakend-text-primary">Environment Variables</h3>
                <button onClick={addEnv} className="px-3 py-1.5 rounded-lg bg-trakend-accent text-white text-sm hover:bg-opacity-80">+ Add Variable</button>
              </div>
              {envVars.length === 0 ? (
                <p className="text-trakend-text-secondary text-sm py-4 text-center">No environment variables</p>
              ) : (
                <div className="space-y-2">
                  <div className="grid grid-cols-[1fr_2fr_40px] gap-2 text-xs text-trakend-text-secondary uppercase px-1">
                    <span>Key</span><span>Value</span><span></span>
                  </div>
                  {envVars.map((e, i) => (
                    <div key={i} className="grid grid-cols-[1fr_2fr_40px] gap-2">
                      <input value={e.key} onChange={ev => updateEnv(i, 'key', ev.target.value)} placeholder="KEY" className="bg-trakend-surface border border-trakend-border rounded px-3 py-2 text-sm text-trakend-text-primary font-mono" />
                      <input value={e.value} onChange={ev => updateEnv(i, 'value', ev.target.value)} placeholder="value" className="bg-trakend-surface border border-trakend-border rounded px-3 py-2 text-sm text-trakend-text-primary font-mono" />
                      <button onClick={() => removeEnv(i)} className="text-red-400 hover:text-red-300">
                        <X size={16} />
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Network Tab */}
          {activeTab === 'network' && inspectData && (
            <div className="space-y-4">
              <h3 className="text-sm font-medium text-trakend-text-primary">Network Configuration</h3>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="text-xs text-trakend-text-secondary uppercase">Network Mode</label>
                  <p className="text-trakend-text-primary font-medium">{inspectData.HostConfig?.NetworkMode || 'bridge'}</p>
                </div>
                {Object.entries(inspectData.NetworkSettings?.Networks || {}).map(([name, net]: [string, any]) => (
                  <React.Fragment key={name}>
                    <div>
                      <label className="text-xs text-trakend-text-secondary uppercase">Network</label>
                      <p className="text-trakend-text-primary font-medium">{name}</p>
                    </div>
                    <div>
                      <label className="text-xs text-trakend-text-secondary uppercase">IP Address</label>
                      <p className="text-trakend-text-primary font-mono">{net.IPAddress || 'N/A'}</p>
                    </div>
                    <div>
                      <label className="text-xs text-trakend-text-secondary uppercase">Gateway</label>
                      <p className="text-trakend-text-primary font-mono">{net.Gateway || 'N/A'}</p>
                    </div>
                    <div>
                      <label className="text-xs text-trakend-text-secondary uppercase">MAC Address</label>
                      <p className="text-trakend-text-primary font-mono">{net.MacAddress || 'N/A'}</p>
                    </div>
                  </React.Fragment>
                ))}
              </div>
            </div>
          )}

          {/* Resources Tab */}
          {activeTab === 'resources' && (
            <div className="space-y-6">
              <div>
                <label className="text-sm font-medium text-trakend-text-primary block mb-2">
                  <Cpu size={14} className="inline mr-2" />
                  CPU Limit (cores, 0 = unlimited)
                </label>
                <div className="flex items-center gap-4">
                  <input
                    type="range"
                    min="0" max="16" step="0.25"
                    value={cpuLimit}
                    onChange={e => { setCpuLimit(parseFloat(e.target.value)); markChanged() }}
                    className="flex-1"
                  />
                  <input
                    type="number"
                    min="0" max="128" step="0.25"
                    value={cpuLimit}
                    onChange={e => { setCpuLimit(parseFloat(e.target.value) || 0); markChanged() }}
                    className="w-24 bg-trakend-surface border border-trakend-border rounded px-3 py-2 text-sm text-trakend-text-primary text-right"
                  />
                  <span className="text-sm text-trakend-text-secondary">cores</span>
                </div>
              </div>

              <div>
                <label className="text-sm font-medium text-trakend-text-primary block mb-2">
                  <MemoryStick size={14} className="inline mr-2" />
                  Memory Limit (MB, 0 = unlimited)
                </label>
                <div className="flex items-center gap-4">
                  <input
                    type="range"
                    min="0" max="32768" step="64"
                    value={memoryLimit}
                    onChange={e => { setMemoryLimit(parseInt(e.target.value)); markChanged() }}
                    className="flex-1"
                  />
                  <input
                    type="number"
                    min="0" max="524288" step="64"
                    value={memoryLimit}
                    onChange={e => { setMemoryLimit(parseInt(e.target.value) || 0); markChanged() }}
                    className="w-24 bg-trakend-surface border border-trakend-border rounded px-3 py-2 text-sm text-trakend-text-primary text-right"
                  />
                  <span className="text-sm text-trakend-text-secondary">MB</span>
                </div>
                {memoryLimit > 0 && (
                  <p className="text-xs text-trakend-text-secondary mt-1">{formatBytes(memoryLimit * 1024 * 1024)}</p>
                )}
              </div>
            </div>
          )}

          {/* Advanced Tab */}
          {activeTab === 'advanced' && inspectData && (
            <div className="space-y-4">
              <div>
                <h3 className="text-sm font-medium text-trakend-text-primary mb-2">Labels</h3>
                <div className="bg-trakend-surface rounded-lg p-3 max-h-48 overflow-y-auto">
                  {Object.entries(inspectData.Config?.Labels || {}).length === 0 ? (
                    <p className="text-trakend-text-secondary text-sm">No labels</p>
                  ) : (
                    <div className="space-y-1">
                      {Object.entries(inspectData.Config?.Labels || {}).map(([key, value]) => (
                        <div key={key} className="flex gap-2 text-xs font-mono">
                          <span className="text-trakend-accent">{key}</span>
                          <span className="text-trakend-text-secondary">=</span>
                          <span className="text-trakend-text-primary break-all">{String(value)}</span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>

              <div>
                <h3 className="text-sm font-medium text-trakend-text-primary mb-2">Entrypoint</h3>
                <p className="text-sm text-trakend-text-primary font-mono bg-trakend-surface rounded-lg p-3">
                  {(inspectData.Config?.Entrypoint || []).join(' ') || 'N/A'}
                </p>
              </div>

              <div>
                <h3 className="text-sm font-medium text-trakend-text-primary mb-2">Container ID</h3>
                <p className="text-sm text-trakend-text-primary font-mono bg-trakend-surface rounded-lg p-3 break-all">
                  {inspectData.Id}
                </p>
              </div>

              <div>
                <h3 className="text-sm font-medium text-trakend-text-primary mb-2">Image ID</h3>
                <p className="text-sm text-trakend-text-primary font-mono bg-trakend-surface rounded-lg p-3 break-all">
                  {inspectData.Image}
                </p>
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between px-6 py-4 border-t border-trakend-border">
          <p className="text-xs text-trakend-text-secondary">
            {hasChanges ? 'Changes require container recreation to apply.' : 'No unsaved changes.'}
          </p>
          <div className="flex gap-3">
            <button
              onClick={onClose}
              className="px-4 py-2 rounded-lg bg-trakend-surface border border-trakend-border text-trakend-text-secondary hover:text-trakend-text-primary text-sm"
            >
              Cancel
            </button>
            <button
              onClick={handleSave}
              disabled={!hasChanges || saving}
              className="flex items-center gap-2 px-4 py-2 rounded-lg bg-trakend-accent text-white text-sm hover:bg-opacity-80 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {saving ? <RefreshCw size={14} className="animate-spin" /> : <Save size={14} />}
              {saving ? 'Applying...' : 'Apply Changes'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
