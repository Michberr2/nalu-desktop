import { useEffect } from 'react'
import { WorkspaceProvider, useWorkspace, bgFor } from './lib/store'
import TitleBar from './components/TitleBar'
import FilesDrawer from './components/FilesDrawer'
import EditorArea from './components/EditorArea'
import TerminalPanel from './components/TerminalPanel'
import NaluBar from './components/NaluBar'
import NaluChat from './components/NaluChat'
import CommandPalette from './components/CommandPalette'
import StatusBar from './components/StatusBar'
import SettingsModal from './components/SettingsModal'
import UpdateBanner from './components/UpdateBanner'
import { fetchMe, syncCliConfig } from './lib/naluApi'

function Shell() {
  const ws = useWorkspace()

  // On launch (and whenever a token appears), confirm the session maps to the
  // same DB user — powers the avatar + loads the user's chats.
  useEffect(() => { fetchMe().then((u) => ws.setUser(u)) }, [ws.settingsOpen]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { syncCliConfig() }, []) // wire the terminal `nalu`/`claude`/`gpt` commands to the current session

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const mod = e.metaKey || e.ctrlKey
      if (mod && e.key === 'k') { e.preventDefault(); ws.setPaletteOpen(true) }
      else if (mod && e.key === 's') { e.preventDefault(); void ws.saveActive() }
      else if (mod && e.key === '`') { e.preventDefault(); ws.setTermOpen(!ws.termOpen) }
      else if (mod && e.shiftKey && (e.key === 'f' || e.key === 'F')) { e.preventDefault(); ws.setFilesOpen(true); ws.setDrawerMode('search') }
      else if (mod && e.shiftKey && (e.key === 'g' || e.key === 'G')) { e.preventDefault(); ws.setFilesOpen(true); ws.setDrawerMode('git') }
      else if (mod && e.key === 'b') { e.preventDefault(); ws.setFilesOpen(!ws.filesOpen) }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [ws])

  return (
    <div className="relative flex h-full w-full flex-col overflow-hidden text-ink">
      {/* Website background: model photo + dark wash behind everything. */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 -z-10 bg-cover bg-center"
        style={{ backgroundImage: `url(${bgFor(ws.routeName)})`, transition: 'background-image 600ms ease' }}
      />
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 -z-10"
        style={{
          background:
            'radial-gradient(1100px 760px at 6% -12%, rgba(56,120,255,0.18), transparent 55%), radial-gradient(950px 680px at 102% -4%, rgba(40,90,200,0.14), transparent 55%), linear-gradient(180deg, rgba(11,12,16,0.48), rgba(11,12,16,0.64))',
        }}
      />

      {/* thin top strip that holds ONLY the macOS window buttons (traffic
          lights); the whole app header sits on the row below it. */}
      <div className="drag h-[30px] shrink-0" />

      <TitleBar />
      <UpdateBanner />

      {/* Two interchangeable faces: NALU (website-like chat + your Studio
          conversations) and IDE (files + editor + terminal + Nalu prompt bar). */}
      {ws.appMode === 'nalu' ? (
        <div className="flex min-h-0 flex-1 px-2 pb-2">
          <NaluChat />
        </div>
      ) : (
        <div className="flex min-h-0 flex-1 gap-2 px-2 pb-2">
          {ws.filesOpen && <FilesDrawer />}
          <div className="flex min-w-0 flex-1 flex-col gap-2">
            <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-2xl border border-glass/[0.1] bg-panel/75 backdrop-blur-2xl">
              <EditorArea />
            </div>
            {ws.termOpen && <TerminalPanel />}
            <NaluBar />
          </div>
        </div>
      )}

      <StatusBar />
      {ws.paletteOpen && <CommandPalette />}
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
