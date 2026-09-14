import test from 'node:test'
import assert from 'node:assert/strict'
import { loadApi } from './api-client-loader.mjs'
const user = { id: 'fixture-user', displayName: 'Fixture' }
const json = (data,status=200) => new Response(JSON.stringify(data),{status,headers:{'Content-Type':'application/json'}})
const cached = client => { client.storage.set('nalu-token','saved-session'); client.storage.set('nalu-user',JSON.stringify(user)) }

test('chat sends systemPrompt through the shared API contract and preserves images, history, model settings and cancellation',async()=>{
 let request, url, answer=''
 const client=loadApi(async(u,r)=>{url=u;request=r;return new Response('event: delta\ndata: {"text":"reply"}\n\nevent: done\ndata: {"ok":true}\n\n')})
 cached(client)
 client.storage.set('nalu-model-settings',JSON.stringify({reasoning:'medium',maxTokens:16000,webSearch:true}))
 const messages=[{role:'system',content:'Use the desktop tools.'},{role:'system',content:[{type:'text',text:'Return only JSON.'}]},{role:'assistant',content:'Which page?'},client.api.imageMessage('This page','data:image/png;base64,fixture')]
 const before=JSON.stringify(messages),controller=new AbortController()
 await client.api.streamChat(messages,{specialist:'reasoning',webSearch:false,maxTokens:512,signal:controller.signal,onDelta:t=>answer+=t})
 const body=JSON.parse(request.body)
 assert.equal(url,'https://n4lu.ai/api/chat')
 assert.equal(body.systemPrompt,'Use the desktop tools.\n\nReturn only JSON.')
 assert.deepEqual(body.messages,JSON.parse(JSON.stringify(messages.slice(2))))
 assert.equal(body.reasoning,'medium');assert.equal(body.maxTokens,512);assert.equal(body.webSearch,false)
 assert.equal(request.signal,controller.signal);assert.equal(request.headers.Authorization,'Bearer saved-session')
 assert.equal(answer,'reply');assert.equal(JSON.stringify(messages),before)
})
test('existing shared me response needs no ok flag and refreshes the cached account',async()=>{
 const client=loadApi(async()=>json({user}));cached(client)
 assert.equal((await client.api.fetchMe()).id,user.id)
 assert.equal(client.storage.get('nalu-token'),'saved-session')
})
for(const [name,reply] of [
 ['quota',()=>json({ok:false,error:'Your project has exceeded the data transfer quota. Upgrade your plan to increase limits.'},500)],
 ['invalid response',()=>new Response('<html>Unavailable</html>',{status:502})],
 ['malformed success',()=>json({ok:true})],
 ['network failure',()=>{throw new TypeError('Network unavailable')}],
]) test(`${name} does not erase the saved account or CLI session`,async()=>{
 const client=loadApi(reply);cached(client)
 await assert.rejects(client.api.fetchMe())
 assert.equal(client.storage.get('nalu-token'),'saved-session')
 assert.equal(JSON.parse(client.storage.get('nalu-user')).id,user.id)
 assert.equal(client.synced.length,0)
})
test('quota sign-in reports account service unavailable without blaming the password or changing the session',async()=>{
 const client=loadApi(async()=>json({error:'Your project has exceeded the data transfer quota. Upgrade your plan to increase limits.'},500));cached(client)
 const result=await client.api.signIn('fixture@example.test','test-only')
 assert.equal(result.ok,false);assert.match(result.error,/account service is temporarily unavailable/)
 assert.doesNotMatch(result.error,/Upgrade your plan/);assert.equal(client.storage.get('nalu-token'),'saved-session')
})
test('invalid credentials remain distinguishable from service failures',async()=>{
 const client=loadApi(async()=>json({ok:false,error:'Invalid email or password'},401))
 assert.match((await client.api.signIn('fixture@example.test','test-only')).error,/Invalid email or password/)
})
for(const status of [200,401,403]) test(`confirmed expired session (${status}) clears local credentials`,async()=>{
 const client=loadApi(async()=>json(status===200?{user:null}:{ok:false,error:'not authenticated'},status));cached(client)
 assert.equal(await client.api.fetchMe(),null)
 assert.equal(client.storage.get('nalu-token'),undefined);assert.equal(client.storage.get('nalu-user'),undefined)
 assert.equal(client.synced.at(-1).token,'')
})
test('a delayed account check cannot sign back in after sign-out',async()=>{
 let resolve
 const client=loadApi(async(_url,request)=>JSON.parse(request.body).action==='me'?new Promise(r=>{resolve=r}):json({ok:true}));cached(client)
 const pending=client.api.fetchMe();client.api.signOut();resolve(json({user}))
 assert.equal(await pending,null);assert.equal(client.storage.get('nalu-user'),undefined)
})
