import fs from 'node:fs'
import path from 'node:path'
import { createHash } from 'node:crypto'

// Fixture-level constraints complement browser behavior. Preserve the original
// receipt when auditing an older run; callers write a separate audit artifact.
export function inspectVisualContract(workspace, initialHashes) {
  const files = [], symlinks = new Set(), dependencyDirectories = []
  const walk = (directory, prefix = '') => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const name = prefix + entry.name, file = path.join(directory, entry.name)
      if (entry.name === 'node_modules' && (entry.isDirectory() || entry.isSymbolicLink())) { dependencyDirectories.push(name); continue }
      if (entry.isSymbolicLink()) { symlinks.add(name); files.push(name); continue }
      if (entry.isDirectory()) {
        if (name === '.npm' || name === '.git') continue // npm check metadata, not project source
        walk(file, name + '/')
      } else if (entry.isFile()) files.push(name)
    }
  }
  walk(workspace)
  const hash = file => createHash('sha256').update(symlinks.has(file) ? 'symlink:' + fs.readlinkSync(path.join(workspace, file)) : fs.readFileSync(path.join(workspace, file))).digest('hex')
  const testFiles = files.filter(file => /(?:^|[/._-])(?:tests?|specs?)(?:[/._-]|$)/i.test(file)
    && /\.(?:[cm]?[jt]sx?|py|rb|rs|go|sh)$/i.test(file)
    && (!initialHashes[file] || hash(file) !== initialHashes[file]))
  return [
    { name: 'no added or modified test files', passed: testFiles.length === 0, actual: testFiles },
    { name: 'dependency configuration preserved', passed: files.includes('package.json') && hash('package.json') === initialHashes['package.json'], actual: files.includes('package.json') ? hash('package.json') : 'missing' },
    { name: 'no added dependency tree', passed: dependencyDirectories.length === 0, actual: dependencyDirectories },
  ]
}
