import fs from 'node:fs'
import path from 'node:path'
import { estimateCost, peakInfo, pricingTable } from './pricing.js'

// Local token accounting for every CAIT model call. CAIT talks to the host
// `llm` service directly, so its calls never reach a DSH session log; this
// ledger keeps the usage the llm stream reports next to the CAIT data dir and
// exposes it as a read-only RPC snapshot for the workbench.
//
// v2 adds estimated cost next to the token counters. Amounts are derived from
// the token split (cache hit vs miss) and the timestamp's peak/off-peak window,
// so they are an estimate, never a billing record.
const VERSION = 2
const FILE_NAME = 'usage.json'
const MAX_RECENT = 40
const MAX_DAYS = 120
const SAVE_DEBOUNCE_MS = 400

function emptyBucket() {
  return {
    requests: 0,
    inputTokens: 0,
    outputTokens: 0,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
    totalTokens: 0,
    costCny: 0,
    costUsd: 0,
  }
}

function toCount(value) {
  const number = Number(value)
  return Number.isFinite(number) && number > 0 ? Math.round(number) : 0
}

function toMoney(value) {
  const number = Number(value)
  // Costs are tiny (a call can be a fraction of a cent); keep 8 decimals so
  // summing many calls does not wipe them out, the UI rounds for display.
  return Number.isFinite(number) && number > 0 ? Math.round(number * 1e8) / 1e8 : 0
}

// DSH llm streams report `{ inputTokens, outputTokens, cacheReadTokens,
// cacheWriteTokens, totalTokens }`; OpenAI-shaped providers may report the
// prompt/completion names instead, so accept both.
export function normalizeUsage(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const inputTokens = toCount(value.inputTokens ?? value.promptTokens ?? value.prompt_tokens)
  const outputTokens = toCount(
    value.outputTokens ?? value.completionTokens ?? value.completion_tokens,
  )
  const cacheReadTokens = toCount(
    value.cacheReadTokens ?? value.cachedTokens ?? value.prompt_tokens_details?.cached_tokens,
  )
  const cacheWriteTokens = toCount(value.cacheWriteTokens)
  const reported = toCount(value.totalTokens ?? value.total_tokens)
  const totalTokens = reported || inputTokens + outputTokens
  if (!totalTokens && !inputTokens && !outputTokens) return null
  return { inputTokens, outputTokens, cacheReadTokens, cacheWriteTokens, totalTokens }
}

function addInto(bucket, usage) {
  bucket.requests += 1
  bucket.inputTokens += usage.inputTokens
  bucket.outputTokens += usage.outputTokens
  bucket.cacheReadTokens += usage.cacheReadTokens
  bucket.cacheWriteTokens += usage.cacheWriteTokens
  bucket.totalTokens += usage.totalTokens
}

function addCost(bucket, cost) {
  if (!cost) return
  bucket.costCny = toMoney(bucket.costCny + cost.cny)
  bucket.costUsd = toMoney(bucket.costUsd + cost.usd)
}

function pad2(value) {
  return String(value).padStart(2, '0')
}

export function dayKey(time) {
  const date = new Date(Number(time) || Date.now())
  if (Number.isNaN(date.getTime())) return ''
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`
}

function routeKey(provider, model) {
  const left = String(provider ?? '').trim() || 'unknown'
  const right = String(model ?? '').trim()
  return right ? `${left}/${right}` : left
}

function purposeKey(purpose) {
  const text = String(purpose ?? '').trim()
  return text || 'unknown'
}

function emptyState() {
  return {
    version: VERSION,
    updatedAt: 0,
    // 费用是从 v2 开始记账的；更早的 token 计数仍在，但不回溯估价，
    // 以免拿今天的价目表去重写历史（峰谷与价格都可能已经变了）。
    costFrom: 0,
    total: emptyBucket(),
    byDay: {},
    byPurpose: {},
    byRoute: {},
    recent: [],
  }
}

function loadState(file) {
  try {
    const raw = fs.readFileSync(file, 'utf8')
    const parsed = JSON.parse(raw)
    if (!parsed || typeof parsed !== 'object') return emptyState()
    const version = Number(parsed.version)
    if (version !== 1 && version !== VERSION) return emptyState()
    const state = emptyState()
    if (parsed.total && typeof parsed.total === 'object') state.total = { ...emptyBucket(), ...parsed.total }
    for (const key of ['byDay', 'byPurpose', 'byRoute']) {
      const group = parsed[key]
      if (!group || typeof group !== 'object') continue
      for (const [name, bucket] of Object.entries(group)) {
        if (bucket && typeof bucket === 'object') state[key][name] = { ...emptyBucket(), ...bucket }
      }
    }
    if (Array.isArray(parsed.recent)) {
      state.recent = parsed.recent.filter((item) => item && typeof item === 'object').slice(0, MAX_RECENT)
    }
    state.updatedAt = toCount(parsed.updatedAt)
    // v1 账本没有费用字段；升级时把起始点钉在升级那一刻。
    state.costFrom = version === VERSION ? toCount(parsed.costFrom) : toCount(parsed.updatedAt) || Date.now()
    return state
  } catch {
    return emptyState()
  }
}

export class CaitUsage {
  constructor({ dataDir } = {}) {
    this.dir = path.resolve(String(dataDir || '.'))
    this.file = path.join(this.dir, FILE_NAME)
    this.state = loadState(this.file)
    this.timer = null
    this.closed = false
  }

  record({ purpose, provider, model, usage } = {}) {
    const tokens = normalizeUsage(usage)
    if (!tokens) return null
    const at = Date.now()
    const cost = estimateCost({ model, usage: tokens, at })
    const state = this.state
    // A ledger created directly at v2 has no upgrade moment to pin, so the
    // first billed call becomes the point where cost tracking started.
    if (!state.costFrom) state.costFrom = at
    state.updatedAt = at
    addInto(state.total, tokens)
    addCost(state.total, cost)

    const day = dayKey(at)
    if (!state.byDay[day]) state.byDay[day] = emptyBucket()
    addInto(state.byDay[day], tokens)
    addCost(state.byDay[day], cost)

    const purposeName = purposeKey(purpose)
    if (!state.byPurpose[purposeName]) state.byPurpose[purposeName] = emptyBucket()
    addInto(state.byPurpose[purposeName], tokens)
    addCost(state.byPurpose[purposeName], cost)

    const route = routeKey(provider, model)
    if (!state.byRoute[route]) state.byRoute[route] = emptyBucket()
    addInto(state.byRoute[route], tokens)
    addCost(state.byRoute[route], cost)

    state.recent.unshift({
      at,
      purpose: purposeName,
      provider: String(provider ?? '') || 'unknown',
      model: String(model ?? '') || 'unknown',
      totalTokens: tokens.totalTokens,
      inputTokens: tokens.inputTokens,
      outputTokens: tokens.outputTokens,
      costCny: cost ? toMoney(cost.cny) : 0,
      costUsd: cost ? toMoney(cost.usd) : 0,
      priced: Boolean(cost),
      peak: cost ? cost.peak : null,
    })
    if (state.recent.length > MAX_RECENT) state.recent.length = MAX_RECENT

    this.pruneDays()
    this.schedule()
    return tokens
  }

  pruneDays() {
    const keys = Object.keys(this.state.byDay).sort()
    if (keys.length <= MAX_DAYS) return
    for (const key of keys.slice(0, keys.length - MAX_DAYS)) delete this.state.byDay[key]
  }

  snapshot() {
    const state = this.state
    const today = dayKey(Date.now())
    return {
      file: this.file,
      updatedAt: state.updatedAt,
      todayKey: today,
      today: state.byDay[today] || emptyBucket(),
      total: { ...state.total },
      byDay: { ...state.byDay },
      byPurpose: { ...state.byPurpose },
      byRoute: { ...state.byRoute },
      recent: state.recent.map((item) => ({ ...item })),
      costFrom: state.costFrom,
      pricing: pricingTable(),
      peakNow: peakInfo(Date.now()),
    }
  }

  schedule() {
    if (this.closed || this.timer) return
    this.timer = setTimeout(() => {
      this.timer = null
      this.flush()
    }, SAVE_DEBOUNCE_MS)
    // A pending token flush must never keep the host process alive.
    this.timer?.unref?.()
  }

  flush() {
    if (this.timer) {
      clearTimeout(this.timer)
      this.timer = null
    }
    if (this.closed) return
    const temporary = `${this.file}.tmp`
    try {
      fs.mkdirSync(this.dir, { recursive: true })
      fs.writeFileSync(temporary, JSON.stringify(this.state))
      fs.renameSync(temporary, this.file)
    } catch {
      // Usage accounting is best-effort: a failed write must not break a
      // translation or chat call.
      try {
        fs.rmSync(temporary, { force: true })
      } catch {
        // ignore
      }
    }
  }

  dispose() {
    this.flush()
    this.closed = true
  }
}
