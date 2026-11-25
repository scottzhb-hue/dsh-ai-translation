import { CatError } from './errors.js'
import { collectStreamText } from './mt.js'
import { BRIEF_FIELDS, briefPromptBlock, cleanBriefValue, normalizeBrief } from './brief.js'
import { now } from './text-utils.js'

/**
 * The project assistant: a bounded chat that sees the document (title, languages,
 * a short sample of the opening segments) and the document brief, and can turn
 * the conversation into a brief the translator may apply.
 *
 * History lives on the document (`doc.aiChat`) so it survives reloads; it is
 * capped so a long conversation can never grow the store without bound.
 */
const MAX_MESSAGES = 30
const MAX_MESSAGE_CHARS = 4000
const MAX_REPLY_CHARS = 8000
const MAX_SAMPLE_SEGMENTS = 3

export function normalizeAiChat(value) {
  if (!Array.isArray(value)) return []
  const list = []
  for (const item of value) {
    const role = item?.role === 'assistant' ? 'assistant' : item?.role === 'user' ? 'user' : ''
    const content = String(item?.content ?? '')
      .replace(/\r\n?/g, '\n')
      .trim()
      .slice(0, MAX_REPLY_CHARS)
    if (!role || !content) continue
    const entry = { role, content, at: typeof item?.at === 'string' ? item.at.slice(0, 40) : '' }
    if (role === 'assistant') {
      const provider = typeof item?.provider === 'string' ? item.provider.trim().slice(0, 80) : ''
      const model = typeof item?.model === 'string' ? item.model.trim().slice(0, 80) : ''
      if (provider) entry.provider = provider
      if (model) entry.model = model
    }
    list.push(entry)
  }
  return list.slice(-MAX_MESSAGES)
}

function documentContext(doc) {
  const total = doc.segments.length
  const lines = [
    `Document: ${doc.name}`,
    `Languages: ${doc.sourceLang} -> ${doc.targetLang}`,
    `Segments: ${total}`,
  ]
  if (doc.format) lines.push(`Format: ${doc.format}`)
  const sample = doc.segments
    .slice(0, MAX_SAMPLE_SEGMENTS)
    .map((segment, index) => `[${index + 1}] ${String(segment.source || '').slice(0, 300)}`)
    .filter((line) => line.trim().length > 4)
  if (sample.length) lines.push(`Opening segments:\n${sample.join('\n')}`)
  const progress = doc.progress
  if (progress && Number(progress.total) > 0) {
    lines.push(
      `Progress: ${Number(progress.confirmed) || 0} confirmed, ${Number(progress.translated) || 0} translated of ${progress.total}`,
    )
  }
  return lines.join('\n')
}

function systemPrompt(doc, mode, effectiveBrief) {
  const parts = [
    'You are the project assistant inside CAIT, a professional computer-aided translation workbench.',
    'The user is the translator working on the document described below.',
    'Answer in the language the user writes in. Keep answers short, concrete and actionable.',
    'You can propose terminology, style rules and translation decisions, but you cannot edit the document yourself and you never invent facts about it.',
    '',
    documentContext(doc),
  ]
  const brief = briefPromptBlock(effectiveBrief ?? doc.brief)
  if (brief) parts.push('', brief.trim())
  if (mode === 'brief') {
    parts.push(
      '',
      'Task: turn this conversation into a compact translation brief for the project.',
      'Reply with exactly one JSON object and nothing else:',
      '{"reply":"one short sentence for the user","brief":{"domain":"","audience":"","tone":"","notes":"","doNotTranslate":"","styleSample":""}}',
      'Fill only the fields the user actually stated and use "" for the rest.',
      '`notes` holds the working rules (terminology, phrasing, numbers, formatting).',
      'Write the brief values in the document target language.',
    )
  }
  return parts.join('\n')
}

/** The brief mode answer is JSON; keep the reply text if the JSON is unusable. */
function parseBriefReply(text) {
  const clean = String(text ?? '')
    .replace(/```(?:json)?/gi, '')
    .trim()
  const start = clean.indexOf('{')
  const end = clean.lastIndexOf('}')
  if (start < 0 || end <= start) return null
  let parsed
  try {
    parsed = JSON.parse(clean.slice(start, end + 1))
  } catch {
    return null
  }
  const source = parsed?.brief && typeof parsed.brief === 'object' ? parsed.brief : {}
  const brief = {}
  for (const field of BRIEF_FIELDS) {
    const value = cleanBriefValue(field, source[field])
    if (value) brief[field] = value
  }
  return {
    reply: String(parsed?.reply ?? '')
      .trim()
      .slice(0, 2000),
    brief: normalizeBrief(brief),
  }
}

const BRIEF_ONLY_PROMPT = '请把我们上面的对话整理成项目说明，只输出约定的 JSON。'

/**
 * One history entry to one DSH message value. DSH projects assistant messages
 * through `source` (it reads `source.replayState`), so every assistant message
 * carries the provider and model that produced it; user messages need none.
 */
function toModelMessage(entry, route) {
  const content = [{ type: 'text', text: entry.content }]
  if (entry.role !== 'assistant') return { role: 'user', content }
  return {
    role: 'assistant',
    content,
    source: {
      kind: 'model',
      provider: entry.provider || route.provider,
      model: entry.model || route.model,
    },
  }
}

/**
 * Assert the shape DSH expects before dispatch. That projection has changed
 * before, and a wrong shape surfaces as a raw TypeError from deep inside the
 * adapter; checking here keeps the failure named and the message recoverable.
 */
function assertModelMessages(messages, route) {
  if (!Array.isArray(messages) || messages.length === 0) {
    throw new CatError('AI_MESSAGE_INVALID', 'AI 助手没有可发送的对话内容。', 500)
  }
  for (const message of messages) {
    if (message?.role !== 'user' && message?.role !== 'assistant') {
      throw new CatError('AI_MESSAGE_INVALID', `AI 对话消息角色不合法：${String(message?.role)}`, 500)
    }
    const parts = message.content
    if (!Array.isArray(parts) || parts.length === 0 || typeof parts[0]?.text !== 'string') {
      throw new CatError('AI_MESSAGE_INVALID', 'AI 对话消息缺少文本内容。', 500)
    }
    if (message.role !== 'assistant') continue
    const source = message.source
    if (source?.kind !== 'model' || !source.provider || !source.model) {
      throw new CatError(
        'AI_MESSAGE_INVALID',
        `AI 对话里的模型回复缺少来源标记（provider/model），已阻止发送。请清空对话后重试（当前路由 ${route?.provider || '?'} / ${route?.model || '?'}）。`,
        500,
      )
    }
  }
}

export const aiChatMethods = {
  aiChatState({ documentId } = {}) {
    const doc = this.requireDocument(documentId)
    return {
      documentId: doc.id,
      messages: normalizeAiChat(doc.aiChat),
      brief: this.briefForDocument(doc),
      documentBrief: doc.brief ? { ...doc.brief } : null,
      projectId: this.projectForDocument(doc)?.id ?? '',
    }
  },

  async aiChat({ documentId, message, mode = 'chat' } = {}) {
    const doc = this.requireDocument(documentId)
    const input = String(message ?? '')
      .replace(/\r\n?/g, '\n')
      .trim()
      .slice(0, MAX_MESSAGE_CHARS)
    const briefMode = mode === 'brief'
    const history = normalizeAiChat(doc.aiChat)
    // A brief request without new input means "turn the conversation above into
    // a project brief": it must not forge an extra user turn in the transcript.
    if (!input && !(briefMode && history.length)) {
      throw new CatError('EMPTY_MESSAGE', '请先输入要告诉 AI 的内容。')
    }

    // Resolve the route before touching the history: a failed call must not
    // leave a dangling user turn in the transcript.
    const route = await this.resolveMtRoute()
    if (route.mock) {
      throw new CatError(
        'AI_ROUTE_UNAVAILABLE',
        '未配置可用的 DSH 模型路由，AI 助手暂不可用；请先在设置里选择 MT 模型路由。',
        503,
      )
    }
    if (typeof this.mtRuntime?.stream !== 'function') {
      throw new CatError(
        'AI_ROUTE_UNAVAILABLE',
        'AI 助手不可用：DSH 模型路由运行时未就绪，请重启 DSH 后重试。',
        503,
      )
    }

    const messages = history.map((item) => toModelMessage(item, route))
    messages.push({ role: 'user', content: [{ type: 'text', text: input || BRIEF_ONLY_PROMPT }] })
    assertModelMessages(messages, route)

    let output
    try {
      const stream = await this.mtRuntime.stream({
        provider: route.provider,
        model: route.model,
        messages,
        system: systemPrompt(doc, briefMode ? 'brief' : 'chat', this.briefForDocument(doc)),
        temperature: 0.3,
        purpose: 'cait-chat',
        signal: AbortSignal.timeout(60000),
      })
      output = await collectStreamText(stream)
    } catch (error) {
      this.logger?.warn?.(
        `CAIT: AI 助手调用失败 provider=${route.provider} model=${route.model}: ${error?.message || error}`,
      )
      throw new CatError(
        'AI_ROUTE_ERROR',
        `AI 助手调用失败（${route.provider} / ${route.model}）：${
          error?.message || error?.code || String(error)
        }`,
        502,
      )
    }

    const raw = String(output ?? '')
      .trim()
      .slice(0, MAX_REPLY_CHARS)
    if (!raw) throw new CatError('AI_EMPTY', 'AI 没有返回内容，请重试。', 502)

    const parsed = briefMode ? parseBriefReply(raw) : null
    const shown = parsed?.reply || raw
    const next = normalizeAiChat([
      ...history,
      ...(input ? [{ role: 'user', content: input, at: now() }] : []),
      {
        role: 'assistant',
        content: shown,
        at: now(),
        provider: route.provider,
        model: route.model,
      },
    ])
    doc.aiChat = next
    this.touch()
    this.persist()

    return {
      documentId: doc.id,
      reply: shown,
      raw,
      brief: parsed?.brief ?? null,
      messages: next,
      provider: route.provider,
      model: route.model,
    }
  },

  clearAiChat({ documentId } = {}) {
    const doc = this.requireDocument(documentId)
    delete doc.aiChat
    this.touch()
    this.persist()
    return { documentId: doc.id, messages: [] }
  },
}
