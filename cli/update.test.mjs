import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { selfUpdate } from './nalu.mjs'

const release = `#!/usr/bin/env node
// Nalu CLI
const VERSION = '9.8.7'
console.log('nalu ' + VERSION)
`

function installed(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nalu-update-test-'))
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }))
  const self = path.join(dir, 'nalu.mjs')
  fs.writeFileSync(self, 'original CLI', { mode: 0o755 })
  return { dir, self }
}

test('self-update validates and atomically replaces the symlink target while preserving permissions', async t => {
  const { dir, self } = installed(t)
  const link = path.join(dir, 'nalu')
  fs.symlinkSync(self, link)
  let request
  await selfUpdate('https://nalu.invalid', { self: link, fetch: async (url, options) => {
    assert.equal(url, 'https://nalu.invalid/nalu.mjs')
    request = options
    return new Response(release)
  } })
  assert.ok(request.signal instanceof AbortSignal)
  assert.equal(fs.readFileSync(self, 'utf8'), release)
  assert.equal(fs.statSync(self).mode & 0o777, 0o755)
  assert.ok(fs.lstatSync(link).isSymbolicLink())
  assert.deepEqual(fs.readdirSync(dir).sort(), ['nalu', 'nalu.mjs'])
})

test('broken downloads preserve the original CLI and leave no staging files', async t => {
  const { dir, self } = installed(t)
  for (const [body, status, message] of [
    ['not found', 404, /HTTP 404/],
    ['<html>error</html>', 200, /does not look/],
    ['#!/usr/bin/env node\n// Nalu CLI\n', 200, /does not look/],
    [release + '\nfunction broken( {', 200, /syntax validation/],
    [release + ' '.repeat(2 * 1024 * 1024), 200, /exceeds/],
  ]) {
    await assert.rejects(selfUpdate('https://nalu.invalid', {
      self, fetch: async () => new Response(body, { status }),
    }), message)
    assert.equal(fs.readFileSync(self, 'utf8'), 'original CLI')
    assert.equal(fs.statSync(self).mode & 0o777, 0o755)
    assert.deepEqual(fs.readdirSync(dir), ['nalu.mjs'])
  }
})

test('validation parses the release without executing it', async t => {
  const { self, dir } = installed(t)
  const marker = path.join(dir, 'must-not-exist')
  const code = release + `\nimport fs from 'node:fs'; fs.writeFileSync(${JSON.stringify(marker)}, 'executed')`
  await selfUpdate('https://nalu.invalid', { self, fetch: async () => new Response(code) })
  assert.equal(fs.existsSync(marker), false)
})

test('interrupted downloads preserve the installed CLI', async t => {
  const { self, dir } = installed(t)
  await assert.rejects(selfUpdate('https://nalu.invalid', {
    self, fetch: async () => new Response(new ReadableStream({
      start(controller) { controller.enqueue(new TextEncoder().encode(release)) },
      pull(controller) { controller.error(new Error('connection reset')) },
    })),
  }), /connection reset/)
  assert.equal(fs.readFileSync(self, 'utf8'), 'original CLI')
  assert.deepEqual(fs.readdirSync(dir), ['nalu.mjs'])
})
