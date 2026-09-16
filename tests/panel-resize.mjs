// Actual Electron pointer, keyboard, editor and layout acceptance checks.
import assert from 'node:assert/strict'
import fs from 'node:fs'

export async function verifyPanelResize(api) {
  const { js, call, click, button, wait, screenshot, record, mode, project, file } = api
  const traces=[]
  const grip = name => `[aria-label="Resize ${name}"]`
  const rect = selector => js(`document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect().toJSON()`)
  const settle = () => js('new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))')
  const viewport = async (width, height) => { await call('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: false }); await settle() }
  const key = async (selector, key, modifiers = 0) => {
    await js(`document.querySelector(${JSON.stringify(selector)}).focus()`)
    const windowsVirtualKeyCode = { ArrowLeft:37, ArrowUp:38, ArrowRight:39, ArrowDown:40, Escape:27, Enter:13, Home:36 }[key]
    await call('Input.dispatchKeyEvent', { type:'keyDown', key, code:key, windowsVirtualKeyCode, modifiers })
    await call('Input.dispatchKeyEvent', { type:'keyUp', key, code:key, windowsVirtualKeyCode, modifiers }); await settle()
  }
  const drag = async (name, dx, dy = 0, cancel = false) => {
    const selector = grip(name), r = await rect(selector), x = r.x + r.width/2, y = r.y + r.height/2
    await js(`window.dragTrace=[];if(!window.traceInstalled){window.traceInstalled=true;for(const type of ['pointerdown','pointermove','pointerup','pointercancel','lostpointercapture','blur'])window.addEventListener(type,e=>{if(type==='blur'&&e.target!==window)return;window.dragTrace.push({type,x:e.clientX,y:e.clientY,buttons:e.buttons,target:e.target?.getAttribute?.('aria-label'),pid:e.pointerId})},true)}`)
    assert.ok(r.width >= 22 && r.height >= 20, `usable ${name} grip`)
    assert.ok(await js(`document.querySelector(${JSON.stringify(selector)}).contains(document.elementFromPoint(${x},${y}))`), `${name} reachable`)
    await call('Input.dispatchMouseEvent', { type:'mouseMoved', x, y })
    await call('Input.dispatchMouseEvent', { type:'mousePressed', button:'left', buttons:1, clickCount:1, x, y })
    for (let i=1; i<=6; i++) { await call('Input.dispatchMouseEvent', { type:'mouseMoved', button:'left', buttons:1, x:x+dx*i/6, y:y+dy*i/6 }); await settle() }
    if (cancel) await key(selector, 'Escape')
    await call('Input.dispatchMouseEvent', { type:'mouseReleased', button:'left', buttons:0, clickCount:1, x:x+dx, y:y+dy })
    await settle()
    traces.push({name,start:r,dx,dy,events:await js('window.dragTrace')});fs.writeFileSync(api.scratch+'/drag-trace.json',JSON.stringify(traces,null,2))
    assert.equal(await js('document.body.style.userSelect'), '', 'selection restored')
  }
  const close = (actual, expected, label) => assert.ok(Math.abs(actual-expected) <= 2, `${label}: ${actual} vs ${expected}`)
  const visible = async selector => {
    const r = await rect(selector)
    assert.ok(r.width>0 && r.height>0 && r.x>=0 && r.y>=0 && r.right<=await js('innerWidth')+1 && r.bottom<=await js('innerHeight')+1, `${selector} in viewport: ${JSON.stringify(r)}`)
  }
  const layout = async () => {
    for (const name of ['Files panel','Editor panel','Nalu panel']) await visible(grip(name))
    await visible('[aria-label="Send prompt"]')
    assert.equal(await js('document.documentElement.scrollWidth > innerWidth'), false, 'no horizontal overflow')
  }

  await viewport(1360, 900)
  await js(`window.nalu.saveWorkspace(${JSON.stringify(JSON.stringify({version:1,folder:project,tabs:[{path:file,name:'first.txt'}],activePath:file}))})`)
  await call('Page.reload')
  await wait(() => js(`document.querySelector('.view-lines')?.textContent.includes('FIRST_ORIGINAL')`), 'editor restored')
  await layout(); await screenshot('resize-pastel-default')

  let before = await rect('.files-drawer')
  await drag('Files panel', 70)
  close((await rect('.files-drawer')).width, before.width+70, 'Files pointer width')
  const savedFiles = (await rect('.files-drawer')).width
  before = await rect('.assistant-column')
  await drag('Nalu panel', -80)
  close((await rect('.assistant-column')).width, before.width+80, 'Nalu pointer width')
  before = await rect('.editor-surface')
  await drag('Editor panel', 40)
  close((await rect('.editor-surface')).width, before.width+40, 'Editor pointer width')
  const savedAssistant = (await rect('.assistant-column')).width
  await call('Page.reload')
  await wait(() => js(`document.querySelector('.view-lines')?.textContent.includes('FIRST_ORIGINAL')`), 'reload after resize')
  close((await rect('.files-drawer')).width, savedFiles, 'Files width persisted')
  close((await rect('.assistant-column')).width, savedAssistant, 'Nalu width persisted')
  before = await rect('.assistant-column')
  await drag('Nalu panel', -30, 0, true)
  close((await rect('.assistant-column')).width, before.width, 'Escape restores previous width')
  await key(grip('Nalu panel'), 'ArrowRight', 8)
  close((await rect('.assistant-column')).width, before.width-5, 'Shift-arrow precise resize')
  await key(grip('Nalu panel'), 'Home'); await key(grip('Files panel'), 'Home')
  record('Files, Editor and Nalu corner grips drag, persist across reload, reset and cancel; Shift-arrow adjusts by five pixels')

  await click('[aria-label="Toggle terminal"]')
  await wait(() => js(`!!document.querySelector('.terminal-panel .xterm-screen')`), 'terminal starts')
  before = await rect('.terminal-panel')
  await drag('Terminal panel', 0, -60)
  close((await rect('.terminal-panel')).height, before.height+60, 'Terminal pointer height')
  before = await rect('.editor-surface')
  await drag('Editor panel', -30, -30)
  close((await rect('.editor-surface')).height, before.height-30, 'Editor vertical resize')
  close((await rect('.editor-surface')).width, before.width-30, 'Editor horizontal resize')
  await visible('[aria-label="Hide terminal"]'); await visible(grip('Terminal panel'))
  await screenshot('resize-editor-terminal')
  await button('Problems'); await visible(grip('Terminal panel'))
  await button('Output'); await visible(grip('Terminal panel'))
  await button('Terminal')
  await key(grip('Editor panel'), 'Home')
  record('Editor corner adjusts both dimensions with Terminal open; Terminal, Problems and Output keep the shared resize grip')

  await mode('PC')
  await wait(() => js(`!!document.querySelector('.browser-preview')`), 'Chrome preview')
  before = await rect('.browser-preview')
  await drag('Chrome preview', 0, -45)
  close((await rect('.browser-preview')).height, before.height-45, 'Chrome pointer height')
  await visible('[aria-label="Send prompt"]'); await screenshot('resize-chrome')
  await key(grip('Chrome preview'), 'Home')
  record('Chrome preview has its own height grip and leaves the task composer accessible')

  await button('Chats'); await wait(() => js(`document.querySelector('.chat-layout').getBoundingClientRect().width > 0`), 'Chats')
  before = await rect('.chat-sidebar')
  await drag('Chat list panel', 60)
  close((await rect('.chat-sidebar')).width, before.width+60, 'Chat list pointer width')
  before = await rect('.chat-conversation')
  await drag('Conversation panel', 40)
  close((await rect('.chat-conversation')).width, before.width-40, 'Conversation pointer width')
  await visible('[aria-label="Send chat message"]'); await screenshot('resize-chats')
  const savedChat = (await rect('.chat-sidebar')).width
  await button('Workspace'); await button('Chats')
  close((await rect('.chat-sidebar')).width, savedChat, 'Chats resize survives view switch')
  await key(grip('Chat list panel'), 'Home')
  record('Chat list and conversation resize through either corner and keep the composer clear')

  await button('Workspace'); await mode('Chat')
  for (const [width,height] of [[1100,760],[900,600]]) {
    await viewport(width,height)
    await layout(); await visible(grip('Terminal panel')); await visible('[aria-label="Hide terminal"]')
    assert.ok((await rect('.editor-surface')).height>=120, 'Editor retains visible code beneath the tabs')
    if (width===900) {
      before=await rect('.assistant-column')
      await drag('Nalu panel',0,-25)
      assert.ok((await rect('.assistant-column')).height>=before.height, 'stacked Nalu resize works')
      await key(grip('Nalu panel'),'Home')
      await mode('PC')
      // Compact Chrome mode scrolls within Nalu when its contents need more room.
      await js(`document.querySelector('[aria-label="Send prompt"]').scrollIntoView({block:'nearest'})`)
      await visible('[aria-label="Send prompt"]'); await visible(grip('Nalu panel'))
      await mode('Chat')
    }
    await screenshot('resize-compact-'+width)
  }
  await viewport(1360,900)
  await click('[title="Sign in"]')
  await js(`Array.from(document.querySelectorAll('.appearance-options button')).find(b=>b.textContent.startsWith('Focus')).click()`)
  await click('[aria-label="Close settings"]')
  await layout(); await screenshot('resize-focus')
  record('Corner grips remain visible at 1360×900, 1100×760 and 900×600 in Pastel and Focus, with compact Chrome controls reachable')
}
