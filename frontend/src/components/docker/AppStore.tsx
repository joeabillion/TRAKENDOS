import React, { useState, useMemo } from 'react'
import { Search } from 'lucide-react'
import { AppDeployDialog } from './AppDeployDialog'
import { APP_TEMPLATES } from './appTemplates'

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

// Build categories dynamically from the template library
const CATEGORIES = ['All', ...Array.from(new Set(APP_TEMPLATES.map(a => a.category))).sort()]

interface AppStoreProps {
  onDeployApp?: (app: AppTemplate) => void
}

export const AppStore: React.FC<AppStoreProps> = ({ onDeployApp }) => {
  const [searchQuery, setSearchQuery] = useState('')
  const [selectedCategory, setSelectedCategory] = useState('All')
  const [selectedApp, setSelectedApp] = useState<AppTemplate | null>(null)

  const filteredApps = useMemo(() => APP_TEMPLATES.filter((app) => {
    const matchesCategory = selectedCategory === 'All' || app.category === selectedCategory
    const matchesSearch = !searchQuery.trim() || app.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      app.description.toLowerCase().includes(searchQuery.toLowerCase()) ||
      app.image.toLowerCase().includes(searchQuery.toLowerCase())
    return matchesCategory && matchesSearch
  }), [searchQuery, selectedCategory])

  const categoryCount = useMemo(() => {
    const counts: Record<string, number> = { All: APP_TEMPLATES.length }
    for (const app of APP_TEMPLATES) {
      counts[app.category] = (counts[app.category] || 0) + 1
    }
    return counts
  }, [])

  return (
    <div className="flex-1 overflow-y-auto bg-trakend-dark">
      <div className="p-8">
        {/* Header */}
        <div className="mb-8">
          <h1 className="text-3xl font-bold text-trakend-text-primary mb-2">App Store</h1>
          <p className="text-trakend-text-secondary">{APP_TEMPLATES.length} apps available • Deploy pre-configured container templates</p>
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
              {category} <span className="ml-1 opacity-60 text-xs">({categoryCount[category] || 0})</span>
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
