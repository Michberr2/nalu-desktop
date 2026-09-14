import { useEffect, useState } from 'react'
import { WorkspaceProvider, useWorkspace, bgFor } from './lib/store'
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

function Shell() {
  const ws = useWorkspace()
  const [terminalStarted, setTerminalStarted] = useState(false)
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
        ws.setQuickOpen(!e.shiftKey); ws.setPaletteOpen(e.shiftKey)
      }
      else if (mod && e.key.toLowerCase() === 's') { e.preventDefault(); void (e.shiftKey ? ws.saveActiveAs() : ws.saveActive()) }
      else if (mod && e.key === '`') { e.preventDefault(); ws.setTermOpen(!ws.termOpen) }
      else if (mod && e.shiftKey && (e.key === 'f' || e.key === 'F')) { e.preventDefault(); ws.setFilesOpen(true); ws.setDrawerMode('search') }
      else if (mod && e.shiftKey && (e.key === 'g' || e.key === 'G')) { e.preventDefault(); ws.setFilesOpen(true); ws.setDrawerMode('git') }
      else if (mod && e.key === 'b') { e.preventDefault(); ws.setFilesOpen(!ws.filesOpen) }
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
      <div className="chats-workspace min-h-0 flex-1" style={{ display: ws.appMode === 'nalu' ? 'flex' : 'none' }}>
          <NaluChat key={ws.user?.id || 'signed-out'} />
      </div>
        <main aria-label="Workspace" className="ide-workspace" style={{ display: ws.appMode === 'ide' ? undefined : 'none' }}>
          {ws.filesOpen && <FilesDrawer />}
          <div className="work-area">
            <div className="editor-column">
              <div className="editor-surface"><EditorArea /></div>
              {(terminalStarted || ws.termOpen) && <div className="terminal-dock" style={{ display: ws.termOpen ? undefined : 'none' }}><TerminalPanel visible={ws.termOpen && ws.appMode === 'ide'} /></div>}
            </div>
            <aside className="assistant-column" aria-label="Nalu assistant"><NaluBar /></aside>
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
