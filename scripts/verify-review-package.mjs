import fs from 'node:fs'
import path from 'node:path'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { createRequire } from 'node:module'
const require = createRequire(import.meta.url)
const asar = require('@electron/asar')
const root = path.resolve(import.meta.dirname, '..')
const packageDir = path.resolve(process.argv[2] || '')
if (!process.argv[2] || !packageDir.startsWith(path.join(root, 'review-build') + path.sep)) throw Error('Supply a review-build package directory.')
const appDirectory = process.argv[3] || 'mac-arm64'
assert.ok(['mac-arm64', 'mac-universal'].includes(appDirectory))
const resources = path.join(packageDir, appDirectory, 'Nalu.app/Contents/Resources')
const archive = path.join(resources, 'app.asar')
const hash = bytes => createHash('sha256').update(bytes).digest('hex')
const sourcePackage = JSON.parse(fs.readFileSync(path.join(root, 'package.json')))
const packagedManifest = JSON.parse(asar.extractFile(archive, 'package.json'))
assert.equal(packagedManifest.version, sourcePackage.version)
const updateConfig = fs.readFileSync(path.join(resources, 'app-update.yml'), 'utf8')
assert.match(updateConfig, /provider: github/)
assert.match(updateConfig, /owner: Michberr2/)
assert.match(updateConfig, /repo: nalu-desktop/)
assert.match(updateConfig, /updaterCacheDirName:/)
const cli = fs.readFileSync(path.join(root, 'cli/nalu.mjs'))
assert.deepEqual(fs.readFileSync(path.join(resources, 'cli/nalu.mjs')), cli, 'Bundled CLI must exactly match source')
const buildFiles = {}
function visit(relative) {
  for (const entry of fs.readdirSync(path.join(root, relative), { withFileTypes: true })) {
    const name = path.join(relative, entry.name)
    if (entry.isDirectory()) visit(name)
    else if (entry.isFile()) {
      const bytes = fs.readFileSync(path.join(root, name))
      assert.deepEqual(asar.extractFile(archive, name), bytes, `Packaged bytes differ: ${name}`)
      buildFiles[name] = hash(bytes)
    }
  }
}
visit('dist'); visit('dist-electron')
const result = {
  checkedAt: new Date().toISOString(), desktopVersion: sourcePackage.version,
  cliVersion: cli.toString().match(/^const VERSION = '([^']+)'/m)[1], cliSha256: hash(cli),
  archiveSha256: hash(fs.readFileSync(archive)), buildFiles, buildFileCount: Object.keys(buildFiles).length,
  updateConfigSha256: hash(Buffer.from(updateConfig)),
  scope: 'Exact packaged renderer/main/preload/browser-worker and CLI bytes compared with the local build. Runtime, signing, installation, and publication require separate evidence.',
}
fs.writeFileSync(path.join(packageDir, 'verification.json'), JSON.stringify(result, null, 2) + '\n')
console.log(`Verified ${result.buildFileCount} build files and CLI ${result.cliVersion} in desktop ${result.desktopVersion}.`)
