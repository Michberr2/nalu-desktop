import { useEffect } from 'react'
import { WorkspaceProvider, useWorkspace } from './lib/store'
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
    <div className="flex h-full w-full flex-col bg-canvas text-ink">
      <TitleBar />
      {/* Soft, spacious "floating cards on the canvas" — the Nalu website feel. */}
      <div className="flex min-h-0 flex-1 gap-2 px-2 pb-2">
        <ActivityBar />
        <SidePanel />
        <div className="flex min-w-0 flex-1 flex-col gap-2">
          <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-2xl border border-glass/[0.08] bg-panel">
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
