import { useEffect } from 'react'
import { WorkspaceProvider, useWorkspace, bgFor } from './lib/store'
import TitleBar from './components/TitleBar'
import ActivityBar from './components/ActivityBar'
import SidePanel from './components/SidePanel'
import EditorArea from './components/EditorArea'
import TerminalPanel from './components/TerminalPanel'
import AIPanel from './components/AIPanel'
import CommandPalette from './components/CommandPalette'
import StatusBar from './components/StatusBar'

function Shell() {
  const ws = useWorkspace()

  // global keyboard shortcuts
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const mod = e.metaKey || e.ctrlKey
      if (mod && e.key === 'k') { e.preventDefault(); ws.setPaletteOpen(true) }
      else if (mod && e.key === 's') { e.preventDefault(); void ws.saveActive() }
      else if (mod && e.key === '`') { e.preventDefault(); ws.setTermOpen(!ws.termOpen) }
      else if (mod && e.key === 'b') { e.preventDefault(); ws.setAiOpen(!ws.aiOpen) }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [ws])

  return (
    <div className="relative flex h-full w-full flex-col overflow-hidden text-ink">
      {/* Background model photo — exactly like the website (Workspace.bgFor):
          a dedicated layer behind everything that shifts with the active Nalu
          model, softened by a dark wash for readability. */}
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
      <TitleBar />
      {/* Soft, spacious "floating cards on the canvas" — the Nalu website feel. */}
      <div className="flex min-h-0 flex-1 gap-2 px-2 pb-2">
        <ActivityBar />
        <SidePanel />
        <div className="flex min-w-0 flex-1 flex-col gap-2">
          <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-2xl border border-glass/[0.1] bg-panel/75 backdrop-blur-2xl">
            <EditorArea />
          </div>
          {ws.termOpen && <TerminalPanel />}
        </div>
        {ws.aiOpen && <AIPanel />}
      </div>
      <StatusBar />
      {ws.paletteOpen && <CommandPalette />}
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
