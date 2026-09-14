import { promises as fs } from 'node:fs'
import path from 'node:path'

export async function createEntry(directory: string, name: string, kind: 'file' | 'folder'): Promise<string> {
  if (!name.trim() || name === '.' || name === '..' || /[\\/\0]/.test(name)) {
    throw new Error('Enter a name without path separators.')
  }
  const destination = path.join(directory, name)
  try {
    if (kind === 'file') await fs.writeFile(destination, '', { flag: 'wx' })
    else await fs.mkdir(destination, { recursive: false })
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'EEXIST') {
      throw new Error('An item with that name already exists. Choose another name.')
    }
    throw error
  }
  return destination
}
