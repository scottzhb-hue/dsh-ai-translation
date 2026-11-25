/**
 * 报价：把「这份稿子多少钱」变成可解释的算式。
 *
 * 单价按 1k 词（或 1k 字符 / 词），每个匹配档位乘一个折扣系数：
 * 100% 与 ICE 几乎不用动笔，85–99% 只需轻改，70–84% 要重写一部分，新句段全价。
 * 这是本地工具的估算，不替代合同——所以每一项都写清字数与系数，方便译员自己核对。
 */

import { CatError } from './errors.js'
import { classifyLeverage } from './analysis.js'
import { countWords, csvCell } from './text-utils.js'
import { clamp } from './similarity.js'

const UNITS = { per1000words: '1k 词', per1000chars: '1k 字符', perword: '词' }
const BUCKET_LABELS = {
  ice: 'ICE / 上下文匹配',
  exact: '100% 匹配',
  fuzzy85: '85–99%',
  fuzzy70: '70–84%',
  new: '新句段',
}

function quoteSettings(settings) {
  const quote = settings.quote ?? {}
  return {
    currency: String(quote.currency ?? 'CNY'),
    unit: UNITS[quote.unit] ? quote.unit : 'per1000words',
    rate: Number(quote.rate) >= 0 ? Number(quote.rate) : 0,
    minimum: Number(quote.minimum) >= 0 ? Number(quote.minimum) : 0,
    discounts: {
      ice: Number(quote.discounts?.ice ?? 0.3),
      exact: Number(quote.discounts?.exact ?? 0.3),
      fuzzy85: Number(quote.discounts?.fuzzy85 ?? 0.6),
      fuzzy70: Number(quote.discounts?.fuzzy70 ?? 0.8),
      new: Number(quote.discounts?.new ?? 1),
    },
  }
}

function round2(value) {
  return Math.round(value * 100) / 100
}

export const quoteMethods = {
  quoteState() {
    const config = quoteSettings(this.settings)
    return { ...config, unitLabel: UNITS[config.unit], buckets: BUCKET_LABELS }
  },

  setQuote({ currency, unit, rate, minimum, discounts } = {}) {
    const current = quoteSettings(this.settings)
    const next = {
      currency: currency === undefined ? current.currency : String(currency).trim().toUpperCase().slice(0, 8),
      unit: unit === undefined ? current.unit : UNITS[unit] ? unit : current.unit,
      rate: rate === undefined ? current.rate : clamp(Number(rate) || 0, 0, 1e6),
      minimum: minimum === undefined ? current.minimum : clamp(Number(minimum) || 0, 0, 1e9),
      discounts: { ...current.discounts },
    }
    if (discounts && typeof discounts === 'object' && !Array.isArray(discounts)) {
      for (const key of Object.keys(BUCKET_LABELS)) {
        if (discounts[key] === undefined) continue
        next.discounts[key] = clamp(Number(discounts[key]) || 0, 0, 3)
      }
    }
    this.settings.quote = next
    this.touch()
    this.persist()
    return this.quoteState()
  },

  quoteDocument({ documentId } = {}) {
    const doc = this.requireDocument(documentId)
    const config = quoteSettings(this.settings)
    const buckets = { ice: 0, exact: 0, fuzzy85: 0, fuzzy70: 0, new: 0 }
    const words = { ice: 0, exact: 0, fuzzy85: 0, fuzzy70: 0, new: 0 }
    const chars = { ice: 0, exact: 0, fuzzy85: 0, fuzzy70: 0, new: 0 }
    let totalWords = 0
    let totalChars = 0

    for (let index = 0; index < doc.segments.length; index += 1) {
      const segment = doc.segments[index]
      const source = String(segment.source ?? '')
      if (!source.trim()) continue
      const segmentWords = countWords(source)
      const segmentChars = Array.from(source).length
      totalWords += segmentWords
      totalChars += segmentChars
      const result = this.lookupTM({ query: source, threshold: 0.7, limit: 1, documentId: doc.id, index })
      const bucket = classifyLeverage(result.matches[0])
      buckets[bucket] += 1
      words[bucket] += segmentWords
      chars[bucket] += segmentChars
    }

    const quantity = (bucket) =>
      config.unit === 'per1000words' ? words[bucket] / 1000 : config.unit === 'per1000chars' ? chars[bucket] / 1000 : words[bucket]
    const lines = Object.keys(BUCKET_LABELS).map((bucket) => {
      const amount = quantity(bucket) * config.rate * config.discounts[bucket]
      return {
        bucket,
        label: BUCKET_LABELS[bucket],
        segments: buckets[bucket],
        words: words[bucket],
        characters: chars[bucket],
        quantity: round2(quantity(bucket)),
        discount: config.discounts[bucket],
        amount: round2(amount),
      }
    })
    const subtotal = round2(lines.reduce((sum, line) => sum + line.amount, 0))
    const total = round2(Math.max(subtotal, config.minimum))

    return {
      documentId: doc.id,
      title: doc.name,
      client: doc.client ?? '',
      batch: doc.batch ?? '',
      sourceLang: doc.sourceLang,
      targetLang: doc.targetLang,
      currency: config.currency,
      unit: config.unit,
      unitLabel: UNITS[config.unit],
      rate: config.rate,
      minimum: config.minimum,
      totalWords,
      totalCharacters: totalChars,
      segments: doc.segments.length,
      buckets,
      lines,
      subtotal,
      total,
      generatedAt: new Date().toISOString(),
    }
  },

  exportQuote({ documentId, format = 'txt' } = {}) {
    const quote = this.quoteDocument({ documentId })
    const fmt = String(format ?? 'txt').toLowerCase()
    const base = quote.title.replace(/[\\/:*?"<>|]+/g, '_').trim() || 'quote'
    if (fmt === 'json') {
      return {
        filename: `${base}.quote.json`,
        mime: 'application/json; charset=utf-8',
        content: `${JSON.stringify(quote, null, 2)}\n`,
        count: quote.segments,
      }
    }
    if (fmt === 'csv') {
      const lines = ['bucket,label,segments,words,characters,quantity,discount,amount,currency']
      for (const line of quote.lines) {
        lines.push(
          [
            line.bucket,
            csvCell(line.label),
            line.segments,
            line.words,
            line.characters,
            line.quantity,
            line.discount,
            line.amount,
            quote.currency,
          ].join(','),
        )
      }
      lines.push(['total', '', quote.segments, quote.totalWords, '', '', '', quote.total, quote.currency].join(','))
      return {
        filename: `${base}.quote.csv`,
        mime: 'text/csv; charset=utf-8',
        content: `${lines.join('\n')}\n`,
        count: quote.segments,
      }
    }
    if (fmt !== 'txt') throw new CatError('INVALID_EXPORT_FORMAT', `报价单不支持导出为 ${fmt}。`, 422)
    const rows = [
      `报价单 · ${quote.title}`,
      `语言对：${quote.sourceLang} → ${quote.targetLang}`,
      `生成时间：${quote.generatedAt}`,
      '',
      `单价：${quote.rate} ${quote.currency} / ${quote.unitLabel}`,
      `最低收费：${quote.minimum} ${quote.currency}`,
      '',
      '档位          句段    字数    计费量     系数    金额',
    ]
    for (const line of quote.lines) {
      rows.push(
        `${line.label.padEnd(14)}${String(line.segments).padStart(5)}${String(line.words).padStart(8)}${String(
          line.quantity,
        ).padStart(10)}${String(line.discount).padStart(8)}${String(line.amount).padStart(10)}`,
      )
    }
    rows.push('', `小计：${quote.subtotal} ${quote.currency}`, `合计：${quote.total} ${quote.currency}`)
    return {
      filename: `${base}.quote.txt`,
      mime: 'text/plain; charset=utf-8',
      content: `${rows.join('\n')}\n`,
      count: quote.segments,
    }
  },

  /** 按当前文档给出「加权字数」总览，供分析面板与报价面板共用。 */
  quotePreview({ documentId } = {}) {
    const report = this.analyzeDocument({ documentId: this.requireDocument(documentId).id })
    return {
      documentId: report.documentId,
      words: report.words,
      characters: report.characters,
      buckets: report.buckets,
      leverage: report.leverage,
    }
  },
}
