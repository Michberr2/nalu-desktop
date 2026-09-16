import { FolderOpen, PanelLeftClose, FilePlus, FolderPlus, Files, Search, GitBranch } from 'lucide-react'
import { useWorkspace } from '../lib/store'
import Explorer from './Explorer'
import SearchPanel from './SearchPanel'
import GitPanel from './GitPanel'
import { useState } from 'react'
import CreateEntryDialog from './CreateEntryDialog'
import ResizeGrip, { type ResizeDelta } from './ResizeGrip'
import { clampPanelSize } from '../lib/panelSize'

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
  const resize = ({ start, dx }: ResizeDelta) => ws.setFilesWidth(clampPanelSize(start.width + dx, 180, Math.min(560, (document.querySelector('.ide-workspace')?.clientWidth || innerWidth) * .32)))

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
      <ResizeGrip edge label="Resize files" value={ws.filesWidth} min={180} max={560} onResize={resize} onReset={() => ws.setFilesWidth(240)} />
      <ResizeGrip label="Resize Files panel" onResize={resize} onReset={() => ws.setFilesWidth(240)} />
    </div>
  )
}
