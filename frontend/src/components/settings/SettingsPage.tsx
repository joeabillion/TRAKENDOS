import React, { useState } from 'react'
import { Save, RotateCcw } from 'lucide-react'
import { ThemeSettings } from './ThemeSettings'
import { SharesSettings } from './SharesSettings'

type SettingsTab = 'general' | 'ssh' | 'docker' | 'shares' | 'theme' | 'maya' | 'updates'

export const SettingsPage: React.FC = () => {
  const [activeTab, setActiveTab] = useState<SettingsTab>('general')
  const [saved, setSaved] = useState(false)

  const handleSave = () => {
    setSaved(true)
    setTimeout(() => setSaved(false), 3000)
  }

  const tabs: { id: SettingsTab; label: string }[] = [
    { id: 'general', label: 'General' },
    { id: 'ssh', label: 'SSH' },
    { id: 'docker', label: 'Docker' },
    { id: 'shares', label: 'Shares & Users' },
    { id: 'theme', label: 'Theme' },
    { id: 'maya', label: 'Maya AI' },
    { id: 'updates', label: 'Updates' },
  ]

  return (
    <div className="flex-1 bg-trakend-dark h-full flex flex-col overflow-hidden">
      <div className="flex h-full overflow-hidden">
        {/* Tab Navigation */}
        <div className="w-56 bg-trakend-surface border-r border-trakend-border flex flex-col">
          <div className="p-6 border-b border-trakend-border">
            <h1 className="text-2xl font-bold text-trakend-text-primary">Settings</h1>
          </div>
          <nav className="flex-1 overflow-y-auto py-4">
            {tabs.map((tab) => (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={`w-full text-left px-6 py-3 transition-colors ${
                  activeTab === tab.id
                    ? 'bg-trakend-accent text-white border-l-4 border-white'
                    : 'text-trakend-text-secondary hover:text-trakend-text-primary hover:bg-trakend-surface-light'
                }`}
              >
                {tab.label}
              </button>
            ))}
          </nav>
        </div>

        {/* Content Area */}
        <div className="flex-1 flex flex-col overflow-hidden">
          {/* Header */}
          <div className="border-b border-trakend-border bg-trakend-surface px-8 py-4 flex items-center justify-between">
            <h2 className="text-lg font-semibold text-trakend-text-primary">
              {tabs.find((t) => t.id === activeTab)?.label}
            </h2>
            <div className="flex gap-3">
              {saved && <span className="text-trakend-success text-sm">✓ Saved</span>}
              <button
                onClick={handleSave}
                className="flex items-center gap-2 px-4 py-2 rounded-lg bg-trakend-accent text-white hover:bg-trakend-accent-dark transition-colors"
              >
                <Save size={16} />
                Save
              </button>
            </div>
          </div>

          {/* Content */}
          <div className="flex-1 overflow-y-auto p-8">
            {activeTab === 'general' && <GeneralSettings />}
            {activeTab === 'ssh' && <SSHSettings />}
            {activeTab === 'docker' && <DockerSettings />}
            {activeTab === 'shares' && <SharesSettings />}
            {activeTab === 'theme' && <ThemeSettings />}
            {activeTab === 'maya' && <MayaSettings />}
            {activeTab === 'updates' && <UpdatesSettings />}
          </div>
        </div>
      </div>
    </div>
  )
}

const GeneralSettings: React.FC = () => {
  const [hostname, setHostname] = useState('trakend-server')
  const [timezone, setTimezone] = useState('America/New_York')
  const [language, setLanguage] = useState('en')

  return (
    <div className="max-w-2xl space-y-6">
      <div>
        <label className="block text-sm font-semibold text-trakend-text-primary mb-2">Hostname</label>
        <input
          type="text"
          value={hostname}
          onChange={(e) => setHostname(e.target.value)}
          className="w-full bg-trakend-surface border border-trakend-border rounded-lg px-4 py-2 text-trakend-text-primary focus:outline-none focus:border-trakend-accent"
        />
        <p className="text-xs text-trakend-text-secondary mt-1">Server identification name</p>
      </div>

      <div>
        <label className="block text-sm font-semibold text-trakend-text-primary mb-2">Timezone</label>
        <select
          value={timezone}
          onChange={(e) => setTimezone(e.target.value)}
          className="w-full bg-trakend-surface border border-trakend-border rounded-lg px-4 py-2 text-trakend-text-primary focus:outline-none focus:border-trakend-accent"
        >
          <option>America/New_York</option>
          <option>America/Chicago</option>
          <option>America/Denver</option>
          <option>America/Los_Angeles</option>
          <option>UTC</option>
          <option>Europe/London</option>
          <option>Europe/Paris</option>
          <option>Asia/Tokyo</option>
        </select>
      </div>

      <div>
        <label className="block text-sm font-semibold text-trakend-text-primary mb-2">Language</label>
        <select
          value={language}
          onChange={(e) => setLanguage(e.target.value)}
          className="w-full bg-trakend-surface border border-trakend-border rounded-lg px-4 py-2 text-trakend-text-primary focus:outline-none focus:border-trakend-accent"
        >
          <option value="en">English</option>
          <option value="es">Español</option>
          <option value="fr">Français</option>
          <option value="de">Deutsch</option>
          <option value="ja">日本語</option>
        </select>
      </div>
    </div>
  )
}

const SSHSettings: React.FC = () => {
  const [port, setPort] = useState('22')
  const [passwordAuth, setPasswordAuth] = useState(true)
  const [keyAuth, setKeyAuth] = useState(true)

  return (
    <div className="max-w-2xl space-y-6">
      <div>
        <label className="block text-sm font-semibold text-trakend-text-primary mb-2">SSH Port</label>
        <input
          type="number"
          value={port}
          onChange={(e) => setPort(e.target.value)}
          className="w-full bg-trakend-surface border border-trakend-border rounded-lg px-4 py-2 text-trakend-text-primary focus:outline-none focus:border-trakend-accent"
        />
      </div>

      <div className="space-y-3">
        <label className="flex items-center gap-3 cursor-pointer">
          <input
            type="checkbox"
            checked={passwordAuth}
            onChange={(e) => setPasswordAuth(e.target.checked)}
            className="w-4 h-4"
          />
          <span className="text-trakend-text-primary">Allow Password Authentication</span>
        </label>

        <label className="flex items-center gap-3 cursor-pointer">
          <input
            type="checkbox"
            checked={keyAuth}
            onChange={(e) => setKeyAuth(e.target.checked)}
            className="w-4 h-4"
          />
          <span className="text-trakend-text-primary">Allow Key-based Authentication</span>
        </label>
      </div>

      <div>
        <label className="block text-sm font-semibold text-trakend-text-primary mb-2">Authorized Keys</label>
        <textarea
          className="w-full h-32 bg-trakend-surface border border-trakend-border rounded-lg px-4 py-2 text-trakend-text-primary focus:outline-none focus:border-trakend-accent font-mono text-xs resize-none"
          placeholder="Paste your SSH public keys here..."
        />
      </div>
    </div>
  )
}

const DockerSettings: React.FC = () => {
  const [daemon, setDaemon] = useState('unix')
  const [network, setNetwork] = useState('bridge')
  const [storage, setStorage] = useState('overlay2')

  return (
    <div className="max-w-2xl space-y-6">
      <div>
        <label className="block text-sm font-semibold text-trakend-text-primary mb-2">Daemon Socket</label>
        <select
          value={daemon}
          onChange={(e) => setDaemon(e.target.value)}
          className="w-full bg-trakend-surface border border-trakend-border rounded-lg px-4 py-2 text-trakend-text-primary focus:outline-none focus:border-trakend-accent"
        >
          <option value="unix">Unix Socket</option>
          <option value="tcp">TCP</option>
        </select>
      </div>

      <div>
        <label className="block text-sm font-semibold text-trakend-text-primary mb-2">Default Network Driver</label>
        <select
          value={network}
          onChange={(e) => setNetwork(e.target.value)}
          className="w-full bg-trakend-surface border border-trakend-border rounded-lg px-4 py-2 text-trakend-text-primary focus:outline-none focus:border-trakend-accent"
        >
          <option value="bridge">Bridge</option>
          <option value="host">Host</option>
          <option value="overlay">Overlay</option>
          <option value="macvlan">Macvlan</option>
        </select>
      </div>

      <div>
        <label className="block text-sm font-semibold text-trakend-text-primary mb-2">Storage Driver</label>
        <select
          value={storage}
          onChange={(e) => setStorage(e.target.value)}
          className="w-full bg-trakend-surface border border-trakend-border rounded-lg px-4 py-2 text-trakend-text-primary focus:outline-none focus:border-trakend-accent"
        >
          <option value="overlay2">Overlay2</option>
          <option value="aufs">AUFS</option>
          <option value="btrfs">Btrfs</option>
          <option value="zfs">ZFS</option>
        </select>
      </div>
    </div>
  )
}

const MayaSettings: React.FC = () => {
  const [enabled, setEnabled] = useState(true)
  const [frequency, setFrequency] = useState('daily')
  const [autoRepair, setAutoRepair] = useState(false)
  const [notifications, setNotifications] = useState(true)

  return (
    <div className="max-w-2xl space-y-6">
      <label className="flex items-center gap-3 cursor-pointer">
        <input
          type="checkbox"
          checked={enabled}
          onChange={(e) => setEnabled(e.target.checked)}
          className="w-4 h-4"
        />
        <span className="text-trakend-text-primary font-semibold">Enable Maya AI</span>
      </label>

      <div>
        <label className="block text-sm font-semibold text-trakend-text-primary mb-2">Scan Frequency</label>
        <select
          value={frequency}
          onChange={(e) => setFrequency(e.target.value)}
          className="w-full bg-trakend-surface border border-trakend-border rounded-lg px-4 py-2 text-trakend-text-primary focus:outline-none focus:border-trakend-accent"
        >
          <option value="hourly">Hourly</option>
          <option value="daily">Daily</option>
          <option value="weekly">Weekly</option>
          <option value="monthly">Monthly</option>
        </select>
      </div>

      <label className="flex items-center gap-3 cursor-pointer">
        <input
          type="checkbox"
          checked={autoRepair}
          onChange={(e) => setAutoRepair(e.target.checked)}
          className="w-4 h-4"
        />
        <div>
          <span className="text-trakend-text-primary">Auto-repair Issues</span>
          <p className="text-xs text-trakend-text-secondary">Automatically fix detected problems</p>
        </div>
      </label>

      <label className="flex items-center gap-3 cursor-pointer">
        <input
          type="checkbox"
          checked={notifications}
          onChange={(e) => setNotifications(e.target.checked)}
          className="w-4 h-4"
        />
        <span className="text-trakend-text-primary">Enable Notifications</span>
      </label>
    </div>
  )
}

const UpdatesSettings: React.FC = () => {
  const [checkFrequency, setCheckFrequency] = useState('daily')
  const [autoUpdate, setAutoUpdate] = useState(false)

  return (
    <div className="max-w-2xl space-y-6">
      <div className="p-4 bg-trakend-surface border border-trakend-border rounded-lg">
        <div className="text-sm font-semibold text-trakend-text-primary mb-1">Current Version</div>
        <div className="text-2xl font-bold text-trakend-accent">v1.0.000</div>
        <p className="text-xs text-trakend-text-secondary mt-2">Released: March 31, 2026</p>
      </div>

      <div>
        <label className="block text-sm font-semibold text-trakend-text-primary mb-2">Check Frequency</label>
        <select
          value={checkFrequency}
          onChange={(e) => setCheckFrequency(e.target.value)}
          className="w-full bg-trakend-surface border border-trakend-border rounded-lg px-4 py-2 text-trakend-text-primary focus:outline-none focus:border-trakend-accent"
        >
          <option value="hourly">Hourly</option>
          <option value="daily">Daily</option>
          <option value="weekly">Weekly</option>
          <option value="never">Never</option>
        </select>
      </div>

      <label className="flex items-center gap-3 cursor-pointer">
        <input
          type="checkbox"
          checked={autoUpdate}
          onChange={(e) => setAutoUpdate(e.target.checked)}
          className="w-4 h-4"
        />
        <div>
          <span className="text-trakend-text-primary">Automatically Update</span>
          <p className="text-xs text-trakend-text-secondary">Install updates without confirmation</p>
        </div>
      </label>

      <button className="px-6 py-2 rounded-lg bg-trakend-accent text-white hover:bg-trakend-accent-dark transition-colors">
        Check for Updates
      </button>

      <div className="pt-4 border-t border-trakend-border">
        <h3 className="text-sm font-semibold text-trakend-text-primary mb-3">Update History</h3>
        <div className="space-y-2">
          <div className="p-2 bg-trakend-surface rounded text-sm">
            <div className="text-trakend-text-primary">v1.0.000 - Latest</div>
            <div className="text-xs text-trakend-text-secondary">Mar 31, 2026</div>
          </div>
          <div className="p-2 bg-trakend-surface rounded text-sm">
            <div className="text-trakend-text-primary">v0.9.0</div>
            <div className="text-xs text-trakend-text-secondary">Dec 15, 2023</div>
          </div>
        </div>
      </div>
    </div>
  )
}
