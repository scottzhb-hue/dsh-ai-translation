// Learn a translation preset (the six brief fields) from reference documents.
//
// Two shapes are supported: a bilingual file (source + target columns, e.g. an
// XLSX with two columns or a DOCX whose paragraphs alternate) and a target-only
// file (a finished translation). The result is returned to the client and never
// written here, so the user can review each field before saving.
import { CatError } from './errors.js'
import { BRIEF_FIELDS, BRIEF_LIMITS, cleanBriefValue } from './brief.js'
import { parseDocx } from './docx.js'
import { parseXlsx } from './xlsx.js'
import { collectStreamText } from './mt.js'
import { now } from './text-utils.js'

export const MAX_LEARN_FILES = 3
export const MAX_LEARN_CHARS = 200000
export const MAX_SAMPLE_LINES = 60
export const MAX_SAMPLE_CHARS = 30000
const MAX_LINE_CHARS = 400

const FIELD_HINTS = {
  domain: 'subject area / genre, one short phrase',
  audience: 'who reads the translation and what they already know',
  tone: 'register and voice the translation should use',
  notes: 'other instructions a translator must follow',
  doNotTranslate: 'names, terms, citations that stay in the source language',
  styleSample: 'two or three representative target sentences copied from the reference',
}

function decodeBase64(value) {
  try {
    return Buffer.from(String(value || ''), 'base64')
  } catch {
    throw new CatError('LEARN_FILE_INVALID', '有文件无法读取，请重新选择。', 422)
  }
}

function sampleLines(text) {
  return String(text || '')
    .split(/\n+/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .slice(0, MAX_SAMPLE_LINES)
    .map((line) => line.slice(0, MAX_LINE_CHARS))
}

function extractOne(file) {
  const name = String(file?.name || 'reference').slice(0, 200)
  const lower = name.toLowerCase()
  const buffer = decodeBase64(file?.base64)
  if (lower.endsWith('.xlsx')) {
    const parsed = parseXlsx(buffer)
    const segments = Array.isArray(parsed?.segments) ? parsed.segments : []
    const lines = segments
      .map((segment) => {
        const source = String(segment?.source || '').trim()
        const target = String(segment?.target || '').trim()
        if (source && target) return `${source.slice(0, 200)} => ${target.slice(0, 200)}`
        return (target || source).slice(0, MAX_LINE_CHARS)
      })
      .filter(Boolean)
    return { name, lines: lines.slice(0, MAX_SAMPLE_LINES), bilingual: lines.some((line) => line.includes('=>')) }
  }
  if (lower.endsWith('.docx')) {
    const text = parseDocx(buffer)
    const lines = sampleLines(text)
    return { name, lines, bilingual: false }
  }
  // Plain text / markdown / csv: decode as UTF-8.
  const text = buffer.toString('utf8')
  return { name, lines: sampleLines(text), bilingual: false }
}

function parseFields(output) {
  const raw = String(output || '')
    .replace(/```[a-zA-Z]*/g, '')
    .replace(/```/g, '')
    .trim()
  const start = raw.indexOf('{')
  const end = raw.lastIndexOf('}')
  if (start < 0 || end <= start) {
    throw new CatError('LEARN_EMPTY', 'AI 没有返回可用的归纳结果，请重试或手工填写。', 502)
  }
  let parsed
  try {
    parsed = JSON.parse(raw.slice(start, end + 1))
  } catch {
    throw new CatError('LEARN_EMPTY', 'AI 返回的归纳结果不是有效 JSON，请重试。', 502)
  }
  const fields = {}
  for (const field of BRIEF_FIELDS) {
    const value = parsed?.[field]
    if (typeof value === 'string' && value.trim()) {
      fields[field] = cleanBriefValue(field, value).slice(0, BRIEF_LIMITS[field])
    }
  }
  return fields
}

export const briefLearnMethods = {
  async learnPreset({ files, target = 'doc', documentId, projectId } = {}) {
    const list = Array.isArray(files) ? files : []
    if (!list.length) throw new CatError('LEARN_FILE_REQUIRED', '请先选择参考文档。', 422)
    if (list.length > MAX_LEARN_FILES) {
      throw new CatError('LEARN_TOO_MANY_FILES', `一次最多 ${MAX_LEARN_FILES} 个文档。`, 422)
    }
    const extracted = list.map((file) => extractOne(file))
    const totalChars = extracted.reduce((sum, item) => sum + item.lines.join('\n').length, 0)
    if (totalChars > MAX_LEARN_CHARS) {
      throw new CatError('LEARN_TOO_LARGE', '参考文档内容过多，请分几次或只挑几段。', 422)
    }
    const bilingual = extracted.some((item) => item.bilingual)
    const sample = extracted
      .map((item) => `### ${item.name}\n${item.lines.join('\n')}`)
      .join('\n\n')
      .slice(0, MAX_SAMPLE_CHARS)

    const route = await this.resolveMtRoute()
    if (route.mock) {
      throw new CatError(
        'LEARN_ROUTE_UNAVAILABLE',
        '未配置可用的 DSH 模型路由，暂时无法自动归纳；可以先手工填写预设。',
        503,
      )
    }
    const fieldsSpec = BRIEF_FIELDS.map((field) => `- ${field}: ${FIELD_HINTS[field]}`).join('\n')
    const prompt = [
      bilingual
        ? 'The reference below contains source→target pairs from a translator the user wants to imitate.'
        : 'The reference below is a finished target-language text the user wants to imitate.',
      'Infer a translation preset for future jobs. Answer with ONE JSON object and nothing else.',
      'Use these keys, omit a key when the sample gives no evidence:',
      fieldsSpec,
      'Keep every value short (domain/tone ≤ 120 chars, styleSample ≤ 400 chars). Write the values in Chinese.',
      '',
      'Reference:',
      sample,
    ].join('\n')

    let output = ''
    try {
      const stream = await this.mtRuntime.stream({
        provider: route.provider,
        model: route.model,
        messages: [{ role: 'user', content: [{ type: 'text', text: prompt }] }],
        system: 'You analyse reference translations and summarise their style as a compact translation brief.',
        temperature: 0.2,
        purpose: 'cait-preset-learn',
        signal: AbortSignal.timeout(60000),
      })
      output = await collectStreamText(stream)
    } catch (error) {
      this.logger?.warn?.(`CAIT: preset learning failed provider=${route.provider}: ${error?.message || error}`)
      throw new CatError(
        'LEARN_ROUTE_ERROR',
        `AI 归纳失败（${route.provider} / ${route.model}）：${error?.message || error}`,
        502,
      )
    }

    return {
      target: target === 'project' ? 'project' : 'doc',
      documentId: documentId || null,
      projectId: projectId || null,
      fields: parseFields(output),
      sources: extracted.map((item) => item.name),
      bilingual,
      learnedAt: now(),
      provider: route.provider,
      model: route.model,
    }
  },
}
