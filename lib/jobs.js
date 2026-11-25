/**
 * 作业（job）：一个客户、一批文件、一份 brief、一套术语库。
 *
 * 1.1.0 只给文档打了 client/batch 两个自由文本标签，批次汇总靠字符串匹配；
 * 结果同一批文件之间无法共享 brief 和术语库，交付与分析也只能一篇一篇来。
 * 作业层把「多文件归一个作业」变成真正的数据模型：
 *
 *   mounts（全局挂载） → job（客户/批次共享资源） → doc（单篇显式绑定）
 *
 * 文档的 tmIds / glossaryIds 仍然可以是 null（继承）或显式列表，继承时先看
 * 作业、再回退到全局挂载，因此旧数据不需要迁移就能工作。
 *
 * 时间记录服务于「这个客户到底花了多久」：作业级秒表 + 手填工时，都落在
 * job.time 下并随 store.json 持久化（重启后仍在走的秒表会继续计时）。
 */

import { CatError } from './errors.js'
import { normalizeBrief } from './brief.js'
import { CAIT_VERSION } from './limits.js'
import { exportFormat } from './export-document.js'
import { glossaryToCsv } from './library-export.js'
import { clampInt } from './similarity.js'
import { countWords, csvCell, makeId, now, safeBaseName } from './text-utils.js'
import { createZip } from './zip.js'

const MAX_JOB_NAME = 120
const MAX_CLIENT = 80
const MAX_NOTE = 2000
const MAX_TIME_ENTRIES = 500
const MAX_ENTRY_MINUTES = 24 * 60

function cleanText(value, max) {
  return String(value ?? '')
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, max)
}

/** Date-only field: `YYYY-MM-DD`, or '' when the value is not a date. */
export function normalizeDueAt(value) {
  const text = String(value ?? '').trim()
  if (!text) return ''
  const match = text.match(/^(\d{4})-(\d{2})-(\d{2})/)
  if (!match) return ''
  const month = Number(match[2])
  const day = Number(match[3])
  if (month < 1 || month > 12 || day < 1 || day > 31) return ''
  return `${match[1]}-${match[2]}-${match[3]}`
}

function isoOrNow(value) {
  const text = String(value ?? '').trim()
  if (!text) return now()
  const stamp = Date.parse(text)
  return Number.isFinite(stamp) ? new Date(stamp).toISOString() : now()
}

function isoOrEmpty(value) {
  const text = String(value ?? '').trim()
  if (!text) return ''
  const stamp = Date.parse(text)
  return Number.isFinite(stamp) ? new Date(stamp).toISOString() : ''
}

function uniqueIds(value) {
  if (!Array.isArray(value)) return null
  const ids = []
  for (const raw of value) {
    const id = String(raw ?? '').trim()
    if (id && !ids.includes(id)) ids.push(id)
  }
  return ids
}

function restoreTimeEntries(value) {
  if (!Array.isArray(value)) return []
  const entries = []
  for (const raw of value.slice(-MAX_TIME_ENTRIES)) {
    const minutes = Number(raw?.minutes)
    if (!Number.isFinite(minutes) || minutes <= 0) continue
    entries.push({
      id: typeof raw.id === 'string' && raw.id ? raw.id : makeId('t'),
      at: isoOrNow(raw.at),
      minutes: clampInt(Math.round(minutes), 1, MAX_ENTRY_MINUTES, 1),
      note: cleanText(raw.note, 200),
    })
  }
  return entries
}

/** Restore one job from store.json. Returns null for unusable records. */
export function restoreJob(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null
  if (typeof raw.id !== 'string' || !raw.id.trim()) return null
  const job = {
    id: raw.id.trim(),
    name: cleanText(raw.name, MAX_JOB_NAME) || 'Untitled job',
    client: cleanText(raw.client, MAX_CLIENT),
    dueAt: normalizeDueAt(raw.dueAt),
    note: cleanText(raw.note, MAX_NOTE),
    createdAt: isoOrNow(raw.createdAt),
    updatedAt: isoOrNow(raw.updatedAt),
    archivedAt: isoOrEmpty(raw.archivedAt) || null,
    brief: normalizeBrief(raw.brief),
    tmIds: uniqueIds(raw.tmIds),
    glossaryIds: uniqueIds(raw.glossaryIds),
    defaultWriteTmId:
      typeof raw.defaultWriteTmId === 'string' && raw.defaultWriteTmId.trim()
        ? raw.defaultWriteTmId.trim()
        : null,
    time: {
      entries: restoreTimeEntries(raw.time?.entries),
      since: isoOrEmpty(raw.time?.since),
    },
  }
  return job
}

function documentWords(doc) {
  return doc.segments.reduce((sum, segment) => sum + countWords(String(segment.source ?? '')), 0)
}

function jobMinutes(job) {
  const recorded = job.time.entries.reduce((sum, entry) => sum + entry.minutes, 0)
  if (!job.time.since) return { recorded, running: 0, total: recorded }
  const started = Date.parse(job.time.since)
  const running = Number.isFinite(started)
    ? Math.max(0, Math.floor((Date.now() - started) / 60000))
    : 0
  return { recorded, running, total: recorded + running }
}

export const jobMethods = {
  jobForDocument(doc) {
    const id = doc?.jobId
    return id ? (this.jobs.get(id) ?? null) : null
  },

  requireJob(jobId) {
    const id = String(jobId ?? '').trim()
    if (!id) throw new CatError('JOB_REQUIRED', '请选择一个作业。')
    const job = this.jobs.get(id)
    if (!job) throw new CatError('JOB_NOT_FOUND', `作业不存在: ${id}`, 404)
    return job
  },

  jobDocuments(job) {
    return [...this.docs.values()].filter((doc) => doc.jobId === job.id)
  },

  /** A job overview cheap enough to embed in every bootstrap. */
  jobSummary(job) {
    const docs = this.jobDocuments(job)
    let words = 0
    let segments = 0
    let translated = 0
    let confirmed = 0
    for (const doc of docs) {
      words += documentWords(doc)
      segments += doc.segments.length
      for (const segment of doc.segments) {
        if (String(segment.target ?? '').trim()) translated += 1
        if (segment.status === 'confirmed') confirmed += 1
      }
    }
    const time = jobMinutes(job)
    const today = new Date().toISOString().slice(0, 10)
    return {
      id: job.id,
      name: job.name,
      client: job.client,
      dueAt: job.dueAt,
      overdue: Boolean(job.dueAt && job.dueAt < today && confirmed < segments),
      note: job.note,
      archivedAt: job.archivedAt,
      documents: docs.length,
      words,
      segments,
      translated,
      confirmed,
      percent: segments ? Math.round((confirmed / segments) * 1000) / 10 : 0,
      minutes: time.total,
      running: Boolean(job.time.since),
      runningSince: job.time.since || '',
      createdAt: job.createdAt,
      updatedAt: job.updatedAt,
      tmIds: job.tmIds,
      glossaryIds: job.glossaryIds,
      defaultWriteTmId: job.defaultWriteTmId,
    }
  },

  listJobs() {
    const jobs = [...this.jobs.values()]
      .sort((left, right) => String(right.updatedAt).localeCompare(String(left.updatedAt)))
      .map((job) => this.jobSummary(job))
    const running = jobs.find((job) => job.running)
    return { jobs, runningJobId: running ? running.id : '', jobCount: jobs.length }
  },

  jobDetail({ jobId } = {}) {
    const job = this.requireJob(jobId)
    const docs = this.jobDocuments(job).map((doc) => ({
      id: doc.id,
      name: doc.name,
      sourceLang: doc.sourceLang,
      targetLang: doc.targetLang,
      segments: doc.segments.length,
      words: documentWords(doc),
      translated: doc.segments.filter((segment) => String(segment.target ?? '').trim()).length,
      confirmed: doc.segments.filter((segment) => segment.status === 'confirmed').length,
      percent: this.progress(doc).percent,
      client: doc.client ?? '',
      batch: doc.batch ?? '',
      updatedAt: doc.updatedAt,
    }))
    docs.sort((left, right) => String(left.name).localeCompare(String(right.name)))
    return {
      job: this.jobSummary(job),
      documents: docs,
      brief: job.brief ? { ...job.brief } : null,
      note: job.note,
      resources: {
        tmIds: job.tmIds,
        glossaryIds: job.glossaryIds,
        defaultWriteTmId: job.defaultWriteTmId,
        effectiveTmIds: this.jobEffectiveTmIds(job),
        effectiveGlossaryIds: this.jobEffectiveGlossaryIds(job),
        inheritsTm: job.tmIds === null || job.tmIds === undefined,
        inheritsGlossary: job.glossaryIds === null || job.glossaryIds === undefined,
      },
      time: this.jobTimeStats(job),
      activeTimerJobId: this.runningJobId(),
    }
  },

  jobEffectiveTmIds(job) {
    const ids = job?.tmIds
    if (ids === null || ids === undefined) return [...this.mounts.tmIds]
    const known = new Set(this.tmLibraries.map((library) => library.tmId))
    return ids.filter((id) => known.has(id))
  },

  jobEffectiveGlossaryIds(job) {
    const ids = job?.glossaryIds
    if (ids === null || ids === undefined) return [...this.mounts.glossaryIds]
    const known = new Set(this.glossaryLibraries.map((library) => library.glossaryId))
    return ids.filter((id) => known.has(id))
  },

  runningJobId() {
    for (const job of this.jobs.values()) {
      if (job.time?.since) return job.id
    }
    return ''
  },

  createJob({ name, client, dueAt, note, brief, tmIds, glossaryIds, defaultWriteTmId } = {}) {
    const stamp = now()
    const jobName = cleanText(name, MAX_JOB_NAME)
    if (!jobName) throw new CatError('JOB_NAME_REQUIRED', '作业名称不能为空。', 422)
    const job = {
      id: makeId('job'),
      name: jobName,
      client: cleanText(client, MAX_CLIENT),
      dueAt: normalizeDueAt(dueAt),
      note: cleanText(note, MAX_NOTE),
      createdAt: stamp,
      updatedAt: stamp,
      archivedAt: null,
      brief: normalizeBrief(brief),
      tmIds: tmIds === undefined ? null : this.normalizeResourceIds('tm', tmIds),
      glossaryIds: glossaryIds === undefined ? null : this.normalizeResourceIds('glossary', glossaryIds),
      defaultWriteTmId:
        typeof defaultWriteTmId === 'string' && defaultWriteTmId.trim()
          ? this.requireTmLibrary(defaultWriteTmId.trim())
          : null,
      time: { entries: [], since: '' },
    }
    this.jobs.set(job.id, job)
    this.touch()
    try {
      this.persist({ strict: true })
    } catch (error) {
      this.jobs.delete(job.id)
      throw error
    }
    return { job: this.jobSummary(job), jobs: this.listJobs() }
  },

  /**
   * Patch a job. Only the fields present in the input change; `tmIds: null`
   * restores inheritance from the global mounts, and an explicit [] means this
   * job reads no TM / glossary at all.
   */
  updateJob(input = {}) {
    const job = this.requireJob(input.jobId)
    const has = (key) => Object.prototype.hasOwnProperty.call(input, key)
    const before = structuredClone(job)
    if (has('name')) {
      const name = cleanText(input.name, MAX_JOB_NAME)
      if (!name) throw new CatError('JOB_NAME_REQUIRED', '作业名称不能为空。', 422)
      job.name = name
    }
    if (has('client')) job.client = cleanText(input.client, MAX_CLIENT)
    if (has('dueAt')) job.dueAt = normalizeDueAt(input.dueAt)
    if (has('note')) job.note = cleanText(input.note, MAX_NOTE)
    if (has('archivedAt') || has('archived')) {
      const archived = input.archived === true || input.archivedAt === true
      job.archivedAt = archived ? now() : null
    }
    if (has('brief')) {
      if (input.brief === null) delete job.brief
      else job.brief = normalizeBrief(input.brief)
    }
    if (has('tmIds')) job.tmIds = this.normalizeResourceIds('tm', input.tmIds)
    if (has('glossaryIds')) job.glossaryIds = this.normalizeResourceIds('glossary', input.glossaryIds)
    if (has('defaultWriteTmId')) {
      const id = String(input.defaultWriteTmId ?? '').trim()
      job.defaultWriteTmId = id ? this.requireTmLibrary(id) : null
    }
    const effectiveTm = this.jobEffectiveTmIds(job)
    if (job.defaultWriteTmId && !effectiveTm.includes(job.defaultWriteTmId)) {
      if (has('defaultWriteTmId')) {
        throw new CatError('TM_NOT_BOUND', '默认写入库必须在该作业绑定的翻译记忆库里。', 409)
      }
      job.defaultWriteTmId = null
    }
    job.updatedAt = now()
    this.touch()
    try {
      this.persist({ strict: true })
    } catch (error) {
      this.jobs.set(job.id, before)
      throw error
    }
    return { job: this.jobSummary(job), jobs: this.listJobs() }
  },

  /** Deleting a job never deletes documents; they simply become unassigned. */
  deleteJob({ jobId, confirm } = {}) {
    const job = this.requireJob(jobId)
    if (confirm !== true) {
      throw new CatError('CONFIRMATION_REQUIRED', '删除作业需要二次确认。', 409)
    }
    const released = []
    for (const doc of this.docs.values()) {
      if (doc.jobId === job.id) {
        delete doc.jobId
        released.push(doc.id)
      }
    }
    this.jobs.delete(job.id)
    this.touch()
    this.persist({ strict: true })
    return { deleted: job.id, released, jobs: this.listJobs() }
  },

  assignDocumentJob({ documentId, jobId } = {}) {
    const doc = this.requireDocument(documentId)
    const target = String(jobId ?? '').trim()
    if (target) {
      this.requireJob(target)
      doc.jobId = target
    } else {
      delete doc.jobId
    }
    doc.updatedAt = now()
    this.touch()
    this.persist({ strict: true })
    return {
      documentId: doc.id,
      jobId: doc.jobId ?? '',
      document: this.documentSummary(doc),
      jobs: this.listJobs(),
    }
  },

  /** Bulk assignment used by the job editor; `replace` also unassigns others. */
  assignJobDocuments({ jobId, documentIds, replace = false } = {}) {
    const job = this.requireJob(jobId)
    const wanted = new Set(
      (Array.isArray(documentIds) ? documentIds : [])
        .map((id) => String(id ?? '').trim())
        .filter(Boolean),
    )
    const assigned = []
    const released = []
    for (const doc of this.docs.values()) {
      if (wanted.has(doc.id)) {
        if (doc.jobId !== job.id) {
          doc.jobId = job.id
          doc.updatedAt = now()
          assigned.push(doc.id)
        }
      } else if (replace && doc.jobId === job.id) {
        delete doc.jobId
        doc.updatedAt = now()
        released.push(doc.id)
      }
    }
    job.updatedAt = now()
    this.touch()
    this.persist({ strict: true })
    return {
      job: this.jobSummary(job),
      assigned,
      released,
      jobs: this.listJobs(),
      documents: [...this.docs.values()].map((doc) => this.documentSummary(doc)),
    }
  },

  /** Aggregated analysis: same buckets as one document, summed across the job. */
  jobAnalysis({ jobId } = {}) {
    const job = this.requireJob(jobId)
    const docs = this.jobDocuments(job)
    const totals = {
      segments: 0,
      words: 0,
      characters: 0,
      translated: 0,
      confirmed: 0,
      duplicates: 0,
      buckets: { ice: 0, exact: 0, fuzzy85: 0, fuzzy70: 0, new: 0 },
      weighted: 0,
    }
    const rows = []
    const failed = []
    for (const doc of docs) {
      try {
        const report = this.analyzeDocument({ documentId: doc.id })
        const row = {
          id: doc.id,
          name: doc.name,
          segments: report.segments ?? doc.segments.length,
          words: report.words ?? 0,
          characters: report.characters ?? 0,
          translated: report.translated ?? 0,
          confirmed: report.confirmed ?? 0,
          duplicates: report.duplicates?.groups ?? 0,
          buckets: { ...totals.buckets, ...(report.buckets ?? {}) },
          weighted: report.leverage?.weighted ?? 0,
        }
        rows.push(row)
        totals.segments += row.segments
        totals.words += row.words
        totals.characters += row.characters
        totals.translated += row.translated
        totals.confirmed += row.confirmed
        totals.duplicates += row.duplicates
        totals.weighted += row.weighted
        for (const key of Object.keys(totals.buckets)) totals.buckets[key] += row.buckets[key] ?? 0
      } catch (error) {
        failed.push(`${doc.name}: ${error?.message ?? error}`)
      }
    }
    const reused = totals.segments - totals.buckets.new
    return {
      jobId: job.id,
      documents: rows,
      totals: {
        ...totals,
        matched: reused,
        matchedPercent: totals.segments
          ? Math.round((reused / totals.segments) * 1000) / 10
          : 0,
      },
      failed,
    }
  },

  ensureJobTime(job) {
    if (!job.time || typeof job.time !== 'object') job.time = { entries: [], since: '' }
    if (!Array.isArray(job.time.entries)) job.time.entries = []
    if (typeof job.time.since !== 'string') job.time.since = ''
    return job.time
  },

  jobTimeStats(job) {
    const time = this.ensureJobTime(job)
    const { recorded, running, total } = jobMinutes(job)
    return {
      jobId: job.id,
      entries: [...time.entries]
        .sort((left, right) => String(right.at).localeCompare(String(left.at)))
        .map((entry) => ({ ...entry })),
      recordedMinutes: recorded,
      runningMinutes: running,
      totalMinutes: total,
      running: Boolean(time.since),
      since: time.since || '',
    }
  },

  jobTime({ jobId } = {}) {
    const job = this.requireJob(jobId)
    return this.jobTimeStats(job)
  },

  startJobTimer({ jobId } = {}) {
    const job = this.requireJob(jobId)
    const running = this.runningJobId()
    if (running === job.id) return { job: this.jobSummary(job), time: this.jobTimeStats(job) }
    let stopped = null
    if (running) {
      const other = this.jobs.get(running)
      if (other) {
        const entry = this.closeJobTimer(other)
        stopped = { jobId: other.id, entry }
      }
    }
    const time = this.ensureJobTime(job)
    time.since = now()
    job.updatedAt = now()
    this.touch()
    this.persist({ strict: true })
    return {
      job: this.jobSummary(job),
      time: this.jobTimeStats(job),
      stopped,
      jobs: this.listJobs(),
    }
  },

  closeJobTimer(job) {
    const time = this.ensureJobTime(job)
    if (!time.since) return null
    const started = Date.parse(time.since)
    const minutes = Number.isFinite(started)
      ? Math.max(1, Math.round((Date.now() - started) / 60000))
      : 1
    const entry = {
      id: makeId('t'),
      at: time.since,
      minutes: clampInt(minutes, 1, MAX_ENTRY_MINUTES, 1),
      note: '',
    }
    time.entries.push(entry)
    if (time.entries.length > MAX_TIME_ENTRIES) {
      time.entries = time.entries.slice(-MAX_TIME_ENTRIES)
    }
    time.since = ''
    return entry
  },

  stopJobTimer({ jobId } = {}) {
    const job = this.requireJob(jobId)
    const entry = this.closeJobTimer(job)
    job.updatedAt = now()
    this.touch()
    this.persist({ strict: true })
    return {
      job: this.jobSummary(job),
      time: this.jobTimeStats(job),
      entry,
      jobs: this.listJobs(),
    }
  },

  addTimeEntry({ jobId, minutes, note, at } = {}) {
    const job = this.requireJob(jobId)
    const value = Number(minutes)
    if (!Number.isFinite(value) || value <= 0) {
      throw new CatError('INVALID_MINUTES', '工时必须是大于 0 的分钟数。', 422)
    }
    const time = this.ensureJobTime(job)
    const entry = {
      id: makeId('t'),
      at: isoOrEmpty(at) || now(),
      minutes: clampInt(Math.round(value), 1, MAX_ENTRY_MINUTES, 1),
      note: cleanText(note, 200),
    }
    time.entries.push(entry)
    if (time.entries.length > MAX_TIME_ENTRIES) {
      time.entries = time.entries.slice(-MAX_TIME_ENTRIES)
    }
    job.updatedAt = now()
    this.touch()
    this.persist({ strict: true })
    return {
      job: this.jobSummary(job),
      time: this.jobTimeStats(job),
      entry,
      jobs: this.listJobs(),
    }
  },

  deleteTimeEntry({ jobId, entryId } = {}) {
    const job = this.requireJob(jobId)
    const time = this.ensureJobTime(job)
    const id = String(entryId ?? '').trim()
    const before = time.entries.length
    time.entries = time.entries.filter((entry) => entry.id !== id)
    if (time.entries.length === before) {
      throw new CatError('TIME_ENTRY_NOT_FOUND', '找不到这条工时记录。', 404)
    }
    job.updatedAt = now()
    this.touch()
    this.persist({ strict: true })
    return { job: this.jobSummary(job), time: this.jobTimeStats(job), jobs: this.listJobs() }
  },

  /**
   * One ZIP for the whole job: every document's deliverables plus combined
   * analysis, QA and glossary sheets, a time log and a single readme.
   */
  exportJobDelivery({ jobId, include = {} } = {}) {
    const job = this.requireJob(jobId)
    const docs = this.jobDocuments(job)
    if (!docs.length) {
      throw new CatError('JOB_EMPTY', '这个作业还没有文档，先添加文档再导出。', 422)
    }
    const want = {
      target: include.target !== false,
      bilingual: include.bilingual !== false,
      glossary: include.glossary !== false,
      qa: include.qa !== false,
      analysis: include.analysis !== false,
      notes: include.notes !== false,
      time: include.time !== false,
      readme: include.readme !== false,
    }
    const entries = []
    const skipped = []
    const perDoc = []
    const qaRows = []
    const noteSections = []
    const time = this.jobTimeStats(job)
    let high = 0
    let medium = 0
    let low = 0
    let totalSegments = 0
    let totalWords = 0
    let totalTranslated = 0
    let totalConfirmed = 0
    const used = new Set()

    const add = (name, data) => {
      if (!data) return
      let candidate = name
      let counter = 2
      while (used.has(candidate)) {
        const dot = name.lastIndexOf('.')
        candidate = dot > 0 ? `${name.slice(0, dot)}-${counter}${name.slice(dot)}` : `${name}-${counter}`
        counter += 1
      }
      used.add(candidate)
      entries.push({ name: candidate, data })
    }

    docs.forEach((doc, position) => {
      const checks = this.deliveryChecks({ documentId: doc.id })
      high += checks.counts.high
      medium += checks.counts.medium
      low += checks.counts.low
      totalSegments += checks.total
      totalTranslated += checks.translated
      totalConfirmed += checks.confirmed
      const words = documentWords(doc)
      totalWords += words
      const prefix = `${String(position + 1).padStart(2, '0')}_${safeBaseName(doc.name) || 'document'}`
      const targetTag = String(doc.targetLang || '').replace(/[^\w-]+/g, '')
      perDoc.push({
        name: doc.name,
        sourceLang: doc.sourceLang,
        targetLang: doc.targetLang,
        segments: checks.total,
        words,
        translated: checks.translated,
        confirmed: checks.confirmed,
        high: checks.counts.high,
        medium: checks.counts.medium,
        low: checks.counts.low,
      })
      if (want.target) {
        try {
          const file = exportFormat(this, doc, 'docx')
          if (file?.content) add(`${prefix}${targetTag ? `.${targetTag}` : ''}.docx`, file.content)
        } catch (error) {
          skipped.push(`${doc.name} target: ${error?.message ?? error}`)
        }
      }
      if (want.bilingual) {
        try {
          const file = exportFormat(this, doc, 'bilingual-docx')
          if (file?.content) add(`${prefix}.bilingual.docx`, file.content)
        } catch (error) {
          skipped.push(`${doc.name} bilingual: ${error?.message ?? error}`)
        }
      }
      if (want.qa) {
        for (const item of checks.items) {
          qaRows.push([doc.name, item.index + 1, item.code, item.severity, item.message])
        }
      }
      if (want.notes) {
        const lines = []
        for (let index = 0; index < doc.segments.length; index += 1) {
          const notes = Array.isArray(doc.segments[index].notes) ? doc.segments[index].notes : []
          for (const note of notes) {
            if (note.deletedAt) continue
            lines.push(`### 句段 ${index + 1}`, '', `- ${note.body ?? note.text ?? ''}`, '')
          }
        }
        if (lines.length) {
          noteSections.push(`## ${doc.name}`, '', ...lines)
        }
      }
    })

    if (want.analysis) {
      const analysis = this.jobAnalysis({ jobId: job.id })
      const header = [
        'document',
        'segments',
        'words',
        'characters',
        'translated',
        'confirmed',
        'duplicates',
        'ice',
        'exact',
        'fuzzy85',
        'fuzzy70',
        'new',
        'weighted',
      ]
      const lines = [header.join(',')]
      for (const row of analysis.documents) {
        lines.push(
          [
            csvCell(row.name),
            row.segments,
            row.words,
            row.characters,
            row.translated,
            row.confirmed,
            row.duplicates,
            row.buckets.ice,
            row.buckets.exact,
            row.buckets.fuzzy85,
            row.buckets.fuzzy70,
            row.buckets.new,
            row.weighted,
          ].join(','),
        )
      }
      const totals = analysis.totals
      lines.push(
        [
          csvCell('TOTAL'),
          totals.segments,
          totals.words,
          totals.characters,
          totals.translated,
          totals.confirmed,
          totals.duplicates,
          totals.buckets.ice,
          totals.buckets.exact,
          totals.buckets.fuzzy85,
          totals.buckets.fuzzy70,
          totals.buckets.new,
          totals.weighted,
        ].join(','),
      )
      add(`${safeBaseName(job.name) || 'job'}.analysis.csv`, `${lines.join('\n')}\n`)
      for (const failure of analysis.failed) skipped.push(`analysis: ${failure}`)
    }

    if (want.glossary) {
      const ids = new Set(this.jobEffectiveGlossaryIds(job))
      const rows = this.glossary.filter((entry) => ids.has(entry.glossaryId || 'default'))
      if (rows.length) {
        add(`${safeBaseName(job.name) || 'job'}.glossary.csv`, glossaryToCsv(rows))
      }
    }

    if (want.qa && qaRows.length) {
      const lines = ['document,index,code,severity,message']
      for (const row of qaRows) {
        lines.push([csvCell(row[0]), row[1], csvCell(row[2]), csvCell(row[3]), csvCell(row[4])].join(','))
      }
      add(`${safeBaseName(job.name) || 'job'}.qa.csv`, `${lines.join('\n')}\n`)
    }

    if (want.notes && noteSections.length) {
      add(`${safeBaseName(job.name) || 'job'}.notes.md`, `# 批注汇总\n\n${noteSections.join('\n')}`)
    }

    if (want.time) {
      const lines = ['date,minutes,note']
      for (const entry of time.entries) {
        lines.push([csvCell(entry.at), entry.minutes, csvCell(entry.note)].join(','))
      }
      if (time.runningMinutes > 0) {
        lines.push([csvCell(time.since), time.runningMinutes, csvCell('running timer')].join(','))
      }
      lines.push(['', time.totalMinutes, csvCell('TOTAL')].join(','))
      add(`${safeBaseName(job.name) || 'job'}.time.csv`, `${lines.join('\n')}\n`)
    }

    if (want.readme) {
      const lines = [
        `作业交付说明 · ${job.name}`,
        '',
        `客户：${job.client || '（未填写）'}`,
        `截止日期：${job.dueAt || '（未填写）'}`,
        `文档数：${docs.length}`,
        `句段：${totalSegments}（已译 ${totalTranslated}，已确认 ${totalConfirmed}）`,
        `字数：${totalWords}`,
        `工时：${Math.floor(time.totalMinutes / 60)} 小时 ${time.totalMinutes % 60} 分`,
        '',
        `交付前检查：高危 ${high}　复核 ${medium}　提示 ${low}`,
        '',
        '文档清单：',
        ...perDoc.map(
          (row) =>
            `- ${row.name}（${row.sourceLang} → ${row.targetLang}）：${row.segments} 段 / ${row.words} 字，已确认 ${row.confirmed}${row.high ? `，高危 ${row.high}` : ''}`,
        ),
      ]
      if (job.note) lines.push('', '作业备注：', job.note)
      if (skipped.length) lines.push('', '未能打包的附件：', ...skipped.map((item) => `- ${item}`))
      lines.push('', `生成时间：${now()}`, `工具：AI辅助翻译 ${CAIT_VERSION}`)
      add(`${safeBaseName(job.name) || 'job'}.交付说明.txt`, `${lines.join('\n')}\n`)
    }

    if (!entries.length) {
      throw new CatError('DELIVERY_EMPTY', '交付包里没有任何文件：请先确认译文，或检查导出选项。', 422)
    }

    return {
      jobId: job.id,
      filename: `${safeBaseName(job.name) || 'job'}.delivery.zip`,
      mime: 'application/zip',
      content: createZip(entries),
      entries: entries.map((entry) => entry.name),
      skipped,
      counts: { high, medium, low },
    }
  },
}
