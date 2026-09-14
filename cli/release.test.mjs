import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const cliDir = fileURLToPath(new URL('.', import.meta.url))
function fixture(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nalu-release-test-'))
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }))
  const bin = path.join(dir, 'mock-bin')
  fs.mkdirSync(bin)
  fs.writeFileSync(path.join(bin, 'curl'), '#!/bin/sh\nfor arg do target="$arg"; done\ncp "$NALU_TEST_DOWNLOAD" "$target"\n', { mode: 0o755 })
  const install = path.join(dir, 'install with spaces')
  const download = path.join(dir, 'download.mjs')
  return { dir, install, download, env: { ...process.env, PATH: `${bin}:${process.env.PATH}`, NALU_TEST_DOWNLOAD: download, NALU_INSTALL_DIR: install, NALU_NO_MODIFY_PATH: '1' } }
}

test('installer creates a runnable isolated installation and a relocatable launcher', t => {
  const f = fixture(t)
  fs.copyFileSync(path.join(cliDir, 'nalu.mjs'), f.download)
  const result = spawnSync('sh', [path.join(cliDir, 'install.sh')], { env: f.env, encoding: 'utf8', timeout: 10000 })
  assert.equal(result.status, 0, result.stdout + result.stderr)
  assert.deepEqual(fs.readdirSync(f.install).sort(), ['nalu', 'nalu.mjs'])
  assert.equal(fs.readFileSync(path.join(f.install, 'nalu.mjs'), 'utf8'), fs.readFileSync(f.download, 'utf8'))
  const moved = path.join(f.dir, 'moved installation')
  fs.renameSync(f.install, moved)
  const version = spawnSync(path.join(moved, 'nalu'), ['--version'], { encoding: 'utf8', timeout: 2000 })
  assert.equal(version.status, 0, version.stderr)
  assert.match(version.stdout, /^nalu \d+\.\d+\.\d+/)
})

test('installer rejects broken downloads without replacing an existing CLI', t => {
  const f = fixture(t)
  fs.mkdirSync(f.install)
  const installed = path.join(f.install, 'nalu.mjs')
  fs.writeFileSync(installed, 'original CLI')
  for (const content of ['<html>error</html>', "#!/usr/bin/env node\n// Nalu CLI\nconst VERSION = '1.0.0'\nfunction broken( {"]) {
    fs.writeFileSync(f.download, content)
    const result = spawnSync('sh', [path.join(cliDir, 'install.sh')], { env: f.env, encoding: 'utf8', timeout: 10000 })
    assert.notEqual(result.status, 0)
    assert.equal(fs.readFileSync(installed, 'utf8'), 'original CLI')
    assert.deepEqual(fs.readdirSync(f.install), ['nalu.mjs'])
  }
})

test('publish script copies the exact CLI and installer to the selected release directory', t => {
  const f = fixture(t)
  const destination = path.join(f.dir, 'client', 'public')
  fs.mkdirSync(destination, { recursive: true })
  const result = spawnSync('sh', [path.join(cliDir, 'publish.sh')], { env: { ...process.env, TRAIN_DIR: f.dir }, encoding: 'utf8', timeout: 5000 })
  assert.equal(result.status, 0, result.stderr)
  for (const file of ['nalu.mjs', 'install.sh'])
    assert.deepEqual(fs.readFileSync(path.join(destination, file)), fs.readFileSync(path.join(cliDir, file)))
})
