import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import { currentUser, type NaluUser } from './naluApi'

export type Tab = { path: string; name: string; content: string; dirty: boolean }

type Ctx = {
  folder: string | null
  openFolder: () => Promise<void>
  tabs: Tab[]
  activePath: string | null
  active: Tab | null
  openFile: (path: string, name: string) => Promise<void>
  setActive: (path: string) => void
  closeTab: (path: string) => void
  editActive: (content: string) => void
  saveActive: () => Promise<void>
  // one drawer (files), one bottom panel (terminal), one modal (settings)
  filesOpen: boolean
  setFilesOpen: (b: boolean) => void
  termOpen: boolean
  setTermOpen: (b: boolean) => void
  paletteOpen: boolean
  setPaletteOpen: (b: boolean) => void
  settingsOpen: boolean
  setSettingsOpen: (b: boolean) => void
  routeName: string
  setRouteName: (s: string) => void
  refreshKey: number
  refresh: () => void
  drawerMode: 'files' | 'search' | 'git'
  setDrawerMode: (m: 'files' | 'search' | 'git') => void
  filesWidth: number
  setFilesWidth: (w: number) => void
  reveal: { path: string; line: number } | null
  openAt: (path: string, name: string, line: number) => Promise<void>
  // Nalu (website-like chat) vs IDE — interchangeable.
  appMode: 'nalu' | 'ide'
  setAppMode: (m: 'nalu' | 'ide') => void
  user: NaluUser | null
  setUser: (u: NaluUser | null) => void
}

// Exact same background-photo mapping the website uses (Workspace.bgFor): the
// backdrop changes to match the active Nalu model/specialist.
// IMPORTANT: use the Vite BASE_URL so the path is RELATIVE to the app — a bare
// "/bg/…" resolves to the disk root under file:// in the packaged app and the
// backgrounds vanish. BASE_URL is "./" in the build, "/" in dev — both correct.
export function bgFor(name: string): string {
  const base = import.meta.env.BASE_URL || './'
  const file =
    (name && /code|reason|cad|design|studio|vision/.test(name.toLowerCase())) ? 'tech.png'
    : (name && /financ|crypto|real estate|legal|health|marketing|hr|social|cre/.test(name.toLowerCase())) ? 'business.png'
    : (name && /image|video|slide|doc|sheet|math|science/.test(name.toLowerCase())) ? 'creative.png'
    : (!name || name.toLowerCase().includes('catalina')) ? 'catalina.png'
    : 'tech.png'
  return `${base}bg/${file}`
}

const WorkspaceCtx = createContext<Ctx | null>(null)

export function WorkspaceProvider({ children }: { children: ReactNode }) {
  const [folder, setFolder] = useState<string | null>(null)
  const [tabs, setTabs] = useState<Tab[]>([])
  const [activePath, setActivePath] = useState<string | null>(null)
  const [filesOpen, setFilesOpen] = useState(true)
  const [termOpen, setTermOpen] = useState(false)
  const [paletteOpen, setPaletteOpen] = useState(false)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [routeName, setRouteName] = useState('nalu-catalina')
  const [refreshKey, setRefreshKey] = useState(0)
  const refresh = useCallback(() => setRefreshKey((k) => k + 1), [])
  const [drawerMode, setDrawerMode] = useState<'files' | 'search' | 'git'>('files')
  const [reveal, setReveal] = useState<{ path: string; line: number } | null>(null)
  const [filesWidth, setFilesWidth] = useState(() => Number(localStorage.getItem('nalu-files-w')) || 240)
  // Default to the website-like Nalu chat if signed in, else the IDE.
  const [user, setUser] = useState<NaluUser | null>(() => currentUser())
  const [appMode, setAppModeState] = useState<'nalu' | 'ide'>(() => (localStorage.getItem('nalu-app-mode') as 'nalu' | 'ide') || (currentUser() ? 'nalu' : 'ide'))
  const setAppMode = useCallback((m: 'nalu' | 'ide') => { setAppModeState(m); localStorage.setItem('nalu-app-mode', m) }, [])

  const openFolder = useCallback(async () => {
    const dir = await window.nalu.openFolder()
    if (dir) { setFolder(dir); setFilesOpen(true) }
  }, [])

  const openFile = useCallback(async (path: string, name: string) => {
    const existing = tabs.find((t) => t.path === path)
    if (!existing) {
      const content = await window.nalu.readFile(path)
      setTabs((prev) => (prev.some((t) => t.path === path) ? prev : [...prev, { path, name, content, dirty: false }]))
    }
    setActivePath(path)
  }, [tabs])

  const openAt = useCallback(async (path: string, name: string, line: number) => {
    await openFile(path, name)
    setReveal({ path, line })
  }, [openFile])

  const closeTab = useCallback((path: string) => {
    setTabs((prev) => {
      const next = prev.filter((t) => t.path !== path)
      setActivePath((cur) => (cur === path ? next[next.length - 1]?.path ?? null : cur))
      return next
    })
  }, [])

  const editActive = useCallback((content: string) => {
    setTabs((prev) => prev.map((t) => (t.path === activePath ? { ...t, content, dirty: true } : t)))
  }, [activePath])

  const saveActive = useCallback(async () => {
    const t = tabs.find((x) => x.path === activePath)
    if (!t) return
    await window.nalu.writeFile(t.path, t.content)
    setTabs((prev) => prev.map((x) => (x.path === t.path ? { ...x, dirty: false } : x)))
    refresh() // update the git "Changes" view so edits show immediately
  }, [tabs, activePath, refresh])

  const active = useMemo(() => tabs.find((t) => t.path === activePath) ?? null, [tabs, activePath])

  // Auto-save (VS Code "afterDelay"): 700ms after the last edit, persist the file
  // so your changes always flow to disk + the Source Control view.
  useEffect(() => {
    const t = tabs.find((x) => x.path === activePath)
    if (!t || !t.dirty) return
    const id = setTimeout(() => { void saveActive() }, 700)
    return () => clearTimeout(id)
  }, [tabs, activePath, saveActive])

  const value: Ctx = {
    folder, openFolder,
    tabs, activePath, active,
    openFile, setActive: setActivePath, closeTab, editActive, saveActive,
    filesOpen, setFilesOpen, termOpen, setTermOpen, paletteOpen, setPaletteOpen,
    settingsOpen, setSettingsOpen, routeName, setRouteName,
    refreshKey, refresh,
    drawerMode, setDrawerMode, reveal, openAt,
    filesWidth, setFilesWidth: (w: number) => { const c = Math.max(180, Math.min(560, w)); setFilesWidth(c); localStorage.setItem('nalu-files-w', String(c)) },
    appMode, setAppMode, user, setUser,
  }
  return <WorkspaceCtx.Provider value={value}>{children}</WorkspaceCtx.Provider>
}

export function useWorkspace(): Ctx {
  const c = useContext(WorkspaceCtx)
  if (!c) throw new Error('useWorkspace outside provider')
  return c
}
