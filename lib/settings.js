import { clamp, clampInt } from './similarity.js'
import { DEFAULT_PREPROCESS, normalizePreprocessOptions } from './preprocess.js'
import { restoredLang } from './lang.js'

// UI languages the workbench can switch between; 'auto' follows the DSH locale.
export const UI_LANG_CODES = ['auto', 'zh', 'en', 'ja']

// Below ~70% a fuzzy match usually shares little more than function words, so
// showing it costs review time without saving any. Mainstream CAT tools sit in
// the 70–75% range for the same reason.
export const DEFAULT_FUZZY_THRESHOLD = 0.7

export const DEFAULT_SETTINGS = {
  sourceLang: 'en',
  targetLang: 'zh-CN',
  fuzzyThreshold: DEFAULT_FUZZY_THRESHOLD,
  tmLimit: 5,
  uiLang: 'auto',
  preprocess: { ...DEFAULT_PREPROCESS },
  // Where terms captured from a selection go by default, and whether the
  // "which library should new terms go to" hint has been shown once.
  termCapture: {
    defaultGlossaryId: '',
    hintSeen: false,
  },
  mt: {
    provider: 'mock',
    model: 'cait-mock',
    temperature: 0.2,
  },
  // Empty provider/model means "inherit the MT route". A separate route lets
  // review use a stronger model without slowing down bulk pre-translation.
  review: {
    provider: '',
    model: '',
    temperature: 0,
  },
  // OpenAI-compatible endpoint on the translator's own machine (LM Studio,
  // Ollama, vLLM). The API key lives outside the store, in mt-local.json.
  mtLocal: {
    enabled: false,
    baseUrl: '',
    model: '',
    timeoutMs: 60000,
  },
  // Quoting: per-1k-word rate and the discount applied to each TM match band.
  quote: {
    currency: 'CNY',
    unit: 'per1000words',
    rate: 120,
    discounts: {
      ice: 0.3,
      exact: 0.3,
      fuzzy85: 0.6,
      fuzzy70: 0.8,
      new: 1,
    },
    minimum: 0,
  },
  // Post-editing effort: keep the MT suggestion on the segment so we can show
  // how much of it the translator kept.
  postEdit: {
    enabled: true,
  },
}

export function restoreSettings(raw) {
  const settings = structuredClone(DEFAULT_SETTINGS)
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return settings
  try {
    if (String(raw.sourceLang ?? '').trim()) {
      settings.sourceLang = restoredLang(raw.sourceLang, settings.sourceLang)
    }
    if (String(raw.targetLang ?? '').trim()) {
      settings.targetLang = restoredLang(raw.targetLang, settings.targetLang)
    }
    const threshold = Number(raw.fuzzyThreshold)
    if (Number.isFinite(threshold)) settings.fuzzyThreshold = clamp(threshold, 0, 1)
    const limit = Number(raw.tmLimit)
    if (Number.isFinite(limit)) settings.tmLimit = clampInt(limit, 1, 20, settings.tmLimit)
    const uiLang = String(raw.uiLang ?? '')
      .trim()
      .toLowerCase()
    if (UI_LANG_CODES.includes(uiLang)) settings.uiLang = uiLang
    settings.preprocess = normalizePreprocessOptions(raw.preprocess)

    if (raw.termCapture && typeof raw.termCapture === 'object' && !Array.isArray(raw.termCapture)) {
      const defaultGlossaryId = String(raw.termCapture.defaultGlossaryId ?? '')
        .trim()
        .slice(0, 80)
      if (defaultGlossaryId) settings.termCapture.defaultGlossaryId = defaultGlossaryId
      settings.termCapture.hintSeen = raw.termCapture.hintSeen === true
    }

    if (raw.mt && typeof raw.mt === 'object' && !Array.isArray(raw.mt)) {
      const provider = String(raw.mt.provider ?? '').trim()
      if (provider) settings.mt.provider = provider.slice(0, 120)
      if (raw.mt.model !== undefined)
        settings.mt.model = String(raw.mt.model ?? '')
          .trim()
          .slice(0, 200)
      const temperature = Number(raw.mt.temperature)
      if (Number.isFinite(temperature)) settings.mt.temperature = clamp(temperature, 0, 2)
    }
    if (raw.review && typeof raw.review === 'object' && !Array.isArray(raw.review)) {
      settings.review.provider = String(raw.review.provider ?? '')
        .trim()
        .slice(0, 120)
      settings.review.model = String(raw.review.model ?? '')
        .trim()
        .slice(0, 200)
      const temperature = Number(raw.review.temperature)
      if (Number.isFinite(temperature)) settings.review.temperature = clamp(temperature, 0, 2)
    }
    if (raw.mtLocal && typeof raw.mtLocal === 'object' && !Array.isArray(raw.mtLocal)) {
      settings.mtLocal.enabled = raw.mtLocal.enabled === true
      settings.mtLocal.baseUrl = String(raw.mtLocal.baseUrl ?? '')
        .trim()
        .replace(/\/+$/, '')
        .slice(0, 500)
      settings.mtLocal.model = String(raw.mtLocal.model ?? '')
        .trim()
        .slice(0, 120)
      const timeoutMs = Number(raw.mtLocal.timeoutMs)
      if (Number.isFinite(timeoutMs)) settings.mtLocal.timeoutMs = clampInt(timeoutMs, 5000, 300000, 60000)
    }
    if (raw.quote && typeof raw.quote === 'object' && !Array.isArray(raw.quote)) {
      const currency = String(raw.quote.currency ?? '')
        .trim()
        .toUpperCase()
      if (currency) settings.quote.currency = currency.slice(0, 8)
      const unit = String(raw.quote.unit ?? '').trim()
      if (['per1000words', 'per1000chars', 'perword'].includes(unit)) settings.quote.unit = unit
      const rate = Number(raw.quote.rate)
      if (Number.isFinite(rate) && rate >= 0) settings.quote.rate = rate
      const minimum = Number(raw.quote.minimum)
      if (Number.isFinite(minimum) && minimum >= 0) settings.quote.minimum = minimum
      const discounts = raw.quote.discounts
      if (discounts && typeof discounts === 'object' && !Array.isArray(discounts)) {
        for (const key of Object.keys(settings.quote.discounts)) {
          const value = Number(discounts[key])
          if (Number.isFinite(value)) settings.quote.discounts[key] = clamp(value, 0, 3)
        }
      }
    }
    if (raw.postEdit && typeof raw.postEdit === 'object' && !Array.isArray(raw.postEdit)) {
      settings.postEdit.enabled = raw.postEdit.enabled !== false
    }
    return settings
  } catch {
    return structuredClone(DEFAULT_SETTINGS)
  }
}
