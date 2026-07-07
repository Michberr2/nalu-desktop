import { useEffect, useState } from 'react'
import { ChevronRight, ChevronDown, FolderOpen } from 'lucide-react'
import { useWorkspace } from '../lib/store'
import FileIcon from './FileIcon'

type Node = { name: string; path: string; dir: boolean }
type Menu = { x: number; y: number; node: Node } | null

// dirname helper (renderer has no node path module)
const dirOf = (p: string) => p.slice(0, p.lastIndexOf('/')) || '/'

function TreeNode({ node, depth, onMenu }: { node: Node; depth: number; onMenu: (m: Menu) => void }) {
  const ws = useWorkspace()
  const [open, setOpen] = useState(false)
  const [children, setChildren] = useState<Node[] | null>(null)

  // reload children when this node's subtree is refreshed (create/delete/rename)
  useEffect(() => {
    if (open && node.dir) window.nalu.readDir(node.path).then(setChildren)
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

  useEffect(() => {
    if (ws.folder) window.nalu.readDir(ws.folder).then(setRoots)
    else setRoots([])
  }, [ws.folder, ws.refreshKey])

  // ---- file operations (simple prompt-driven, then refresh the tree) ----
  const newFile = async (dir: string) => {
    const name = window.prompt('New file name')?.trim()
    if (!name) return
    try { const p = await window.nalu.createFile(dir, name); ws.refresh(); await ws.openFile(p, name) } catch { alert('Could not create file') }
  }
  const newFolder = async (dir: string) => {
    const name = window.prompt('New folder name')?.trim()
    if (!name) return
    try { await window.nalu.mkdir(dir, name); ws.refresh() } catch { alert('Could not create folder') }
  }
  const rename = async (node: Node) => {
    const name = window.prompt('Rename to', node.name)?.trim()
    if (!name || name === node.name) return
    try { await window.nalu.rename(node.path, dirOf(node.path) + '/' + name); ws.refresh() } catch { alert('Could not rename') }
  }
  const del = async (node: Node) => {
    if (!window.confirm(`Delete ${node.name}?`)) return
    try { await window.nalu.del(node.path); ws.refresh() } catch { alert('Could not delete') }
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
            <MenuItem label="New File" onClick={() => { void newFile(menu.node.path); setMenu(null) }} />
            <MenuItem label="New Folder" onClick={() => { void newFolder(menu.node.path); setMenu(null) }} />
            <div className="my-1 border-t border-glass/[0.08]" />
          </>}
          <MenuItem label="Rename" onClick={() => { void rename(menu.node); setMenu(null) }} />
          <MenuItem label="Delete" danger onClick={() => { void del(menu.node); setMenu(null) }} />
        </div>
      )}
    </div>
  )
}

function MenuItem({ label, onClick, danger }: { label: string; onClick: () => void; danger?: boolean }) {
  return (
    <button onClick={onClick} className={`block w-full px-3 py-1.5 text-left hover:bg-glass/[0.08] ${danger ? 'text-red-300' : 'text-ink'}`}>{label}</button>
  )
}
