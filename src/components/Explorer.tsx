import { useEffect, useState } from 'react'
import { ChevronRight, ChevronDown, FolderOpen } from 'lucide-react'
import { useWorkspace } from '../lib/store'
import FileIcon from './FileIcon'

type Node = { name: string; path: string; dir: boolean }

function TreeNode({ node, depth }: { node: Node; depth: number }) {
  const ws = useWorkspace()
  const [open, setOpen] = useState(false)
  const [children, setChildren] = useState<Node[] | null>(null)

  const toggle = async () => {
    if (node.dir) {
      if (!open && !children) setChildren(await window.nalu.readDir(node.path))
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
      {open && children && children.map((c) => <TreeNode key={c.path} node={c} depth={depth + 1} />)}
    </div>
  )
}

export default function Explorer() {
  const ws = useWorkspace()
  const [roots, setRoots] = useState<Node[]>([])

  useEffect(() => {
    if (ws.folder) window.nalu.readDir(ws.folder).then(setRoots)
    else setRoots([])
  }, [ws.folder])

  if (!ws.folder) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-3 p-6 text-center">
        <FolderOpen size={26} className="text-dim" />
        <p className="text-[12px] text-dim">No folder open</p>
        <button
          onClick={() => void ws.openFolder()}
          className="rounded-md bg-gold/90 px-3 py-1.5 text-[12px] font-medium text-[#15170f] hover:bg-gold"
        >
          Open folder
        </button>
      </div>
    )
  }

  return (
    <div className="min-h-0 flex-1 overflow-y-auto px-1.5 pb-2">
      <div className="mb-1 px-1.5 text-[11px] font-medium text-dim">{ws.folder.split('/').pop()}</div>
      {roots.map((n) => <TreeNode key={n.path} node={n} depth={0} />)}
    </div>
  )
}
