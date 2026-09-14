import { useEffect, useState } from 'react'
import { ChevronRight, ChevronDown, FolderOpen } from 'lucide-react'
import { useWorkspace } from '../lib/store'
import FileIcon from './FileIcon'
import CreateEntryDialog from './CreateEntryDialog'
import TrashEntryDialog from './TrashEntryDialog'

type Node = { name: string; path: string; dir: boolean }
type Menu = { x: number; y: number; node: Node } | null

// dirname helper (renderer has no node path module)
const dirOf = (p: string) => p.slice(0, Math.max(p.lastIndexOf('/'), p.lastIndexOf('\\'))) || '/'

function TreeNode({ node, depth, onMenu }: { node: Node; depth: number; onMenu: (m: Menu) => void }) {
  const ws = useWorkspace()
  const [open, setOpen] = useState(false)
  const [children, setChildren] = useState<Node[] | null>(null)

  // reload children when this node's subtree is refreshed (create/delete/rename)
  useEffect(() => {
    let cancelled = false
    if (open && node.dir) void window.nalu.readDir(node.path).then(
      entries => { if (!cancelled) setChildren(entries) },
      () => { if (!cancelled) setChildren([]) },
    )
    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ws.refreshKey])

  const toggle = async () => {
    if (node.dir) {
      if (!open) setChildren(await window.nalu.readDir(node.path))
      setOpen(!open)
    } else {
      await ws.openFile(node.path, node.name)
    }
  }

  const isActive = ws.activePath === node.path
  return (
    <div>
      <button
        onClick={toggle}
        draggable
        onDragStart={(e) => { e.dataTransfer.setData('text/plain', node.path); e.dataTransfer.effectAllowed = 'copy' }}
        onContextMenu={(e) => { e.preventDefault(); onMenu({ x: e.clientX, y: e.clientY, node }) }}
        className={`group flex w-full items-center gap-1 rounded px-1 py-[3px] text-left text-[13px] hover:bg-glass/[0.05] ${
          isActive ? 'bg-glass/[0.08] text-ink' : 'text-dim'
        }`}
        style={{ paddingLeft: depth * 12 + 4 }}
      >
        {node.dir ? (
          open ? <ChevronDown size={13} className="shrink-0 text-dim" /> : <ChevronRight size={13} className="shrink-0 text-dim" />
        ) : (
          <span className="w-[13px] shrink-0" />
        )}
        <FileIcon name={node.name} dir={node.dir} open={open} />
        <span className="truncate">{node.name}</span>
      </button>
      {open && children && children.map((c) => <TreeNode key={c.path} node={c} depth={depth + 1} onMenu={onMenu} />)}
    </div>
  )
}

export default function Explorer() {
  const ws = useWorkspace()
  const [roots, setRoots] = useState<Node[]>([])
  const [menu, setMenu] = useState<Menu>(null)
  const [renameNode, setRenameNode] = useState<Node | null>(null)
  const [renameName, setRenameName] = useState('')
  const [renameError, setRenameError] = useState('')
  const [renaming, setRenaming] = useState(false)
  const [creation, setCreation] = useState<{ directory: string; kind: 'file' | 'folder' } | null>(null)
  const [trashNode, setTrashNode] = useState<Node | null>(null)

  useEffect(() => {
    let cancelled = false
    if (ws.folder) void window.nalu.readDir(ws.folder).then(
      entries => { if (!cancelled) setRoots(entries) },
      () => { if (!cancelled) setRoots([]) },
    )
    else setRoots([])
    return () => { cancelled = true }
  }, [ws.folder, ws.refreshKey])

  const rename = async () => {
    if (!renameNode || renaming) return
    const name = renameName.trim()
    if (!name || name === '.' || name === '..' || /[\\/\0]/.test(name)) {
      setRenameError('Enter a file or folder name without path separators.')
      return
    }
    if (name === renameNode.name) { setRenameNode(null); return }
    setRenaming(true); setRenameError('')
    try {
      const separator = renameNode.path.includes('\\') ? '\\' : '/'
      await ws.renamePath(renameNode.path, dirOf(renameNode.path).replace(/[\\/]$/, '') + separator + name)
      setRenameNode(null)
    } catch (error) { setRenameError(error instanceof Error ? error.message : String(error)) }
    finally { setRenaming(false) }
  }

  if (!ws.folder) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-3 p-6 text-center">
        <FolderOpen size={26} className="text-dim" />
        <p className="text-[12px] text-dim">No folder open</p>
        <button onClick={() => void ws.openFolder()} className="rounded-md bg-gold/90 px-3 py-1.5 text-[12px] font-medium text-[#15170f] hover:bg-gold">
          Open folder
        </button>
      </div>
    )
  }

  return (
    <div className="min-h-0 flex-1 overflow-y-auto px-1.5 pb-2" onClick={() => setMenu(null)}>
      <div className="mb-1 px-1.5 text-[11px] font-medium text-dim">{ws.folder.split('/').pop()}</div>
      {roots.map((n) => <TreeNode key={n.path} node={n} depth={0} onMenu={setMenu} />)}

      {/* right-click context menu */}
      {menu && (
        <div
          className="fixed z-50 min-w-[150px] overflow-hidden rounded-lg border border-glass/[0.12] bg-panel py-1 text-[12px] shadow-2xl"
          style={{ left: menu.x, top: menu.y }}
          onClick={(e) => e.stopPropagation()}
        >
          {menu.node.dir && <>
            <MenuItem label="New File" onClick={() => { setCreation({directory:menu.node.path,kind:'file'}); setMenu(null) }} />
            <MenuItem label="New Folder" onClick={() => { setCreation({directory:menu.node.path,kind:'folder'}); setMenu(null) }} />
            <div className="my-1 border-t border-glass/[0.08]" />
          </>}
          <MenuItem label="Rename" onClick={() => { setRenameNode(menu.node); setRenameName(menu.node.name); setRenameError(''); setMenu(null) }} />
          <MenuItem label="Move to Trash" danger onClick={() => { setTrashNode(menu.node); setMenu(null) }} />
        </div>
      )}
      {renameNode && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={e => e.stopPropagation()}>
          <form role="dialog" aria-modal="true" aria-labelledby="rename-title"
            onSubmit={e => { e.preventDefault(); void rename() }}
            onKeyDown={e => { e.stopPropagation(); if (e.key === 'Escape' && !renaming) setRenameNode(null) }}
            className="w-[360px] rounded-xl border border-glass/[0.12] bg-panel p-5 shadow-2xl">
            <h2 id="rename-title" className="mb-3 text-sm font-medium text-ink">Rename {renameNode.dir ? 'folder' : 'file'}</h2>
            <input aria-label="New name" autoFocus value={renameName} disabled={renaming}
              onFocus={e => e.target.select()} onChange={e => setRenameName(e.target.value)}
              className="w-full rounded-md border border-glass/[0.15] bg-black/20 px-3 py-2 text-sm text-ink outline-none focus:border-gold/60" />
            {renameError && <p role="alert" className="mt-2 text-xs text-red-300">{renameError}</p>}
            <div className="mt-4 flex justify-end gap-2">
              <button type="button" disabled={renaming} onClick={() => setRenameNode(null)} className="rounded-md px-3 py-1.5 text-xs text-dim">Cancel</button>
              <button type="submit" disabled={renaming} className="rounded-md bg-gold/90 px-3 py-1.5 text-xs text-[#15170f] disabled:opacity-50">{renaming ? 'Renaming…' : 'Rename'}</button>
            </div>
          </form>
        </div>
      )}
      {creation && <CreateEntryDialog {...creation} onClose={() => setCreation(null)} />}
      {trashNode && <TrashEntryDialog target={trashNode} onClose={() => setTrashNode(null)} />}
    </div>
  )
}

function MenuItem({ label, onClick, danger }: { label: string; onClick: () => void; danger?: boolean }) {
  return (
    <button onClick={onClick} className={`block w-full px-3 py-1.5 text-left hover:bg-glass/[0.08] ${danger ? 'text-red-300' : 'text-ink'}`}>{label}</button>
  )
}
