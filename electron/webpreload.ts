// Runs in the Nalu Browser BEFORE any page script. Masks the automation
// fingerprints that bot-walls (Akamai, etc.) key on, so legitimate web tasks in
// our own visible Chromium behave like a normal user's browser.
try {
  Object.defineProperty(navigator, 'webdriver', { get: () => false, configurable: true })
} catch {
  /* some pages freeze navigator — best effort */
}
try {
  // A couple of the other commonly-fingerprinted props, set to realistic values.
  if (!(navigator.languages && navigator.languages.length)) {
    Object.defineProperty(navigator, 'languages', { get: () => ['en-US', 'en'], configurable: true })
  }
  // chrome runtime object exists in real Chrome
  const w = window as unknown as { chrome?: unknown }
  if (!w.chrome) w.chrome = { runtime: {} }
} catch {
  /* best effort */
}
