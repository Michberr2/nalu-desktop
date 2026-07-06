import { Folder, FolderOpen, FileText, FileCode, FileJson, FileImage, Braces } from 'lucide-react'

// A tiny, tasteful file-type icon set (gold-tinted for code, dim otherwise).
export default function FileIcon({ name, dir, open }: { name: string; dir: boolean; open?: boolean }) {
  if (dir) {
    const Icon = open ? FolderOpen : Folder
    return <Icon size={14} className="shrink-0 text-gold/80" />
  }
  const ext = name.split('.').pop()?.toLowerCase() || ''
  if (['ts', 'tsx', 'js', 'jsx', 'mjs', 'cjs'].includes(ext)) return <FileCode size={14} className="shrink-0 text-accent" />
  if (['json'].includes(ext)) return <FileJson size={14} className="shrink-0 text-dim" />
  if (['css', 'scss', 'html'].includes(ext)) return <Braces size={14} className="shrink-0 text-accent/80" />
  if (['png', 'jpg', 'jpeg', 'gif', 'svg', 'webp'].includes(ext)) return <FileImage size={14} className="shrink-0 text-dim" />
  return <FileText size={14} className="shrink-0 text-dim" />
}
