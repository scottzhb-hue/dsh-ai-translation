import { CatError } from './errors.js'
import { makeId, now } from './text-utils.js'
import { normalizeSegmentState } from './segment-state.js'

// Merging rewrites the segment list without touching the template mapping, so
// it works for every format as long as both segments come from the same source
// paragraph; a cross-paragraph merge has to be forced and clears the paragraphs
// it consumed on export.
//
// Splitting keeps the mapping too, as long as both halves keep pointing at the
// same structural unit: the two segments share docxPart/docxParagraph, and the
// exporter writes them back into that one paragraph separated by <w:br/>, so a
// split never duplicates a paragraph on export. Plain text has no template, so
// both halves simply become adjacent paragraphs. Formats whose mapping cannot
// express "two segments in one unit" (pptx, xlsx) stay blocked.
const SPLIT_FORMATS = new Set(['txt', 'md', 'markdown', 'docx'])

/**
 * The structural unit a segment belongs to. Office templates map segments back
 * to a paragraph through docxPart/docxParagraph, plain text through paragraph.
 * Merging inside one unit keeps the mapping; merging across units needs force.
 */
function paragraphUnit(segment) {
  const meta = segment.meta && typeof segment.meta === 'object' ? segment.meta : null
  if (meta && typeof meta.docxPart === 'string' && Number.isInteger(meta.docxParagraph)) {
    return `docx:${meta.docxPart}:${meta.docxParagraph}`
  }
  if (meta && typeof meta.pptxSlide === 'string' && Number.isInteger(meta.pptxParagraph)) {
    return `pptx:${meta.pptxSlide}:${meta.pptxParagraph}`
  }
  if (Number.isInteger(segment.paragraph)) return `paragraph:${segment.paragraph}`
  return 'paragraph:0'
}

const CJK_CHAR = /[\u3400-\u9fff\u3040-\u30ff\uac00-\ud7af]/

/**
 * Join merged fragments the way the language wants them: a space between Latin
 * fragments, nothing between CJK ones (a Chinese sentence pair must not gain a
 * space when two segments become one).
 */
function joinFragments(parts) {
  let out = ''
  for (const part of parts) {
    if (!out) {
      out = part
      continue
    }
    const left = out[out.length - 1]
    const right = part[0]
    out += (CJK_CHAR.test(left) || CJK_CHAR.test(right) ? '' : ' ') + part
  }
  return out
}

function editError(code, message) {
  return new CatError(code, message, 400)
}

function splittableDocument(store, documentId) {
  const doc = store.requireDocument(documentId)
  if (!SPLIT_FORMATS.has(String(doc.format || 'txt').toLowerCase())) {
    throw editError(
      'SEGMENT_EDIT_FORMAT_UNSUPPORTED',
      '当前格式不支持拆分句段；支持 TXT、Markdown 与 DOCX。',
    )
  }
  return doc
}

function renumber(segments) {
  segments.forEach((segment, index) => {
    segment.id = `s${index + 1}`
  })
}

function snapshotDoc(doc) {
  return {
    segments: doc.segments.map((segment) => ({
      ...segment,
      notes: Array.isArray(segment.notes) ? segment.notes.map((note) => ({ ...note })) : [],
      meta: segment.meta ? { ...segment.meta } : segment.meta,
    })),
    cursor: doc.cursor,
    updatedAt: doc.updatedAt,
    revision: doc.revision,
  }
}

function restoreDoc(doc, snapshot) {
  doc.segments = snapshot.segments
  doc.cursor = snapshot.cursor
  doc.updatedAt = snapshot.updatedAt
  doc.revision = snapshot.revision
}

function targetStatus(target) {
  return String(target || '').trim() ? 'translated' : 'pending'
}

export const segmentEditMethods = {
  mergeSegments({ documentId, index, count = 2, force = false } = {}) {
    // Every format may merge inside one structural unit; a cross-unit merge
    // rewrites the template mapping, so it stays behind the explicit force flag.
    const doc = this.requireDocument(documentId)
    const start = Number(index)
    const size = Number(count)
    if (!Number.isInteger(start) || start < 0 || start >= doc.segments.length - 1) {
      throw editError('MERGE_RANGE_INVALID', '合并范围无效：至少需要当前句段和下一句段。')
    }
    if (!Number.isInteger(size) || size < 2 || start + size > doc.segments.length) {
      throw editError('MERGE_RANGE_INVALID', '合并范围无效：句段数量不足。')
    }
    const group = doc.segments.slice(start, start + size)
    if (group.some((segment) => segment.locked)) {
      throw editError('SEGMENT_LOCKED', '锁定的句段不能合并。')
    }
    const units = group.map(paragraphUnit)
    const crossUnit = new Set(units).size > 1
    if (crossUnit && !force) {
      throw editError(
        'MERGE_PARAGRAPH_MISMATCH',
        '不能跨段落合并句段；如确需跨段落合并，请按住 Shift 再点合并。',
      )
    }

    const before = snapshotDoc(doc)
    try {
      const target = joinFragments(
        group.map((segment) => String(segment.target || '').trim()).filter(Boolean),
      )
      const firstOrigin = group.find((segment) => segment.origin)?.origin || (target ? 'mt' : null)
      const origin = target
        ? group.some((segment) => segment.origin === 'manual')
          ? 'manual'
          : firstOrigin
        : null
      const source = joinFragments(
        group.map((segment) => String(segment.source || '').trim()).filter(Boolean),
      )
      const notes = group.flatMap((segment) =>
        Array.isArray(segment.notes) ? segment.notes.map((note) => ({ ...note })) : [],
      )
      const merged = {
        ...group[0],
        id: group[0].id,
        uid: makeId('u'),
        source,
        target,
        status: targetStatus(target),
        origin,
        suggestion: '',
        suggestionReason: '',
        notes,
        locked: false,
        confirmedAt: null,
        updatedAt: now(),
        meta: {
          ...(group[0].meta || {}),
          mergedFrom: group.map((segment) => segment.uid).filter(Boolean),
          ...(crossUnit
            ? {
                mergedConsumed: group.slice(1).map((segment) => {
                  const meta = segment.meta && typeof segment.meta === 'object' ? segment.meta : {}
                  return {
                    part: typeof meta.docxPart === 'string' ? meta.docxPart : null,
                    ordinal: Number.isInteger(meta.docxParagraph)
                      ? meta.docxParagraph
                      : Number.isInteger(segment.paragraph)
                        ? segment.paragraph
                        : null,
                  }
                }),
              }
            : {}),
        },
      }
      normalizeSegmentState(merged)
      doc.segments.splice(start, size, merged)
      renumber(doc.segments)
      doc.cursor = start
      this.touch()
      this.persist()
      return {
        index: start,
        segment: this.segmentView(merged, start),
        mergedFrom: merged.meta.mergedFrom,
        forced: crossUnit,
      }
    } catch (error) {
      restoreDoc(doc, before)
      throw error
    }
  },

  splitSegment({ documentId, index, at } = {}) {
    const doc = splittableDocument(this, documentId)
    const position = Number(index)
    if (!Number.isInteger(position) || position < 0 || position >= doc.segments.length) {
      throw editError('SPLIT_RANGE_INVALID', '拆分位置无效。')
    }
    const segment = doc.segments[position]
    if (segment.locked) throw editError('SEGMENT_LOCKED', '锁定的句段不能拆分。')
    const source = String(segment.source || '')
    const offset = Number(at)
    if (!Number.isInteger(offset) || offset <= 0 || offset >= source.length) {
      throw editError('SPLIT_RANGE_INVALID', '拆分位置必须落在源文中间。')
    }
    const leftSource = source.slice(0, offset).trim()
    const rightSource = source.slice(offset).trim()
    if (!leftSource || !rightSource) {
      throw editError('SPLIT_RANGE_INVALID', '拆分后两侧都必须有内容。')
    }

    const target = String(segment.target || '')
    let targetOffset = 0
    if (target) {
      targetOffset = Math.round(target.length * (offset / source.length))
      targetOffset = Math.max(0, Math.min(target.length, targetOffset))
    }
    const leftTarget = target.slice(0, targetOffset).trim()
    const rightTarget = target.slice(targetOffset).trim()
    const notes = Array.isArray(segment.notes) ? segment.notes.map((note) => ({ ...note })) : []
    const parentUid = segment.uid
    const makePart = (partSource, partTarget, withNotes) => {
      const part = {
        ...segment,
        id: '',
        uid: makeId('u'),
        source: partSource,
        target: partTarget,
        status: targetStatus(partTarget),
        origin: partTarget ? 'manual' : null,
        suggestion: '',
        suggestionReason: '',
        notes: withNotes ? notes : [],
        locked: false,
        confirmedAt: null,
        updatedAt: now(),
        meta: {
          ...(segment.meta || {}),
          splitFrom: parentUid,
        },
      }
      normalizeSegmentState(part)
      return part
    }

    const before = snapshotDoc(doc)
    try {
      const left = makePart(leftSource, leftTarget, true)
      const right = makePart(rightSource, rightTarget, false)
      doc.segments.splice(position, 1, left, right)
      renumber(doc.segments)
      doc.cursor = position
      this.touch()
      this.persist()
      return {
        index: position,
        segments: [this.segmentView(left, position), this.segmentView(right, position + 1)],
        splitFrom: parentUid,
      }
    } catch (error) {
      restoreDoc(doc, before)
      throw error
    }
  },
}
