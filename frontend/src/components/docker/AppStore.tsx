import React, { useState } from 'react'
import { Search } from 'lucide-react'
import { AppDeployDialog } from './AppDeployDialog'

export interface AppTemplate {
  id: string
  name: string
  icon: string
  category: string
  description: string
  image: string
  version: string
  ports: Array<{
    containerPort: number
    hostPort?: number
    protocol: string
  }>
  environment: Array<{
    name: string
    value?: string
    description: string
  }>
  volumes: Array<{
    containerPath: string
    hostPath?: string
    description: string
  }>
  restartPolicy: 'no' | 'always' | 'unless-stopped' | 'on-failure'
  resources?: {
    cpuCores?: number
    memoryMb?: number
  }
}

const APP_TEMPLATES: AppTemplate[] = [
  {
    id: 'plex',
    name: 'Plex Media Server',
    icon: '🎬',
    category: 'Media',
    description: 'A personal media library with movies, music and photos',
    image: 'plexinc/pms-docker:latest',
    version: 'latest',
    ports: [{ containerPort: 32400, hostPort: 32400, protocol: 'tcp' }],
    environment: [
      { name: 'PUID', value: '1000', description: 'User ID' },
      { name: 'PGID', value: '1000', description: 'Group ID' },
      { name: 'VERSION', value: 'latest', description: 'Version' },
    ],
    volumes: [
      { containerPath: '/config', hostPath: '/mnt/media/config', description: 'Plex config directory' },
      { containerPath: '/tv', hostPath: '/mnt/media/tv', description: 'TV shows directory' },
      { containerPath: '/movies', hostPath: '/mnt/media/movies', description: 'Movies directory' },
    ],
    restartPolicy: 'unless-stopped',
    resources: { cpuCores: 2, memoryMb: 1024 },
  },
  {
    id: 'jellyfin',
    name: 'Jellyfin',
    icon: '🎥',
    category: 'Media',
    description: 'The volunteer-built media system with the best in open source video streaming',
    image: 'jellyfin/jellyfin:latest',
    version: 'latest',
    ports: [{ containerPort: 8096, hostPort: 8096, protocol: 'tcp' }],
    environment: [{ name: 'JELLYFIN_PublishedServerUrl', value: 'http://localhost:8096', description: 'Server URL' }],
    volumes: [
      { containerPath: '/config', hostPath: '/mnt/jellyfin/config', description: 'Config directory' },
      { containerPath: '/cache', hostPath: '/mnt/jellyfin/cache', description: 'Cache directory' },
      { containerPath: '/media', hostPath: '/mnt/media', description: 'Media directory' },
    ],
    restartPolicy: 'unless-stopped',
  },
  {
    id: 'nextcloud',
    name: 'Nextcloud',
    icon: '☁️',
    category: 'Cloud',
    description: 'A safe home for all your data. Access & share your files, calendars, contacts, mail & more',
    image: 'nextcloud:latest',
    version: 'latest',
    ports: [{ containerPort: 80, hostPort: 8080, protocol: 'tcp' }],
    environment: [
      { name: 'NEXTCLOUD_ADMIN_USER', value: 'admin', description: 'Admin username' },
      { name: 'NEXTCLOUD_ADMIN_PASSWORD', value: '', description: 'Admin password' },
    ],
    volumes: [
      { containerPath: '/var/www/html', hostPath: '/mnt/nextcloud/html', description: 'Data directory' },
      { containerPath: '/var/www/html/data', hostPath: '/mnt/nextcloud/data', description: 'User data' },
    ],
    restartPolicy: 'unless-stopped',
  },
  {
    id: 'sonarr',
    name: 'Sonarr',
    icon: '📺',
    category: 'Media',
    description: 'TV series collection manager for newsgroup and bittorrent users',
    image: 'linuxserver/sonarr:latest',
    version: 'latest',
    ports: [{ containerPort: 8989, hostPort: 8989, protocol: 'tcp' }],
    environment: [
      { name: 'PUID', value: '1000', description: 'User ID' },
      { name: 'PGID', value: '1000', description: 'Group ID' },
    ],
    volumes: [
      { containerPath: '/config', hostPath: '/mnt/sonarr/config', description: 'Config directory' },
      { containerPath: '/tv', hostPath: '/mnt/media/tv', description: 'TV shows directory' },
      { containerPath: '/downloads', hostPath: '/mnt/downloads', description: 'Downloads directory' },
    ],
    restartPolicy: 'unless-stopped',
  },
  {
    id: 'radarr',
    name: 'Radarr',
    icon: '🎞️',
    category: 'Media',
    description: 'Movie collection manager for newsgroup and bittorrent users',
    image: 'linuxserver/radarr:latest',
    version: 'latest',
    ports: [{ containerPort: 7878, hostPort: 7878, protocol: 'tcp' }],
    environment: [
      { name: 'PUID', value: '1000', description: 'User ID' },
      { name: 'PGID', value: '1000', description: 'Group ID' },
    ],
    volumes: [
      { containerPath: '/config', hostPath: '/mnt/radarr/config', description: 'Config directory' },
      { containerPath: '/movies', hostPath: '/mnt/media/movies', description: 'Movies directory' },
      { containerPath: '/downloads', hostPath: '/mnt/downloads', description: 'Downloads directory' },
    ],
    restartPolicy: 'unless-stopped',
  },
  {
    id: 'prometheus',
    name: 'Prometheus',
    icon: '📊',
    category: 'Monitoring',
    description: 'An open-source monitoring system with a dimensional data model',
    image: 'prom/prometheus:latest',
    version: 'latest',
    ports: [{ containerPort: 9090, hostPort: 9090, protocol: 'tcp' }],
    environment: [],
    volumes: [{ containerPath: '/prometheus', hostPath: '/mnt/prometheus/data', description: 'Data directory' }],
    restartPolicy: 'unless-stopped',
    resources: { cpuCores: 1, memoryMb: 512 },
  },
  {
    id: 'grafana',
    name: 'Grafana',
    icon: '📈',
    category: 'Monitoring',
    description: 'The analytics and monitoring solution for every database',
    image: 'grafana/grafana:latest',
    version: 'latest',
    ports: [{ containerPort: 3000, hostPort: 3000, protocol: 'tcp' }],
    environment: [
      { name: 'GF_SECURITY_ADMIN_USER', value: 'admin', description: 'Admin user' },
      { name: 'GF_SECURITY_ADMIN_PASSWORD', value: 'admin', description: 'Admin password' },
    ],
    volumes: [{ containerPath: '/var/lib/grafana', hostPath: '/mnt/grafana', description: 'Data directory' }],
    restartPolicy: 'unless-stopped',
  },
  {
    id: 'nginx',
    name: 'Nginx',
    icon: '🌐',
    category: 'Network',
    description: 'High performance load balancer and reverse proxy',
    image: 'nginx:latest',
    version: 'latest',
    ports: [
      { containerPort: 80, hostPort: 80, protocol: 'tcp' },
      { containerPort: 443, hostPort: 443, protocol: 'tcp' },
    ],
    environment: [],
    volumes: [
      { containerPath: '/etc/nginx', hostPath: '/mnt/nginx/config', description: 'Config directory' },
      { containerPath: '/usr/share/nginx/html', hostPath: '/mnt/nginx/html', description: 'HTML directory' },
    ],
    restartPolicy: 'unless-stopped',
  },
  {
    id: 'wireguard',
    name: 'WireGuard',
    icon: '🔐',
    category: 'Network',
    description: 'Fast, modern, secure VPN tunnel',
    image: 'linuxserver/wireguard:latest',
    version: 'latest',
    ports: [{ containerPort: 51820, hostPort: 51820, protocol: 'udp' }],
    environment: [
      { name: 'PUID', value: '1000', description: 'User ID' },
      { name: 'PGID', value: '1000', description: 'Group ID' },
    ],
    volumes: [{ containerPath: '/config', hostPath: '/mnt/wireguard/config', description: 'Config directory' }],
    restartPolicy: 'unless-stopped',
  },
  {
    id: 'code-server',
    name: 'Code Server',
    icon: '💻',
    category: 'Dev',
    description: 'VS Code running on a remote server, accessible through the browser',
    image: 'codercom/code-server:latest',
    version: 'latest',
    ports: [{ containerPort: 8443, hostPort: 8443, protocol: 'tcp' }],
    environment: [{ name: 'PASSWORD', value: '', description: 'Access password' }],
    volumes: [
      { containerPath: '/home/coder/project', hostPath: '/mnt/projects', description: 'Project directory' },
      { containerPath: '/home/coder/.config', hostPath: '/mnt/code-server', description: 'Config directory' },
    ],
    restartPolicy: 'unless-stopped',
  },
  {
    id: 'pihole',
    name: 'Pi-hole',
    icon: '🕳️',
    category: 'Network',
    description: 'Network-wide Ad Blocking & DNS sinkhole',
    image: 'pihole/pihole:latest',
    version: 'latest',
    ports: [
      { containerPort: 80, hostPort: 8000, protocol: 'tcp' },
      { containerPort: 53, hostPort: 53, protocol: 'udp' },
    ],
    environment: [
      { name: 'WEBPASSWORD', value: '', description: 'Admin password' },
      { name: 'TZ', value: 'UTC', description: 'Timezone' },
    ],
    volumes: [
      { containerPath: '/etc/pihole', hostPath: '/mnt/pihole', description: 'Config directory' },
      { containerPath: '/etc/dnsmasq.d', hostPath: '/mnt/dnsmasq', description: 'DNS config' },
    ],
    restartPolicy: 'unless-stopped',
  },
  {
    id: 'homeassistant',
    name: 'Home Assistant',
    icon: '🏠',
    category: 'Home',
    description: 'Open source home automation that puts local control and privacy first',
    image: 'homeassistant/home-assistant:latest',
    version: 'latest',
    ports: [{ containerPort: 8123, hostPort: 8123, protocol: 'tcp' }],
    environment: [{ name: 'TZ', value: 'UTC', description: 'Timezone' }],
    volumes: [{ containerPath: '/config', hostPath: '/mnt/homeassistant', description: 'Config directory' }],
    restartPolicy: 'unless-stopped',
    resources: { cpuCores: 2, memoryMb: 512 },
  },
]

const CATEGORIES = ['All', 'Media', 'Cloud', 'Monitoring', 'Network', 'Home', 'Dev']

interface AppStoreProps {
  onDeployApp?: (app: AppTemplate) => void
}

export const AppStore: React.FC<AppStoreProps> = ({ onDeployApp }) => {
  const [searchQuery, setSearchQuery] = useState('')
  const [selectedCategory, setSelectedCategory] = useState('All')
  const [selectedApp, setSelectedApp] = useState<AppTemplate | null>(null)

  const filteredApps = APP_TEMPLATES.filter((app) => {
    const matchesCategory = selectedCategory === 'All' || app.category === selectedCategory
    const matchesSearch = app.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      app.description.toLowerCase().includes(searchQuery.toLowerCase())
    return matchesCategory && matchesSearch
  })

  return (
    <div className="flex-1 overflow-y-auto bg-trakend-dark">
      <div className="p-8">
        {/* Header */}
        <div className="mb-8">
          <h1 className="text-3xl font-bold text-trakend-text-primary mb-2">App Store</h1>
          <p className="text-trakend-text-secondary">Deploy pre-configured container templates</p>
        </div>

        {/* Search */}
        <div className="mb-6">
          <div className="relative">
            <Search size={18} className="absolute left-3 top-3 text-trakend-text-secondary" />
            <input
              type="text"
              placeholder="Search apps..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full pl-10 pr-4 py-3 rounded-lg bg-trakend-surface border border-trakend-border text-trakend-text-primary placeholder-trakend-text-secondary focus:outline-none focus:border-trakend-accent"
            />
          </div>
        </div>

        {/* Category Tabs */}
        <div className="flex gap-2 mb-6 overflow-x-auto pb-2">
          {CATEGORIES.map((category) => (
            <button
              key={category}
              onClick={() => setSelectedCategory(category)}
              className={`px-4 py-2 rounded-lg whitespace-nowrap transition-colors ${
                selectedCategory === category
                  ? 'bg-trakend-accent text-white'
                  : 'bg-trakend-surface border border-trakend-border text-trakend-text-secondary hover:text-trakend-text-primary'
              }`}
            >
              {category}
            </button>
          ))}
        </div>

        {/* App Grid */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {filteredApps.map((app) => (
            <button
              key={app.id}
              onClick={() => setSelectedApp(app)}
              className="bg-trakend-surface border border-trakend-border rounded-lg p-5 hover:border-trakend-accent transition-colors text-left group"
            >
              <div className="flex items-start justify-between mb-3">
                <div className="text-4xl">{app.icon}</div>
                <span className="px-2 py-1 rounded text-xs font-medium bg-trakend-accent/20 text-trakend-accent">
                  {app.category}
                </span>
              </div>
              <h3 className="text-lg font-semibold text-trakend-text-primary mb-2 group-hover:text-trakend-accent transition-colors">
                {app.name}
              </h3>
              <p className="text-sm text-trakend-text-secondary mb-3 line-clamp-2">{app.description}</p>
              <div className="flex items-center justify-between">
                <span className="text-xs text-trakend-text-secondary">{app.image}</span>
                <span className="text-xs text-trakend-accent font-medium">Deploy →</span>
              </div>
            </button>
          ))}
        </div>

        {filteredApps.length === 0 && (
          <div className="flex items-center justify-center py-16">
            <div className="text-center">
              <div className="text-6xl mb-4">🔍</div>
              <h2 className="text-xl font-semibold text-trakend-text-primary mb-2">No apps found</h2>
              <p className="text-trakend-text-secondary">Try adjusting your search filters</p>
            </div>
          </div>
        )}
      </div>

      {/* Deploy Dialog */}
      {selectedApp && (
        <AppDeployDialog
          app={selectedApp}
          onClose={() => setSelectedApp(null)}
          onDeploy={async (containerName, config) => {
            // This will be handled by the parent component
            onDeployApp?.(selectedApp)
            setSelectedApp(null)
          }}
        />
      )}
    </div>
  )
}
