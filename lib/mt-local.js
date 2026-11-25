/**
 * 本地 MT 端点：任意 OpenAI 兼容的 `POST {baseUrl}/chat/completions`。
 *
 * 为什么值得单独做一层：译员在有保密要求或离线场景下，会跑 LM Studio / Ollama /
 * vLLM；把这一类端点接进工作台，就不必先给 DSH 配一个云端路由。Key 存在
 * `<dataDir>/mt-local.json`（0600 语义，不落 store.json、不进会话记录），
 * 其余非敏感配置写进 settings 以便随项目设置一起备份。
 */

import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { CatError } from './errors.js'
import { cleanText, now } from './text-utils.js'

const SECRET_FILE = 'mt-local.json'
const MAX_REPLY_CHARS = 8000
const DEFAULT_TIMEOUT_MS = 60000

function normalizeBaseUrl(value) {
  const text = String(value ?? '').trim()
  if (!text) return ''
  return text.replace(/\/+$/, '')
}

export const mtLocalMethods = {
  mtLocalSecretFile() {
    if (!this.dataDir) return ''
    return join(this.dataDir, SECRET_FILE)
  },

  readMtLocalSecret() {
    const file = this.mtLocalSecretFile()
    if (!file) return ''
    try {
      const raw = JSON.parse(readFileSync(file, 'utf8'))
      return typeof raw?.apiKey === 'string' ? raw.apiKey : ''
    } catch {
      return ''
    }
  },

  writeMtLocalSecret(apiKey) {
    const file = this.mtLocalSecretFile()
    if (!file) return
    const value = String(apiKey ?? '').trim()
    if (!value) {
      try {
        rmSync(file, { force: true })
      } catch {
        /* 删不掉就算了，下次覆盖即可 */
      }
      return
    }
    mkdirSync(dirname(file), { recursive: true })
    writeFileSync(file, `${JSON.stringify({ apiKey: value, updatedAt: now() }, null, 2)}\n`, 'utf8')
  },

  mtLocalState() {
    const config = this.settings.mtLocal ?? {}
    return {
      enabled: Boolean(config.enabled),
      baseUrl: String(config.baseUrl ?? ''),
      model: String(config.model ?? ''),
      hasKey: Boolean(this.readMtLocalSecret()),
      timeoutMs: Number(config.timeoutMs) || DEFAULT_TIMEOUT_MS,
    }
  },

  setMtLocal({ enabled, baseUrl, model, apiKey, timeoutMs } = {}) {
    const state = this.settings.mtLocal ?? {}
    const next = {
      enabled: enabled === undefined ? Boolean(state.enabled) : Boolean(enabled),
      baseUrl: baseUrl === undefined ? String(state.baseUrl ?? '') : normalizeBaseUrl(baseUrl).slice(0, 500),
      model: model === undefined ? String(state.model ?? '') : String(model).trim().slice(0, 120),
      timeoutMs:
        timeoutMs === undefined
          ? Number(state.timeoutMs) || DEFAULT_TIMEOUT_MS
          : Math.min(Math.max(Number(timeoutMs) || DEFAULT_TIMEOUT_MS, 5000), 300000),
    }
    if (next.enabled && (!next.baseUrl || !next.model)) {
      throw new CatError('MT_LOCAL_INCOMPLETE', '启用本地 MT 需要同时填写端点地址与模型名。', 422)
    }
    if (apiKey !== undefined) this.writeMtLocalSecret(apiKey)
    this.settings.mtLocal = next
    this.touch()
    this.persist()
    return this.mtLocalState()
  },

  async mtLocalChat({ system, prompt, timeoutMs } = {}) {
    const state = this.mtLocalState()
    if (!state.baseUrl || !state.model) {
      throw new CatError('MT_LOCAL_INCOMPLETE', '本地 MT 尚未配置端点地址或模型名。', 422)
    }
    const key = this.readMtLocalSecret()
    const body = {
      model: state.model,
      messages: [
        ...(String(system ?? '').trim() ? [{ role: 'system', content: String(system) }] : []),
        { role: 'user', content: String(prompt ?? '') },
      ],
      temperature: 0.2,
      stream: false,
    }
    const headers = { 'content-type': 'application/json' }
    if (key) headers.authorization = `Bearer ${key}`
    let response
    try {
      response = await fetch(`${state.baseUrl}/chat/completions`, {
        method: 'POST',
        headers,
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(Math.min(Math.max(Number(timeoutMs) || state.timeoutMs, 5000), 300000)),
      })
    } catch (error) {
      throw new CatError(
        'MT_LOCAL_FAILED',
        `本地 MT 连不上（${state.baseUrl}）：${error?.message || error}`,
        502,
      )
    }
    const text = await response.text()
    if (!response.ok) {
      throw new CatError(
        'MT_LOCAL_FAILED',
        `本地 MT 返回 HTTP ${response.status}（${state.baseUrl}）：${text.slice(0, 300)}`,
        502,
      )
    }
    let payload
    try {
      payload = JSON.parse(text)
    } catch {
      throw new CatError('MT_LOCAL_FAILED', `本地 MT 返回的不是 JSON（${state.baseUrl}）。`, 502)
    }
    const content = payload?.choices?.[0]?.message?.content
    const reply = Array.isArray(content)
      ? content.map((part) => (typeof part === 'string' ? part : part?.text ?? '')).join('')
      : String(content ?? '')
    return cleanText(reply.slice(0, MAX_REPLY_CHARS), '本地 MT 译文')
  },

  async mtLocalTest() {
    const started = Date.now()
    const text = await this.mtLocalChat({
      system: 'Reply with the single word OK.',
      prompt: 'ping',
      timeoutMs: 20000,
    })
    return { ok: true, latencyMs: Date.now() - started, model: this.mtLocalState().model, reply: text.slice(0, 120) }
  },
}
