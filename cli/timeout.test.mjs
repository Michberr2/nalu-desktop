import test from 'node:test'
import assert from 'node:assert/strict'
import { setTimeout as delay } from 'node:timers/promises'
import { streamOnce } from './nalu.mjs'

const state = () => ({ api: 'https://nalu.invalid', messages: [], workerAborts: new Set() })

test('heartbeats and empty deltas cannot keep an inactive model response alive', {timeout:2000}, async()=>{
  const original=globalThis.fetch;let timer
  try {
    globalThis.fetch=async(_url,{signal})=>new Response(new ReadableStream({start(controller){
      timer=setInterval(()=>controller.enqueue(new TextEncoder().encode(': heartbeat\n\nevent: delta\ndata: {"text":""}\n\nevent: tool_call_delta\ndata: {"index":0,"arguments":""}\n\n')),5)
      signal.addEventListener('abort',()=>{clearInterval(timer);controller.error(new Error('aborted'))},{once:true})
    }}))
    const session=state(),result=await streamOnce(session,{}, {quiet:true,responseIdleTimeoutMs:40,requestTimeoutMs:1000})
    assert.match(result.error,/no content for 40ms/);assert.equal(result.retryable,false)
    assert.equal(session.workerAborts.size,0)
  } finally {clearInterval(timer);globalThis.fetch=original}
})

test('real reasoning activity extends idle time while preserving the absolute deadline', {timeout:2000}, async()=>{
  const original=globalThis.fetch;let timer
  try {
    globalThis.fetch=async()=>new Response(new ReadableStream({start(controller){let n=0
      timer=setInterval(()=>{
        const text=++n<6?'event: reasoning\ndata: {"text":"working"}\n\n':'event: delta\ndata: {"text":"finished"}\n\nevent: done\ndata: {"ok":true}\n\n'
        controller.enqueue(new TextEncoder().encode(text))
        if(n===6){clearInterval(timer);controller.close()}
      },25)
    }}))
    const result=await streamOnce(state(),{}, {quiet:true,responseIdleTimeoutMs:100,requestTimeoutMs:1000})
    assert.equal(result.error,'');assert.equal(result.text,'finished')
  } finally {clearInterval(timer);globalThis.fetch=original}
})

test('keepalive traffic cannot extend the response deadline', { timeout: 2000 }, async () => {
  const original = globalThis.fetch
  const session = state()
  let heartbeat
  try {
    globalThis.fetch = async (_url, { signal }) => new Response(new ReadableStream({
      start(controller) {
        heartbeat = setInterval(() => controller.enqueue(new TextEncoder().encode(': heartbeat\n\n')), 5)
        signal.addEventListener('abort', () => {
          clearInterval(heartbeat)
          controller.error(new Error('aborted'))
        }, { once: true })
      },
    }))
    const result = await streamOnce(session, {}, { quiet: true, requestTimeoutMs: 30 })
    assert.match(result.error, /30ms deadline/)
    assert.equal(result.retryable, false)
    assert.equal(session.workerAborts.size, 0)
  } finally { clearInterval(heartbeat); globalThis.fetch = original }
})

test('deadline covers waiting for response headers as well as body data', { timeout: 2000 }, async () => {
  const original = globalThis.fetch
  try {
    globalThis.fetch = (_url, { signal }) => new Promise((resolve, reject) => {
      signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true })
    })
    const result = await streamOnce(state(), {}, { quiet: true, requestTimeoutMs: 20 })
    assert.match(result.error, /20ms deadline/)
    assert.equal(result.retryable, false)
  } finally { globalThis.fetch = original }
})

test('successful responses clear their deadline timer', async () => {
  const original = globalThis.fetch
  let signal
  try {
    globalThis.fetch = async (_url, options) => {
      signal = options.signal
      return new Response('event: delta\ndata: {"text":"done"}\n\nevent: done\ndata: {"ok":true}\n\n')
    }
    const result = await streamOnce(state(), {}, { quiet: true, requestTimeoutMs: 30 })
    assert.equal(result.error, '')
    await delay(50)
    assert.equal(signal.aborted, false)
  } finally { globalThis.fetch = original }
})

test('slow responses show waiting status and clean up progress on completion', async () => {
  const original = globalThis.fetch
  let output = ''
  try {
    globalThis.fetch = async () => {
      await delay(35)
      return new Response('event: delta\ndata: {"text":"done"}\n\nevent: done\ndata: {"ok":true}\n\n')
    }
    const result = await streamOnce(state(), { feed() {}, flush() {} }, { progressIntervalMs: 10, onProgress: chunk => { output += chunk } })
    assert.equal(result.error, '')
    assert.match(output, /waiting for Nalu/)
    const completed = output
    await delay(30)
    assert.equal(output, completed)
  } finally { globalThis.fetch = original }
})
