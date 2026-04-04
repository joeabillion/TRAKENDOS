import React, { createContext, useContext, useEffect, useState } from 'react'

interface ThemeColors {
  primary: string
  secondary: string
  accent: string
  background: string
  surface: string
  success: string
  warning: string
  error: string
  info: string
}

const defaultDarkTheme: ThemeColors = {
  primary: '#1e2128',
  secondary: '#252830',
  accent: '#2ab5b2',
  background: '#171a1f',
  surface: '#2e3240',
  success: '#00d4aa',
  warning: '#ffa502',
  error: '#ff3860',
  info: '#3273dc',
}

const defaultLightTheme: ThemeColors = {
  primary: '#ffffff',
  secondary: '#f5f6fa',
  accent: '#2ab5b2',
  background: '#eef0f5',
  surface: '#e8eaf0',
  success: '#00d4aa',
  warning: '#ffa502',
  error: '#ff3860',
  info: '#3273dc',
}

interface ThemeContextType {
  colors: ThemeColors
  isDark: boolean
  setIsDark: (isDark: boolean) => void
  updateColors: (colors: Partial<ThemeColors>) => void
  resetToDefault: () => void
  applyTheme: (colors: ThemeColors) => void
}

const ThemeContext = createContext<ThemeContextType | undefined>(undefined)

export const ThemeProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [isDark, setIsDark] = useState(true)
  const [colors, setColors] = useState<ThemeColors>(defaultDarkTheme)

  // Load theme from localStorage on mount
  useEffect(() => {
    const savedTheme = localStorage.getItem('theme-settings')
    if (savedTheme) {
      try {
        const parsed = JSON.parse(savedTheme)
        setIsDark(parsed.isDark !== false)
        setColors({ ...(parsed.isDark !== false ? defaultDarkTheme : defaultLightTheme), ...parsed.colors })
      } catch (e) {
        console.error('Failed to load theme:', e)
      }
    }
  }, [])

  // Apply CSS variables whenever theme changes
  useEffect(() => {
    const root = document.documentElement
    root.style.setProperty('--color-bg-primary', colors.primary)
    root.style.setProperty('--color-bg-darker', colors.background)
    root.style.setProperty('--color-bg-secondary', colors.secondary)
    root.style.setProperty('--color-surface', colors.surface)
    root.style.setProperty('--color-border', adjustBrightness(colors.surface, isDark ? -15 : -10))
    root.style.setProperty('--color-text-primary', isDark ? '#e2e4e9' : '#1a1f2e')
    root.style.setProperty('--color-text-secondary', isDark ? '#8b8fa3' : '#6b7280')
    root.style.setProperty('--color-accent', colors.accent)
    root.style.setProperty('--color-accent-dark', adjustBrightness(colors.accent, -15))
    root.style.setProperty('--color-accent-light', adjustBrightness(colors.accent, 20))
    root.style.setProperty('--color-success', colors.success)
    root.style.setProperty('--color-warning', colors.warning)
    root.style.setProperty('--color-error', colors.error)
    root.style.setProperty('--color-info', colors.info)

    if (isDark) {
      document.documentElement.classList.add('dark')
    } else {
      document.documentElement.classList.remove('dark')
    }
  }, [colors, isDark])

  const handleSetIsDark = (dark: boolean) => {
    setIsDark(dark)
    const newColors = dark ? { ...defaultDarkTheme, ...colors } : { ...defaultLightTheme, ...colors }
    setColors(newColors)
    saveTheme(dark, newColors)
  }

  const updateColors = (newColors: Partial<ThemeColors>) => {
    const updated = { ...colors, ...newColors }
    setColors(updated)
    saveTheme(isDark, updated)
  }

  const resetToDefault = () => {
    const theme = isDark ? defaultDarkTheme : defaultLightTheme
    setColors(theme)
    saveTheme(isDark, theme)
  }

  const applyTheme = (theme: ThemeColors) => {
    setColors(theme)
    saveTheme(isDark, theme)
  }

  const saveTheme = (dark: boolean, themeColors: ThemeColors) => {
    localStorage.setItem(
      'theme-settings',
      JSON.stringify({
        isDark: dark,
        colors: themeColors,
      })
    )
  }

  const value: ThemeContextType = {
    colors,
    isDark,
    setIsDark: handleSetIsDark,
    updateColors,
    resetToDefault,
    applyTheme,
  }

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>
}

export const useTheme = () => {
  const context = useContext(ThemeContext)
  if (!context) {
    throw new Error('useTheme must be used within ThemeProvider')
  }
  return context
}

function adjustBrightness(color: string, percent: number): string {
  const hex = color.replace('#', '')
  const r = parseInt(hex.substring(0, 2), 16)
  const g = parseInt(hex.substring(2, 4), 16)
  const b = parseInt(hex.substring(4, 6), 16)

  const adjusted = (val: number) => {
    const newVal = Math.round(val + val * (percent / 100))
    return Math.max(0, Math.min(255, newVal))
  }

  return '#' + [adjusted(r), adjusted(g), adjusted(b)].map((x) => x.toString(16).padStart(2, '0')).join('')
}
