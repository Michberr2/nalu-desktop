import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { execTool } from './nalu.mjs'

const execute = (name, args) => execTool({ yolo: true, sessionAllow: new Set() }, {
  id: 'file-test', function: { name, arguments: JSON.stringify(args) },
})
function fixture(t, content = 'first\nsecond\n') {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nalu-file-test-'))
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }))
  const file = path.join(dir, 'example.txt')
  fs.writeFileSync(file, content)
  return file
}

test('edit_file can delete matched text and write_file can create empty files', async t => {
  const file = fixture(t)
  assert.match(await execute('edit_file', { path: file, old_string: 'first\n', new_string: '' }), /edited/)
  assert.equal(fs.readFileSync(file, 'utf8'), 'second\n')
  assert.match(await execute('write_file', { path: file, content: '' }), /wrote 0 bytes/)
  assert.equal(fs.readFileSync(file, 'utf8'), '')
})

test('wrong JSON types cannot expand an edit or overwrite a file', async t => {
  const file = fixture(t, 'match match')
  for (const replace_all of ['false', 'true', 1, null, {}]) {
    const result = await execute('edit_file', { path: file, old_string: 'match', new_string: 'changed', replace_all })
    assert.match(result, /replace_all must be a boolean/)
    assert.equal(fs.readFileSync(file, 'utf8'), 'match match')
  }
  assert.match(await execute('write_file', { path: file, content: { value: 'bad' } }), /content must be a string/)
  assert.equal(fs.readFileSync(file, 'utf8'), 'match match')
})

test('ambiguous edits require explicit replace_all true; replacement text stays literal', async t => {
  const file = fixture(t, 'match match')
  assert.match(await execute('edit_file', { path: file, old_string: 'match', new_string: '$&', replace_all: false }), /appears 2 times/)
  assert.equal(fs.readFileSync(file, 'utf8'), 'match match')
  assert.match(await execute('edit_file', { path: file, old_string: 'match', new_string: '$&', replace_all: true }), /2 replacements/)
  assert.equal(fs.readFileSync(file, 'utf8'), '$& $&')
})

test('read_file rejects invalid line ranges and returns accurately numbered valid ranges', async t => {
  const file = fixture(t)
  for (const offset of [0, -1, 1.5, '2'])
    assert.match(await execute('read_file', { path: file, offset }), /must be/)
  const result = await execute('read_file', { path: file, offset: 2, limit: 1 })
  assert.match(result, /2  second/)
  assert.doesNotMatch(result, /first/)
})
