export interface BrowserCommand {
  action: string
  url?: string
  origins?: string[]
  selector?: string
  value?: string
  key?: string
  assertion?: string
  expected?: string
  count?: number
  width?: number
  height?: number
  timeout_ms?: number
}

// Serialized into a dedicated isolated world. Keep this function self-contained:
// page JavaScript cannot replace its DOM methods or fabricate the RPC response.
export function inspectBrowserPage(command: BrowserCommand) {
  const compact = (value: string | null | undefined) => (value || '').replace(/\s+/g, ' ').trim()
  const visible = (el: Element) => {
    const style = getComputedStyle(el), rect = el.getBoundingClientRect()
    return rect.width > 0 && rect.height > 0 && style.visibility !== 'hidden' && style.display !== 'none' && !el.closest('[hidden],[inert]')
  }
  const nameOf = (el: Element) => {
    const labelled = (el.getAttribute('aria-labelledby') || '').split(/\s+/).filter(Boolean)
      .map(id => document.getElementById(id)?.textContent || '').join(' ')
    const labels = 'labels' in el ? Array.from((el as HTMLInputElement).labels || []).map(label => label.textContent).join(' ') : ''
    return compact(labelled || el.getAttribute('aria-label') || labels
      || (el.matches('button,a,[role="button"],summary') ? el.textContent : '')
      || (el.matches('input[type="submit"],input[type="button"]') ? (el as HTMLInputElement).value : '')
      || el.getAttribute('title'))
  }
  const selectorOf = (el: Element) => {
    if (el.id && document.querySelectorAll('#' + CSS.escape(el.id)).length === 1) return '#' + CSS.escape(el.id)
    const parts: string[] = []
    for (let at: Element | null = el; at && at !== document.documentElement; at = at.parentElement) {
      const siblings = Array.from(at.parentElement?.children || []).filter(sibling => sibling.tagName === at!.tagName)
      parts.unshift(at.tagName.toLowerCase() + (siblings.length > 1 ? `:nth-of-type(${siblings.indexOf(at) + 1})` : ''))
      if (document.querySelectorAll(parts.join(' > ')).length === 1) return parts.join(' > ')
    }
    return parts.join(' > ')
  }
  const controls = Array.from(document.querySelectorAll('input:not([type="hidden"]),textarea,select,button,a[href],[role="button"],[role="textbox"],[role="combobox"],summary,[contenteditable="true"]')).filter(visible)
  const missingLabels = controls.filter(el => !nameOf(el)).map(selectorOf)
  const overflow = Math.max(document.documentElement.scrollWidth, document.body?.scrollWidth || 0) - innerWidth
  let authorRules = 0, unreadableStylesheets = 0
  for (const sheet of document.styleSheets) {
    try { authorRules += sheet.cssRules.length } catch { unreadableStylesheets++ }
  }
  const matching = () => {
    if (typeof command.selector !== 'string' || !command.selector.trim()) throw Error('A CSS selector is required for this action.')
    return Array.from(document.querySelectorAll(command.selector))
  }
  const target = () => {
    const matches = matching().filter(visible)
    if (matches.length !== 1) throw Error(`Expected one visible target; found ${matches.length}. Inspect the snapshot and use its CSS selectors.`)
    const el = matches[0] as HTMLElement
    if (el.matches(':disabled,[aria-disabled="true"]')) throw Error('Target is disabled.')
    return el
  }
  if (command.action === 'target') {
    const el = target()
    el.scrollIntoView({ block: 'center', inline: 'center', behavior: 'instant' })
    const rect = el.getBoundingClientRect(), x = rect.left + rect.width / 2, y = rect.top + rect.height / 2
    const hit = document.elementFromPoint(x, y)
    if (!hit || !(el === hit || el.contains(hit))) throw Error('Target is covered by another element.')
    return { x, y }
  }
  if (command.action === 'focus') {
    const el = target()
    if (!el.matches('input,textarea,[contenteditable="true"]')) throw Error('Fill requires a text input, textarea, or contenteditable element.')
    if (el.matches('[readonly],input[type="file"],input[type="checkbox"],input[type="radio"],input[type="hidden"]')) throw Error('This control cannot be filled as text.')
    el.focus()
    if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) el.select()
    else { const range = document.createRange(); range.selectNodeContents(el); const selection = getSelection(); selection?.removeAllRanges(); selection?.addRange(range) }
    return { focused: document.activeElement === el }
  }
  if (command.action === 'select') {
    const el = target()
    if (!(el instanceof HTMLSelectElement)) throw Error('Select requires a native select element.')
    const options = Array.from(el.options).filter(option => option.value === command.value)
    if (options.length !== 1 || options[0].disabled) throw Error('Select value is missing, ambiguous, or disabled.')
    el.value = command.value!
    el.dispatchEvent(new Event('input', { bubbles: true }))
    el.dispatchEvent(new Event('change', { bubbles: true }))
    return { value: el.value }
  }
  if (command.action === 'assert') {
    let passed: boolean, actual: unknown
    switch (command.assertion) {
      case 'text': {
        if (!command.expected) throw Error('Text assertions require a nonempty expected string.')
        const elements = matching().filter(visible)
        if (elements.length > 1) throw Error(`Ambiguous text assertion: ${elements.length} visible elements match. Use a unique selector from the snapshot, or body for whole-page text.`)
        if (elements.length !== 1) { actual = { visibleMatches: elements.length }; passed = false; break }
        actual = (elements[0] as HTMLElement).innerText || elements[0].textContent || ''
        passed = String(actual).includes(command.expected); break
      }
      case 'value': {
        if (typeof command.expected !== 'string') throw Error('Value assertions require an expected string, which may be empty.')
        const elements = matching().filter(visible)
        if (elements.length > 1) throw Error(`Ambiguous value assertion: ${elements.length} visible elements match. Use a unique selector from the snapshot.`)
        actual = elements.length === 1 && 'value' in elements[0] ? (elements[0] as HTMLInputElement).value : { visibleMatches: elements.length }
        passed = actual === command.expected; break
      }
      case 'count': {
        if (!Number.isInteger(command.count) || command.count! < 0) throw Error('Count assertions require a nonnegative integer count.')
        actual = matching().filter(visible).length; passed = actual === command.count; break
      }
      case 'visible': actual = matching().filter(visible).length; passed = actual === 1; break
      case 'labels': actual = missingLabels; passed = missingLabels.length === 0; break
      case 'no_overflow': actual = { overflowPixels: overflow, viewportWidth: innerWidth }; passed = overflow <= 1; break
      default: throw Error('Unknown DOM assertion. Use text, value, count, visible, labels, no_overflow, or no_errors.')
    }
    return { assertion: command.assertion, selector: command.selector, expected: command.expected ?? command.count, passed, actual }
  }
  return {
    url: location.href, title: document.title, viewport: { width: innerWidth, height: innerHeight },
    text: (document.body?.innerText || '').slice(0, 14000),
    controls: controls.slice(0, 100).map(el => ({
      selector: selectorOf(el), tag: el.tagName.toLowerCase(), role: el.getAttribute('role') || undefined,
      name: nameOf(el), placeholder: el.getAttribute('placeholder') || undefined,
      type: el.getAttribute('type') || undefined, disabled: el.matches(':disabled,[aria-disabled="true"]'),
      value: 'value' in el ? (el as HTMLInputElement).type === 'password' ? '[redacted]' : (el as HTMLInputElement).value : undefined,
      checked: 'checked' in el ? (el as HTMLInputElement).checked : undefined,
      options: el instanceof HTMLSelectElement ? Array.from(el.options).map(option => ({ value: option.value, label: option.label, disabled: option.disabled })) : undefined,
    })),
    diagnostics: { missingLabels, overflowPixels: overflow,
      brokenImages: Array.from(document.images).filter(el => visible(el) && el.complete && !el.naturalWidth).map(el => el.src).slice(0, 20),
      bodyFont: document.body ? getComputedStyle(document.body).fontFamily : '',
      styling: { authorRules, unreadableStylesheets, classedElements: document.querySelectorAll('[class]').length, inlineStyledElements: document.querySelectorAll('[style]').length },
    },
    truncated: controls.length > 100 || (document.body?.innerText.length || 0) > 14000,
  }
}
