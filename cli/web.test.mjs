import test from 'node:test'
import assert from 'node:assert/strict'
import { toolWeb } from './nalu.mjs'
const session = () => ({ api: 'https://nalu.invalid', token: 'test-token', workerAborts: new Set() })

test('web tools pass authentication and render search results', async () => {
  const original = globalThis.fetch
  const state = session()
  try {
    globalThis.fetch = async (url, options) => {
      assert.equal(url, 'https://nalu.invalid/api/web')
      assert.equal(options.headers.Authorization, 'Bearer test-token')
      assert.deepEqual(JSON.parse(options.body), { action: 'search', query: 'test' })
      return new Response(JSON.stringify({ results: [null, { url: 'https://example.com', title: 'Example', snippet: 'Result' }] }))
    }
    assert.match(await toolWeb(state, { action: 'search', query: 'test' }), /Example\n  https:\/\/example.com\n  Result/)
    assert.equal(state.workerAborts.size, 0)
  } finally { globalThis.fetch = original }
})

test('web tools enforce timeouts and clean up cancellation handles', async () => {
  const original = globalThis.fetch
  const state = session()
  try {
    globalThis.fetch = (_url, { signal }) => new Promise((resolve, reject) => {
      signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true })
    })
    assert.match(await toolWeb(state, { action: 'search', query: 'test' }, { timeoutMs: 20 }), /timed out after 20ms/)
    assert.equal(state.workerAborts.size, 0)
    const pending = toolWeb(state, { action: 'search', query: 'test' })
    state.interrupted = true
    for (const ac of state.workerAborts) ac.abort()
    assert.equal(await pending, 'web error: interrupted')
    assert.equal(state.workerAborts.size, 0)
  } finally { globalThis.fetch = original }
})

test('web tools report backend errors instead of claiming no results', async () => {
  const original = globalThis.fetch
  try {
    globalThis.fetch = async () => new Response(JSON.stringify({ error: 'page unavailable' }))
    assert.equal(await toolWeb(session(), { action: 'fetch', url: 'https://example.com' }), 'web error: page unavailable')
  } finally { globalThis.fetch = original }
})
