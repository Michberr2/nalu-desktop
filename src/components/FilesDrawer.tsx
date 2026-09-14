import { FolderOpen, PanelLeftClose, FilePlus, FolderPlus, Files, Search, GitBranch } from 'lucide-react'
import { useWorkspace } from '../lib/store'
import Explorer from './Explorer'
import SearchPanel from './SearchPanel'
import GitPanel from './GitPanel'
import { useState } from 'react'
import CreateEntryDialog from './CreateEntryDialog'

// The ONE drawer — Files by default, with Search and Git as modes (no extra
// activity bar; keeps the clean single-drawer look).
export default function FilesDrawer() {
  const ws = useWorkspace()
  const [creation, setCreation] = useState<{ directory: string; kind: 'file' | 'folder' } | null>(null)

  const newAt = async (kind: 'file' | 'folder') => {
    if (!ws.folder) return void ws.openFolder()
    setCreation({ directory: ws.folder, kind })
  }

  const modes = [
    { key: 'files', icon: Files, title: 'Files' },
    { key: 'search', icon: Search, title: 'Search' },
    { key: 'git', icon: GitBranch, title: 'Source control' },
  ] as const

  // drag-to-resize the drawer width
  const startResize = (e: React.MouseEvent) => {
    e.preventDefault()
    const startX = e.clientX
    const startW = ws.filesWidth
    const onMove = (ev: MouseEvent) => ws.setFilesWidth(startW + (ev.clientX - startX))
    const onUp = () => { window.removeEventListener('mousemove', onMove); window.removeEventListener('mouseup', onUp); document.body.style.cursor = '' }
    window.addEventListener('mousemove', onMove); window.addEventListener('mouseup', onUp)
    document.body.style.cursor = 'col-resize'
  }

  return (
    <div className="files-drawer" style={{ width: ws.filesWidth }}>
      <nav className="drawer-navigation" aria-label="Project tools">
        {modes.map(m => <button key={m.key} title={m.title} aria-label={m.title} aria-pressed={ws.drawerMode === m.key} onClick={() => ws.setDrawerMode(m.key)}><m.icon size={14}/><span>{m.key === 'git' ? 'Changes' : m.title}</span></button>)}
      </nav>
      <div className="drawer-heading"><span>{ws.drawerMode === 'files' ? 'PROJECT FILES' : ws.drawerMode === 'git' ? 'SOURCE CONTROL' : 'SEARCH PROJECT'}</span><div className="flex">
        {ws.drawerMode === 'files' && <>
          <button onClick={() => void newAt('file')} title="New file" aria-label="New file" className="icon-button"><FilePlus size={14}/></button>
          <button onClick={() => void newAt('folder')} title="New folder" aria-label="New folder" className="icon-button"><FolderPlus size={14}/></button>
        </>}
        <button onClick={() => void ws.openFolder()} title="Open folder" aria-label="Open folder" className="icon-button"><FolderOpen size={14}/></button>
        <button onClick={() => ws.setFilesOpen(false)} title="Hide (⌘B)" aria-label="Hide files" className="icon-button"><PanelLeftClose size={14}/></button>
      </div></div>
      {ws.drawerMode === 'files' && <Explorer />}
      {ws.drawerMode === 'search' && <SearchPanel />}
      {ws.drawerMode === 'git' && <GitPanel />}
      {creation && <CreateEntryDialog {...creation} onClose={() => setCreation(null)} />}

      {/* drag handle to resize the drawer */}
      <div role="separator" aria-label="Resize files" aria-orientation="vertical" aria-valuemin={180} aria-valuemax={560} aria-valuenow={ws.filesWidth} tabIndex={0} onKeyDown={e => { if(e.key === 'ArrowLeft' || e.key === 'ArrowRight') { e.preventDefault(); ws.setFilesWidth(ws.filesWidth + (e.key === 'ArrowRight' ? 20 : -20)) } }} onMouseDown={startResize} className="group absolute right-0 top-0 h-full w-1.5 cursor-col-resize" title="Drag to resize">
        <div className="mx-auto h-full w-px bg-transparent group-hover:bg-gold/50" />
      </div>
    </div>
  )
}
