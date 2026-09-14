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

test('Cloudflare history is loaded through the public account API, including large Unicode messages',async()=>{
 const chats=[{id:'cloudflare-chat',title:'A wolf and a unicorn',messages:[{role:'user',content:'🦄🐺'.repeat(700000)}]}]
 const client=loadApi(async(url,req)=>{assert.equal(url,'https://n4lu.ai/api/data');assert.equal(req.headers.Authorization,'Bearer saved-session');return json({data:{'nalu-chats':JSON.stringify(chats)}})})
 cached(client);assert.equal(JSON.stringify(await client.api.loadChats()),JSON.stringify(chats))
})
for(const [label,response] of [['failed',()=>json({error:'Offline'},503)],['malformed',()=>json({ok:true})],['invalid history',()=>json({data:{'nalu-chats':'broken'}})]]) test(`${label} history is an error, never a successful empty history`,async()=>{
 const client=loadApi(response);cached(client);await assert.rejects(client.api.loadChats());assert.equal(client.storage.get('nalu-token'),'saved-session')
})
test('a delayed saved-data response cannot cross an account switch',async()=>{
 let finish;const client=loadApi(()=>new Promise(resolve=>{finish=resolve}));cached(client)
 const pending=client.api.loadChats();client.api.setToken('another-account');finish(json({data:{'nalu-chats':'[]'}}))
 await assert.rejects(pending,/account changed/)
})
test('large desktop saves compress without truncation and use the same Cloudflare merge contract as the web',async()=>{
 const {gunzipSync}=await import('node:zlib'),requests=[]
 const client=loadApi(async(url,request)=>{assert.equal(url,'https://n4lu.ai/api/data');requests.push(request);return json({ok:true})});cached(client)
 const chats=[{id:'large',messages:[{role:'assistant',content:'Unicorn 🦄 wolf 🐺 '.repeat(300000)}],design:{title:'Keep the artifact'}}]
 await client.api.saveChats(chats)
 assert.equal(requests.length,1)
 const request=requests[0],body=JSON.parse(request.body)
 assert.ok(Buffer.byteLength(request.body)<3500000);assert.equal(body.action,'setMany');assert.equal(body.encoding,'gzip-base64')
 assert.equal(request.headers.Authorization,'Bearer saved-session')
 const entries=JSON.parse(gunzipSync(Buffer.from(body.compressedEntries,'base64')))
 assert.equal(entries['nalu-chats'],JSON.stringify(chats))
})
test('separate save batches stop if the account changes between requests',async()=>{
 let calls=0,client
 client=loadApi(async()=>{calls++;client.api.setToken('another-account');return json({ok:true})});cached(client)
 const chats=[1,2,3].map(id=>({id:String(id),messages:[{role:'user',content:'x'.repeat(2000000)}]}))
 await assert.rejects(client.api.saveChats(chats),/account changed/);assert.equal(calls,1)
})
test('rejected and malformed save receipts are surfaced for retry',async()=>{
 for(const response of [()=>json({error:'Offline'},503),()=>json({error:'Rejected'},409),()=>json({})]){
  const client=loadApi(response);cached(client);await assert.rejects(client.api.saveChats([{id:'keep',messages:[]}]))
 }
})
