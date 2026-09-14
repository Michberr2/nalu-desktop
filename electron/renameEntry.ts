import { promises as fs } from 'node:fs'
import path from 'node:path'

// Explorer rename never intentionally replaces another entry, including a
// dangling symlink. The existence check is not atomic against external writers.
export async function renameEntry(from: string, to: string): Promise<boolean> {
  if (path.resolve(from) === path.resolve(to)) return true
  if (path.dirname(path.resolve(from)) !== path.dirname(path.resolve(to))) {
    throw new Error('Rename must stay in the same folder.')
  }
  try {
    await fs.lstat(to)
    throw new Error('An item with that name already exists. Choose another name.')
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
  }
  await fs.rename(from, to)
  return true
}
