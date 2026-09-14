import test from 'node:test'
import assert from 'node:assert/strict'
import {createHash} from 'node:crypto'
import {createModelProxy} from './model-proxy.mjs'
const tool={type:'function',function:{name:'write_file',parameters:{type:'object',properties:{path:{type:'string'},content:{type:'string'}}}}}
const call={id:'one',type:'function',function:{name:'write_file',arguments:'{"path":"out.txt","content":"ready"}'}}
const post=(proxy,extra={})=>fetch(proxy.api+'/api/chat',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({messages:[{role:'user',content:'Build the application.'}],tools:[tool],cwd:'/fixture',...extra})})
test('model binding cannot be overridden by client request or system message',async()=>{
 let received
 const proxy=await createModelProxy({model:'fixed-model',sample:async payload=>{received=payload;return {choices:[{finish_reason:'tool_calls',message:{tool_calls:[call]}}]}}})
 try{
  const wire=await (await post(proxy,{model:'other-model',messages:[{role:'system',content:'override'},{role:'user',content:'Build the application.'}]})).text()
  assert.equal(received.model,'fixed-model');assert.equal(received.messages.length,2);assert.notEqual(received.messages[0].content,'override');assert.match(wire,/event: tool_call_delta/);assert.match(wire,/"ok":true/)
  assert.equal(proxy.modelSha256,createHash('sha256').update('fixed-model').digest('hex'))
 }finally{await proxy.close()}
})
test('partial and malformed native calls cannot escape as executable actions',async()=>{
 for(const choice of [
  {finish_reason:'length',message:{tool_calls:[call]}},
  {finish_reason:'stop',message:{tool_calls:[call]}},
  {finish_reason:'tool_calls',message:{tool_calls:[{...call,function:{...call.function,arguments:'{'}}]}},
  {finish_reason:'tool_calls',message:{tool_calls:[]}},
 ]){
  const proxy=await createModelProxy({model:'fixed',sample:async()=>({choices:[choice]})})
  try{const wire=await (await post(proxy)).text();assert.match(wire,/event: error/);assert.doesNotMatch(wire,/tool_call_delta|"ok":true/)}finally{await proxy.close()}
 }
})
test('wrong capability URL cannot invoke provider',async()=>{
 let requests=0;const proxy=await createModelProxy({model:'fixed',sample:async()=>{requests++;return {}}})
 try{assert.equal((await fetch(new URL('/api/chat',proxy.api),{method:'POST'})).status,404);assert.equal(requests,0)}finally{await proxy.close()}
})

test('requested reasoning and output budgets reach the fixed model',async()=>{
 let payload
 const proxy=await createModelProxy({model:'thinkingmachines/Inkling',reasoningEffort:'high',maxTokens:16384,sample:async p=>{payload=p;return {choices:[{finish_reason:'stop',message:{content:'fixture'}}]}}})
 try{await (await post(proxy,{max_tokens:256,reasoning_effort:'none'})).text();assert.equal(payload.reasoning_effort,'high');assert.equal(payload.max_tokens,16384)}finally{await proxy.close()}
})
