import { Search } from 'lucide-react'
import { useWorkspace } from '../lib/store'

export default function TitleBar() {
  const ws = useWorkspace()
  const isMac = window.nalu?.platform === 'darwin'
  return (
    <div className="drag flex h-10 shrink-0 items-center gap-3 px-3">
      {/* leave room for the macOS traffic lights */}
      {isMac && <div className="w-16" />}
      <div className="flex items-center gap-2">
        <img src="/wolf-icon.png" alt="Nalu" className="h-4 w-4 rounded" style={{ filter: 'brightness(0) invert(1)' }} />
        <span className="text-[13px] font-semibold tracking-tight text-ink">Nalu</span>
      </div>
      <button
        onClick={() => ws.setPaletteOpen(true)}
        className="no-drag mx-auto flex h-7 w-full max-w-md items-center gap-2 rounded-full border border-glass/[0.08] bg-panel px-3.5 text-[12px] text-dim hover:border-gold/30 hover:text-ink"
      >
        <Search size={12} />
        <span className="truncate">
          {ws.folder ? ws.folder.split('/').pop() : 'Search or run a command'}
          <span className="ml-1.5 text-dim/60">⌘K</span>
        </span>
      </button>
      <div className="w-16" />
    </div>
  )
}
