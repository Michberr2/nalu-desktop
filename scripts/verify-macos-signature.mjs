import fs from 'node:fs'
import path from 'node:path'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
const root = path.resolve(import.meta.dirname, '..')
const directory = path.resolve(process.argv[2] || '')
assert.equal(process.platform, 'darwin')
assert.ok(process.argv[2] && directory.startsWith(path.join(root, 'review-build') + path.sep))
const appDirectory = process.argv[3] || 'mac-arm64'
assert.ok(['mac-arm64', 'mac-universal'].includes(appDirectory))
const app = path.join(directory, appDirectory, 'Nalu.app')
const manifest = JSON.parse(fs.readFileSync(path.join(root, 'package.json')))
const run = (command, args) => {
  const result = spawnSync(command, args, { encoding: 'utf8', timeout: 60000 })
  return { status: result.status, signal: result.signal, output: (result.stdout || '') + (result.stderr || ''), ...(result.error ? { error: result.error.message } : {}) }
}
const verification = run('codesign', ['--verify', '--deep', '--strict', '--verbose=2', app])
const metadata = run('codesign', ['-d', '--verbose=4', app])
const gatekeeper = run('spctl', ['--assess', '--type', 'execute', '--verbose=4', app])
const staple = run('xcrun', ['stapler', 'validate', app])
const signed = verification.status === 0 && metadata.status === 0
  && metadata.output.includes('Identifier=' + manifest.build.appId + '\n')
  && metadata.output.includes('TeamIdentifier=' + manifest.build.mac.notarize.teamId + '\n')
  && metadata.output.includes('Authority=Developer ID Application:') && metadata.output.includes('(runtime)')
const result = { checkedAt: new Date().toISOString(), app, signed, gatekeeperAccepted: gatekeeper.status === 0,
  stapleValidated: staple.status === 0, verification, metadata, gatekeeper, staple,
  scope: 'Strict nested signature, Developer ID identity and hardened runtime validation. Gatekeeper assessment and stapled-ticket validation are recorded separately; a valid signature alone is not notarization.' }
fs.writeFileSync(path.join(directory, 'signature-verification.json'), JSON.stringify(result, null, 2) + '\n')
console.log(JSON.stringify({ signed, gatekeeperAccepted: result.gatekeeperAccepted, stapleValidated: result.stapleValidated }))
if (!signed) process.exitCode = 1
