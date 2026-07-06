import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react'

export type Tab = { path: string; name: string; content: string; dirty: boolean }

type View = 'explorer' | 'search' | 'git' | 'studio' | 'settings'

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
  view: View
  setView: (v: View) => void
  aiOpen: boolean
  setAiOpen: (b: boolean) => void
  termOpen: boolean
  setTermOpen: (b: boolean) => void
  paletteOpen: boolean
  setPaletteOpen: (b: boolean) => void
  routeName: string
  setRouteName: (s: string) => void
}

// Exact same background-photo mapping the website uses (Workspace.bgFor): the
// backdrop changes to match the active Nalu model/specialist.
export function bgFor(name: string): string {
  const n = name.toLowerCase()
  if (n.includes('catalina') || !n) return '/bg/catalina.png'
  if (/code|reason|cad|design|studio|vision/.test(n)) return '/bg/tech.png'
  if (/financ|crypto|real estate|legal|health|marketing|hr|social|cre/.test(n)) return '/bg/business.png'
  if (/image|video|slide|doc|sheet|math|science/.test(n)) return '/bg/creative.png'
  return '/bg/tech.png'
}

const WorkspaceCtx = createContext<Ctx | null>(null)

export function WorkspaceProvider({ children }: { children: ReactNode }) {
  const [folder, setFolder] = useState<string | null>(null)
  const [tabs, setTabs] = useState<Tab[]>([])
  const [activePath, setActivePath] = useState<string | null>(null)
  const [view, setView] = useState<View>('explorer')
  const [aiOpen, setAiOpen] = useState(true)
  const [termOpen, setTermOpen] = useState(false)
  const [paletteOpen, setPaletteOpen] = useState(false)
  const [routeName, setRouteName] = useState('nalu-catalina')

  const openFolder = useCallback(async () => {
    const dir = await window.nalu.openFolder()
    if (dir) setFolder(dir)
  }, [])

  const openFile = useCallback(async (path: string, name: string) => {
    setTabs((prev) => {
      if (prev.some((t) => t.path === path)) return prev
      return prev // content loaded below
    })
    const existing = tabs.find((t) => t.path === path)
    if (!existing) {
      const content = await window.nalu.readFile(path)
      setTabs((prev) => (prev.some((t) => t.path === path) ? prev : [...prev, { path, name, content, dirty: false }]))
    }
    setActivePath(path)
  }, [tabs])

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
  }, [tabs, activePath])

  const active = useMemo(() => tabs.find((t) => t.path === activePath) ?? null, [tabs, activePath])

  const value: Ctx = {
    folder, openFolder,
    tabs, activePath, active,
    openFile, setActive: setActivePath, closeTab, editActive, saveActive,
    view, setView,
    aiOpen, setAiOpen, termOpen, setTermOpen, paletteOpen, setPaletteOpen,
    routeName, setRouteName,
  }
  return <WorkspaceCtx.Provider value={value}>{children}</WorkspaceCtx.Provider>
}

export function useWorkspace(): Ctx {
  const c = useContext(WorkspaceCtx)
  if (!c) throw new Error('useWorkspace outside provider')
  return c
}
