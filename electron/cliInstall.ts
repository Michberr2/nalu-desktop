import fs from 'node:fs'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { randomUUID } from 'node:crypto'

const versionOf = (source: string) => source.match(/^const VERSION = '([0-9]+\.[0-9]+\.[0-9]+)'/m)?.[1]
const newer = (left: string, right: string) => {
  const a = left.split('.').map(Number), b = right.split('.').map(Number)
  for (let i = 0; i < 3; i++) if (a[i] !== b[i]) return a[i] > b[i]
  return false
}
const quote = (value: string) => `'${value.replace(/'/g, `'"'"'`)}'`

export function installDesktopCli({ sourcePath, binDir, runtime, appPath = '', platform = process.platform }: {
  sourcePath: string; binDir: string; runtime: string; appPath?: string; platform?: NodeJS.Platform
}) {
  const source = fs.readFileSync(sourcePath, 'utf8')
  const bundledVersion = versionOf(source)
  if (!bundledVersion) throw new Error('Bundled Nalu CLI has no valid version.')
  fs.mkdirSync(binDir, { recursive: true })
  const installed = path.join(binDir, 'nalu.mjs')
  const check = (file: string) => {
    const result = spawnSync(runtime, ['--check', file], { env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' }, timeout: 10000, encoding: 'utf8' })
    return !result.error && result.status === 0
  }
  let existing = ''
  try { existing = fs.readFileSync(installed, 'utf8') } catch { /* first installation */ }
  const existingVersion = versionOf(existing)
  const preserve = existingVersion && newer(existingVersion, bundledVersion) && check(installed)
  if (!preserve && existing !== source) {
    const staged = path.join(binDir, `.nalu-${randomUUID()}.mjs`)
    try {
      fs.writeFileSync(staged, source, { mode: 0o755, flag: 'wx' })
      if (!check(staged)) throw new Error('Bundled Nalu CLI failed its runtime syntax check.')
      fs.renameSync(staged, installed)
    } finally { try { fs.unlinkSync(staged) } catch { /* renamed or absent */ } }
  }
  const script = platform === 'win32'
    ? `@echo off\r\nsetlocal\r\nset "ELECTRON_RUN_AS_NODE=1"\r\nset "NALU_DESKTOP_RUNTIME=${runtime.replace(/%/g, '%%')}"\r\nset "NALU_DESKTOP_APP=${appPath.replace(/%/g, '%%')}"\r\n"${runtime.replace(/%/g, '%%')}" "${installed.replace(/%/g, '%%')}" %*\r\n`
    : `#!/bin/sh\n# Nalu Desktop: full coding agent using the app runtime.\nNALU_DESKTOP_RUNTIME=${quote(runtime)} NALU_DESKTOP_APP=${quote(appPath)} ELECTRON_RUN_AS_NODE=1 exec ${quote(runtime)} ${quote(installed)} "$@"\n`
  const launcher = path.join(binDir, platform === 'win32' ? 'nalu.cmd' : 'nalu')
  const stagedLauncher = `${launcher}.${randomUUID()}.tmp`
  try {
    fs.writeFileSync(stagedLauncher, script, { mode: 0o755, flag: 'wx' })
    fs.renameSync(stagedLauncher, launcher)
  } finally { try { fs.unlinkSync(stagedLauncher) } catch { /* renamed or absent */ } }
  return { launcher, script: installed, version: preserve ? existingVersion : bundledVersion }
}
