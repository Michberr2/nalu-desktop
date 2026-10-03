import assert from 'node:assert/strict'
import fs from 'node:fs'
export async function verifyCompanion(api) {
 const {call,js,wait,record,replies,taskFeed,requests}=api
 let target;await wait(async()=>{target=(await call('Target.getTargets')).targetInfos.find(t=>t.type==='page'&&t.url.endsWith('#companion'));return target},'desktop companion window')
 const session=(await call('Target.attachToTarget',{targetId:target.targetId,flatten:true})).sessionId
 const petCall=(method,params={})=>call(method,params,session)
 const petJs=async expression=>{const r=await petCall('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true});if(r.exceptionDetails)throw Error(r.exceptionDetails.exception?.description||r.exceptionDetails.text);return r.result.value}
 const click=async selector=>{await wait(()=>petJs(`!!document.querySelector(${JSON.stringify(selector)})`),'companion control '+selector);return petJs(`document.querySelector(${JSON.stringify(selector)}).click()`)}
 const screen=async name=>{await new Promise(r=>setTimeout(r,250));const dimensions=await petJs('({width:innerWidth,height:innerHeight})');fs.writeFileSync(api.scratch+'/'+name+'.png',Buffer.from((await petCall('Page.captureScreenshot',{format:'png',clip:{x:0,y:0,...dimensions,scale:1}})).data,'base64'))}
 await petCall('Fetch.enable',{patterns:[{urlPattern:'https://*'},{urlPattern:'http://*'}]})
 await wait(()=>petJs(`document.querySelector('.floating-nalu')?.dataset.ready==='true'`),'original artwork WebGL avatar')
 await js(`window.nalu.companion.activity('assistant',false,{needsApproval:false});window.nalu.companion.activity('chats',false,{needsApproval:false});window.nalu.companion.find()`)
 await wait(()=>petJs(`!!document.querySelector('[aria-label="Talk with Nalu"]') && innerWidth===404`),'Find opens conversation')
 await click('[aria-label="Close companion conversation"]')
 await wait(()=>petJs(`innerWidth===164 && innerHeight===164`),'compact native overlay')
 assert.equal(await petJs('typeof window.nalu'), 'undefined','companion must not inherit filesystem/shell preload')
 assert.equal(await petJs('typeof window.companion.openWorkspace'),'function')
 assert.equal(await petJs(`getComputedStyle(document.body).backgroundColor`),'rgba(0, 0, 0, 0)')
 assert.equal(await petJs(`!!document.querySelector('.companion-stage')`),false,'full body model is replaced')
 await screen('companion-floating')
 await click('[aria-label="Talk to Nalu"]');await wait(()=>petJs(`!!document.querySelector('[aria-label="Talk with Nalu"]') && innerWidth===404`),'companion bubble')
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
 await click('[aria-label="Pause Nalu"]')
 await wait(()=>petJs(`document.querySelector('.floating-nalu').dataset.paused==='true'`),'pause avatar')
 await screen('companion-paused')
 await petJs(`window.companion.set({paused:false})`)
 await js(`window.nalu.companion.activity('assistant',true,{task:'Build a calendar for my team',status:'Checking the calendar layout and interactions.',needsApproval:false})`)
 await wait(()=>petJs(`Array.from(document.querySelectorAll('.companion-work')).some(el => el.textContent.includes('Checking the calendar layout'))`),'live task context in thought bubble')
 await checkBubble();await screen('companion-working');await click('[aria-label="Close companion conversation"]')
 await js(`window.nalu.companion.activity('assistant',false)`)
 record('compact original-artwork avatar replaces the full body; pause, native resize and workspace task context remain available')
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
 try { await wait(()=>petJs(`document.querySelector('.companion-view-tabs')?.textContent.includes('(4)')`),'account task count') }
 catch(error) { await screen('companion-live-failure'); throw Error(String(error)+' '+JSON.stringify(await petJs(`({text:document.body.innerText,visible:document.visibilityState,hasToken:!!localStorage.getItem('nalu-token'),state:await window.companion.get()})`))) }
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
 assert.ok(JSON.stringify({messages:requests.at(-1).messages,systemPrompt:requests.at(-1).systemPrompt}).includes('LIVE_TASK_3'),'the answer receives all live task context')
 await screen('companion-live-answer')
 await js('window.nalu.companion.find()')
 await wait(()=>petJs(`innerWidth===404 && !!document.querySelector('.companion-panel')`),'Find Nalu reveals her and opens her bubble')
 await screen('companion-found')
 record('Find Nalu reveals her; all account task sources and waiting details reach both the task view and conversation; invalid routing no longer blocks chat')
 await petJs(`window.companion.openWorkspace('Build a calendar for my team')`)
 await wait(()=>js(`document.querySelector('[aria-label="Nalu prompt"]').value==='Build a calendar for my team'`),'task handoff')
 assert.equal(await js(`document.querySelector('[aria-label="Nalu work mode"] [aria-selected=true]').textContent`),'Auto')
 await petJs(`void window.companion.set({enabled:false})`)
 await wait(async()=>!(await call('Target.getTargets')).targetInfos.some(t=>t.url.endsWith('#companion')),'hide companion')
 assert.equal((await js(`window.nalu.companion.get()`)).enabled,false)
 record('companion Stop, exact task handoff to Auto, and Hide/settings persistence work without file/shell access from the companion window')
}
