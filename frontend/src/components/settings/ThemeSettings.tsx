import React from 'react'
import { useTheme } from '../../context/ThemeContext'
import { RotateCcw } from 'lucide-react'

export const ThemeSettings: React.FC = () => {
  const { colors, isDark, setIsDark, updateColors, resetToDefault } = useTheme()

  const colorFields = [
    { key: 'primary', label: 'Primary Background' },
    { key: 'secondary', label: 'Secondary Background' },
    { key: 'accent', label: 'Accent Color' },
    { key: 'surface', label: 'Surface Color' },
    { key: 'success', label: 'Success Color' },
    { key: 'warning', label: 'Warning Color' },
    { key: 'error', label: 'Error Color' },
    { key: 'info', label: 'Info Color' },
  ] as const

  const presets = [
    {
      name: 'Dark (Default)',
      colors: {
        primary: '#1a1a1a',
        secondary: '#2a2a2a',
        accent: '#ff6b35',
        surface: '#3a3a3a',
        success: '#00d4aa',
        warning: '#ffa502',
        error: '#ff3860',
        info: '#3273dc',
      },
    },
    {
      name: 'Ocean',
      colors: {
        primary: '#0a0e27',
        secondary: '#1a2a47',
        accent: '#00d9ff',
        surface: '#2a3a57',
        success: '#00ff88',
        warning: '#ffaa00',
        error: '#ff3366',
        info: '#00d9ff',
      },
    },
    {
      name: 'Forest',
      colors: {
        primary: '#0f1419',
        secondary: '#1a2f1a',
        accent: '#4ade80',
        surface: '#2a3f2a',
        success: '#86efac',
        warning: '#fbbf24',
        error: '#f87171',
        info: '#38bdf8',
      },
    },
  ]

  const handleColorChange = (key: string, value: string) => {
    updateColors({ [key]: value })
  }

  const applyPreset = (preset: (typeof presets)[number]) => {
    updateColors(preset.colors)
  }

  return (
    <div className="max-w-4xl space-y-8">
      {/* Dark/Light Mode Toggle */}
      <div className="flex items-center gap-4 p-4 bg-trakend-surface rounded-lg border border-trakend-border">
        <div>
          <div className="text-sm font-semibold text-trakend-text-primary">Theme Mode</div>
          <p className="text-xs text-trakend-text-secondary">Choose between dark and light interface</p>
        </div>
        <div className="ml-auto flex gap-2">
          <button
            onClick={() => setIsDark(true)}
            className={`px-4 py-2 rounded-lg transition-colors ${
              isDark
                ? 'bg-trakend-accent text-white'
                : 'bg-trakend-dark text-trakend-text-secondary hover:text-trakend-text-primary'
            }`}
          >
            Dark
          </button>
          <button
            onClick={() => setIsDark(false)}
            className={`px-4 py-2 rounded-lg transition-colors ${
              !isDark
                ? 'bg-trakend-accent text-white'
                : 'bg-trakend-dark text-trakend-text-secondary hover:text-trakend-text-primary'
            }`}
          >
            Light
          </button>
        </div>
      </div>

      {/* Color Presets */}
      <div>
        <h3 className="text-sm font-semibold text-trakend-text-primary mb-3">Color Presets</h3>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {presets.map((preset) => (
            <button
              key={preset.name}
              onClick={() => applyPreset(preset)}
              className="p-4 bg-trakend-surface border border-trakend-border rounded-lg hover:border-trakend-accent transition-colors text-left"
            >
              <div className="text-sm font-semibold text-trakend-text-primary mb-3">{preset.name}</div>
              <div className="grid grid-cols-4 gap-2">
                {Object.values(preset.colors).map((color, i) => (
                  <div
                    key={i}
                    className="h-8 rounded border border-trakend-border"
                    style={{ backgroundColor: color }}
                  />
                ))}
              </div>
            </button>
          ))}
        </div>
      </div>

      {/* Custom Color Picker */}
      <div>
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-sm font-semibold text-trakend-text-primary">Custom Colors</h3>
          <button
            onClick={resetToDefault}
            className="flex items-center gap-2 px-3 py-1 text-xs rounded bg-trakend-dark hover:bg-trakend-surface-light transition-colors text-trakend-text-secondary"
          >
            <RotateCcw size={14} />
            Reset
          </button>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {colorFields.map(({ key, label }) => (
            <div key={key} className="p-4 bg-trakend-surface border border-trakend-border rounded-lg">
              <label className="block text-sm font-semibold text-trakend-text-primary mb-3">{label}</label>
              <div className="flex items-center gap-3">
                <input
                  type="color"
                  value={colors[key as keyof typeof colors]}
                  onChange={(e) => handleColorChange(key, e.target.value)}
                  className="w-12 h-12 rounded cursor-pointer border border-trakend-border"
                />
                <input
                  type="text"
                  value={colors[key as keyof typeof colors]}
                  onChange={(e) => handleColorChange(key, e.target.value)}
                  className="flex-1 bg-trakend-dark border border-trakend-border rounded px-3 py-2 text-sm text-trakend-text-primary font-mono focus:outline-none focus:border-trakend-accent"
                />
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Preview */}
      <div>
        <h3 className="text-sm font-semibold text-trakend-text-primary mb-3">Preview</h3>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="p-4 rounded-lg" style={{ backgroundColor: colors.primary }}>
            <div className="text-sm font-semibold" style={{ color: colors.accent }}>
              Accent Text
            </div>
            <div className="text-xs mt-2 opacity-70">Secondary text</div>
          </div>
          <div className="p-4 rounded-lg" style={{ backgroundColor: colors.surface }}>
            <button
              className="px-4 py-2 rounded text-white text-sm font-semibold transition-all"
              style={{ backgroundColor: colors.accent }}
            >
              Sample Button
            </button>
          </div>
          <div className="p-4 rounded-lg" style={{ backgroundColor: colors.primary }}>
            <div className="text-sm font-semibold" style={{ color: colors.success }}>
              Success - Everything is good
            </div>
          </div>
          <div className="p-4 rounded-lg" style={{ backgroundColor: colors.primary }}>
            <div className="text-sm font-semibold" style={{ color: colors.error }}>
              Error - Something went wrong
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
