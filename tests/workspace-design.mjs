// Interaction and visual acceptance layered onto the real-app mode harness.
import assert from 'node:assert/strict'
const visible = selector => `(()=>{const e=document.querySelector(${JSON.stringify(selector)});if(!e)return false;const r=e.getBoundingClientRect();return r.width>0&&r.height>0&&r.left>=0&&r.top>=0&&r.right<=innerWidth+1&&r.bottom<=innerHeight+1})()`
async function keyboard(api,key,code,modifiers=0) {const windowsVirtualKeyCode=({Escape:27,Enter:13,ArrowLeft:37,ArrowRight:39,Tab:9})[key] || key.toUpperCase().charCodeAt(0);await api.call('Input.dispatchKeyEvent',{type:'keyDown',key,code,modifiers,windowsVirtualKeyCode});await api.call('Input.dispatchKeyEvent',{type:'keyUp',key,code,modifiers,windowsVirtualKeyCode})}
async function replaceInput(api,selector,text) {await api.js(`{ const input=document.querySelector(${JSON.stringify(selector)});input.focus();input.select(); }`);await api.call('Input.insertText',{text})}
export async function beforeProject(api) {
 const {js,call,click,button,wait,screenshot,record}=api
 await call('Emulation.setDeviceMetricsOverride',{width:1360,height:900,deviceScaleFactor:1,mobile:false})
 assert.ok(await js(`!!document.querySelector('.appearance-pastel')`));assert.ok(await js(visible('[aria-label="Search commands"]')))
 await screenshot('design-welcome-wide')
 const expected=['Build an idea','Work on existing code','Handle everyday work']
 for(const text of expected)assert.ok(await js(`document.querySelector('.welcome-task-grid').textContent.includes(${JSON.stringify(text)})`))
 await js(`Array.from(document.querySelectorAll('.welcome-task-grid button')).find(b=>b.textContent.includes('Work on existing code')).click()`)
 await wait(()=>js(`document.querySelector('[aria-label="Nalu work mode"] [aria-selected=true]')?.textContent==='Auto'`),'one-click task mode')
 assert.equal(await js(`document.querySelector('[aria-label="Nalu prompt"]').value`),'Help me improve this code. I want to: ')
 await wait(()=>js(`document.activeElement===document.querySelector('[aria-label="Nalu prompt"]')`),'prompt focus')
 record('welcome task card selects Auto, prepares the task and focuses its prompt in one click without executing')
 await js(`document.querySelector('[title="Sign in"]').focus();document.querySelector('[title="Sign in"]').click()`)
 await wait(()=>js(`!!document.querySelector('dialog[open][aria-labelledby="settings-title"]')`),'Settings')
 await js(`Array.from(document.querySelectorAll('.appearance-options button')).find(b=>b.textContent.startsWith('Scenic')).click()`)
 assert.ok(await js(`!!document.querySelector('.appearance-scenic')`));assert.equal(await js(`localStorage.getItem('nalu-appearance')`),'scenic')
 await click('[aria-label="Close settings"]');await screenshot('design-scenic-option')
 await click('[title="Sign in"]');await js(`Array.from(document.querySelectorAll('.appearance-options button')).find(b=>b.textContent.startsWith('Focus')).click()`);await click('[aria-label="Close settings"]')
 await click('[title="Sign in"]');await js(`Array.from(document.querySelectorAll('.appearance-options button')).find(b=>b.textContent.startsWith('Pastel')).click()`);await screenshot('design-pastel-settings');await click('[aria-label="Close settings"]')
 record('Pastel, Focus and Scenic appearance controls work and persist the selected option')
 for(const [width,height] of [[1100,760],[900,600]]) {
  await call('Emulation.setDeviceMetricsOverride',{width,height,deviceScaleFactor:1,mobile:false})
  for(const selector of ['[aria-label="Send prompt"]','[aria-label="Nalu work mode"]','[aria-label="Task activity"]','[aria-label="Your team"]','.welcome-primary'])assert.ok(await js(visible(selector)),`${selector} at ${width}×${height}`)
  assert.equal(await js('document.documentElement.scrollWidth > innerWidth'),false)
  await screenshot(`design-welcome-${width}`)
 }
 await call('Emulation.setDeviceMetricsOverride',{width:1360,height:900,deviceScaleFactor:1,mobile:false})
 record('welcome, mode selector, Send and header utilities remain reachable at 1360×900, 1100×760 and 900×600')
 await button('Chats');await wait(()=>js(visible('[aria-label="Chat prompt"]')),'Chats view')
 await replaceInput(api,'[aria-label="Chat prompt"]','Keep this chat draft')
 await button('Workspace');await button('Chats');assert.equal(await js(`document.querySelector('[aria-label="Chat prompt"]').value`),'Keep this chat draft')
 await screenshot('design-chats-empty')
 await button('Workspace')
 record('Workspace and Chats switch without discarding the conversation draft')
 await click('[aria-label="Source control"]')
 await js(`document.querySelector('[aria-label="Resize files"]').focus()`)
 for(let i=0;i<20;i++)await keyboard(api,'ArrowLeft','ArrowLeft')
 for(const width of [180,220,260,320]) {
  await wait(()=>js(`Number(document.querySelector('[aria-label="Resize files"]').getAttribute('aria-valuenow'))===${width}`),'sidebar width '+width)
  const layout=await js(`(()=>{const panel=document.querySelector('.files-drawer').getBoundingClientRect();return [...document.querySelectorAll('.drawer-navigation button')].map(button=>{const r=button.getBoundingClientRect(),label=button.querySelector('span').getBoundingClientRect();return {text:button.textContent,inside:r.left>=panel.left&&r.right<=panel.right,labelFits:label.left>=r.left&&label.right<=r.right,overflow:button.scrollWidth>button.clientWidth}})})()`)
  assert.deepEqual(layout.map(x=>x.text),['Files','Search','Changes'])
  assert.ok(layout.every(x=>x.inside&&x.labelFits&&!x.overflow),JSON.stringify({width,layout}))
  await screenshot('sidebar-'+width)
  const next=({180:220,220:260,260:320})[width]
  if(next){await js(`document.querySelector('[aria-label="Resize files"]').focus()`);for(let i=width;i<next;i+=20)await keyboard(api,'ArrowRight','ArrowRight')}
 }
 await click('[aria-label="Files"]')
 record('Files, Search and Changes labels fit completely at sidebar widths 180, 220, 260 and 320, with keyboard resizing')
}
export async function withProject(api) {
 const {js,click,call,wait,mode,screenshot,record}=api
 await click('[aria-label="Edit file with Nalu"]')
 await wait(()=>js(`document.querySelector('[aria-label="Nalu work mode"] [aria-selected=true]')?.textContent==='Edit'`),'one-click file edit')
 await wait(()=>js(`document.activeElement===document.querySelector('[aria-label="Nalu prompt"]')`),'prompt focus')
 assert.ok(await js(`document.querySelector('.composer-context')?.textContent.includes('first.txt')`))
 await mode('Chat');await screenshot('design-project-wide')
 // Files stay beside both the editor and assistant, and each has a usable width.
 const geometry=await js(`(()=>{const rect=s=>{const r=document.querySelector(s).getBoundingClientRect();return {left:r.left,right:r.right,width:r.width,top:r.top,bottom:r.bottom}};return {files:rect('.files-drawer'),editor:rect('.editor-column'),assistant:rect('.assistant-column')}})()`)
 assert.ok(geometry.editor.width>=300);assert.ok(geometry.assistant.width>=300);assert.ok(geometry.files.right<geometry.editor.left);assert.ok(geometry.editor.right<geometry.assistant.left)
 await js(`document.querySelector('[aria-label="Nalu work mode"] [aria-selected=true]').focus()`)
 await keyboard(api,'ArrowRight','ArrowRight');assert.equal(await js(`document.querySelector('[aria-label="Nalu work mode"] [aria-selected=true]').textContent`),'Agent')
 await mode('Chat')
 await click('[aria-label="Search"]');await wait(()=>js(`!!document.querySelector('input[placeholder="Search in files"]')`),'Search navigation')
 await click('[aria-label="Source control"]');await click('[aria-label="Files"]')
 await click('[aria-label="Search commands"]');await wait(()=>js(`!!document.querySelector('[cmdk-input]')`),'command search');await keyboard(api,'Escape','Escape');await wait(()=>js(`!document.querySelector('[cmdk-input]')`),'command search closes')
 await call('Emulation.setDeviceMetricsOverride',{width:900,height:600,deviceScaleFactor:1,mobile:false})
 assert.ok(await js(visible('[aria-label="Edit file with Nalu"]')));assert.ok(await js(visible('[aria-label="Send prompt"]')))
 await screenshot('design-project-compact')
 await call('Emulation.setDeviceMetricsOverride',{width:1360,height:900,deviceScaleFactor:1,mobile:false})
 record('one-click Edit with Nalu, keyboard mode switching, project tool navigation and responsive editor/assistant layout')
}
export async function afterTasks(api) {
 const {js,click,call,button,wait,screenshot,record,replies,apiRequests}=api
 for(const [trigger,title] of [['Task activity','Task activity'],['Your team','Your team']]) {
  await js(`document.querySelector('[aria-label="${trigger}"]').focus();document.querySelector('[aria-label="${trigger}"]').click()`)
  await wait(()=>js(`!!document.querySelector('dialog[open][aria-label="${title}"]')`),title+' dialog')
  assert.ok(await js(`document.querySelector('dialog[open]').contains(document.activeElement)`))
  await keyboard(api,'k','KeyK',4);assert.equal(await js(`!!document.querySelector('[cmdk-input]')`),false)
  await screenshot(title==='Your team'?'design-team':'design-activity')
  await keyboard(api,'Escape','Escape');assert.equal(await js(`document.activeElement===document.querySelector('[aria-label="${trigger}"]')`),true)
 }
 record('Activity and Team remain one-click accessible with native modal focus, Escape and focus restoration')
 await button('Chats');await wait(()=>js(visible('[aria-label="Chat prompt"]')),'Chats')
 await replaceInput(api,'[aria-label="Chat prompt"]','Explain this example')
 replies.push('# A clearer answer\nHere is the **result**.\n- First step\n- Second step\n```js\nconst result = 42;\n```')
 await click('[aria-label="Send chat message"]');await wait(()=>js(`!!document.querySelector('.chat-conversation .message-content h3')`),'formatted answer')
 assert.equal(await js(`document.querySelector('.chat-conversation .message-code pre').textContent`),'const result = 42;')
 await wait(()=>apiRequests.some(r=>r.action==='set'&&r.key==='nalu-chats'&&r.value.includes('const result = 42')),'shared chat save request')
 await screenshot('design-chat-answer')
 await button('Workspace');await button('Chats');assert.equal(await js(`document.querySelector('.chat-conversation .message-code pre').textContent`),'const result = 42;')
 const expert=await js(`document.querySelector('[aria-label="Choose expert"]').options.length`);assert.ok(expert>=15)
 await button('Workspace')
 record('Chats renders headings, lists and exact code, preserves specialist selection and saves the conversation through the shared API contract')
}

export async function autoTasks(api) {
 const {js,click,button,wait,mode,replies,record}=api
 const idle=()=>wait(()=>js(`!!document.querySelector('[aria-label="Send prompt"]')`),'Auto task idle')
 await mode('Auto')
 await replaceInput(api,'[aria-label="Nalu prompt"]','Draft a brief project update')
 replies.push({mode:'chat',reason:'This is a writing task.'},'AUTO_BUSINESS_REPLY')
 await click('[aria-label="Send prompt"]');await idle()
 assert.ok(await js(`document.querySelector('.nalu-assistant').textContent.includes('AUTO_BUSINESS_REPLY')`))
 assert.equal(await js(`document.querySelector('[aria-label="Nalu work mode"] [aria-selected=true]').textContent`),'Auto')
 await replaceInput(api,'[aria-label="Nalu prompt"]','Print the current directory in the terminal')
 replies.push({mode:'terminal',reason:'A shell task needs the terminal.'},'pwd','DONE: AUTO_TERMINAL_DONE')
 await click('[aria-label="Send prompt"]');await wait(()=>js(`Array.from(document.querySelectorAll('button')).some(b=>b.textContent.trim()==='Approve')`),'Auto command approval')
 await button('Approve');await idle();assert.ok(await js(`document.querySelector('.nalu-assistant').textContent.includes('AUTO_TERMINAL_DONE')`))
 await replaceInput(api,'[aria-label="Nalu prompt"]','Change the open file to AUTO_EDIT')
 replies.push({mode:'edit',reason:'The change is limited to the open file.'},'```text\nAUTO_EDIT\n```')
 await click('[aria-label="Send prompt"]');await idle();await wait(()=>js(`!!document.querySelector('.nalu-assistant .monaco-diff-editor')`),'Auto edit preview');await button('Reject')
 await replaceInput(api,'[aria-label="Nalu prompt"]','An unclear task')
 replies.push({question:'What would you like to accomplish?'})
 await click('[aria-label="Send prompt"]');await idle();assert.equal(await js(`document.querySelector('[aria-label="Nalu prompt"]').value`),'An unclear task')
 assert.ok(await js(`document.querySelector('.nalu-assistant').textContent.includes('What would you like to accomplish?')`))
 await replaceInput(api,'[aria-label="Nalu prompt"]','Build something from an idea');replies.push('invalid routing output','What would you like to build? FALLBACK_CONVERSATION')
 await click('[aria-label="Send prompt"]');await idle();assert.ok(await js(`document.querySelector('.nalu-assistant').textContent.includes('FALLBACK_CONVERSATION')`))
 assert.equal(await js(`Array.from(document.querySelectorAll('button')).some(b=>b.textContent.trim()==='Approve')`),false)
 assert.ok(api.requests.some(request => request.systemPrompt?.includes('Choose the most appropriate Nalu Desktop mode')))
 assert.ok(api.requests.every(request => request.messages.every(message => message.role !== 'system')))
 await replaceInput(api,'[aria-label="Nalu prompt"]','Stop before choosing tools');replies.push('__HOLD__')
 await click('[aria-label="Send prompt"]');await wait(()=>js(`!!document.querySelector('[aria-label="Stop task"]')`),'interpretation starts');await click('[aria-label="Stop task"]');await idle()
 assert.equal(await js(`document.querySelector('[aria-label="Nalu prompt"]').value`),'Stop before choosing tools')
 record('Auto sends routing instructions through the shared systemPrompt field, routes writing, approved shell execution and reviewable edits, asks when unclear, continues conversation on invalid routing, and preserves drafts on Stop')
}
