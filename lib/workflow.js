/**
 * 项目/批次与「译后编辑投入」。
 *
 * 自由译员常见的工作单位不是单篇文档，而是「某个客户这一批 6 个文件」：
 * 共享 brief、共享术语库，最后一起交付、一起结算。这里只做最小闭环——
 * 给文档打 client/batch 标签，再按标签汇总进度与字数，不做独立的作业数据库。
 *
 * postEdit 则记录「MT 建议发出后译员改了多少」：keepRatio 越接近 1，说明机器
 * 建议越可用，也就能回答"这个客户到底该不该用 MT"。
 */

import { CatError } from './errors.js'
import { classifyLeverage } from './analysis.js'
import { countWords } from './text-utils.js'

const MAX_LABEL = 80

function cleanLabel(value) {
  return String(value ?? '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, MAX_LABEL)
}

export const workflowMethods = {
  setDocumentBatch({ documentId, client, batch } = {}) {
    const doc = this.requireDocument(documentId)
    doc.client = client === undefined ? doc.client ?? '' : cleanLabel(client)
    doc.batch = batch === undefined ? doc.batch ?? '' : cleanLabel(batch)
    doc.updatedAt = new Date().toISOString()
    this.touch()
    this.persist()
    return { documentId: doc.id, client: doc.client ?? '', batch: doc.batch ?? '' }
  },

  /** 按 client/batch 汇总：同一批里的文档进度、字数与匹配率。 */
  batchSummary({ batch = '', client = '' } = {}) {
    const wantBatch = cleanLabel(batch)
    const wantClient = cleanLabel(client)
    const docs = [...this.docs.values()].filter((doc) => {
      const docBatch = String(doc.batch ?? '')
      const docClient = String(doc.client ?? '')
      if (wantBatch && docBatch !== wantBatch) return false
      if (wantClient && docClient !== wantClient) return false
      if (!wantBatch && !wantClient) return Boolean(docBatch || docClient)
      return true
    })
    const rows = docs.map((doc) => {
      const total = doc.segments.length
      const translated = doc.segments.filter((segment) => String(segment.target ?? '').trim()).length
      const confirmed = doc.segments.filter((segment) => segment.status === 'confirmed').length
      const words = doc.segments.reduce((sum, segment) => sum + countWords(String(segment.source ?? '')), 0)
      return {
        id: doc.id,
        title: doc.name,
        client: doc.client ?? '',
        batch: doc.batch ?? '',
        segments: total,
        words,
        translated,
        confirmed,
        percent: total ? Math.round((confirmed / total) * 1000) / 10 : 0,
      }
    })
    return {
      batch: wantBatch,
      client: wantClient,
      documents: rows,
      totals: rows.reduce(
        (sum, row) => ({
          documents: sum.documents + 1,
          segments: sum.segments + row.segments,
          words: sum.words + row.words,
          translated: sum.translated + row.translated,
          confirmed: sum.confirmed + row.confirmed,
        }),
        { documents: 0, segments: 0, words: 0, translated: 0, confirmed: 0 },
      ),
    }
  },

  /** 记录一次确认时的「保留率」：建议被改动得越少，机器贡献越大。 */
  recordPostEdit(doc, index, keepRatio) {
    const segment = doc.segments[index]
    if (!segment || !Number.isFinite(keepRatio)) return
    const ratio = Math.min(Math.max(keepRatio, 0), 1)
    segment.postEdit = {
      keepRatio: Math.round(ratio * 1000) / 1000,
      at: new Date().toISOString(),
      suggestion: String(segment.suggestion ?? '').slice(0, 4000),
    }
  },

  postEditStats({ documentId } = {}) {
    const doc = this.requireDocument(documentId)
    const items = []
    let sum = 0
    let buckets = { full: 0, highKeep: 0, mediumKeep: 0, lowKeep: 0 }
    for (let index = 0; index < doc.segments.length; index += 1) {
      const post = doc.segments[index].postEdit
      if (!post || !Number.isFinite(post.keepRatio)) continue
      sum += post.keepRatio
      if (post.keepRatio >= 0.95) buckets.full += 1
      else if (post.keepRatio >= 0.8) buckets.highKeep += 1
      else if (post.keepRatio >= 0.5) buckets.mediumKeep += 1
      else buckets.lowKeep += 1
      items.push({ index, keepRatio: post.keepRatio })
    }
    items.sort((left, right) => left.keepRatio - right.keepRatio)
    return {
      documentId: doc.id,
      entries: items.length,
      averageKeep: items.length ? Math.round((sum / items.length) * 1000) / 1000 : 0,
      buckets,
      lowest: items.slice(0, 50),
      enabled: this.settings.postEdit?.enabled !== false,
    }
  },

  /** 单文档的「成本与产出」快照：分析、报价、译后编辑放一屏。 */
  workloadSnapshot({ documentId } = {}) {
    const doc = this.requireDocument(documentId)
    const analysis = this.analyzeDocument({ documentId: doc.id })
    const buckets = analysis.buckets ?? {}
    const total = analysis.segments ?? doc.segments.length
    return {
      documentId: doc.id,
      title: doc.name,
      client: doc.client ?? '',
      batch: doc.batch ?? '',
      segments: total,
      words: analysis.words ?? 0,
      characters: analysis.characters ?? 0,
      buckets,
      leverage: analysis.leverage ?? {},
      topBucket: Object.keys(buckets).sort((a, b) => buckets[b] - buckets[a])[0] ?? 'new',
    }
  },

  /** 按匹配档位给出「该不该重跑 MT」的建议：新句段多才值得批量跑。 */
  batchAdvice({ documentId } = {}) {
    const doc = this.requireDocument(documentId)
    const pending = []
    const counts = { pending: 0, ice: 0, exact: 0, fuzzy85: 0, fuzzy70: 0, new: 0 }
    for (let index = 0; index < doc.segments.length; index += 1) {
      const segment = doc.segments[index]
      if (String(segment.target ?? '').trim()) continue
      counts.pending += 1
      if (!segment.source) continue
      const result = this.lookupTM({ query: segment.source, threshold: 0.7, limit: 1, documentId: doc.id, index })
      const bucket = classifyLeverage(result.matches[0])
      counts[bucket] += 1
      if (bucket === 'new' && pending.length < 2000) pending.push(index)
    }
    if (!counts.pending) {
      return { documentId: doc.id, pending: 0, counts, recommended: 0, indexes: [], message: '所有句段都已有译文。' }
    }
    return {
      documentId: doc.id,
      pending: counts.pending,
      counts,
      recommended: pending.length,
      indexes: pending,
      message: `待译 ${counts.pending} 段，其中新句段 ${counts.new} 段适合直接跑 MT，其余 ${counts.ice + counts.exact + counts.fuzzy85 + counts.fuzzy70} 段更适合先看复用建议。`,
    }
  },
}

export function assertBatchLabel(value) {
  const label = cleanLabel(value)
  if (label.length > MAX_LABEL) throw new CatError('BATCH_LABEL_TOO_LONG', '项目/批次名称过长。', 422)
  return label
}
