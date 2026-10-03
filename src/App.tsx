import { useEffect, useRef, useState, type CSSProperties } from 'react'
import { WorkspaceProvider, useWorkspace, bgFor } from './lib/store'
import AvatarHome from './components/AvatarHome'
import './avatar-theme.css'
import TitleBar from './components/TitleBar'
import FilesDrawer from './components/FilesDrawer'
import EditorArea from './components/EditorArea'
import TerminalPanel from './components/TerminalPanel'
import NaluBar from './components/NaluBar'
import NaluChat from './components/NaluChat'
import CommandPalette from './components/CommandPalette'
import QuickOpen from './components/QuickOpen'
import StatusBar from './components/StatusBar'
import SettingsModal from './components/SettingsModal'
import UpdateBanner from './components/UpdateBanner'
import { fetchMe, syncCliConfig } from './lib/naluApi'
import ResizeGrip, { type ResizeDelta } from './components/ResizeGrip'
import { clampPanelSize, usePanelSize, useStackedPanels } from './lib/panelSize'

function Shell() {
  const ws = useWorkspace()
  const [terminalStarted, setTerminalStarted] = useState(false)
  const areaRef = useRef<HTMLDivElement>(null)
  const editorRef = useRef<HTMLDivElement>(null)
  const stacked = useStackedPanels()
  const [assistantWidth, setAssistantWidth] = usePanelSize('nalu-assistant-w')
  const [assistantHeight, setAssistantHeight] = usePanelSize('nalu-assistant-h')
  const resizeAssistant = ({ start, dx, dy }: ResizeDelta) => {
    if (stacked) setAssistantHeight(clampPanelSize(start.height - dy, 260, (areaRef.current?.clientHeight || innerHeight) - 220))
    else setAssistantWidth(clampPanelSize(start.width - dx, 300, (areaRef.current?.clientWidth || innerWidth) - 292))
  }
  const resizeEditor = ({ start, dx, dy }: ResizeDelta) => {
    if (!stacked) {
      const gap = areaRef.current ? parseFloat(getComputedStyle(areaRef.current).columnGap) || 0 : 16
      setAssistantWidth(clampPanelSize((areaRef.current?.clientWidth || 0) - start.width - dx - gap, 300, (areaRef.current?.clientWidth || 0) - 280 - gap))
    }
    if (ws.termOpen) ws.setTermHeight(clampPanelSize((editorRef.current?.clientHeight || 0) - start.height - dy - 10, 120, (editorRef.current?.clientHeight || 0) * .65))
    else if (stacked) setAssistantHeight(clampPanelSize((areaRef.current?.clientHeight || 0) - start.height - dy - 10, 260, (areaRef.current?.clientHeight || 0) - 220))
  }
  useEffect(() => { if (ws.termOpen) setTerminalStarted(true) }, [ws.termOpen])

  useEffect(() => window.nalu.companion?.onTask(prompt => { ws.setAppMode('ide'); window.dispatchEvent(new CustomEvent('nalu:compose', { detail: { mode: 'auto', prompt } })) }), [ws.setAppMode])

  // On launch (and whenever a token appears), confirm the session maps to the
  // same DB user — powers the avatar + loads the user's chats.
  useEffect(() => {
    let active = true
    void fetchMe().then(u => { if (active) ws.setUser(u) }).catch(() => { /* Keep the cached account through service outages. Settings shows the error. */ })
    return () => { active = false }
  }, [ws.settingsOpen]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { syncCliConfig() }, []) // wire the terminal `nalu`/`claude`/`gpt` commands to the current session

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const mod = e.metaKey || e.ctrlKey
      if (mod && e.key === 'k') { e.preventDefault(); ws.setQuickOpen(false); ws.setPaletteOpen(true) }
      else if (mod && e.key.toLowerCase() === 'p') {
        e.preventDefault()
        if (!e.shiftKey) ws.setAppMode('ide'); ws.setQuickOpen(!e.shiftKey); ws.setPaletteOpen(e.shiftKey)
      }
      else if (mod && e.key.toLowerCase() === 's') { e.preventDefault(); void (e.shiftKey ? ws.saveActiveAs() : ws.saveActive()) }
      else if (mod && e.key === '`') { e.preventDefault(); ws.setAppMode('ide'); ws.setTermOpen(!ws.termOpen) }
      else if (mod && e.shiftKey && (e.key === 'f' || e.key === 'F')) { e.preventDefault(); ws.setAppMode('ide'); ws.setFilesOpen(true); ws.setDrawerMode('search') }
      else if (mod && e.shiftKey && (e.key === 'g' || e.key === 'G')) { e.preventDefault(); ws.setAppMode('ide'); ws.setFilesOpen(true); ws.setDrawerMode('git') }
      else if (mod && e.key === 'b') { e.preventDefault(); ws.setAppMode('ide'); ws.setFilesOpen(!ws.filesOpen) }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [ws])

  return (
    <div className={`nalu-shell platform-${window.nalu.platform || 'darwin'} appearance-${ws.appearance} relative flex h-full w-full flex-col overflow-hidden text-ink`}>
      {ws.appearance === 'pastel' && <div aria-hidden className="pastel-background pointer-events-none absolute inset-0 -z-10 bg-cover bg-center" style={{ backgroundImage: `url(${import.meta.env.BASE_URL}bg/pastel-painting.png)` }}/>}
      {/* Website background: model photo + dark wash behind everything. */}
      <div
        aria-hidden
        className="scenic-background pointer-events-none absolute inset-0 -z-10 bg-cover bg-center"
        style={{ backgroundImage: `url(${bgFor(ws.routeName)})`, transition: 'background-image 600ms ease' }}
      />
      <div
        aria-hidden
        className="scenic-background pointer-events-none absolute inset-0 -z-10"
        style={{
          background:
            'radial-gradient(1100px 760px at 6% -12%, rgba(56,120,255,0.18), transparent 55%), radial-gradient(950px 680px at 102% -4%, rgba(40,90,200,0.14), transparent 55%), linear-gradient(180deg, rgba(11,12,16,0.48), rgba(11,12,16,0.64))',
        }}
      />

      {/* thin top strip that holds ONLY the macOS window buttons (traffic
          lights); the whole app header sits on the row below it. */}
      <TitleBar />
      <UpdateBanner />

      {/* Two interchangeable faces: NALU (website-like chat + your Studio
          conversations) and IDE (files + editor + terminal + Nalu prompt bar). */}
      {ws.appMode === 'home' && <AvatarHome/>}
      <div className="chats-workspace min-h-0 flex-1" style={{ display: ws.appMode === 'nalu' ? 'flex' : 'none' }}>
          <NaluChat key={ws.user?.id || 'signed-out'} />
      </div>
        <main aria-label="Workspace" className="ide-workspace" style={{ display: ws.appMode === 'ide' ? undefined : 'none' }}>
          {ws.filesOpen && <FilesDrawer />}
          <div ref={areaRef} className="work-area" style={{ '--assistant-width': assistantWidth === null ? undefined : `${assistantWidth}px`, '--assistant-height': assistantHeight === null ? undefined : `${assistantHeight}px` } as CSSProperties}>
            <div ref={editorRef} className="editor-column">
              <div className="editor-surface"><EditorArea /><ResizeGrip label="Resize Editor panel" axis={stacked ? 'y' : ws.termOpen ? 'both' : 'x'} onResize={resizeEditor} onReset={() => { setAssistantWidth(null); setAssistantHeight(null); if (ws.termOpen) ws.setTermHeight(224) }} /></div>
              {(terminalStarted || ws.termOpen) && <div className="terminal-dock" style={{ display: ws.termOpen ? undefined : 'none', height: ws.termHeight }}><TerminalPanel visible={ws.termOpen && ws.appMode === 'ide'} /></div>}
            </div>
            <aside className="assistant-column" aria-label="Nalu assistant"><NaluBar /><ResizeGrip label="Resize Nalu panel" corner="left" axis={stacked ? 'y' : 'x'} onResize={resizeAssistant} onReset={() => { setAssistantWidth(null); setAssistantHeight(null) }} /></aside>
          </div>
        </main>

      <StatusBar />
      {ws.paletteOpen && <CommandPalette />}
      {ws.quickOpen && <QuickOpen />}
      {ws.settingsOpen && <SettingsModal />}
    </div>
  )
}

export default function App() {
  return (
    <WorkspaceProvider>
      <Shell />
    </WorkspaceProvider>
  )
}
