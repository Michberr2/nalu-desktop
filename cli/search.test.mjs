import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { toolGrep } from './nalu.mjs'

function fixture(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nalu-search-test-'))
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }))
  return dir
}

test('search finds nested paths using globstars and respects file filters', t => {
  const dir = fixture(t)
  fs.mkdirSync(path.join(dir, 'src', 'lib'), { recursive: true })
  fs.writeFileSync(path.join(dir, 'src', 'main.ts'), 'needle\n')
  fs.writeFileSync(path.join(dir, 'src', 'lib', 'util.ts'), 'needle\n')
  fs.writeFileSync(path.join(dir, 'src', 'skip.js'), 'needle\n')
  const result = toolGrep({ path: dir, pattern: 'needle', glob: 'src/**/*.ts' })
  assert.match(result, /main.ts:1: needle/)
  assert.match(result, /util.ts:1: needle/)
  assert.doesNotMatch(result, /skip.js/)
  assert.match(toolGrep({ path: path.join(dir, 'src', 'skip.js'), pattern: 'needle', glob: '*.ts' }), /no matches/)
})

test('direct-file searches use the same size and binary limits as directory searches', t => {
  const dir = fixture(t)
  const large = path.join(dir, 'large.txt')
  const binary = path.join(dir, 'binary.dat')
  fs.writeFileSync(large, 'needle' + 'x'.repeat(1500000))
  fs.writeFileSync(binary, 'needle\0data')
  assert.match(toolGrep({ path: large, pattern: 'needle' }), /search incomplete: files larger/)
  assert.match(toolGrep({ path: binary, pattern: 'needle' }), /search incomplete: binary/)
  assert.match(toolGrep({ path: dir, pattern: 'needle' }), /files larger.*binary|binary.*files larger/)
})

test('search depth limits are disclosed instead of implying a complete negative result', t => {
  const dir = fixture(t)
  const nested = path.join(dir, ...Array(14).fill('nested'))
  fs.mkdirSync(nested, { recursive: true })
  fs.writeFileSync(path.join(nested, 'file.txt'), 'needle')
  assert.match(toolGrep({ path: dir, pattern: 'needle' }), /search incomplete: 12-directory depth/)
  assert.match(toolGrep({ path: nested, pattern: 'needle' }), /file.txt:1: needle/)
})

test('search match caps remain visible and malformed regex falls back to literal search', t => {
  const dir = fixture(t)
  const file = path.join(dir, 'many.txt')
  fs.writeFileSync(file, Array(205).fill('literal [').join('\n'))
  const result = toolGrep({ path: file, pattern: '[' })
  assert.match(result, /many.txt:1: literal \[/)
  assert.match(result, /capped at 200 matches/)
})
