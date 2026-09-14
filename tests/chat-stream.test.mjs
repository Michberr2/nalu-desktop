import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import ts from 'typescript'
const code=ts.transpileModule(fs.readFileSync(new URL('../src/lib/chatStream.ts',import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}}).outputText
const {consumeChatStream}=await import(`data:text/javascript;base64,${Buffer.from(code).toString('base64')}`)
const event=(name,data)=>`event: ${name}\ndata: ${JSON.stringify(data)}\n\n`
const done=event('done',{ok:true})
const options=()=>({onDelta:()=>{}})
test('byte-split UTF-8 and CRLF streams retain deltas and routing',async()=>{
  const bytes=new TextEncoder().encode((event('route',{name:'Code'})+event('delta',{text:'🌊 hello'})+done).replaceAll('\n','\r\n'))
  let offset=0,output='',route=''
  const response=new Response(new ReadableStream({pull(c){if(offset===bytes.length)c.close();else c.enqueue(bytes.slice(offset,++offset))}}))
  await consumeChatStream(response,{onDelta:t=>output+=t,onRoute:r=>route=r})
  assert.equal(output,'🌊 hello');assert.equal(route,'Code')
})
test('HTTP failures surface even when body is ordinary JSON',async()=>{
  await assert.rejects(consumeChatStream(new Response('{"error":"unauthorized"}',{status:401}),options()),/HTTP 401/)
})
test('an API error after partial tool text rejects the whole response',async()=>{
  await assert.rejects(consumeChatStream(new Response(event('delta',{text:'{"tool":"run"'})+event('error',{message:'Model unavailable'})),options()),/Model unavailable/)
})
test('a disconnected stream cannot authorize a complete-looking tool action',async()=>{
  await assert.rejects(consumeChatStream(new Response(event('delta',{text:'{"tool":"run","command":"touch unwanted"}'})),options()),/ended before completion/)
})
test('malformed data and unsuccessful done events fail',async()=>{
  await assert.rejects(consumeChatStream(new Response('event: delta\ndata: {oops}\n\n'+done),options()),/malformed/)
  await assert.rejects(consumeChatStream(new Response(event('done',{ok:false})),options()),/could not finish/)
})
test('a final DONE frame without delimiter is accepted',async()=>{
  await consumeChatStream(new Response(done.trim()),options())
})
test('aborting an idle stream cancels its reader and rejects promptly',async()=>{
  const controller=new AbortController();let cancelled=false
  const response=new Response(new ReadableStream({cancel(){cancelled=true}}))
  const result=consumeChatStream(response,{...options(),signal:controller.signal})
  controller.abort()
  await assert.rejects(result,{name:'AbortError'});assert.equal(cancelled,true)
})
test('callback errors propagate instead of being swallowed as malformed JSON',async()=>{
  await assert.rejects(consumeChatStream(new Response(event('delta',{text:'hi'})+done),{onDelta(){throw new Error('render failed')}}),/render failed/)
})
