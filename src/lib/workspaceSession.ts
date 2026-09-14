import { reconcileDisk, type DocumentTab } from './documentState'

type Entry = { path: string; name: string; content?: string; savedContent?: string; detached?: boolean }
export type WorkspaceSession = { version: 1; activePath: string | null; tabs: Entry[]; folder?: string | null }

export function snapshotSession(tabs: DocumentTab[], activePath: string | null, folder?: string | null): WorkspaceSession {
  return { version: 1, activePath, ...(folder !== undefined ? { folder } : {}), tabs: tabs.map(tab => ({ path: tab.path, name: tab.name,
    ...(tab.dirty || tab.detached ? { content: tab.content, savedContent: tab.savedContent } : {}),
    ...(tab.detached ? { detached: true } : {}),
  })) }
}

export function parseSession(raw: string): WorkspaceSession {
  const value = JSON.parse(raw) as WorkspaceSession
  if (!value || value.version !== 1 || !Array.isArray(value.tabs) ||
      !(value.activePath === null || typeof value.activePath === 'string')) throw new Error('Invalid workspace recovery journal.')
  if (value.folder !== undefined && value.folder !== null && (typeof value.folder !== 'string' || !value.folder.length)) throw new Error('Invalid workspace recovery folder.')
  const paths = new Set<string>()
  for (const tab of value.tabs) {
    if (!tab || typeof tab.path !== 'string' || !tab.path || typeof tab.name !== 'string' ||
        (tab.detached !== undefined && (typeof tab.detached !== 'boolean' || (tab.detached && tab.content === undefined))) ||
        !((tab.content === undefined && tab.savedContent === undefined) ||
          (typeof tab.content === 'string' && typeof tab.savedContent === 'string')) || paths.has(tab.path)) {
      throw new Error('Invalid workspace recovery entry.')
    }
    paths.add(tab.path)
  }
  return value
}

export async function restoreSession(session: WorkspaceSession, read: (path: string) => Promise<string>, signal?: AbortSignal) {
  const restore = async (entry: Entry) => {
    if (entry.detached) return { path: entry.path, name: entry.name, content: entry.content!, savedContent: entry.savedContent!, dirty: true, detached: true, recovered: true } as DocumentTab
    try {
      const disk = await read(entry.path)
      if (entry.content === undefined) return { path: entry.path, name: entry.name, content: disk, savedContent: disk, dirty: false } as DocumentTab
      const tab = reconcileDisk({ path: entry.path, name: entry.name, content: entry.content, savedContent: entry.savedContent!, dirty: entry.content !== entry.savedContent }, disk)
      return { ...tab, recovered: tab.dirty }
    } catch (error) {
      if (entry.content === undefined) return null
      return { path: entry.path, name: entry.name, content: entry.content, savedContent: entry.savedContent!, dirty: true, recovered: true,
        saveError: `Cannot read original file: ${error instanceof Error ? error.message : String(error)}` } as DocumentTab
    }
  }
  // Avoid issuing a read for every saved tab at once. Keep tab ordering stable
  // even when filesystem reads finish out of order, and stop scheduling reads
  // when the owning renderer effect is retired.
  const restored: (DocumentTab | null)[] = new Array(session.tabs.length)
  let next = 0
  await Promise.all(Array.from({ length: Math.min(4, session.tabs.length) }, async () => {
    while (next < session.tabs.length) {
      signal?.throwIfAborted()
      const index = next++
      restored[index] = await restore(session.tabs[index])
    }
  }))
  signal?.throwIfAborted()
  const tabs = restored.filter((tab): tab is DocumentTab => tab !== null)
  return { tabs, activePath: tabs.some(tab => tab.path === session.activePath) ? session.activePath : tabs[0]?.path ?? null,
    ...(session.folder !== undefined ? { folder: session.folder } : {}) }
}
