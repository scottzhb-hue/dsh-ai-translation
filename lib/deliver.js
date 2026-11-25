/**
 * 交付（delivery）：一个自由译员按下「交付」之前最想知道两件事——
 * 1) 这份稿子还有没有会让客户退回来的问题（空译、未确认、缺占位符、数字不一致……）；
 * 2) 我能不能一次性把这批东西打包发出去（目标稿、双语稿、术语表、质检、分析、说明）。
 *
 * 检查项分三档：high 会直接导致返工（空译/标签丢失/禁用术语），medium 需要复核
 * （数字不一致、源文照抄、未确认），low 只是提示（未确认数量、超长句段）。
 * 交付包不阻断导出，只在界面里用颜色区分，避免替译员做决定。
 */

import { CatError } from './errors.js'
import { CAIT_VERSION } from './limits.js'
import { exportFormat } from './export-document.js'
import { glossaryToCsv } from './library-export.js'
import { csvCell, safeBaseName, now } from './text-utils.js'
import { createZip } from './zip.js'

const MAX_ITEMS = 300
const RISK_ORDER = { high: 0, medium: 1, low: 2 }

function hasLatin(text) {
  return /[A-Za-z]{2}/.test(text)
}

function trimValue(value) {
  return String(value ?? '').trim()
}

function issueKey(issue) {
  return `${issue.index}:${issue.code}`
}

function noteCount(segment) {
  return Array.isArray(segment.notes) ? segment.notes.filter((note) => !note.deletedAt).length : 0
}

export const deliverMethods = {
  deliveryChecks({ documentId } = {}) {
    const doc = this.requireDocument(documentId)
    const items = []
    const counts = { high: 0, medium: 0, low: 0 }
    const byCode = new Map()
    const push = (index, code, severity, message) => {
      counts[severity] += 1
      byCode.set(code, (byCode.get(code) ?? 0) + 1)
      if (items.length < MAX_ITEMS) items.push({ index, code, severity, message })
    }

    let untranslated = 0
    let unconfirmed = 0

    for (let index = 0; index < doc.segments.length; index += 1) {
      const segment = doc.segments[index]
      const target = trimValue(segment.target)
      if (!target) {
        if (segment.status === 'pending') {
          untranslated += 1
          continue
        }
        push(index, 'EMPTY_TARGET', 'high', '句段标为已翻译/已确认，但译文为空。')
        continue
      }
      if (segment.status !== 'confirmed') {
        unconfirmed += 1
        if (items.length < MAX_ITEMS) {
          items.push({ index, code: 'UNCONFIRMED', severity: 'low', message: '有译文但尚未确认。' })
        }
        counts.low += 1
        byCode.set('UNCONFIRMED', (byCode.get('UNCONFIRMED') ?? 0) + 1)
      }
      if (hasLatin(target) && target === trimValue(segment.source) && doc.sourceLang !== doc.targetLang) {
        push(index, 'SOURCE_EQUAL_TARGET', 'medium', '译文与原文完全相同，疑似漏译。')
      }
      if (noteCount(segment) > 0) {
        push(index, 'NOTE_OPEN', 'low', '该句段仍有批注未处理。')
      }
    }

    // 规则质检给出的高危项优先展示，低危项只计数（避免淹没真正要修的地方）。
    let qa = { issues: [], checked: 0 }
    try {
      qa = this.getQaReport({ documentId })
    } catch {
      qa = { issues: [], checked: 0 }
    }
    const seen = new Set(items.map(issueKey))
    for (const issue of qa.issues ?? []) {
      const severity = issue.risk === 'high' ? 'high' : issue.risk === 'medium' ? 'medium' : 'low'
      const key = issueKey(issue)
      if (seen.has(key)) continue
      seen.add(key)
      push(issue.index ?? 0, issue.code ?? 'QA', severity, issue.message ?? '质检问题')
    }

    items.sort((left, right) => {
      const risk = (RISK_ORDER[left.severity] ?? 9) - (RISK_ORDER[right.severity] ?? 9)
      return risk || left.index - right.index
    })

    return {
      documentId: doc.id,
      title: doc.name,
      sourceLang: doc.sourceLang,
      targetLang: doc.targetLang,
      total: doc.segments.length,
      translated: doc.segments.filter((segment) => trimValue(segment.target)).length,
      confirmed: doc.segments.filter((segment) => segment.status === 'confirmed').length,
      untranslated,
      unconfirmed,
      counts,
      byCode: [...byCode.entries()].map(([code, count]) => ({ code, count })).sort((a, b) => b.count - a.count),
      checked: qa.checked ?? 0,
      items,
      truncated: counts.high + counts.medium + counts.low > items.length,
      ok: counts.high === 0,
    }
  },

  exportDelivery({ documentId, include = {} } = {}) {
    const doc = this.requireDocument(documentId)
    const checks = this.deliveryChecks({ documentId })
    const want = {
      target: include.target !== false,
      bilingual: include.bilingual !== false,
      glossary: include.glossary !== false,
      qa: include.qa !== false,
      analysis: include.analysis !== false,
      notes: include.notes !== false,
      readme: include.readme !== false,
    }
    const entries = []
    const skipped = []
    const base = safeBaseName(doc.name) || 'translation'
    const targetTag = String(doc.targetLang || 'target').replace(/[^\w-]+/g, '')

    const add = (name, data) => {
      if (!data) return
      entries.push({ name, data })
    }

    const tryExport = (format, name) => {
      try {
        const file = exportFormat(this, doc, format)
        if (file?.content) add(name ?? file.filename, file.content)
      } catch (error) {
        skipped.push(`${format}: ${error?.message ?? error}`)
      }
    }

    if (want.target) tryExport('docx', `${base}.${targetTag}.docx`)
    if (want.bilingual) tryExport('bilingual-docx', `${base}.${targetTag}.bilingual.docx`)

    if (want.glossary) {
      const mounted = new Set(this.effectiveGlossaryIds(doc))
      const rows = this.glossary.filter((entry) => mounted.has(entry.glossaryId || 'default'))
      if (rows.length) add(`${base}.glossary.csv`, glossaryToCsv(rows))
    }

    if (want.qa) {
      const lines = ['index,code,severity,message']
      for (const item of checks.items) {
        lines.push([item.index + 1, csvCell(item.code), csvCell(item.severity), csvCell(item.message)].join(','))
      }
      add(`${base}.qa.csv`, `${lines.join('\n')}\n`)
    }

    if (want.analysis) {
      try {
        const report = this.analyzeDocument({ documentId: doc.id })
        const lines = ['metric,value']
        const rows = [
          ['segments', report.segments ?? checks.total],
          ['words', report.words ?? ''],
          ['characters', report.characters ?? ''],
          ['translated', report.translated ?? checks.translated],
          ['confirmed', report.confirmed ?? checks.confirmed],
          ['duplicates', report.duplicates ?? ''],
          ['ice', report.buckets?.ice ?? ''],
          ['exact', report.buckets?.exact ?? ''],
          ['fuzzy85', report.buckets?.fuzzy85 ?? ''],
          ['fuzzy70', report.buckets?.fuzzy70 ?? ''],
          ['new', report.buckets?.new ?? ''],
          ['weighted', report.leverage?.weighted ?? ''],
        ]
        for (const [key, value] of rows) lines.push(`${key},${csvCell(value)}`)
        add(`${base}.analysis.csv`, `${lines.join('\n')}\n`)
      } catch (error) {
        skipped.push(`analysis: ${error?.message ?? error}`)
      }
    }

    if (want.notes) {
      const lines = []
      for (let index = 0; index < doc.segments.length; index += 1) {
        const notes = Array.isArray(doc.segments[index].notes) ? doc.segments[index].notes : []
        for (const note of notes) {
          if (note.deletedAt) continue
          lines.push(`## 句段 ${index + 1}`)
          lines.push(`- ${note.body ?? note.text ?? ''}`)
          lines.push('')
        }
      }
      if (lines.length) add(`${base}.notes.md`, `# 批注汇总\n\n${lines.join('\n')}`)
    }

    if (want.readme) {
      const lines = [
        `交付说明 · ${doc.name}`,
        '',
        `语言对：${doc.sourceLang} → ${doc.targetLang}`,
        `格式：${doc.format}`,
        `句段：${checks.total}（已译 ${checks.translated}，已确认 ${checks.confirmed}）`,
        `未译：${checks.untranslated}　未确认：${checks.unconfirmed}`,
        '',
        `交付前检查：高危 ${checks.counts.high}　复核 ${checks.counts.medium}　提示 ${checks.counts.low}`,
        ...checks.byCode.slice(0, 12).map((entry) => `- ${entry.code}: ${entry.count}`),
      ]
      if (checks.items.length) {
        lines.push('', '待处理项（最多列出前 20 条）：')
        for (const item of checks.items.slice(0, 20)) {
          lines.push(`- 句段 ${item.index + 1} [${item.severity}] ${item.code}：${item.message}`)
        }
      }
      if (skipped.length) lines.push('', '未能打包的附件：', ...skipped.map((item) => `- ${item}`))
      lines.push('', `生成时间：${now()}`, `工具：AI辅助翻译 ${CAIT_VERSION}`)
      add(`${base}.交付说明.txt`, `${lines.join('\n')}\n`)
    }

    if (!entries.length) {
      throw new CatError('DELIVERY_EMPTY', '交付包里没有任何文件：请先确认译文，或检查导出选项。', 422)
    }

    return {
      documentId: doc.id,
      filename: `${base}.delivery.zip`,
      mime: 'application/zip',
      content: createZip(entries),
      entries: entries.map((entry) => entry.name),
      skipped,
      counts: checks.counts,
    }
  },
}
