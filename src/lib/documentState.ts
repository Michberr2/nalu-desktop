export type DocumentTab = {
  path: string
  name: string
  content: string
  savedContent: string
  dirty: boolean
  diskConflict?: string
  saveError?: string
  recovered?: boolean
  detached?: boolean
}

// An edit proposal belongs to the buffer the model actually read. Never apply
// it over newer typing, a disk conflict, or a deleted/renamed file.
export function applyProposedContent(tab: DocumentTab, before: string, after: string): DocumentTab | null {
  if (tab.detached || tab.diskConflict !== undefined || tab.content !== before) return null
  return { ...tab, content: after, dirty: after !== tab.savedContent, saveError: undefined }
}

export function reconcileDisk(tab: DocumentTab, disk: string): DocumentTab {
  if (tab.detached) return tab
  if (disk === tab.savedContent) return tab.diskConflict === undefined ? tab : { ...tab, diskConflict: undefined }
  if (tab.dirty && disk !== tab.content) return { ...tab, diskConflict: disk }
  return { ...tab, content: disk, savedContent: disk, dirty: false, diskConflict: undefined, saveError: undefined, recovered: false }
}

// A completed write acknowledges only its own snapshot. Typing during a save
// must remain dirty so the next save persists the newer edit.
export function acknowledgeSave(tab: DocumentTab, written: string): DocumentTab {
  return { ...tab, savedContent: written, dirty: tab.content !== written, diskConflict: undefined, saveError: undefined, recovered: false }
}

export function acknowledgeSaveAs(tab: DocumentTab, destination: string, written: string): DocumentTab {
  return { ...acknowledgeSave(tab, written), detached: false, path: destination, name: destination.split(/[\\/]/).pop() || tab.name }
}

export function relocatedPath(file: string, from: string, to: string): string {
  const normalized = file.replace(/\\/g, '/')
  const source = from.replace(/\\/g, '/').replace(/\/$/, '')
  if (normalized !== source && !normalized.startsWith(source + '/')) return file
  const separator = to.includes('\\') ? '\\' : '/'
  return to.replace(/[\\/]$/, '') + normalized.slice(source.length).replace(/\//g, separator)
}

export function relocateTabs(tabs: DocumentTab[], from: string, to: string): DocumentTab[] {
  const result = tabs.map(tab => {
    const path = relocatedPath(tab.path, from, to)
    return path === tab.path ? tab : { ...tab, path, name: path.split(/[\\/]/).pop() || tab.name }
  })
  if (new Set(result.map(tab => tab.path)).size !== result.length) {
    throw new Error('The destination is already open in another tab. Close it or choose another name.')
  }
  return result
}

export function detachDeletedTabs(tabs: DocumentTab[], target: string): DocumentTab[] {
  const source = target.replace(/\\/g, '/').replace(/\/$/, '')
  return tabs.flatMap(tab => {
    const file = tab.path.replace(/\\/g, '/')
    if (file !== source && !file.startsWith(source + '/')) return [tab]
    if (!tab.dirty) return []
    return [{ ...tab, detached: true, recovered: true, diskConflict: undefined, saveError: undefined }]
  })
}
