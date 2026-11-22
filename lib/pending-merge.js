import { existsSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

/**
 * 一次性批量合并（迁移）入口。
 *
 * 活动文档由 CatStore 常驻内存，外部直接改 store.json 会被下一次 persist 覆盖，
 * 所以批量合并不走"改文件"这条路，而是：
 *   1. 把合并计划写到 `<dataDir>/pending-merge.json`；
 *   2. DSH 下次启动、插件加载、store 完成 load 之后，由这里执行；
 *   3. 每处合并前用 `expectedSuffix` 校验当前段落的源码尾部，对不上就跳过，
 *      避免用户已经手动合并过、索引错位时误合并；
 *   4. 按索引降序执行（前面的索引不会因为后面的合并而移动）；
 *   5. 结果写 `<dataDir>/pending-merge-result.json`，计划文件改名为 `.done-<时间戳>`。
 *
 * 计划格式：
 * {
 *   "documentId": "doc_xxx",
 *   "merges": [{ "index": 60, "count": 2, "expectedSuffix": "as A." }]
 * }
 */
export const PENDING_MERGE_FILENAME = 'pending-merge.json'
export const PENDING_MERGE_RESULT = 'pending-merge-result.json'

// 一个进程只跑一次，避免插件重载时重复执行。
let claimed = false

export function applyPendingMerge(store, logger = null) {
  if (claimed) return null
  claimed = true

  const log = logger ?? store?.logger ?? console
  const dataDir = typeof store?.dataDir === 'string' ? store.dataDir : ''
  if (!dataDir) return null
  const planFile = join(dataDir, PENDING_MERGE_FILENAME)
  if (!existsSync(planFile)) return null

  let plan
  try {
    plan = JSON.parse(readFileSync(planFile, 'utf8'))
  } catch (error) {
    log?.warn?.(`CAIT: 合并计划无法解析，已保留原文件: ${error?.message ?? error}`)
    return null
  }

  const documentId = String(plan?.documentId ?? '').trim()
  const doc = documentId ? (store.docs?.get(documentId) ?? null) : null
  const merges = Array.isArray(plan?.merges) ? plan.merges : []
  const result = {
    at: new Date().toISOString(),
    documentId,
    segmentsBefore: null,
    segmentsAfter: null,
    applied: [],
    skipped: [],
  }

  if (!doc) {
    result.skipped.push({ index: null, reason: 'document-not-found' })
  } else {
    result.segmentsBefore = doc.segments.length
    const ordered = merges
      .filter((entry) => entry && Number.isInteger(entry.index))
      .slice()
      .sort((a, b) => b.index - a.index)

    for (const entry of ordered) {
      const index = entry.index
      const count = Number.isInteger(entry.count) ? entry.count : 2
      const expected = typeof entry.expectedSuffix === 'string' ? entry.expectedSuffix.trim() : ''
      const segment = doc.segments[index]
      if (!segment) {
        result.skipped.push({ index, reason: 'no-segment' })
        continue
      }
      if (expected && !String(segment.source ?? '').trimEnd().endsWith(expected)) {
        result.skipped.push({
          index,
          reason: 'unexpected-source',
          sourceTail: String(segment.source ?? '').slice(-60),
        })
        continue
      }
      if (count < 2 || index + count > doc.segments.length) {
        result.skipped.push({ index, reason: 'range-invalid', count })
        continue
      }
      try {
        const merged = store.mergeSegments({ documentId, index, count, force: false })
        result.applied.push({
          index,
          count,
          source: merged?.segment?.source ?? null,
        })
      } catch (error) {
        result.skipped.push({ index, reason: 'merge-failed', message: String(error?.message ?? error) })
      }
    }

    result.segmentsAfter = doc.segments.length
    try {
      store.flushPersist?.()
    } catch (error) {
      result.persistError = String(error?.message ?? error)
    }
  }

  try {
    writeFileSync(join(dataDir, PENDING_MERGE_RESULT), JSON.stringify(result, null, 2), 'utf8')
    renameSync(planFile, `${planFile}.done-${Date.now()}`)
  } catch (error) {
    log?.warn?.(`CAIT: 合并计划收尾失败: ${error?.message ?? error}`)
  }

  log?.info?.(
    `CAIT: 批量合并完成，合并 ${result.applied.length} 处、跳过 ${result.skipped.length} 处，句段 ${result.segmentsBefore} → ${result.segmentsAfter}。`,
  )
  return result
}
