// User-tunable model settings for Inkling: reasoning level + answer token
// capacity. Persisted in localStorage, sent with every /api/chat request.
export type ReasoningLevel = 'none' | 'low' | 'medium' | 'high'
export const REASONING_LEVELS: ReasoningLevel[] = ['none', 'low', 'medium', 'high']
export const REASONING_DESC: Record<ReasoningLevel, string> = {
  none: 'Fastest — answers directly, no deliberation',
  low: 'Light reasoning (recommended)',
  medium: 'More deliberation for harder problems',
  high: 'Deepest reasoning — slowest',
}

export interface ModelSettings {
  reasoning: ReasoningLevel
  maxTokens: number
}
export const DEFAULT_SETTINGS: ModelSettings = { reasoning: 'low', maxTokens: 8192 }
export const MIN_TOKENS = 256
export const MAX_TOKENS = 32000

const KEY = 'nalu-model-settings'

function clamp(n: number): number {
  return Number.isFinite(n) ? Math.max(MIN_TOKENS, Math.min(MAX_TOKENS, Math.round(n))) : DEFAULT_SETTINGS.maxTokens
}

export function getModelSettings(): ModelSettings {
  try {
    const p = JSON.parse(localStorage.getItem(KEY) || '{}')
    return {
      reasoning: REASONING_LEVELS.includes(p.reasoning) ? p.reasoning : DEFAULT_SETTINGS.reasoning,
      maxTokens: clamp(Number(p.maxTokens)),
    }
  } catch {
    return { ...DEFAULT_SETTINGS }
  }
}

export function setModelSettings(patch: Partial<ModelSettings>): ModelSettings {
  const next = { ...getModelSettings(), ...patch }
  try {
    localStorage.setItem(KEY, JSON.stringify(next))
  } catch {
    /* storage blocked */
  }
  return next
}
