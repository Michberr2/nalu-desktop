type Entry = { name: string; path: string; dir: boolean }
export const CONTEXT_INDEX_LIMIT = 5000
const ignored = new Set(['node_modules', '.git', 'dist', 'dist-electron', 'release', 'build', '.next', 'out'])

export async function indexWorkspace(root: string, read: (path: string) => Promise<Entry[]>, signal: AbortSignal) {
  const paths: string[] = [], files: string[] = [], pending = [root]
  const seen = new Set<string>()
  let unreadable = 0
  while (pending.length && paths.length < CONTEXT_INDEX_LIMIT) {
    signal.throwIfAborted()
    const directory = pending.pop()!
    if (seen.has(directory)) continue
    seen.add(directory)
    let entries: Entry[]
    try { entries = await read(directory) }
    catch (error) { signal.throwIfAborted(); if (directory === root) throw error; unreadable++; continue }
    signal.throwIfAborted()
    for (const entry of entries) {
      if (ignored.has(entry.name)) continue
      paths.push(entry.path.slice(root.replace(/[\\/]+$/, '').length + 1).replace(/\\/g, '/'))
      if (entry.dir) pending.push(entry.path)
      else files.push(paths[paths.length - 1])
      if (paths.length >= CONTEXT_INDEX_LIMIT) break
    }
  }
  return { paths, files, limited: paths.length >= CONTEXT_INDEX_LIMIT, unreadable }
}
