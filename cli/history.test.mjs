import test from 'node:test'
import assert from 'node:assert/strict'
import { setTimeout as delay } from 'node:timers/promises'
import { trimHistory, pool, streamOnce } from './nalu.mjs'

test('trimming preserves the real request when a retry nudge is the latest user-role message', () => {
  const original = { role: 'user', content: 'Fix the payment calculation' }
  const messages = [
    { role: 'user', content: 'old task' },
    { role: 'assistant', content: 'x'.repeat(170000) },
    original,
    { role: 'assistant', content: 'y'.repeat(170000) },
    { role: 'user', naluInternal: true, content: 'Please issue a valid call' },
  ]
  trimHistory(messages)
  assert.equal(messages[0], original)
  assert.equal(messages.at(-1).naluInternal, true)
})

test('history compaction keeps tool calls paired with results', () => {
  const messages = [{ role: 'user', content: 'current task' }]
  for (let i = 0; i < 10; i++) {
    messages.push({ role: 'assistant', tool_calls: [{ id: `call-${i}`, function: { name: 'read_file', arguments: '{}' } }] })
    messages.push({ role: 'tool', tool_call_id: `call-${i}`, content: 'x'.repeat(30000) })
  }
  trimHistory(messages)
  assert.equal(messages.length, 21)
  for (let i = 1; i < messages.length; i += 2)
    assert.equal(messages[i].tool_calls[0].id, messages[i + 1].tool_call_id)
  assert.equal(messages.at(-1).content.length, 30000)
  assert.ok(messages[2].content.length < 100)
})

test('internal history metadata never enters the backend message payload', async () => {
  const original = globalThis.fetch
  try {
    globalThis.fetch = async (_url, options) => {
      const body = JSON.parse(options.body)
      assert.deepEqual(body.messages, [{ role: 'user', content: 'retry' }])
      return new Response('event: delta\ndata: {"text":"done"}\n\nevent: done\ndata: {"ok":true}\n\n')
    }
    await streamOnce({ api: 'https://nalu.invalid', workerAborts: new Set(), messages: [{ role: 'user', naluInternal: true, content: 'retry' }] }, {}, { quiet: true })
  } finally { globalThis.fetch = original }
})

test('parallel work respects concurrency and preserves input order', async () => {
  let active = 0, peak = 0
  const result = await pool([30, 10, 20, 5], 2, async ms => {
    peak = Math.max(peak, ++active)
    await delay(ms)
    active--
    return ms
  })
  assert.equal(peak, 2)
  assert.deepEqual(result, [30, 10, 20, 5])
})

test('parallel failure drains in-flight work without starting queued tasks', async () => {
  const started = []
  let siblingFinished = false
  await assert.rejects(pool([0, 1, 2, 3], 2, async item => {
    started.push(item)
    if (item === 0) { await delay(5); throw new Error('task failed') }
    await delay(25)
    siblingFinished = true
  }), /task failed/)
  assert.equal(siblingFinished, true)
  assert.deepEqual(started, [0, 1])
  await assert.rejects(pool([1], 0, async x => x), /positive integer/)
})
