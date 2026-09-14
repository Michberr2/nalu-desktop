import { API_BASE, getToken } from '../lib/naluApi'

export async function transcribeRecording(blob: Blob, signal: AbortSignal): Promise<string> {
  const audio = await new Promise<string>((resolve, reject) => { const reader = new FileReader(); reader.onerror = () => reject(Error('Could not read the recording.')); reader.onload = () => resolve(String(reader.result)); reader.readAsDataURL(blob) })
  signal.throwIfAborted()
  const response = await fetch(`${API_BASE}/api/transcribe`, { method: 'POST', headers: { 'Content-Type': 'application/json', ...(getToken() ? { Authorization: `Bearer ${getToken()}` } : {}) }, body: JSON.stringify({ audio, mime: blob.type }), signal })
  const data = await response.json()
  if (!response.ok) throw Error(typeof data.error === 'string' ? data.error : 'Could not transcribe your voice.')
  if (typeof data.text !== 'string' || !data.text.trim()) throw Error('I didn’t catch any words. Try again or type your task.')
  return data.text.trim()
}

/** Shared Nalu voice API, with an on-device voice if the service is unavailable. */
export async function speakReply(text: string, signal: AbortSignal, onSpeaking: (speaking: boolean) => void): Promise<void> {
  const clean = text.replace(/```[\s\S]*?```/g, 'The code is in my reply.').replace(/[*#`]/g, '').slice(0, 1600)
  if (!clean.trim()) return
  let blob: Blob | null = null
  try {
    const response = await fetch(`${API_BASE}/api/tts`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text: clean, voice: 'britishWoman' }), signal: AbortSignal.any([signal, AbortSignal.timeout(10000)]) })
    if (response.ok && response.headers.get('content-type')?.startsWith('audio/')) blob = await response.blob()
  } catch { signal.throwIfAborted() }
  signal.throwIfAborted()
  onSpeaking(true)
  try {
    if (blob && blob.size > 0) {
      const url = URL.createObjectURL(blob), audio = new Audio(url)
      try {
        await new Promise<void>((resolve, reject) => {
          const stop = () => { audio.pause(); cleanup(); reject(signal.reason || Error('Stopped')) }
          const cleanup = () => signal.removeEventListener('abort', stop)
          audio.onended = () => { cleanup(); resolve() }
          audio.onerror = () => { cleanup(); reject(Error('Voice playback failed. Your reply is still available to read.')) }
          signal.addEventListener('abort', stop, { once: true })
          void audio.play().catch(error => { cleanup(); reject(error) })
        })
      } finally { audio.pause(); URL.revokeObjectURL(url) }
    } else {
      await new Promise<void>((resolve, reject) => {
        const utterance = new SpeechSynthesisUtterance(clean)
        utterance.lang = 'en-GB'; utterance.rate = 1
        const voices = speechSynthesis.getVoices()
        utterance.voice = voices.find(v => v.lang === 'en-GB' && /female|serena|martha|kate/i.test(v.name)) || voices.find(v => v.lang === 'en-GB') || null
        const stop = () => { speechSynthesis.cancel(); cleanup(); reject(signal.reason || Error('Stopped')) }
        const cleanup = () => signal.removeEventListener('abort', stop)
        utterance.onend = () => { cleanup(); resolve() }; utterance.onerror = () => { cleanup(); reject(Error('Voice playback is unavailable. You can read the reply here.')) }
        signal.addEventListener('abort', stop, { once: true }); speechSynthesis.speak(utterance)
      })
    }
  } finally { onSpeaking(false) }
}
