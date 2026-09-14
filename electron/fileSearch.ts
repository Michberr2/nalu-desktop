import { promises as fs, constants } from 'node:fs'
import path from 'node:path'
import { SEARCH_RESULT_LIMIT } from '../src/lib/searchLimits'

export type SearchHit = { file: string; rel: string; line: number; text: string }
export const SEARCH_IGNORE = new Set(['.git', 'node_modules', '.DS_Store', 'dist', 'dist-electron', '.next', 'release', 'build'])

export async function searchFiles(root: string, query: string, signal?: AbortSignal): Promise<SearchHit[]> {
  const needle = query.trim().toLowerCase()
  signal?.throwIfAborted()
  if (!root || !needle) return []
  const hits: SearchHit[] = []
  const maxBytes = 2_000_000
  // Reuse one bounded buffer throughout this sequential traversal.
  const buffer = Buffer.allocUnsafe(maxBytes + 1)
  const decoder = new TextDecoder('utf-8', { fatal: true })
  const visit = async (directory: string): Promise<void> => {
    signal?.throwIfAborted()
    let entries
    try { entries = await fs.readdir(directory, { withFileTypes: true }) }
    catch (error) { if (directory === root) throw error; return }
    entries.sort((a, b) => a.name.localeCompare(b.name))
    for (const entry of entries) {
      signal?.throwIfAborted()
      if (hits.length >= SEARCH_RESULT_LIMIT) return
      if (SEARCH_IGNORE.has(entry.name)) continue
      const file = path.join(directory, entry.name)
      if (entry.isDirectory()) { await visit(file); continue }
      if (!entry.isFile()) continue // never follow links or read special files
      let handle
      try {
        handle = await fs.open(file, constants.O_RDONLY | (constants.O_NOFOLLOW || 0) | (constants.O_NONBLOCK || 0))
        const stat = await handle.stat()
        if (!stat.isFile() || stat.size > maxBytes) continue
        let length = 0
        while (length < buffer.length) {
          signal?.throwIfAborted()
          const { bytesRead } = await handle.read(buffer, length, Math.min(65536, buffer.length - length), length)
          if (!bytesRead) break
          length += bytesRead
        }
        if (length > maxBytes || buffer.subarray(0, length).includes(0)) continue
        const lines = decoder.decode(buffer.subarray(0, length)).split('\n')
        for (let i = 0; i < lines.length && hits.length < SEARCH_RESULT_LIMIT; i++) {
          if (lines[i].toLowerCase().includes(needle)) hits.push({ file, rel: path.relative(root, file), line: i + 1, text: lines[i].trim().slice(0, 200) })
        }
      } catch { signal?.throwIfAborted() /* unreadable or non-UTF-8 file */ }
      finally { await handle?.close() }
    }
  }
  await visit(root)
  signal?.throwIfAborted()
  return hits
}
