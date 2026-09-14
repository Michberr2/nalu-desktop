// Real application main, preload, renderer and local tools. Only cloud responses
// are deterministic CDP fixtures; no production account or external page is used.
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import http from 'node:http'
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
const design=process.env.NALU_DESIGN_TEST==='1' ? await import('./workspace-design.mjs') : null
const root=path.resolve(import.meta.dirname,'..')
const executable=path.resolve(process.argv[2]||path.join(root,'node_modules/electron/dist/Electron.app/Contents/MacOS/Electron'))
const packaged=executable.endsWith('/MacOS/Nalu')
const scratch=fs.mkdtempSync(path.join(os.tmpdir(),'nalu-modes-'))
const home=path.join(scratch,'home'),profile=path.join(scratch,'profile'),project=path.join(scratch,'project')
for(const dir of [home,profile,project,path.join(project,'child')])fs.mkdirSync(dir)
const file=path.join(project,'first.txt'),second=path.join(project,'second.txt')
fs.writeFileSync(file,'FIRST_ORIGINAL');fs.writeFileSync(second,'SECOND_ORIGINAL')
fs.writeFileSync(path.join(project,'verify.test.mjs'),"import assert from 'node:assert/strict'; import fs from 'node:fs'; assert.equal(fs.readFileSync('agent.txt','utf8'),'AGENT_CHANGED'); console.log('AGENT_VERIFIED')")
const receipt={executable,scratch,checks:[],passed:false,scope:'Actual application with deterministic AI responses, real files, commands and local browser. Does not measure live model quality or system mouse/keyboard permissions.'}
const record=text=>{receipt.checks.push(text);console.log('PASS: '+text);fs.writeFileSync(path.join(scratch,'verification.json'),JSON.stringify(receipt,null,2)+'\n')}
const wait=async(fn,label,timeout=20000)=>{const end=Date.now()+timeout;while(Date.now()<end){if(await fn())return;await new Promise(r=>setTimeout(r,50))}throw Error('Timed out: '+label)}
const server=http.createServer((_req,res)=>{res.writeHead(200,{'content-type':'text/html'});res.end('<title>PC fixture</title><label>Name <input id="name"></label><button id="apply" onclick="document.querySelector(\'#result\').textContent=document.querySelector(\'#name\').value">Apply name</button><p id="result">Waiting</p>')})
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve))
const pageUrl=`http://127.0.0.1:${server.address().port}`
let child,socket,sessionId,sequence=0,output='',exited
const pending=new Map(),requests=[],ledger=[],replies=[],apiRequests=[],taskFeed=[]
const call=(method,params={},target=sessionId)=>new Promise((resolve,reject)=>{
 const id=++sequence,timer=setTimeout(()=>{pending.delete(id);reject(Error('CDP timeout: '+method))},20000)
 pending.set(id,{resolve:v=>{clearTimeout(timer);resolve(v)},reject:e=>{clearTimeout(timer);reject(e)}})
 socket.send(JSON.stringify({id,method,params,...(target?{sessionId:target}:{})}))
})
const js=async expression=>{const r=await call('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true});if(r.exceptionDetails)throw Error(r.exceptionDetails.exception?.description||r.exceptionDetails.text);return r.result.value}
const click=selector=>js(`document.querySelector(${JSON.stringify(selector)}).click()`)
const button=text=>js(`Array.from(document.querySelectorAll('button')).find(b=>b.textContent.trim()===${JSON.stringify(text)}).click()`)
const mode=async text=>{await js(`Array.from(document.querySelectorAll('[aria-label="Nalu work mode"] [role=tab]')).find(b=>b.textContent===${JSON.stringify(text)}).click()`);await wait(()=>js(`document.querySelector('[aria-label="Nalu work mode"] [role=tab][aria-selected=true]')?.textContent===${JSON.stringify(text)}`),'select '+text)}
const draft=async text=>{await js(`document.querySelector('[aria-label="Nalu prompt"]').focus()`);await call('Input.insertText',{text})}
const send=async(text,answers)=>{replies.push(...answers);await draft(text);await click('[aria-label="Send prompt"]')}
const idle=()=>wait(()=>js(`!!document.querySelector('[aria-label="Send prompt"]')`),'task idle')
const approval=()=>wait(()=>js(`Array.from(document.querySelectorAll('button')).some(b=>b.textContent.trim()==='Approve')`),'approval')
const screenshot=async name=>{await js('new Promise(resolve=>setTimeout(resolve,180))');fs.writeFileSync(path.join(scratch,name+'.png'),Buffer.from((await call('Page.captureScreenshot',{format:'png'})).data,'base64'))}
const networkErrors=[]
let authOutage=false
async function paused(event){
 const {requestId,request}=event.params
 try{
  if(!request.url.startsWith('https://n4lu.ai/')){await call('Fetch.failRequest',{requestId,errorReason:'BlockedByClient'},event.sessionId);return}
  const headers=[{name:'Content-Type',value:'application/json'},{name:'Access-Control-Allow-Origin',value:'*'},{name:'Access-Control-Allow-Headers',value:'*'},{name:'Access-Control-Allow-Methods',value:'POST, GET, OPTIONS'}]
  let body='{"ok":true,"tasks":[],"members":[]}',responseCode=200
  if(request.method==='POST'){
   const data=JSON.parse(request.postData||'{}');apiRequests.push(data)
   if(request.url.endsWith('/api/chat')){
    requests.push(data)
    const answer=replies.shift()
    if(answer===undefined)throw Error('Unexpected AI request: '+request.postData)
    if(answer==='__HOLD__')return
    const text=typeof answer==='string'?answer:JSON.stringify(answer)
    body='event: delta\ndata: '+JSON.stringify({text})+'\n\nevent: done\ndata: {"ok":true}\n\n'
    headers[0].value='text/event-stream'
   }else if(request.url.endsWith('/api/auth')&&authOutage){responseCode=500;body=JSON.stringify({ok:false,error:'Your project has exceeded the data transfer quota. Upgrade your plan to increase limits.'})}
   else if(data.action==='task-feed')body=JSON.stringify({ok:true,tasks:taskFeed,now:new Date().toISOString()})
   else if(data.action==='task-log')ledger.push(data)
  }
  await call('Fetch.fulfillRequest',{requestId,responseCode,responseHeaders:headers,body:Buffer.from(body).toString('base64')},event.sessionId)
 }catch(error){networkErrors.push(String(error));try{await call('Fetch.failRequest',{requestId,errorReason:'Failed'},event.sessionId)}catch{}}
}
const designApi={scratch,js,call,click,button,mode,draft,wait,screenshot,record,replies,requests,apiRequests,taskFeed,ledger,project,file}
try{
 const env=Object.fromEntries(['PATH','TMPDIR','LANG','LC_ALL'].filter(k=>process.env[k]).map(k=>[k,process.env[k]]))
 Object.assign(env,{HOME:home,GH_CONFIG_DIR:path.join(home,'gh'),GIT_CONFIG_GLOBAL:path.join(home,'gitconfig'),GIT_CONFIG_NOSYSTEM:'1',NALU_NO_TRAINING_DATA:'1',NALU_DISABLE_UPDATES:'1'})
 child=spawn(executable,[...(packaged?[]:[root]),'--remote-debugging-port=0','--remote-debugging-address=127.0.0.1','--user-data-dir='+profile],{cwd:project,env,detached:true,stdio:['ignore','pipe','pipe']})
 exited=new Promise(resolve=>child.once('exit',resolve));child.stdout.on('data',d=>output+=d);child.stderr.on('data',d=>output+=d)
 child.on('error',e=>output+=e.message)
 await wait(()=>/DevTools listening on (ws:\/\/[^\s]+)/.test(output),'app launch')
 socket=new WebSocket(output.match(/DevTools listening on (ws:\/\/[^\s]+)/)[1]);await new Promise((resolve,reject)=>{socket.addEventListener('open',resolve,{once:true});socket.addEventListener('error',reject,{once:true})})
 socket.addEventListener('message',event=>{const m=JSON.parse(event.data);if(m.method==='Fetch.requestPaused'){void paused(m);return}const p=pending.get(m.id);if(!p)return;pending.delete(m.id);m.error?p.reject(Error(m.error.message)):p.resolve(m.result)})
 let target;await wait(async()=>{target=(await call('Target.getTargets')).targetInfos.find(t=>t.type==='page'&&t.url.startsWith('file:')&&!t.url.includes('#companion'));return target},'renderer')
 sessionId=(await call('Target.attachToTarget',{targetId:target.targetId,flatten:true})).sessionId
 await call('Fetch.enable',{patterns:[{urlPattern:'https://*'},{urlPattern:'http://*'}]})
 await wait(()=>js(`!!window.nalu && !!document.querySelector('button[title="Sign in"]')`),'fresh UI')
 await js(`localStorage.setItem('nalu-app-mode','ide');localStorage.setItem('nalu-last-folder',${JSON.stringify(project)});localStorage.setItem('nalu-token','mode-fixture-token')`)
 if(process.env.NALU_ACCOUNT_TEST==='1') {
   authOutage=true
   await js(`localStorage.setItem('nalu-user',JSON.stringify({id:'saved-fixture',displayName:'Saved Fixture'}))`)
   await call('Page.reload')
   await wait(()=>js(`!!document.querySelector('button[title="Saved Fixture — account & settings"]')`),'cached account remains signed in')
   await click('button[title="Saved Fixture — account & settings"]')
   await wait(()=>js(`document.querySelector('dialog[open]')?.textContent.includes('account service is temporarily unavailable')`),'account outage shown')
   assert.ok(await js(`document.querySelector('dialog[open]').textContent.includes('Saved Fixture')`))
   assert.equal(await js(`!!document.querySelector('#nalu-password')`),false)
   await screenshot('account-outage-saved-session')
   await button('Sign out')
   await js(`document.querySelector('#nalu-email').focus()`);await call('Input.insertText',{text:'fixture@example.test'})
   await js(`document.querySelector('#nalu-password').focus()`);await call('Input.insertText',{text:'not-a-real-password'})
   await button('Sign in')
   await wait(()=>js(`Array.from(document.querySelectorAll('button')).some(b=>b.textContent.trim()==='Sign in'&&!b.disabled)`),'sign-in request finished')
   assert.ok(await js(`document.querySelector('dialog[open]').textContent.includes('account service is temporarily unavailable')`))
   assert.equal(await js(`document.querySelector('dialog[open]').textContent.includes('Upgrade your plan')`),false)
   await screenshot('account-outage-sign-in')
   record('Database outage preserves the cached account and shows an account-service error; a failed fresh sign-in does not blame the user’s plan or password')
   receipt.passed=true
 } else if(process.env.NALU_APPEARANCE_ONLY==='1') {
   await design.beforeProject(designApi)
   await js(`window.nalu.saveWorkspace(${JSON.stringify(JSON.stringify({version:1,folder:project,tabs:[{path:file,name:'first.txt'}],activePath:file}))})`)
   await call('Page.reload')
   await wait(()=>js(`document.querySelector('.view-lines')?.textContent.includes('FIRST_ORIGINAL')`),'pastel editor')
   await screenshot('pastel-editor')
   receipt.passed=true
 } else if(process.env.NALU_COMPANION_ONLY==='1') {
   await (await import('./companion-design.mjs')).verifyCompanion(designApi)
   receipt.passed=true
 } else {
 await design?.beforeProject(designApi)
 await mode('Edit');await draft('Missing file edit');await click('[aria-label="Send prompt"]')
 assert.ok(await js(`document.body.textContent.includes('Open a file before requesting an edit.')`));assert.equal(await js(`document.querySelector('[aria-label="Nalu prompt"]').value`),'Missing file edit')
 record('Edit without an open file explains the requirement and preserves the prompt')
 await js(`window.nalu.saveWorkspace(${JSON.stringify(JSON.stringify({version:1,folder:project,tabs:[{path:file,name:'first.txt'},{path:second,name:'second.txt'}],activePath:file}))})`)
 await call('Page.reload')
 await wait(()=>js(`document.querySelector('.view-lines')?.textContent.includes('FIRST_ORIGINAL')`),'restored files')
 await design?.withProject(designApi)
 assert.equal(await js(`document.querySelectorAll('[role=tablist][aria-label="Nalu work mode"] [role=tab]').length`),6)
 await mode('Chat');await draft('CHAT_DRAFT');await mode('Edit');assert.equal(await js(`document.querySelector('[aria-label="Nalu prompt"]').value`),'')
 await mode('Chat');assert.equal(await js(`document.querySelector('[aria-label="Nalu prompt"]').value`),'CHAT_DRAFT')
 replies.push('CHAT_RESPONSE_ONLY');await click('[aria-label="Send prompt"]');await idle()
 assert.ok(await js(`document.body.textContent.includes('CHAT_RESPONSE_ONLY')`));assert.equal(fs.readFileSync(file,'utf8'),'FIRST_ORIGINAL')
 record('Auto and five manual modes, separate drafts, Chat response without file changes')
 await mode('Edit');assert.equal(await js(`document.body.textContent.includes('CHAT_RESPONSE_ONLY')`),false)
 await send('EDIT_FIRST',['```text\nFIRST_EDITED\n```']);await idle()
 await wait(()=>js(`!!document.querySelector('section[aria-label^="Proposed changes"] .monaco-diff-editor')`),'Edit diff')
 await button('second.txt');await wait(()=>js(`document.querySelector('.view-lines')?.textContent.includes('SECOND_ORIGINAL')`),'second editor')
 await screenshot('edit-original-file-preview')
 await button('Apply');await wait(()=>js(`document.body.textContent.includes('Applied to ')`),'proposal applied')
 assert.ok(await js(`document.querySelector('.view-lines')?.textContent.includes('SECOND_ORIGINAL')`),'active second file must stay unchanged')
 await button('first.txt');await wait(()=>js(`document.querySelector('.view-lines')?.textContent.includes('FIRST_EDITED')`),'original file updated')
 await send('EDIT_STALE',['```text\nSTALE_REPLACEMENT\n```']);await idle()
 fs.writeFileSync(file,'EXTERNAL_EDIT')
 await js(`window.dispatchEvent(new Event('focus'))`)
 await wait(()=>js(`document.body.textContent.includes('EXTERNAL_EDIT') || document.body.textContent.includes('This file changed on disk')`),'external change noticed')
 await button('Apply');await wait(()=>js(`Array.from(document.querySelectorAll('[role=alert]')).some(e=>e.textContent.includes('original file changed'))`),'stale proposal rejected')
 await button('Reject')
 assert.equal(fs.readFileSync(second,'utf8'),'SECOND_ORIGINAL')
 assert.ok(!fs.readFileSync(file,'utf8').includes('STALE_REPLACEMENT'))
 record('Edit full diff, Apply targets original file after tab switch, stale changes rejected, Reject preserves files')
 await mode('Terminal')
 await send('Go into the child folder',['cd child','DONE: Changed directory'])
 await approval();assert.equal(await js(`Array.from(document.querySelectorAll('[aria-label="Nalu work mode"] [role=tab]')).every(b=>b.disabled)`),true)
 await button('Approve');await idle()
 await send('Print the current directory',['pwd','DONE: Printed directory']);await approval();await button('Approve');await idle()
 assert.ok(await js(`document.body.textContent.includes(${JSON.stringify(path.join(project,'child'))})`))
 await send('Create a file but deny approval',['touch denied.txt']);await approval();await button('Deny');await idle()
 assert.equal(fs.existsSync(path.join(project,'child','denied.txt')),false)
 await send('Create a file but stop while approval is open',['touch stopped.txt']);await approval();await click('[aria-label="Stop task"]');await idle()
 assert.equal(fs.existsSync(path.join(project,'child','stopped.txt')),false)
 await send('Wait until stopped',["printf running > running.txt; while :; do sleep 1; done"]);await approval();await button('Approve');await wait(()=>fs.existsSync(path.join(project,'child','running.txt')),'real shell started');await click('[aria-label="Stop task"]');await idle()
 await screenshot('terminal-ai-approval-and-stop')
 await js(`Array.from(document.querySelectorAll('label')).find(l=>l.textContent.trim()==='auto-run').querySelector('input').click()`)
 await send('Create a file with auto-run enabled',['touch auto-approved.txt','DONE: Created file']);await idle();assert.equal(fs.existsSync(path.join(project,'child','auto-approved.txt')),true)
 record('Terminal AI interpretation, approvals, working directory across tasks, denial and Stop before/during execution')
 await mode('Agent');assert.equal(await js(`document.body.textContent.includes('CHAT_RESPONSE_ONLY')`),false)
 await send('Create agent.txt and verify it',[{tool:'write_file',path:'agent.txt',content:'AGENT_CHANGED'},{tool:'run',command:'node verify.test.mjs'},{tool:'done',summary:'AGENT_TASK_VERIFIED'}])
 await approval();assert.equal((await js(`window.nalu.companion.get()`)).activities.find(a=>a.source==='assistant')?.needsApproval,true);assert.equal(fs.existsSync(path.join(project,'agent.txt')),false);await button('Approve');await approval();await button('Approve');await idle()
 assert.equal(fs.readFileSync(path.join(project,'agent.txt'),'utf8'),'AGENT_CHANGED');assert.ok(await js(`document.body.textContent.includes('AGENT_TASK_VERIFIED')`))
 record('Agent approves a real file write, runs its real verification test and then completes')
 await mode('PC')
 await send('Fill the local test page and verify the result',[
 {tool:'browse',url:pageUrl},{tool:'click_el',selector:'#name'},{tool:'type_text',text:'PC_TYPED_終'},{tool:'click_el',selector:'#apply'},{tool:'read_page'},{tool:'done',summary:'PC_LOCAL_PAGE_VERIFIED'}])
 for(let i=0;i<5;i++){await approval();await button('Approve')}
 await idle();assert.ok(await js(`document.body.textContent.includes('PC_LOCAL_PAGE_VERIFIED')`))
 const page=await js(`window.nalu.pc.webJs("document.querySelector('#result').textContent",true)`)
 assert.equal(page.ok,true);assert.equal(page.out,'PC_TYPED_終')
 await wait(()=>js(`!!document.querySelector('[aria-label="Live Chrome preview"] img')`),'live Chrome mini preview')
 const previewFill=await js(`window.nalu.pc.webFill('#name','MINI_PREVIEW_CLICK')`);assert.equal(previewFill.ok,true)
 const previewPoint=await js(`(async()=>{
   const state=await window.nalu.pc.preview(),r=document.querySelector('.browser-preview-page img').getBoundingClientRect();
   const point=JSON.parse((await window.nalu.pc.webJs("JSON.stringify((()=>{const r=document.querySelector('#apply').getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2}})())",true)).out);
   const scale=Math.min(r.width/state.width,r.height/state.height);
   return {x:r.left+(r.width-state.width*scale)/2+point.x*scale,y:r.top+(r.height-state.height*scale)/2+point.y*scale};
 })()`)
 await call('Page.bringToFront')
 await call('Input.dispatchMouseEvent',{type:'mousePressed',...previewPoint,button:'left',clickCount:1})
 await call('Input.dispatchMouseEvent',{type:'mouseReleased',...previewPoint,button:'left',clickCount:1})
 await wait(async()=> (await js(`window.nalu.pc.webJs("document.querySelector('#result').textContent",true)`)).out==='MINI_PREVIEW_CLICK','scaled mini preview click reaches the Chrome element')
 await screenshot('pc-local-page-verified')
 record('Live Chrome preview renders and a click through the scaled preview reaches the real page control')
 record('PC real local browser navigation, trusted element click, Unicode typing, form action, page read and completion')
 await mode('Chat');assert.ok(await js(`document.body.textContent.includes('CHAT_RESPONSE_ONLY')`));assert.equal(await js(`document.body.textContent.includes('PC_LOCAL_PAGE_VERIFIED')`),false)
 await send('Hold the AI reply',['__HOLD__']);await wait(()=>requests.at(-1)?.messages.at(-1)?.content.includes('Hold the AI reply'),'pending model call');await click('[aria-label="Stop task"]');await idle()
 record('mode transcripts remain separate and Stop aborts a pending Chat request')
 await design?.afterTasks(designApi)
 await design?.autoTasks(designApi)
 if (process.env.NALU_COMPANION_TEST==='1') await (await import('./companion-design.mjs')).verifyCompanion(designApi)
 assert.deepEqual(networkErrors,[]);assert.deepEqual(replies,[])
 receipt.passed=true
 }
}catch(error){receipt.error=error.stack;process.exitCode=1;try{receipt.screenText=await js('document.body.textContent');await screenshot('failure')}catch{}}
finally{
 fs.writeFileSync(path.join(scratch,'verification.json'),JSON.stringify(receipt,null,2)+'\n')
 socket?.close()
 if(child&&child.exitCode===null&&child.signalCode===null){try{process.kill(-child.pid,'SIGTERM')}catch{}const timer=setTimeout(()=>{try{process.kill(-child.pid,'SIGKILL')}catch{}},3000);await exited;clearTimeout(timer)}
 server.closeAllConnections();server.close();fs.writeFileSync(path.join(scratch,'launch.log'),output);fs.writeFileSync(path.join(scratch,'verification.json'),JSON.stringify(receipt,null,2)+'\n');console.log(JSON.stringify(receipt,null,2))
}
