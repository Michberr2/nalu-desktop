import test from 'node:test'
import assert from 'node:assert/strict'
import { makeRenderer } from './nalu.mjs'

function render(text) {
  let output = ''
  const renderer = makeRenderer(chunk => { output += chunk })
  for (const char of text) renderer.feed(char)
  renderer.flush()
  return output
}

test('live-model inline tool syntax is hidden while narration is preserved', () => {
  assert.equal(render('Let me see the project.bash{"arguments":{"command":"ls -la"}}'), 'Let me see the project.\n')
  assert.equal(render('Reading now.{"name":"read_file","arguments":{"path":"sum.mjs"}}'), 'Reading now.\n')
  assert.equal(render('Fixed it.edit_file{"name":"edit_file","arguments":{"path":"sum.mjs","old_string":"-","new_string":"+"}}'), 'Fixed it.\n')
})

test('multiline prefixed tool calls preserve narration without printing argument bodies', () => {
  const output = render('Reading now.read_file{\n"path": "sum.mjs"\n}\n')
  assert.equal(output, 'Reading now.\n')
})

test('ordinary code, JSON data, and standalone language names are not swallowed', () => {
  for (const content of [
    '```bash\nnpm test\n```',
    '```json\n{"project":"nalu"}\n```',
    '{\n"answer": 42\n}',
    'json',
    'Use bash to run your tests.',
  ]) {
    const output = render(content)
    for (const line of content.split('\n')) assert.ok(output.includes(line), output)
  }
})

test('structured tool-only output is hidden', () => {
  assert.equal(render('{"name":"read_file","arguments":{"path":"file.txt"}}'), '')
})

test('model text and code blocks cannot emit terminal control commands', () => {
  const text = 'Hello\x1b[2J world\x1b]52;c;payload\x07\x08'
  assert.equal(render(text), 'Hello world\n')
  const code = render('```sh\n' + text + '\n```')
  assert.doesNotMatch(code, /\x1b|\x07|\x08/)
  assert.match(code, /Hello world/)
})
