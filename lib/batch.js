/**
 * 批量动作：自由译员最费时间的不是翻译，而是在几百上千句里反复点「确认 / 锁定 /
 * 清空」。这里的每个方法都先在服务端把范围算出来，再一次性改完并只持久化一次，
 * 避免 UI 里循环发几十个 RPC 把状态写乱。
 *
 * 过滤条件刻意做成"语义"而非"SQL"：pending / unconfirmed / risk / duplicate /
 * new / fuzzy / locked / notes，前端只负责渲染，服务端是唯一事实来源。
 */

import { CatError } from './errors.js'
import { classifyLeverage } from './analysis.js'
import { normalizeText } from './similarity.js'

const FILTERS = new Set(['all', 'pending', 'unconfirmed', 'risk', 'duplicate', 'new', 'fuzzy', 'locked', 'notes'])
const MAX_BATCH = 20000

function pickIndexes(indexes, total) {
  if (!Array.isArray(indexes) || !indexes.length) {
    throw new CatError('BATCH_EMPTY', '没有选中任何句段：请先筛选或勾选要处理的句段。', 422)
  }
  const unique = new Set()
  for (const value of indexes) {
    const index = Number(value)
    if (!Number.isInteger(index) || index < 0 || index >= total) continue
    unique.add(index)
  }
  if (!unique.size) throw new CatError('BATCH_EMPTY', '没有选中任何句段：请先筛选或勾选要处理的句段。', 422)
  return [...unique].sort((a, b) => a - b)
}

function qaRiskMap(store, documentId) {
  const map = new Map()
  try {
    const report = store.getQaReport({ documentId })
    for (const issue of report.issues ?? []) {
      const previous = map.get(issue.index)
      const risk = issue.risk === 'high' ? 3 : issue.risk === 'medium' ? 2 : 1
      if (!previous || risk > previous) map.set(issue.index, risk)
    }
  } catch {
    return map
  }
  return map
}

export const batchMethods = {
  /**
   * 服务端筛选：返回命中句段的索引，前端据此高亮与批量操作。
   * 匹配率分档需要 TM 查询，只在 new/fuzzy 两个过滤器下才算。
   */
  batchSelection({ documentId, filter = 'all', limit = MAX_BATCH } = {}) {
    const doc = this.requireDocument(documentId)
    const name = String(filter ?? 'all')
    if (!FILTERS.has(name)) {
      throw new CatError('BATCH_FILTER_UNKNOWN', `未知的筛选条件：${name}。`, 422)
    }
    const cap = Math.min(Math.max(Number(limit) || MAX_BATCH, 1), MAX_BATCH)
    const risk = name === 'risk' ? qaRiskMap(this, doc.id) : null
    const duplicates = new Map()
    if (name === 'duplicate') {
      for (const segment of doc.segments) {
        const key = normalizeText(segment.source)
        if (key) duplicates.set(key, (duplicates.get(key) ?? 0) + 1)
      }
    }
    const indexes = []
    for (let index = 0; index < doc.segments.length; index += 1) {
      const segment = doc.segments[index]
      const target = String(segment.target ?? '').trim()
      let hit = false
      if (name === 'all') hit = true
      else if (name === 'pending') hit = !target
      else if (name === 'unconfirmed') hit = Boolean(target) && segment.status !== 'confirmed'
      else if (name === 'locked') hit = Boolean(segment.locked)
      else if (name === 'notes') hit = Array.isArray(segment.notes) && segment.notes.some((note) => !note.deletedAt)
      else if (name === 'risk') hit = (risk.get(index) ?? 0) >= 2
      else if (name === 'duplicate') {
        const key = normalizeText(segment.source)
        hit = Boolean(key) && (duplicates.get(key) ?? 0) > 1
      } else if (name === 'new' || name === 'fuzzy') {
        if (!segment.source || target) continue
        const result = this.lookupTM({ query: segment.source, threshold: 0.7, limit: 1, documentId: doc.id, index })
        const bucket = classifyLeverage(result.matches[0])
        hit = name === 'new' ? bucket === 'new' : bucket !== 'new'
      }
      if (!hit) continue
      indexes.push(index)
      if (indexes.length >= cap) break
    }
    return { documentId: doc.id, filter: name, total: indexes.length, indexes }
  },

  /** 批量确认：沿用单段确认的语义（写 TM、重置草稿快照）。 */
  batchConfirmSegments({ documentId, indexes, addToTm = true } = {}) {
    const doc = this.requireDocument(documentId)
    const list = pickIndexes(indexes, doc.segments.length)
    let confirmed = 0
    let skipped = 0
    for (const index of list) {
      const segment = doc.segments[index]
      if (!String(segment.target ?? '').trim()) {
        skipped += 1
        continue
      }
      try {
        this.confirmSegment({ documentId: doc.id, index, addToTm })
        confirmed += 1
      } catch {
        skipped += 1
      }
    }
    return { documentId: doc.id, requested: list.length, confirmed, skipped }
  },

  batchSetLocked({ documentId, indexes, locked = true } = {}) {
    const doc = this.requireDocument(documentId)
    const list = pickIndexes(indexes, doc.segments.length)
    const stamp = new Date().toISOString()
    for (const index of list) {
      doc.segments[index].locked = Boolean(locked)
      doc.segments[index].updatedAt = stamp
    }
    this.touch()
    this.persist()
    return { documentId: doc.id, changed: list.length, locked: Boolean(locked) }
  },

  batchClearTargets({ documentId, indexes } = {}) {
    const doc = this.requireDocument(documentId)
    const list = pickIndexes(indexes, doc.segments.length)
    const stamp = new Date().toISOString()
    let cleared = 0
    for (const index of list) {
      const segment = doc.segments[index]
      if (!String(segment.target ?? '').trim() && segment.status === 'pending') continue
      segment.target = ''
      segment.status = 'pending'
      segment.confirmedAt = null
      segment.suggestion = null
      segment.origin = 'manual'
      segment.updatedAt = stamp
      cleared += 1
    }
    this.touch()
    this.persist()
    return { documentId: doc.id, requested: list.length, cleared }
  },
}
