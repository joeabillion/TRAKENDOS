/**
 * Terminal preferences + persisted tab state (localStorage).
 */

export const TERMINAL_FONT_STACK =
  '"JetBrainsMono Nerd Font", "JetBrainsMono NF", "FiraCode Nerd Font", "MesloLGS NF", "Hack Nerd Font", ' +
  '"JetBrains Mono", "Fira Code", "Cascadia Code", "Cascadia Mono", "SF Mono", Menlo, Monaco, Consolas, ' +
  '"DejaVu Sans Mono", "Liberation Mono", "Ubuntu Mono", "Courier New", monospace'

export const FONT_SIZE_MIN = 8
export const FONT_SIZE_MAX = 32
export const FONT_SIZE_DEFAULT = 13

const KEY_FONT_SIZE = 'trakend-terminal-font-size'
const KEY_COPY_ON_SELECT = 'trakend-terminal-copy-on-select'
const KEY_TABS = 'trakend-terminal-tabs-v2'
const KEY_SHELL = 'trakend-terminal-default-shell'

export interface PersistedTab {
  id: string
  sessionId: string | null
  title: string
  shell: string
  /** True when the user renamed the tab (don't overwrite with OSC titles). */
  customTitle?: boolean
}

export function loadFontSize(): number {
  const raw = Number(localStorage.getItem(KEY_FONT_SIZE))
  if (!raw || Number.isNaN(raw)) return FONT_SIZE_DEFAULT
  return clampFontSize(raw)
}

export function saveFontSize(size: number): void {
  localStorage.setItem(KEY_FONT_SIZE, String(clampFontSize(size)))
}

export function clampFontSize(size: number): number {
  return Math.max(FONT_SIZE_MIN, Math.min(FONT_SIZE_MAX, Math.round(size)))
}

export function loadCopyOnSelect(): boolean {
  const raw = localStorage.getItem(KEY_COPY_ON_SELECT)
  return raw === null ? true : raw === 'true'
}

export function saveCopyOnSelect(v: boolean): void {
  localStorage.setItem(KEY_COPY_ON_SELECT, String(v))
}

export function loadDefaultShell(): string {
  return localStorage.getItem(KEY_SHELL) || 'auto'
}

export function saveDefaultShell(shell: string): void {
  localStorage.setItem(KEY_SHELL, shell)
}

export function loadTabs(): { tabs: PersistedTab[]; activeId: string | null } {
  try {
    const raw = localStorage.getItem(KEY_TABS)
    if (!raw) return { tabs: [], activeId: null }
    const parsed = JSON.parse(raw)
    if (!parsed || !Array.isArray(parsed.tabs)) return { tabs: [], activeId: null }
    const tabs: PersistedTab[] = parsed.tabs
      .filter((t: any) => t && typeof t.id === 'string')
      .map((t: any) => ({
        id: String(t.id),
        sessionId: typeof t.sessionId === 'string' ? t.sessionId : null,
        title: typeof t.title === 'string' && t.title ? t.title : 'Terminal',
        shell: typeof t.shell === 'string' ? t.shell : 'auto',
        customTitle: !!t.customTitle,
      }))
    const activeId = typeof parsed.activeId === 'string' && tabs.some((t) => t.id === parsed.activeId) ? parsed.activeId : tabs[0]?.id ?? null
    return { tabs, activeId }
  } catch {
    return { tabs: [], activeId: null }
  }
}

export function saveTabs(tabs: PersistedTab[], activeId: string | null): void {
  try {
    localStorage.setItem(KEY_TABS, JSON.stringify({ tabs, activeId }))
  } catch {
    /* quota — ignore */
  }
}

export function newTabId(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
}

/** Shell names that mean "nothing is running in the foreground". */
export const IDLE_SHELL_PROCESSES = new Set(['bash', 'sh', 'zsh', 'pwsh', 'dash', 'fish', 'ash', ''])
