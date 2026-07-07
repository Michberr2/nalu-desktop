import { FolderOpen, PanelLeftClose, FilePlus, FolderPlus } from 'lucide-react'
import { useWorkspace } from '../lib/store'
import Explorer from './Explorer'

// The ONE drawer — just the files. Clean.
export default function FilesDrawer() {
  const ws = useWorkspace()

  const newAt = async (kind: 'file' | 'folder') => {
    if (!ws.folder) return void ws.openFolder()
    const name = window.prompt(kind === 'file' ? 'New file name' : 'New folder name')?.trim()
    if (!name) return
    try {
      if (kind === 'file') { const p = await window.nalu.createFile(ws.folder, name); ws.refresh(); await ws.openFile(p, name) }
      else { await window.nalu.mkdir(ws.folder, name); ws.refresh() }
    } catch { alert(`Could not create ${kind}`) }
  }

  return (
    <div className="flex w-60 shrink-0 flex-col overflow-hidden rounded-2xl border border-glass/[0.1] bg-panel/75 backdrop-blur-2xl">
      <div className="flex items-center justify-between px-3 py-2.5">
        <span className="text-[11px] font-semibold uppercase tracking-[0.14em] text-dim">Files</span>
        <div className="flex items-center gap-0.5">
          <button onClick={() => void newAt('file')} title="New file" className="rounded p-1 text-dim hover:bg-glass/10 hover:text-ink"><FilePlus size={13} /></button>
          <button onClick={() => void newAt('folder')} title="New folder" className="rounded p-1 text-dim hover:bg-glass/10 hover:text-ink"><FolderPlus size={13} /></button>
          <button onClick={() => void ws.openFolder()} title="Open folder" className="rounded p-1 text-dim hover:bg-glass/10 hover:text-ink"><FolderOpen size={13} /></button>
          <button onClick={() => ws.setFilesOpen(false)} title="Hide files (⌘B)" className="rounded p-1 text-dim hover:bg-glass/10 hover:text-ink"><PanelLeftClose size={13} /></button>
        </div>
      </div>
      <Explorer />
    </div>
  )
}
