import { FolderOpen, PanelLeftClose } from 'lucide-react'
import { useWorkspace } from '../lib/store'
import Explorer from './Explorer'

// The ONE drawer — just the files. Clean.
export default function FilesDrawer() {
  const ws = useWorkspace()
  return (
    <div className="flex w-60 shrink-0 flex-col overflow-hidden rounded-2xl border border-glass/[0.1] bg-panel/75 backdrop-blur-2xl">
      <div className="flex items-center justify-between px-3 py-2.5">
        <span className="text-[11px] font-semibold uppercase tracking-[0.14em] text-dim">Files</span>
        <div className="flex items-center gap-1">
          <button onClick={() => void ws.openFolder()} title="Open folder" className="rounded p-1 text-dim hover:bg-glass/10 hover:text-ink">
            <FolderOpen size={14} />
          </button>
          <button onClick={() => ws.setFilesOpen(false)} title="Hide files (⌘B)" className="rounded p-1 text-dim hover:bg-glass/10 hover:text-ink">
            <PanelLeftClose size={14} />
          </button>
        </div>
      </div>
      <Explorer />
    </div>
  )
}
