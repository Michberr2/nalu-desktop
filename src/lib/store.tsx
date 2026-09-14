import { createContext, useCallback, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { currentUser, type NaluUser } from './naluApi'

import { acknowledgeSave, acknowledgeSaveAs, reconcileDisk, relocatedPath, relocateTabs, detachDeletedTabs, applyProposedContent, type DocumentTab } from './documentState'
import { parseSession, restoreSession, snapshotSession } from './workspaceSession'
export type Tab = DocumentTab

type Ctx = {
  folder: string | null
  openFolder: () => Promise<void>
  openFolderAt: (dir: string) => void
  tabs: Tab[]
  recoveryError: string | null
  activePath: string | null
  active: Tab | null
  openFile: (path: string, name: string) => Promise<boolean>
  openError: { path: string; name: string; message: string } | null
  dismissOpenError: () => void
  setActive: (path: string) => void
  closeTab: (path: string) => void
  editActive: (content: string) => void
  applyEditProposal: (path: string, before: string, after: string) => boolean
  saveActive: (overwrite?: boolean) => Promise<void>
  saveActiveAs: () => Promise<void>
  useDiskVersion: () => void
  reloadTabs: () => Promise<void>
  renamePath: (from: string, to: string) => Promise<void>
  trashPath: (target: string) => Promise<void>
  // one drawer (files), one bottom panel (terminal), one modal (settings)
  filesOpen: boolean
  setFilesOpen: (b: boolean) => void
  termOpen: boolean
  setTermOpen: (b: boolean) => void
  paletteOpen: boolean
  quickOpen: boolean
  setQuickOpen: (b: boolean) => void
  setPaletteOpen: (b: boolean) => void
  settingsOpen: boolean
  setSettingsOpen: (b: boolean) => void
  appearance: 'focus' | 'scenic' | 'pastel'
  setAppearance: (value: 'focus' | 'scenic' | 'pastel') => void
  routeName: string
  setRouteName: (s: string) => void
  refreshKey: number
  refresh: () => void
  drawerMode: 'files' | 'search' | 'git'
  setDrawerMode: (m: 'files' | 'search' | 'git') => void
  filesWidth: number
  setFilesWidth: (w: number) => void
  termHeight: number
  setTermHeight: (h: number) => void
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
  // Legacy profiles keep the project in localStorage. The durable journal wins
  // once loaded, unless the user has already chosen another project this launch.
  const [folder, setFolder] = useState<string | null>(() => localStorage.getItem('nalu-last-folder'))
  const folderChosen = useRef(false)
  const [tabs, setTabs] = useState<Tab[]>([])
  const tabsRef = useRef<Tab[]>(tabs); tabsRef.current = tabs
  const saving = useRef(new Set<string>())
  const saveAsTargets = useRef(new Set<string>())
  const renaming = useRef<{ committed: boolean } | null>(null)
  const pathEpoch = useRef(0)
  const openRequest = useRef(0)
  const [openError, setOpenError] = useState<{ path: string; name: string; message: string } | null>(null)
  useLayoutEffect(() => {
    pathEpoch.current++; openRequest.current++; setOpenError(null)
  }, [folder])
  // Keep saves paused until React has committed the new paths. Releasing the
  // lock immediately after IPC could let an old autosave recreate the source.
  useEffect(() => {
    if (renaming.current?.committed) renaming.current = null
  }, [tabs])
  const [activePath, setActivePath] = useState<string | null>(null)
  const [recoveryReady, setRecoveryReady] = useState(false)
  const [recoveryError, setRecoveryError] = useState<string | null>(null)
  const recoveryLoad = useRef<Promise<void>>(Promise.resolve())
  const lastRecoverySnapshot = useRef('')
  useEffect(() => {
    let cancelled = false
    const recoveryAbort = new AbortController()
    recoveryLoad.current = (async () => {
      try {
        const raw = await window.nalu.loadWorkspace()
        if (cancelled) return
        const restored = raw ? await restoreSession(parseSession(raw), window.nalu.readFile, recoveryAbort.signal) : null
        if (cancelled) return
        if (restored) {
          if (restored.folder !== undefined && !folderChosen.current) setFolder(restored.folder)
          setTabs(current => [...current, ...restored.tabs.filter(tab => !current.some(t => t.path === tab.path))])
          setActivePath(current => current || restored.activePath)
        }
        setRecoveryReady(true)
      } catch (error) {
        if (!cancelled) setRecoveryError(`Recovery journal could not be opened: ${String(error)}`)
      }
    })()
    return () => { cancelled = true; recoveryAbort.abort() }
  }, [])
  useEffect(() => {
    if (!recoveryReady) return
    const snapshot = JSON.stringify(snapshotSession(tabs, activePath, folder))
    if (snapshot === lastRecoverySnapshot.current) return
    lastRecoverySnapshot.current = snapshot
    void window.nalu.saveWorkspace(snapshot)
      .then(() => setRecoveryError(null), error => {
        if (lastRecoverySnapshot.current === snapshot) lastRecoverySnapshot.current = ''
        setRecoveryError(`Unsaved edits could not be backed up: ${String(error)}`)
      })
  }, [tabs, activePath, folder, recoveryReady])
  const [filesOpen, setFilesOpen] = useState(true)
  const [termOpen, setTermOpen] = useState(false)
  const [paletteOpen, setPaletteOpen] = useState(false)
  const [quickOpen, setQuickOpen] = useState(false)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [appearance, setAppearanceState] = useState<'focus' | 'scenic' | 'pastel'>(() => { const saved = localStorage.getItem('nalu-appearance'); return saved === 'focus' || saved === 'scenic' ? saved : 'pastel' })
  useEffect(() => { document.documentElement.dataset.appearance = appearance }, [appearance])
  const setAppearance = useCallback((value: 'focus' | 'scenic' | 'pastel') => { setAppearanceState(value); localStorage.setItem('nalu-appearance', value) }, [])
  const [routeName, setRouteName] = useState('nalu-catalina')
  const [refreshKey, setRefreshKey] = useState(0)
  const refresh = useCallback(() => setRefreshKey((k) => k + 1), [])
  const [drawerMode, setDrawerMode] = useState<'files' | 'search' | 'git'>('files')
  const [reveal, setReveal] = useState<{ path: string; line: number } | null>(null)
  const [filesWidth, setFilesWidth] = useState(() => Number(localStorage.getItem('nalu-files-w')) || 240)
  const [termHeight, setTermHeightState] = useState(() => Number(localStorage.getItem('nalu-term-h')) || 224)
  // Default to the website-like Nalu chat if signed in, else the IDE.
  const [user, setUser] = useState<NaluUser | null>(() => currentUser())
  const [appMode, setAppModeState] = useState<'nalu' | 'ide'>(() => (localStorage.getItem('nalu-app-mode') as 'nalu' | 'ide') || (currentUser() ? 'nalu' : 'ide'))
  const setAppMode = useCallback((m: 'nalu' | 'ide') => { setAppModeState(m); localStorage.setItem('nalu-app-mode', m) }, [])

  const openFolder = useCallback(async () => {
    const dir = await window.nalu.openFolder()
    if (dir) { folderChosen.current = true; setFolder(dir); setFilesOpen(true); localStorage.setItem('nalu-last-folder', dir) }
  }, [])

  // Open a specific path (e.g. a freshly-cloned GitHub repo) without the dialog.
  const openFolderAt = useCallback((dir: string) => {
    folderChosen.current = true; setFolder(dir); setFilesOpen(true); localStorage.setItem('nalu-last-folder', dir)
  }, [])

  const openFile = useCallback(async (path: string, name: string) => {
    const request = ++openRequest.current, epoch = pathEpoch.current
    setOpenError(null)
    await recoveryLoad.current
    if (renaming.current || epoch !== pathEpoch.current || saveAsTargets.current.has(path)) return false
    try {
      const existing = tabsRef.current.find((t) => t.path === path)
      if (!existing) {
        const content = await window.nalu.readFile(path)
        if (renaming.current || epoch !== pathEpoch.current || saveAsTargets.current.has(path)) return false
        setTabs((prev) => (prev.some((t) => t.path === path) ? prev : [...prev, { path, name, content, savedContent: content, dirty: false }]))
      }
      if (request !== openRequest.current) return false
      setActivePath(path)
      return true
    } catch (error) {
      if (request === openRequest.current && epoch === pathEpoch.current) {
        const message = String(error).replace(/^Error:\s*/, '').replace(/^Error invoking remote method '[^']+':\s*(?:Error:\s*)?/, '')
        setOpenError({ path, name, message })
      }
      return false
    }
  }, [])

  const openAt = useCallback(async (path: string, name: string, line: number) => {
    if (await openFile(path, name)) setReveal({ path, line })
  }, [openFile])

  const editActive = useCallback((content: string) => {
    setTabs((prev) => prev.map((t) => (t.path === activePath ? { ...t, content, dirty: !!t.detached || content !== t.savedContent, saveError: undefined } : t)))
  }, [activePath])

  const applyEditProposal = useCallback((path: string, before: string, after: string) => {
    const target = tabsRef.current.find(tab => tab.path === path)
    if (!target || !applyProposedContent(target, before, after)) return false
    setTabs(current => current.map(tab => tab.path === path ? applyProposedContent(tab, before, after) ?? tab : tab))
    return true
  }, [])

  const saveFile = useCallback(async (filePath: string, overwrite = false) => {
    const tab = tabsRef.current.find(t => t.path === filePath)
    if (!tab || tab.detached || renaming.current || saving.current.has(tab.path) || (tab.diskConflict !== undefined && !overwrite)) return
    saving.current.add(tab.path)
    try {
      const disk = await window.nalu.readFile(tab.path)
      if (!overwrite && disk !== tab.savedContent) {
        setTabs(prev => prev.map(t => t.path === tab.path ? reconcileDisk(t, disk) : t))
        return
      }
      await window.nalu.writeFile(tab.path, tab.content)
      setTabs(prev => prev.map(t => t.path === tab.path ? acknowledgeSave(t, tab.content) : t))
      refresh()
    } catch (error) {
      setTabs(prev => prev.map(t => t.path === tab.path ? { ...t, saveError: error instanceof Error ? error.message : String(error) } : t))
    } finally { saving.current.delete(tab.path) }
  }, [refresh])
  const saveActive = useCallback(async (overwrite = false) => {
    if (activePath) await saveFile(activePath, overwrite)
  }, [activePath, saveFile])

  const saveActiveAs = useCallback(async () => {
    const source = activePath
    if (!source || renaming.current || saving.current.has(source)) return
    saving.current.add(source)
    let target: string | null = null
    try {
      const destination = await window.nalu.chooseSavePath(source)
      if (!destination) return
      const tab = tabsRef.current.find(t => t.path === source)
      if (!tab) return
      if (saveAsTargets.current.has(destination) || (destination !== source && tabsRef.current.some(t => t.path === destination))) {
        throw new Error('The destination is open in another tab. Close that tab or choose another name.')
      }
      target = destination; saveAsTargets.current.add(destination)
      await window.nalu.writeFile(destination, tab.content)
      setTabs(current => current.map(t => t.path === source ? acknowledgeSaveAs(t, destination, tab.content) : t))
      setActivePath(current => current === source ? destination : current)
      refresh()
    } catch (error) {
      setTabs(current => current.map(t => t.path === source ? { ...t, saveError: String(error) } : t))
    } finally { saving.current.delete(source); if (target) saveAsTargets.current.delete(target) }
  }, [activePath, refresh])

  const renamePath = useCallback(async (from: string, to: string) => {
    await recoveryLoad.current
    if (from === to) return
    if (renaming.current || saving.current.size) {
      throw new Error('A file operation is still finishing. Try Rename again in a moment.')
    }
    // Validate tab collisions before changing disk. Pause new saves and opens;
    // editing remains available and the commit maps the latest buffer state.
    relocateTabs(tabsRef.current, from, to)
    renaming.current = { committed: false }
    pathEpoch.current++
    try {
      await window.nalu.rename(from, to)
      renaming.current.committed = true
      setTabs(current => relocateTabs(current, from, to))
      setActivePath(current => current ? relocatedPath(current, from, to) : current)
      setReveal(current => current ? { ...current, path: relocatedPath(current.path, from, to) } : current)
      refresh()
    } catch (error) {
      renaming.current = null
      setTabs(current => [...current]) // rearm any autosave delayed by the lock
      throw error
    }
  }, [refresh])

  const closeTab = useCallback(async (filePath: string) => {
    if (renaming.current) return
    const tab = tabsRef.current.find(t => t.path === filePath)
    if (tab?.dirty) await saveFile(filePath)
    setTabs(prev => {
      const current = prev.find(t => t.path === filePath)
      if (current?.dirty || current?.diskConflict !== undefined || current?.saveError) return prev
      const next = prev.filter(t => t.path !== filePath)
      setActivePath(active => active === filePath ? next[next.length - 1]?.path ?? null : active)
      return next
    })
  }, [saveFile])

  const trashPath = useCallback(async (target: string) => {
    await recoveryLoad.current
    if (renaming.current || saving.current.size) throw new Error('A file operation is still finishing. Try again in a moment.')
    renaming.current = { committed: false }
    pathEpoch.current++
    try {
      // Back up dirty buffers before moving their on-disk originals to Trash.
      await window.nalu.saveWorkspace(JSON.stringify(snapshotSession(tabsRef.current, activePath, folder)))
      await window.nalu.del(target)
      renaming.current.committed = true
      setTabs(current => {
        const next = detachDeletedTabs(current, target)
        setActivePath(active => next.some(tab => tab.path === active) ? active : next[next.length - 1]?.path ?? null)
        return next
      })
      refresh()
    } catch (error) {
      renaming.current = null
      setTabs(current => [...current])
      throw error
    }
  }, [activePath, folder, refresh])

  const useDiskVersion = useCallback(() => {
    setTabs(prev => prev.map(t => t.path === activePath && t.diskConflict !== undefined
      ? { ...t, content: t.diskConflict, savedContent: t.diskConflict, dirty: false, diskConflict: undefined, saveError: undefined, recovered: false } : t))
  }, [activePath])

  const reloading = useRef(false)
  const reloadTabs = useCallback(async () => {
    if (reloading.current || renaming.current) return
    reloading.current = true
    try {
      const snapshots = tabsRef.current.filter(t => !t.detached && !saving.current.has(t.path))
      const results = await Promise.all(snapshots.map(async tab => {
        try { return { tab, disk: await window.nalu.readFile(tab.path) } } catch { return null }
      }))
      setTabs(prev => prev.map(tab => {
        const result = results.find(r => r?.tab === tab)
        return result && !renaming.current && !saving.current.has(tab.path) ? reconcileDisk(tab, result.disk) : tab
      }))
    } finally { reloading.current = false }
  }, [])
  useEffect(() => {
    const timer = setInterval(() => { void reloadTabs() }, 2000)
    const onFocus = () => { void reloadTabs() }
    window.addEventListener('focus', onFocus)
    return () => { clearInterval(timer); window.removeEventListener('focus', onFocus) }
  }, [reloadTabs])

  const active = useMemo(() => tabs.find((t) => t.path === activePath) ?? null, [tabs, activePath])

  // Each file owns its delay: switching tabs or typing elsewhere must not
  // cancel a pending save. Only a new edit to that file resets its timer.
  const saveTimers = useRef(new Map<string, { content: string; timer: ReturnType<typeof setTimeout> }>())
  useEffect(() => {
    for (const [filePath, pending] of saveTimers.current) {
      const tab = tabs.find(t => t.path === filePath)
      if (!tab?.dirty || tab.recovered || tab.diskConflict !== undefined || tab.saveError || tab.content !== pending.content) {
        clearTimeout(pending.timer); saveTimers.current.delete(filePath)
      }
    }
    for (const tab of tabs) {
      if (!tab.dirty || tab.recovered || tab.diskConflict !== undefined || tab.saveError || saveTimers.current.has(tab.path)) continue
      const timer = setTimeout(() => { saveTimers.current.delete(tab.path); void saveFile(tab.path) }, 700)
      saveTimers.current.set(tab.path, { content: tab.content, timer })
    }
  }, [tabs, saveFile])
  useEffect(() => () => {
    for (const pending of saveTimers.current.values()) clearTimeout(pending.timer)
    saveTimers.current.clear()
  }, [])

  const value: Ctx = {
    folder, openFolder, openFolderAt,
    tabs, activePath, active, recoveryError, openError, dismissOpenError: () => setOpenError(null),
    openFile, setActive: path => { openRequest.current++; setOpenError(null); setActivePath(path) }, closeTab, editActive, applyEditProposal, saveActive, saveActiveAs, useDiskVersion, reloadTabs, renamePath, trashPath,
    filesOpen, setFilesOpen, termOpen, setTermOpen, paletteOpen, setPaletteOpen,
    quickOpen, setQuickOpen,
    settingsOpen, setSettingsOpen, routeName, setRouteName,
    refreshKey, refresh,
    drawerMode, setDrawerMode, reveal, openAt,
    filesWidth, setFilesWidth: (w: number) => { const c = Math.max(180, Math.min(560, w)); setFilesWidth(c); localStorage.setItem('nalu-files-w', String(c)) },
    termHeight, setTermHeight: (h: number) => { const c = Math.max(120, Math.min(700, h)); setTermHeightState(c); localStorage.setItem('nalu-term-h', String(c)) },
    appMode, setAppMode, user, setUser, appearance, setAppearance,
  }
  return <WorkspaceCtx.Provider value={value}>{children}</WorkspaceCtx.Provider>
}

export function useWorkspace(): Ctx {
  const c = useContext(WorkspaceCtx)
  if (!c) throw new Error('useWorkspace outside provider')
  return c
}
