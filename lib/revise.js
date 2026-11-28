import { CatError } from './errors.js'
import { briefPromptBlock } from './brief.js'
import { canonicalLanguage } from './lang.js'
import { clampInt } from './similarity.js'
import { collectStreamText } from './mt.js'
import { cleanText, now } from './text-utils.js'

const MAX_REVISE_CHARS = 4000
const MAX_SOURCE_CHARS = 4000
const MAX_CONTEXT = 5
const DEFAULT_CONTEXT = 3
const MAX_GLOSSARY = 12

/**
 * AI 重译：把当前句段重新翻一遍，输入比预翻译多了三样东西——
 * 前 N 条已经有译文的句段（原文 + 译文，保证语气连贯）、项目/文档 brief、
 * 以及该句段命中的术语库。结果单独存在 `segment.revise` 里，
 * 不覆盖 `segment.suggestion`（那是预翻译底稿），两边可以对照着看。
 */
function contextLines(doc, index, count) {
  const lines = []
  for (let cursor = index - 1; cursor >= 0 && lines.length < count; cursor -= 1) {
    const item = doc.segments[cursor]
    if (!item || !String(item.target ?? '').trim()) continue
    lines.unshift(
      `${String(item.source).slice(0, 600)} => ${String(item.target).slice(0, 600)}`,
    )
  }
  return lines
}

export const reviseMethods = {
  async reviseSegment({ documentId, index, before = null } = {}) {
    const doc = this.requireDocument(documentId)
    const at = Number(index)
    const segment = this.findSegment(doc, at)
    const source = cleanText(segment.source, '原文').slice(0, MAX_SOURCE_CHARS)
    if (!source) {
      throw new CatError('REVISE_EMPTY_SOURCE', '当前句段没有原文，无法重译。', 422)
    }
    const count = clampInt(
      before ?? this.settings.reviewContext ?? DEFAULT_CONTEXT,
      0,
      MAX_CONTEXT,
      DEFAULT_CONTEXT,
    )
    const previous = contextLines(doc, index, count)
    const hits = this.findGlossaryHits(segment.source, doc.sourceLang, doc.id).slice(
      0,
      MAX_GLOSSARY,
    )
    const terms = hits.map(
      (hit) =>
        `- ${hit.term} => ${hit.target}${hit.forbidden ? ' (forbidden)' : ''}${
          hit.preferred ? ' (preferred)' : ''
        }`,
    )
    const src = canonicalLanguage(doc.sourceLang)
    const tgt = canonicalLanguage(doc.targetLang)
    const prompt = [
      `Translate ONE segment from ${src} to ${tgt}. This is a re-translation: aim for a publishable target text, not a literal rendering.`,
      'Return only the translated text. No quotes, no explanations, no segment numbers.',
      briefPromptBlock(this.briefForDocument(doc)),
      previous.length
        ? `Previous translated segments (source => target, for tone and terminology continuity):\n${previous.join('\n')}`
        : '',
      terms.length ? `Glossary terms in this segment:\n${terms.join('\n')}` : '',
      `Source: ${source}`,
    ]
      .filter((part) => String(part ?? '').trim())
      .join('\n\n')
    const systemText =
      'You are a professional translator. Produce one fluent, accurate translation in the target language, following the brief and the glossary, and staying consistent with the previous segments.'

    const started = Date.now()
    const local = this.mtLocalState?.() ?? { enabled: false }
    let text = ''
    let provider = 'local'
    let model = local.model || ''
    if (local.enabled && local.baseUrl && local.model) {
      text = await this.mtLocalChat({ system: systemText, prompt })
      if (!text) {
        throw new CatError(
          'REVISE_EMPTY',
          `本地 MT 没有返回译文（${local.baseUrl} / ${local.model}）。`,
          502,
        )
      }
    } else {
      const route = await this.resolveMtRoute()
      if (route.mock) {
        throw new CatError(
          'REVISE_UNAVAILABLE',
          'AI 重译需要可用的 DSH 模型路由；当前只有离线术语替换。',
          409,
        )
      }
      provider = route.provider
      model = route.model
      try {
        const stream = await this.mtRuntime.stream({
          provider,
          model,
          messages: [{ role: 'user', content: [{ type: 'text', text: prompt }] }],
          system: systemText,
          temperature: this.settings.mt?.temperature ?? 0.2,
          purpose: 'cait-revise',
          signal: AbortSignal.timeout(60000),
        })
        text = await collectStreamText(stream)
      } catch (error) {
        this.logger?.warn?.(
          `CAIT: revise failed provider=${provider} model=${model}: ${error?.message || error}`,
        )
        throw new CatError(
          'REVISE_ROUTE_ERROR',
          `AI 重译调用失败（${provider} / ${model}）：${error?.message || error?.code || String(error)}`,
          502,
        )
      }
      if (!text) {
        throw new CatError('REVISE_EMPTY', '模型没有返回译文。', 502)
      }
    }
    const cleaned = cleanText(
      String(text)
        .replace(/^```[a-z]*\s*/i, '')
        .replace(/```$/, '')
        .replace(/^["'「]+|["'」]+$/g, ''),
      '译文',
    ).slice(0, MAX_REVISE_CHARS)
    if (!cleaned) throw new CatError('REVISE_EMPTY', '模型没有返回译文。', 502)
    const stamp = now()
    segment.revise = { text: cleaned, at: stamp, provider, model, before: previous.length }
    this.touch()
    this.schedulePersist?.()
    return {
      documentId: doc.id,
      index: at,
      revise: { ...segment.revise },
      provider,
      model,
      context: { before: previous.length, glossary: hits.length },
      latencyMs: Date.now() - started,
    }
  },

  clearRevise({ documentId, index } = {}) {
    const doc = this.requireDocument(documentId)
    const at = Number(index)
    const segment = this.findSegment(doc, at)
    delete segment.revise
    this.touch()
    this.schedulePersist?.()
    return { documentId: doc.id, index: at, revise: null }
  },
}

export { MAX_REVISE_CHARS, MAX_CONTEXT }
