// Heartbeats stop an automatic restart if a renderer hangs or is still loading.
export function reportUpdateActivity(send: (blocked: boolean, idleMs: number) => void, blocked: () => boolean) {
  let lastInput = Date.now()
  const report = () => send(blocked(), Math.max(0, Date.now() - lastInput))
  const input = () => { lastInput = Date.now(); report() }
  const events = ['pointerdown', 'keydown', 'input', 'wheel', 'focus']
  for (const event of events) window.addEventListener(event, input, true)
  report()
  const timer = setInterval(report, 2000)
  return () => { clearInterval(timer); for (const event of events) window.removeEventListener(event, input, true) }
}
