import { CatError } from './errors.js'
import { now } from './text-utils.js'
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'

/**
 * Draft recovery keeps the text of the *open* segment in a small per-project
 * file, because the editor holds only one draft at a time and the host writes
 * it into the project store on navigation or confirm. A crash or an abrupt
 * restart between those moments would otherwise lose whatever was typed.
 *
 * The snapshot is deliberately separate from store.json: it is written while
 * the user types (small, frequent), it must survive a half-written store, and
 * it is disposable once the segment is saved or confirmed.
 */
const DRAFT_DIRNAME = 'drafts'
const DRAFT_VERSION = 1
const MAX_DRAFT_CHARS = 20000
const MAX_DRAFT_ENTRIES = 50

const EMPTY_STATE = { target: '', at: '', uid: '' }

function safeFileName(documentId) {
  return `${String(documentId ?? '').replace(/[^A-Za-z0-9_-]/g, '_')}.json`
}

function emptyFile(documentId) {
  return {
    version: DRAFT_VERSION,
    documentId,
    savedAt: '',
    entries: {},
  }
}

function readEntryFile(file, documentId) {
  if (!existsSync(file)) return emptyFile(documentId)
  try {
    const parsed = JSON.parse(readFileSync(file, 'utf8'))
    if (!parsed || typeof parsed !== 'object') return emptyFile(documentId)
    const entries = parsed.entries && typeof parsed.entries === 'object' ? parsed.entries : {}
    const clean = {}
    for (const [uid, entry] of Object.entries(entries)) {
      const target = String(entry?.target ?? '')
      if (!uid || !target) continue
      clean[uid] = {
        target: target.slice(0, MAX_DRAFT_CHARS),
        index: Number.isInteger(entry?.index) ? entry.index : -1,
        at: String(entry?.at ?? ''),
      }
    }
    return {
      version: DRAFT_VERSION,
      documentId,
      savedAt: String(parsed.savedAt ?? ''),
      entries: clean,
    }
  } catch {
    // A truncated or foreign file is not worth an error: recovery is optional.
    return emptyFile(documentId)
  }
}

function writeEntryFile(file, payload) {
  const dir = dirname(file)
  mkdirSync(dir, { recursive: true })
  const temp = `${file}.tmp`
  writeFileSync(temp, JSON.stringify(payload), 'utf8')
  renameSync(temp, file)
}

/**
 * draftRecovery: part of the CatStore API, registered in lib/store-mixins.js.
 */
export const draftRecoveryMethods = {
  draftRecoveryFile(documentId) {
    if (!this.dataDir) return ''
    return join(this.dataDir, DRAFT_DIRNAME, safeFileName(documentId))
  },

  draftRecovery({ documentId, uid } = {}) {
    const doc = this.requireDocument(documentId)
    const wanted = String(uid ?? '').trim()
    if (!wanted || !doc.segments.some((segment) => segment.uid === wanted)) return EMPTY_STATE
    const file = this.draftRecoveryFile(doc.id)
    if (!file) return EMPTY_STATE
    const stored = readEntryFile(file, doc.id)
    const entry = stored.entries[wanted]
    if (!entry?.target) return EMPTY_STATE
    return { target: entry.target, at: entry.at, uid: wanted }
  },

  saveDraftRecovery({ documentId, index, uid, target } = {}) {
    const doc = this.requireDocument(documentId)
    const segment = this.findSegment(doc, Number(index ?? doc.cursor))
    const file = this.draftRecoveryFile(doc.id)
    if (!file) return { saved: false, count: 0, savedAt: '' }
    const key = segment.uid
    if (!key) return { saved: false, count: 0, savedAt: '' }
    const value = String(target ?? '').slice(0, MAX_DRAFT_CHARS)
    const stored = readEntryFile(file, doc.id)
    // Only uids that still exist are worth keeping: merge, split and re-import
    // retire old ones, and a stale snapshot must never resurface text.
    const live = new Set(doc.segments.map((item) => item.uid).filter(Boolean))
    const entries = {}
    for (const [entryUid, entry] of Object.entries(stored.entries)) {
      if (live.has(entryUid)) entries[entryUid] = entry
    }
    const savedTarget = String(segment.target ?? '')
    if (!value || value === savedTarget) delete entries[key]
    else entries[key] = { target: value, index: Number(index ?? doc.cursor), at: now() }

    const keys = Object.keys(entries)
    if (!keys.length) {
      if (existsSync(file)) rmSync(file, { force: true })
      return { saved: false, count: 0, savedAt: '' }
    }
    // Newest first, so a runaway snapshot cannot grow without bound.
    keys.sort((a, b) => String(entries[b].at).localeCompare(String(entries[a].at)))
    const bounded = {}
    for (const entryUid of keys.slice(0, MAX_DRAFT_ENTRIES)) bounded[entryUid] = entries[entryUid]
    const savedAt = now()
    try {
      writeEntryFile(file, {
        version: DRAFT_VERSION,
        documentId: doc.id,
        savedAt,
        entries: bounded,
      })
    } catch (error) {
      this.logger?.warn?.(`CAIT: 草稿暂存失败 document=${doc.id}: ${error?.message || error}`)
      throw new CatError('DRAFT_RECOVERY_FAILED', '草稿暂存失败，请检查磁盘空间与权限。', 500)
    }
    return { saved: true, count: Object.keys(bounded).length, savedAt }
  },

  clearDraftRecovery({ documentId, uid } = {}) {
    const doc = this.requireDocument(documentId)
    const file = this.draftRecoveryFile(doc.id)
    if (!file) return { count: 0 }
    const key = String(uid ?? '').trim()
    const stored = readEntryFile(file, doc.id)
    if (!key) {
      if (existsSync(file)) rmSync(file, { force: true })
      return { count: 0 }
    }
    if (!stored.entries[key]) return { count: Object.keys(stored.entries).length }
    delete stored.entries[key]
    const keys = Object.keys(stored.entries)
    if (!keys.length) {
      if (existsSync(file)) rmSync(file, { force: true })
      return { count: 0 }
    }
    writeEntryFile(file, { ...stored, savedAt: now() })
    return { count: keys.length }
  },
}
