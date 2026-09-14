import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { createHash } from 'node:crypto'
import { inspectVisualContract } from './visual-contract.mjs'

test('visual acceptance rejects the prohibited tests observed in live repair while allowing npm metadata and project plans', t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'nalu-visual-contract-'))
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }))
  const pkg = '{"scripts":{"check":"node --check app.js"}}'
  fs.writeFileSync(path.join(directory, 'package.json'), pkg)
  fs.mkdirSync(path.join(directory, '.npm')); fs.writeFileSync(path.join(directory, '.npm/_update-notifier-last-checked'), '')
  fs.mkdirSync(path.join(directory, '.nalu/plans'), { recursive: true }); fs.writeFileSync(path.join(directory, '.nalu/plans/repair.md'), 'Fix the stylesheet reference.')
  const initial = { 'package.json': createHash('sha256').update(pkg).digest('hex') }
  assert.ok(inspectVisualContract(directory, initial).every(check => check.passed))
  for (const name of ['test-behavior.js', 'edge.test.js']) fs.writeFileSync(path.join(directory, name), 'const assert = require("assert"); assert.ok(true)')
  const checks = inspectVisualContract(directory, initial)
  assert.equal(checks[0].passed, false)
  assert.deepEqual(checks[0].actual, ['edge.test.js', 'test-behavior.js'])
  assert.ok(checks.slice(1).every(check => check.passed))
})
