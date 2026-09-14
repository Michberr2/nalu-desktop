import assert from 'node:assert/strict'
import fs from 'node:fs'
export async function verifyCompanion(api) {
 const {call,js,wait,record,replies,taskFeed,requests}=api
 let target;await wait(async()=>{target=(await call('Target.getTargets')).targetInfos.find(t=>t.type==='page'&&t.url.endsWith('#companion'));return target},'desktop companion window')
 const session=(await call('Target.attachToTarget',{targetId:target.targetId,flatten:true})).sessionId
 const petCall=(method,params={})=>call(method,params,session)
 const petJs=async expression=>{const r=await petCall('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true});if(r.exceptionDetails)throw Error(r.exceptionDetails.exception?.description||r.exceptionDetails.text);return r.result.value}
 const click=async selector=>{await wait(()=>petJs(`!!document.querySelector(${JSON.stringify(selector)})`),'companion control '+selector);return petJs(`document.querySelector(${JSON.stringify(selector)}).click()`)}
 const screen=async name=>{await new Promise(r=>setTimeout(r,250));const w=await petJs('innerWidth'),px=await petJs(`Number(document.querySelector('.companion-stage')?.dataset.position || 450)`);fs.writeFileSync(api.scratch+'/'+name+'.png',Buffer.from((await petCall('Page.captureScreenshot',{format:'png',clip:{x:Math.max(0,Math.min(w-900,px-450)),y:0,width:Math.min(w,900),height:520,scale:1}})).data,'base64'))}
 await petCall('Fetch.enable',{patterns:[{urlPattern:'https://*'},{urlPattern:'http://*'}]})
 await wait(()=>petJs(`!!document.querySelector('.companion-stage canvas') && document.querySelector('.companion-stage').dataset.mood`),'3D model')
 await js(`window.nalu.companion.activity('assistant',false,{needsApproval:false});window.nalu.companion.activity('chats',false,{needsApproval:false});window.nalu.companion.find()`)
 await wait(()=>petJs(`!!document.querySelector('[aria-label="Talk with Nalu"]') && Math.abs(Number(document.querySelector('.companion-stage').dataset.ballPosition)-(innerWidth/2+115))<5`),'Find resets the ball before motion fixtures')
 await click('[aria-label="Close companion conversation"]')
 if (process.env.NALU_OFFSCREEN_TEST==='1') {
   await petCall('Emulation.setDeviceMetricsOverride',{width:240,height:520,deviceScaleFactor:1,mobile:false})
   await wait(()=>petJs(`document.querySelector('.companion-stage').dataset.fetching==='true'`),'fetch ball beyond the resized viewport')
   await wait(()=>petJs(`Number(document.querySelector('.companion-stage').dataset.position)>innerWidth+125`),'whole wolf exits to get her ball',20000)
   await wait(()=>petJs(`document.querySelector('.companion-stage').dataset.fetching==='false' && Number(document.querySelector('.companion-stage').dataset.ballPosition)>0 && Number(document.querySelector('.companion-stage').dataset.ballPosition)<innerWidth`),'wolf brings the offscreen ball back',30000)
   await screen('companion-offscreen-return')
   await petCall('Emulation.clearDeviceMetricsOverride')
   await js('window.nalu.companion.find()')
   record('actual renderer lets the whole wolf leave the viewport to retrieve an offscreen ball and brings both back')
 }
 assert.equal(await petJs('typeof window.nalu'), 'undefined','companion must not inherit filesystem/shell preload')
 assert.equal(await petJs('typeof window.companion.openWorkspace'),'function')
 assert.equal(await petJs(`getComputedStyle(document.body).backgroundColor`),'rgba(0, 0, 0, 0)')
 assert.equal(await petJs(`document.querySelector('.companion-stage').dataset.ballVisible`),'true','her ball stays visible while idle')
 await screen('companion-walking')
 await click('[aria-label="Talk to Nalu"]');await wait(()=>petJs(`!!document.querySelector('[aria-label="Talk with Nalu"]')`),'companion bubble')
 const checkBubble = async () => {
   const overflow = await petJs(`(() => {
     const path = document.querySelector('.thought-cloud path'), inverse = path.getScreenCTM().inverse();
     return [...document.querySelectorAll('.companion-panel header, .companion-body, .companion-panel form, .companion-panel footer')].filter(el => {
       const r = el.getBoundingClientRect();
       return [[r.left,r.top],[r.right,r.top],[r.right,r.bottom],[r.left,r.bottom]].some(([x,y]) => !path.isPointInFill(new DOMPoint(x,y).matrixTransform(inverse)));
     }).map(el => el.className || el.tagName);
   })()`)
   assert.deepEqual(overflow, [], 'Header, scroll area, composer and footer must fit inside the actual cloud shape')
 }
 await checkBubble()
 await click('[aria-label="Toss Nalu a treat"]')
 await wait(()=>petJs(`Number(document.querySelector('.companion-stage').dataset.treatsCaught)>0`),'Nalu catches the physical treat',18000)
 await screen('companion-grabs-treat')
 await wait(()=>petJs(`document.querySelector('.companion-stage').dataset.treat==='none'`),'Nalu eats treat')
 record('companion uses real WebGL Nalu model, transparent document and a restricted preload; tossed treat reaches her mouth and is eaten')
 await click('[aria-label="Let Nalu rest"]');await click('[aria-label="Close companion conversation"]')
 await wait(()=>petJs(`document.querySelector('.companion-stage').dataset.mood==='circle'`),'walk circles before resting');await screen('companion-circles-before-rest');await wait(()=>petJs(`Number(document.querySelector('.companion-stage').dataset.curl)>.99`),'lying down')
 assert.equal(await petJs(`document.querySelector('.companion-stage').dataset.ballVisible`),'true','her ball stays visible while resting')
 await screen('companion-curled-up')
 await petJs(`window.companion.set({paused:false})`)
 await js(`window.nalu.companion.activity('assistant',true,{task:'Build a calendar for my team',status:'Checking the calendar layout and interactions.',needsApproval:false})`)
 await wait(()=>petJs(`document.querySelector('.companion-stage').dataset.mood==='play'`),'working ball play')
 await click('[aria-label="Talk to Nalu"]');try { await wait(()=>petJs(`Array.from(document.querySelectorAll('.companion-work')).some(el => el.textContent.includes('Checking the calendar layout'))`),'live task context in thought bubble') } catch (error) { await screen('companion-context-failure'); throw Error(String(error)+' '+JSON.stringify(await petJs(`Promise.all([window.companion.get(), Promise.resolve(document.body.innerText)])`))) }await wait(()=>petJs(`Number(document.querySelector('.companion-stage').dataset.ballContacts)>0`),'physical ball contact',18000);await checkBubble();await screen('companion-working-ball');await click('[aria-label="Close companion conversation"]')
 await wait(()=>petJs(`document.querySelector('.companion-stage').dataset.mood==='dig'`),'working digging',25000)
 await wait(()=>petJs(`Number(document.querySelector('.companion-stage').dataset.dirtEmitted)>0`),'dirt emitted by grounded paw scrape')
 await screen('companion-working-dig')
 await js(`window.nalu.companion.activity('assistant',false)`)
 record('rest walks circles then lowers the original model into a lying pose; real workspace activity IPC starts ball play and digging and returns to idle when work stops')
 // Background throttling is disabled so hidden tasks keep running. Verify the
 // native window acknowledgement; Chromium visibility stays "visible" in that mode.
 assert.equal(await js('window.nalu.closeWorkspace()'),true,'native workspace hides')
 await click('[aria-label="Talk to Nalu"]');await click('[aria-label="Mute Nalu voice"]')
 await petJs(`document.querySelector('[aria-label="Companion message"]').focus()`)
 await petCall('Input.insertText',{text:'Help me plan my morning'})
 replies.push({mode:'chat',reason:'A planning conversation'},'Start with your most important task, then leave room for a short break.')
 await click('[aria-label="Send companion message"]')
 await wait(()=>petJs(`document.querySelector('.companion-messages').textContent.includes('most important task')`),'companion answers with workspace closed')
 await screen('companion-chat-workspace-closed')
 await click('[aria-label="Open Nalu workspace"]');await wait(()=>js('document.visibilityState === "visible"'),'reopen workspace from Nalu')
 record('closing the workspace keeps the companion alive; AI chat works while closed and the companion reopens the same workspace')
 // Stop an outstanding interpretation. No late reply can dispatch a workspace task.
 await petJs(`document.querySelector('[aria-label="Companion message"]').focus()`);await petCall('Input.insertText',{text:'Hold this task'})
 replies.push('__HOLD__');await click('[aria-label="Send companion message"]');await wait(()=>petJs(`!!document.querySelector('[aria-label="Stop companion"]')`),'companion busy');await click('[aria-label="Stop companion"]')
 await wait(()=>petJs(`!!document.querySelector('[aria-label="Send companion message"]')`),'companion stopped')
 // Account tasks are visible across sources, without a two-task truncation.
 taskFeed.push(...['cli','web','voice','mobile'].map((source,i)=>({id:'live-'+i,title:'LIVE_TASK_'+i,source,status:i===2?'waiting':'running',updated_at:new Date().toISOString(),events:[{m:'LATEST_ACTION_'+i}],meta:i===2?{pendingQuestion:{text:'Which time works?'}}:{}})))
 await click('[aria-label="Talk to Nalu"]')
 await wait(()=>petJs(`document.querySelector('.companion-view-tabs')?.textContent.includes('(4)')`),'account task count')
 await petJs(`Array.from(document.querySelectorAll('.companion-view-tabs button')).find(b=>b.textContent.includes('Live tasks')).click()`)
 await wait(()=>petJs(`document.querySelector('[aria-label="Live tasks"]')?.textContent.includes('LIVE_TASK_3')`),'all live tasks including the fourth task')
 assert.ok(await petJs(`document.querySelector('[aria-label="Live tasks"]').textContent.includes('Which time works?')`))
 await checkBubble();await screen('companion-live-tasks')
 await petJs(`document.querySelector('[aria-label="Companion message"]').focus();document.querySelector('[aria-label="Companion message"]').select()`)
 await petCall('Input.insertText',{text:'what are you up to?'})
 replies.push('I am here with you.', 'I’m tracking four live tasks, including the voice task waiting for your preferred time.')
 await click('[aria-label="Send companion message"]')
 await wait(()=>petJs(`document.querySelector('.companion-messages')?.textContent.includes('four live tasks')`),'conversation survives malformed routing')
 assert.equal(await petJs(`document.body.textContent.includes('could not choose a mode')`),false)
 assert.ok(JSON.stringify(requests.at(-1).messages).includes('LIVE_TASK_3'),'the answer receives all live task context')
 await screen('companion-live-answer')
 await js('window.nalu.companion.find()')
 await wait(()=>petJs(`Math.abs(Number(document.querySelector('.companion-stage').dataset.position)-innerWidth/2)<8 && !!document.querySelector('.companion-panel')`),'Find Nalu centers her and opens her bubble')
 await screen('companion-found')
 record('ball remains visible while idle and resting; Find Nalu reveals her; all account task sources and waiting details reach both the task view and conversation; invalid routing no longer blocks chat')
 await petJs(`window.companion.openWorkspace('Build a calendar for my team')`)
 await wait(()=>js(`document.querySelector('[aria-label="Nalu prompt"]').value==='Build a calendar for my team'`),'task handoff')
 assert.equal(await js(`document.querySelector('[aria-label="Nalu work mode"] [aria-selected=true]').textContent`),'Auto')
 await petJs(`void window.companion.set({enabled:false})`)
 await wait(async()=>!(await call('Target.getTargets')).targetInfos.some(t=>t.url.endsWith('#companion')),'hide companion')
 assert.equal((await js(`window.nalu.companion.get()`)).enabled,false)
 record('companion Stop, exact task handoff to Auto, and Hide/settings persistence work without file/shell access from the companion window')
}
