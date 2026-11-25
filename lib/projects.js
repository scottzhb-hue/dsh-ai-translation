/**
 * 项目（project）：一个客户、一批文件、一份 brief、一套术语库。
 *
 * 1.1.0 只给文档打了 client/batch 两个自由文本标签，批次汇总靠字符串匹配；
 * 结果同一批文件之间无法共享 brief 和术语库，交付与分析也只能一篇一篇来。
 * 项目层把「多文件归一个项目」变成真正的数据模型：
 *
 *   mounts（全局挂载） → project（客户/批次共享资源） → doc（单篇显式绑定）
 *
 * 文档的 tmIds / glossaryIds 仍然可以是 null（继承）或显式列表，继承时先看
 * 项目、再回退到全局挂载，因此旧数据不需要迁移就能工作。
 *
 * 每篇文档一定属于一个项目：没有归属的散稿统一落在「未分类」项目里，用户
 * 可以重命名它，也可以把文档移到别的项目（未分类项目本身不能删除）。
 *
 * 时间记录服务于「这个客户到底花了多久」：项目级秒表 + 手填工时，都落在
 * project.time 下并随 store.json 持久化（重启后仍在走的秒表会继续计时）。
 */

import { CatError } from './errors.js'
import { normalizeBrief } from './brief.js'
import { CAIT_VERSION } from './limits.js'
import { exportFormat } from './export-document.js'
import { glossaryToCsv } from './library-export.js'
import { clampInt } from './similarity.js'
import { countWords, csvCell, makeId, now, safeBaseName } from './text-utils.js'
import { createZip } from './zip.js'

export const INBOX_PROJECT_ID = 'project_inbox'
export const INBOX_PROJECT_NAME = '未分类'

const MAX_PROJECT_NAME = 120
const MAX_CLIENT = 80
const MAX_NOTE = 2000
const MAX_TIME_ENTRIES = 500
const MAX_ENTRY_MINUTES = 24 * 60
const MAX_REPORT_ITEMS = 200

/** The four document states the project views and reports share. */
export const DOCUMENT_STATUS_LABEL = {
  untranslated: '未翻译',
  incomplete: '未完成',
  translated: '已翻译',
  done: '已完成',
}

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

/** The「未分类」project: always exists, can be renamed, cannot be deleted. */
export function blankInboxProject(stamp = now()) {
  return {
    id: INBOX_PROJECT_ID,
    name: INBOX_PROJECT_NAME,
    inbox: true,
    client: '',
    dueAt: '',
    note: '',
    createdAt: stamp,
    updatedAt: stamp,
    archivedAt: null,
    tmIds: null,
    glossaryIds: null,
    defaultWriteTmId: null,
    time: { entries: [], since: '' },
  }
}

/** Restore one project from store.json. Returns null for unusable records. */
export function restoreProject(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null
  if (typeof raw.id !== 'string' || !raw.id.trim()) return null
  const project = {
    id: raw.id.trim(),
    name: cleanText(raw.name, MAX_PROJECT_NAME) || '未命名项目',
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
  if (raw.inbox === true || project.id === INBOX_PROJECT_ID) project.inbox = true
  return project
}

function documentWords(doc) {
  return doc.segments.reduce((sum, segment) => sum + countWords(String(segment.source ?? '')), 0)
}

function projectMinutes(project) {
  const recorded = project.time.entries.reduce((sum, entry) => sum + entry.minutes, 0)
  if (!project.time.since) return { recorded, running: 0, total: recorded }
  const started = Date.parse(project.time.since)
  const running = Number.isFinite(started)
    ? Math.max(0, Math.floor((Date.now() - started) / 60000))
    : 0
  return { recorded, running, total: recorded + running }
}

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

function reportItems(items) {
  return items.slice(0, MAX_REPORT_ITEMS)
}

/** Small printable HTML shell shared by both report kinds. */
function reportHtml({ title, subtitle, sections }) {
  const body = sections.join('\n')
  return `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8" />
<title>${escapeHtml(title)}</title>
<style>
  :root { color-scheme: light; }
  body { margin: 0; padding: 32px 40px 56px; font: 14px/1.6 -apple-system, "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif; color: #1f2328; background: #fff; }
  h1 { font-size: 24px; margin: 0 0 4px; }
  h2 { font-size: 16px; margin: 28px 0 10px; padding-bottom: 6px; border-bottom: 1px solid #d8dee4; }
  .subtitle { color: #57606a; margin: 0 0 18px; }
  .kpis { display: flex; flex-wrap: wrap; gap: 10px; margin: 0 0 8px; }
  .kpi { border: 1px solid #d8dee4; border-radius: 8px; padding: 10px 14px; min-width: 108px; }
  .kpi b { display: block; font-size: 18px; }
  .kpi span { color: #57606a; font-size: 12px; }
  table { width: 100%; border-collapse: collapse; font-size: 13px; }
  th, td { border-bottom: 1px solid #e6eaef; padding: 6px 8px; text-align: left; vertical-align: top; }
  th { background: #f6f8fa; font-weight: 600; }
  td.num, th.num { text-align: right; font-variant-numeric: tabular-nums; }
  .badge { display: inline-block; padding: 1px 8px; border-radius: 999px; font-size: 12px; border: 1px solid #d8dee4; }
  .badge.done { background: #dafbe1; border-color: #aceebb; }
  .badge.translated { background: #ddf4ff; border-color: #b6e3ff; }
  .badge.incomplete { background: #fff8c5; border-color: #f5e48c; }
  .badge.untranslated { background: #ffebe9; border-color: #ffcecb; }
  .muted { color: #57606a; }
  footer { margin-top: 28px; color: #57606a; font-size: 12px; }
  @media print { body { padding: 0; } h2 { break-after: avoid; } }
</style>
</head>
<body>
${body}
<footer>由 AI辅助翻译 ${escapeHtml(CAIT_VERSION)} 生成于 ${escapeHtml(now())}</footer>
</body>
</html>
`
}

export const projectMethods = {
  /** Make sure the「未分类」project exists in memory (call after reset/restore). */
  ensureInboxProject() {
    if (!(this.projects instanceof Map)) this.projects = new Map()
    const existing = this.projects.get(INBOX_PROJECT_ID)
    if (existing) {
      existing.inbox = true
      if (!existing.time || typeof existing.time !== 'object') {
        existing.time = { entries: [], since: '' }
      }
      return existing
    }
    const inbox = blankInboxProject()
    this.projects.set(inbox.id, inbox)
    return inbox
  },

  /**
   * Four-state document status used by every project view and report:
   * untranslated (no target text), incomplete (some segments still empty),
   * translated (every segment has text, review pending), done (all confirmed).
   */
  documentStatus(doc) {
    const total = doc.segments.length
    let confirmed = 0
    let withTarget = 0
    for (const segment of doc.segments) {
      if (segment.status === 'confirmed') confirmed += 1
      if (String(segment.target ?? '').trim()) withTarget += 1
    }
    const percent = total ? Math.round((confirmed / total) * 100) : 0
    let code = 'untranslated'
    if (total && confirmed === total) code = 'done'
    else if (withTarget > 0) code = withTarget === total ? 'translated' : 'incomplete'
    return {
      code,
      label: DOCUMENT_STATUS_LABEL[code],
      total,
      confirmed,
      translated: withTarget,
      pending: total - withTarget,
      percent,
    }
  },

  projectForDocument(doc) {
    const id = doc?.projectId
    const project = id ? this.projects.get(id) : null
    if (project) return project
    return this.projects.get(INBOX_PROJECT_ID) ?? this.ensureInboxProject()
  },

  requireProject(projectId) {
    const id = String(projectId ?? '').trim()
    if (!id) throw new CatError('PROJECT_REQUIRED', '请选择一个项目。')
    const project = this.projects.get(id)
    if (!project) throw new CatError('PROJECT_NOT_FOUND', `项目不存在: ${id}`, 404)
    return project
  },

  /** Used by import/create flows: unknown or empty ids fall back to「未分类」. */
  resolveProjectId(value) {
    const id = String(value ?? '').trim()
    if (!id || id === INBOX_PROJECT_ID) return INBOX_PROJECT_ID
    return this.projects.has(id) ? id : INBOX_PROJECT_ID
  },

  projectDocuments(project) {
    const docs = [...this.docs.values()]
    if (!project) return []
    if (project.id === INBOX_PROJECT_ID) {
      return docs.filter((doc) => !doc.projectId || doc.projectId === INBOX_PROJECT_ID)
    }
    return docs.filter((doc) => doc.projectId === project.id)
  },

  /** A project overview cheap enough to embed in every bootstrap. */
  projectSummary(project) {
    const docs = this.projectDocuments(project)
    let words = 0
    let segments = 0
    let translated = 0
    let confirmed = 0
    const statusCounts = { untranslated: 0, incomplete: 0, translated: 0, done: 0 }
    for (const doc of docs) {
      words += documentWords(doc)
      segments += doc.segments.length
      const status = this.documentStatus(doc)
      statusCounts[status.code] += 1
      for (const segment of doc.segments) {
        if (String(segment.target ?? '').trim()) translated += 1
        if (segment.status === 'confirmed') confirmed += 1
      }
    }
    const time = projectMinutes(project)
    const today = new Date().toISOString().slice(0, 10)
    return {
      id: project.id,
      name: project.name,
      inbox: Boolean(project.inbox),
      client: project.client,
      dueAt: project.dueAt,
      overdue: Boolean(project.dueAt && project.dueAt < today && confirmed < segments),
      note: project.note,
      archivedAt: project.archivedAt,
      documents: docs.length,
      words,
      segments,
      translated,
      confirmed,
      percent: segments ? Math.round((confirmed / segments) * 1000) / 10 : 0,
      statusCounts,
      minutes: time.total,
      running: Boolean(project.time.since),
      runningSince: project.time.since || '',
      createdAt: project.createdAt,
      updatedAt: project.updatedAt,
      tmIds: project.tmIds,
      glossaryIds: project.glossaryIds,
      defaultWriteTmId: project.defaultWriteTmId,
    }
  },

  listProjects() {
    const rows = [...this.projects.values()].map((project) => this.projectSummary(project))
    const inbox = rows.filter((row) => row.inbox)
    const rest = rows
      .filter((row) => !row.inbox)
      .sort((left, right) => String(right.updatedAt).localeCompare(String(left.updatedAt)))
    const projects = [...rest, ...inbox]
    const running = projects.find((project) => project.running)
    return { projects, runningProjectId: running ? running.id : '', projectCount: projects.length }
  },

  projectDetail({ projectId } = {}) {
    const project = this.requireProject(projectId)
    const docs = this.projectDocuments(project).map((doc) => {
      const status = this.documentStatus(doc)
      return {
        id: doc.id,
        name: doc.name,
        sourceLang: doc.sourceLang,
        targetLang: doc.targetLang,
        segments: doc.segments.length,
        words: documentWords(doc),
        translated: status.translated,
        confirmed: status.confirmed,
        percent: status.percent,
        status: status.code,
        statusLabel: status.label,
        pending: status.pending,
        client: doc.client ?? '',
        batch: doc.batch ?? '',
        updatedAt: doc.updatedAt,
      }
    })
    docs.sort((left, right) => String(left.name).localeCompare(String(right.name)))
    return {
      project: this.projectSummary(project),
      documents: docs,
      brief: project.brief ? { ...project.brief } : null,
      note: project.note,
      resources: {
        tmIds: project.tmIds,
        glossaryIds: project.glossaryIds,
        defaultWriteTmId: project.defaultWriteTmId,
        effectiveTmIds: this.projectEffectiveTmIds(project),
        effectiveGlossaryIds: this.projectEffectiveGlossaryIds(project),
        inheritsTm: project.tmIds === null || project.tmIds === undefined,
        inheritsGlossary: project.glossaryIds === null || project.glossaryIds === undefined,
      },
      time: this.projectTimeStats(project),
      activeTimerProjectId: this.runningProjectId(),
    }
  },

  projectEffectiveTmIds(project) {
    const ids = project?.tmIds
    if (ids === null || ids === undefined) return [...this.mounts.tmIds]
    const known = new Set(this.tmLibraries.map((library) => library.tmId))
    return ids.filter((id) => known.has(id))
  },

  projectEffectiveGlossaryIds(project) {
    const ids = project?.glossaryIds
    if (ids === null || ids === undefined) return [...this.mounts.glossaryIds]
    const known = new Set(this.glossaryLibraries.map((library) => library.glossaryId))
    return ids.filter((id) => known.has(id))
  },

  runningProjectId() {
    for (const project of this.projects.values()) {
      if (project.time?.since) return project.id
    }
    return ''
  },

  createProject({ name, client, dueAt, note, brief, tmIds, glossaryIds, defaultWriteTmId } = {}) {
    const stamp = now()
    const projectName = cleanText(name, MAX_PROJECT_NAME)
    if (!projectName) throw new CatError('PROJECT_NAME_REQUIRED', '项目名称不能为空。', 422)
    const project = {
      id: makeId('project'),
      name: projectName,
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
    this.projects.set(project.id, project)
    this.touch()
    try {
      this.persist({ strict: true })
    } catch (error) {
      this.projects.delete(project.id)
      throw error
    }
    return { project: this.projectSummary(project), projects: this.listProjects() }
  },

  /**
   * Patch a project. Only the fields present in the input change; `tmIds: null`
   * restores inheritance from the global mounts, and an explicit [] means this
   * project reads no TM / glossary at all. Renaming is just `name`.
   */
  updateProject(input = {}) {
    const project = this.requireProject(input.projectId)
    const has = (key) => Object.prototype.hasOwnProperty.call(input, key)
    const before = structuredClone(project)
    if (has('name')) {
      const name = cleanText(input.name, MAX_PROJECT_NAME)
      if (!name) throw new CatError('PROJECT_NAME_REQUIRED', '项目名称不能为空。', 422)
      project.name = name
    }
    if (has('client')) project.client = cleanText(input.client, MAX_CLIENT)
    if (has('dueAt')) project.dueAt = normalizeDueAt(input.dueAt)
    if (has('note')) project.note = cleanText(input.note, MAX_NOTE)
    if (has('archivedAt') || has('archived')) {
      const archived = input.archived === true || input.archivedAt === true
      project.archivedAt = archived ? now() : null
    }
    if (has('brief')) {
      if (input.brief === null) delete project.brief
      else project.brief = normalizeBrief(input.brief)
    }
    if (has('tmIds')) project.tmIds = this.normalizeResourceIds('tm', input.tmIds)
    if (has('glossaryIds')) project.glossaryIds = this.normalizeResourceIds('glossary', input.glossaryIds)
    if (has('defaultWriteTmId')) {
      const id = String(input.defaultWriteTmId ?? '').trim()
      project.defaultWriteTmId = id ? this.requireTmLibrary(id) : null
    }
    const effectiveTm = this.projectEffectiveTmIds(project)
    if (project.defaultWriteTmId && !effectiveTm.includes(project.defaultWriteTmId)) {
      if (has('defaultWriteTmId')) {
        throw new CatError('TM_NOT_BOUND', '默认写入库必须在该项目绑定的翻译记忆库里。', 409)
      }
      project.defaultWriteTmId = null
    }
    project.updatedAt = now()
    this.touch()
    try {
      this.persist({ strict: true })
    } catch (error) {
      this.projects.set(project.id, before)
      throw error
    }
    return { project: this.projectSummary(project), projects: this.listProjects() }
  },

  /**
   * Deleting a project never deletes documents: they move to「未分类」.
   * The inbox itself cannot be deleted (rename it instead).
   */
  deleteProject({ projectId, confirm } = {}) {
    const project = this.requireProject(projectId)
    if (project.inbox || project.id === INBOX_PROJECT_ID) {
      throw new CatError('INBOX_PROJECT', '「未分类」项目不能删除；可以重命名它，或把文档移到别的项目。', 409)
    }
    if (confirm !== true) {
      throw new CatError('CONFIRMATION_REQUIRED', '删除项目需要二次确认。', 409)
    }
    const released = []
    for (const doc of this.docs.values()) {
      if (doc.projectId === project.id) {
        doc.projectId = INBOX_PROJECT_ID
        doc.updatedAt = now()
        released.push(doc.id)
      }
    }
    this.projects.delete(project.id)
    this.touch()
    this.persist({ strict: true })
    return { deleted: project.id, released, projects: this.listProjects() }
  },

  assignDocumentProject({ documentId, projectId } = {}) {
    const doc = this.requireDocument(documentId)
    const target = String(projectId ?? '').trim() || INBOX_PROJECT_ID
    this.requireProject(target)
    doc.projectId = target
    doc.updatedAt = now()
    this.touch()
    this.persist({ strict: true })
    return {
      documentId: doc.id,
      projectId: doc.projectId,
      document: this.documentSummary(doc),
      projects: this.listProjects(),
    }
  },

  /** Bulk assignment used by the project editor; `replace` also moves others out. */
  assignProjectDocuments({ projectId, documentIds, replace = false } = {}) {
    const project = this.requireProject(projectId)
    const wanted = new Set(
      (Array.isArray(documentIds) ? documentIds : [])
        .map((id) => String(id ?? '').trim())
        .filter(Boolean),
    )
    const assigned = []
    const released = []
    for (const doc of this.docs.values()) {
      if (wanted.has(doc.id)) {
        if (doc.projectId !== project.id) {
          doc.projectId = project.id
          doc.updatedAt = now()
          assigned.push(doc.id)
        }
      } else if (replace && doc.projectId === project.id) {
        doc.projectId = INBOX_PROJECT_ID
        doc.updatedAt = now()
        released.push(doc.id)
      }
    }
    project.updatedAt = now()
    this.touch()
    this.persist({ strict: true })
    return {
      project: this.projectSummary(project),
      assigned,
      released,
      projects: this.listProjects(),
      documents: [...this.docs.values()].map((doc) => this.documentSummary(doc)),
    }
  },

  /** Aggregated analysis: same buckets as one document, summed across the project. */
  projectAnalysis({ projectId } = {}) {
    const project = this.requireProject(projectId)
    const docs = this.projectDocuments(project)
    const totals = {
      segments: 0,
      words: 0,
      characters: 0,
      translated: 0,
      confirmed: 0,
      duplicates: 0,
      buckets: { ice: 0, exact: 0, fuzzy85: 0, fuzzy70: 0, new: 0 },
      bucketWords: { ice: 0, exact: 0, fuzzy85: 0, fuzzy70: 0, new: 0 },
      bucketCharacters: { ice: 0, exact: 0, fuzzy85: 0, fuzzy70: 0, new: 0 },
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
          sourceLang: doc.sourceLang,
          targetLang: doc.targetLang,
          segments: report.segments ?? doc.segments.length,
          words: report.words ?? 0,
          characters: report.characters ?? 0,
          translated: report.translated ?? 0,
          confirmed: report.confirmed ?? 0,
          duplicates: report.duplicates?.groups ?? 0,
          buckets: { ...totals.buckets, ...(report.buckets ?? {}) },
          bucketWords: { ...totals.bucketWords, ...(report.bucketWords ?? {}) },
          bucketCharacters: { ...totals.bucketCharacters, ...(report.bucketCharacters ?? {}) },
          weighted: report.leverage?.weighted ?? 0,
          status: this.documentStatus(doc).code,
        }
        rows.push(row)
        totals.segments += row.segments
        totals.words += row.words
        totals.characters += row.characters
        totals.translated += row.translated
        totals.confirmed += row.confirmed
        totals.duplicates += row.duplicates
        totals.weighted += row.weighted
        for (const key of Object.keys(totals.buckets)) {
          totals.buckets[key] += row.buckets[key] ?? 0
          totals.bucketWords[key] += row.bucketWords[key] ?? 0
          totals.bucketCharacters[key] += row.bucketCharacters[key] ?? 0
        }
      } catch (error) {
        failed.push(`${doc.name}: ${error?.message ?? error}`)
      }
    }
    const reused = totals.segments - totals.buckets.new
    // 报价只依赖上面的汇总数字，顺手算出来，避免再走一遍逐句段 TM 查询。
    const quote = this.quoteSummary({
      title: project.name,
      client: project.client,
      sourceLang: docs[0]?.sourceLang ?? '',
      targetLang: docs[0]?.targetLang ?? '',
      segments: totals.segments,
      totalWords: totals.words,
      totalCharacters: totals.characters,
      buckets: totals.buckets,
      wordBuckets: totals.bucketWords,
      charBuckets: totals.bucketCharacters,
    })
    return {
      projectId: project.id,
      documents: rows,
      totals: {
        ...totals,
        matched: reused,
        matchedPercent: totals.segments
          ? Math.round((reused / totals.segments) * 1000) / 10
          : 0,
      },
      quote,
      failed,
    }
  },

  /** Project-level quote: bucket totals from projectAnalysis, no second TM walk. */
  projectQuote({ projectId } = {}) {
    const project = this.requireProject(projectId)
    const analysis = this.projectAnalysis({ projectId: project.id })
    return {
      projectId: project.id,
      ...analysis.quote,
      analysis: { documents: analysis.documents, totals: analysis.totals },
      failed: analysis.failed,
    }
  },

  ensureProjectTime(project) {
    if (!project.time || typeof project.time !== 'object') project.time = { entries: [], since: '' }
    if (!Array.isArray(project.time.entries)) project.time.entries = []
    if (typeof project.time.since !== 'string') project.time.since = ''
    return project.time
  },

  projectTimeStats(project) {
    const time = this.ensureProjectTime(project)
    const { recorded, running, total } = projectMinutes(project)
    return {
      projectId: project.id,
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

  projectTime({ projectId } = {}) {
    const project = this.requireProject(projectId)
    return this.projectTimeStats(project)
  },

  startProjectTimer({ projectId } = {}) {
    const project = this.requireProject(projectId)
    const running = this.runningProjectId()
    if (running === project.id) return { project: this.projectSummary(project), time: this.projectTimeStats(project) }
    let stopped = null
    if (running) {
      const other = this.projects.get(running)
      if (other) {
        const entry = this.closeProjectTimer(other)
        stopped = { projectId: other.id, entry }
      }
    }
    const time = this.ensureProjectTime(project)
    time.since = now()
    project.updatedAt = now()
    this.touch()
    this.persist({ strict: true })
    return {
      project: this.projectSummary(project),
      time: this.projectTimeStats(project),
      stopped,
      projects: this.listProjects(),
    }
  },

  closeProjectTimer(project) {
    const time = this.ensureProjectTime(project)
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

  stopProjectTimer({ projectId } = {}) {
    const project = this.requireProject(projectId)
    const entry = this.closeProjectTimer(project)
    project.updatedAt = now()
    this.touch()
    this.persist({ strict: true })
    return {
      project: this.projectSummary(project),
      time: this.projectTimeStats(project),
      entry,
      projects: this.listProjects(),
    }
  },

  addTimeEntry({ projectId, minutes, note, at } = {}) {
    const project = this.requireProject(projectId)
    const value = Number(minutes)
    if (!Number.isFinite(value) || value <= 0) {
      throw new CatError('INVALID_MINUTES', '工时必须是大于 0 的分钟数。', 422)
    }
    const time = this.ensureProjectTime(project)
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
    project.updatedAt = now()
    this.touch()
    this.persist({ strict: true })
    return {
      project: this.projectSummary(project),
      time: this.projectTimeStats(project),
      entry,
      projects: this.listProjects(),
    }
  },

  deleteTimeEntry({ projectId, entryId } = {}) {
    const project = this.requireProject(projectId)
    const time = this.ensureProjectTime(project)
    const id = String(entryId ?? '').trim()
    const before = time.entries.length
    time.entries = time.entries.filter((entry) => entry.id !== id)
    if (time.entries.length === before) {
      throw new CatError('TIME_ENTRY_NOT_FOUND', '找不到这条工时记录。', 404)
    }
    project.updatedAt = now()
    this.touch()
    this.persist({ strict: true })
    return { project: this.projectSummary(project), time: this.projectTimeStats(project), projects: this.listProjects() }
  },

  /**
   * One ZIP for the whole project: every document's deliverables plus combined
   * analysis, QA and glossary sheets, a time log and a single readme.
   */
  exportProjectDelivery({ projectId, include = {} } = {}) {
    const project = this.requireProject(projectId)
    const docs = this.projectDocuments(project)
    if (!docs.length) {
      throw new CatError('PROJECT_EMPTY', '这个项目还没有文档，先添加文档再导出。', 422)
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
    const time = this.projectTimeStats(project)
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

    const base = safeBaseName(project.name) || 'project'

    if (want.analysis) {
      const analysis = this.projectAnalysis({ projectId: project.id })
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
      add(`${base}.analysis.csv`, `${lines.join('\n')}\n`)
      for (const failure of analysis.failed) skipped.push(`analysis: ${failure}`)
    }

    if (want.glossary) {
      const ids = new Set(this.projectEffectiveGlossaryIds(project))
      const rows = this.glossary.filter((entry) => ids.has(entry.glossaryId || 'default'))
      if (rows.length) {
        add(`${base}.glossary.csv`, glossaryToCsv(rows))
      }
    }

    if (want.qa && qaRows.length) {
      const lines = ['document,index,code,severity,message']
      for (const row of qaRows) {
        lines.push([csvCell(row[0]), row[1], csvCell(row[2]), csvCell(row[3]), csvCell(row[4])].join(','))
      }
      add(`${base}.qa.csv`, `${lines.join('\n')}\n`)
    }

    if (want.notes && noteSections.length) {
      add(`${base}.notes.md`, `# 批注汇总\n\n${noteSections.join('\n')}`)
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
      add(`${base}.time.csv`, `${lines.join('\n')}\n`)
    }

    if (want.readme) {
      const lines = [
        `项目交付说明 · ${project.name}`,
        '',
        `客户：${project.client || '（未填写）'}`,
        `截止日期：${project.dueAt || '（未填写）'}`,
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
      if (project.note) lines.push('', '项目备注：', project.note)
      if (skipped.length) lines.push('', '未能打包的附件：', ...skipped.map((item) => `- ${item}`))
      lines.push('', `生成时间：${now()}`, `工具：AI辅助翻译 ${CAIT_VERSION}`)
      add(`${base}.交付说明.txt`, `${lines.join('\n')}\n`)
    }

    if (!entries.length) {
      throw new CatError('DELIVERY_EMPTY', '交付包里没有任何文件：请先确认译文，或检查导出选项。', 422)
    }

    return {
      projectId: project.id,
      filename: `${base}.delivery.zip`,
      mime: 'application/zip',
      content: createZip(entries),
      entries: entries.map((entry) => entry.name),
      skipped,
      counts: { high, medium, low },
    }
  },

  /**
   * 项目翻译报告：文档清单与各自状态、匹配分析、质检汇总、工时与报价，
   * 一次导出 CSV（给表格）或 HTML（可直接打印成 PDF）。
   */
  projectReport({ projectId, format = 'html' } = {}) {
    const project = this.requireProject(projectId)
    const docs = this.projectDocuments(project)
    if (!docs.length) {
      throw new CatError('PROJECT_EMPTY', '这个项目还没有文档，先添加文档再生成报告。', 422)
    }
    const analysis = this.projectAnalysis({ projectId: project.id })
    const quote = this.quoteSummary({
      title: project.name,
      client: project.client,
      segments: analysis.totals.segments,
      totalWords: analysis.totals.words,
      totalCharacters: analysis.totals.characters,
      buckets: analysis.totals.buckets,
      wordBuckets: analysis.totals.bucketWords,
      charBuckets: analysis.totals.bucketCharacters,
    })
    const time = this.projectTimeStats(project)
    const docsRows = docs.map((doc) => {
      const status = this.documentStatus(doc)
      const row = analysis.documents.find((entry) => entry.id === doc.id) ?? {}
      const checks = this.deliveryChecks({ documentId: doc.id })
      return {
        id: doc.id,
        name: doc.name,
        sourceLang: doc.sourceLang,
        targetLang: doc.targetLang,
        segments: doc.segments.length,
        words: documentWords(doc),
        status: status.code,
        statusLabel: status.label,
        percent: status.percent,
        confirmed: status.confirmed,
        translated: status.translated,
        duplicates: row.duplicates ?? 0,
        buckets: row.buckets ?? { ice: 0, exact: 0, fuzzy85: 0, fuzzy70: 0, new: 0 },
        weighted: row.weighted ?? 0,
        high: checks.counts.high,
        medium: checks.counts.medium,
        low: checks.counts.low,
        items: checks.items,
      }
    })
    const base = `${safeBaseName(project.name) || 'project'}.report`
    if (String(format).toLowerCase() === 'csv') {
      return {
        projectId: project.id,
        filename: `${base}.csv`,
        mime: 'text/csv; charset=utf-8',
        content: projectReportCsv(project, docsRows, analysis, quote, time),
        documents: docsRows.length,
      }
    }
    return {
      projectId: project.id,
      filename: `${base}.html`,
      mime: 'text/html; charset=utf-8',
      content: projectReportHtml(project, docsRows, analysis, quote, time),
      documents: docsRows.length,
    }
  },

  /** 单篇文档的翻译报告：状态、匹配分析、质检、报价，CSV 或 HTML。 */
  documentReport({ documentId, format = 'html' } = {}) {
    const doc = this.requireDocument(documentId)
    const status = this.documentStatus(doc)
    const analysis = this.analyzeDocument({ documentId: doc.id })
    const quote = this.quoteDocument({ documentId: doc.id })
    const checks = this.deliveryChecks({ documentId: doc.id })
    const base = `${safeBaseName(doc.name) || 'document'}.report`
    if (String(format).toLowerCase() === 'csv') {
      return {
        documentId: doc.id,
        filename: `${base}.csv`,
        mime: 'text/csv; charset=utf-8',
        content: documentReportCsv(doc, status, analysis, quote, checks),
      }
    }
    return {
      documentId: doc.id,
      filename: `${base}.html`,
      mime: 'text/html; charset=utf-8',
      content: documentReportHtml(doc, status, analysis, quote, checks),
    }
  },
}

function projectReportCsv(project, docsRows, analysis, quote, time) {
  const header = [
    'document',
    'language',
    'segments',
    'words',
    'status',
    'percent',
    'confirmed',
    'duplicates',
    'ice',
    'exact',
    'fuzzy85',
    'fuzzy70',
    'new',
    'weighted',
    'blocking',
    'review',
    'notice',
  ]
  const lines = [header.join(',')]
  for (const row of docsRows) {
    lines.push(
      [
        csvCell(row.name),
        csvCell(`${row.sourceLang}->${row.targetLang}`),
        row.segments,
        row.words,
        csvCell(row.statusLabel),
        row.percent,
        row.confirmed,
        row.duplicates,
        row.buckets.ice,
        row.buckets.exact,
        row.buckets.fuzzy85,
        row.buckets.fuzzy70,
        row.buckets.new,
        row.weighted,
        row.high,
        row.medium,
        row.low,
      ].join(','),
    )
  }
  const totals = analysis.totals
  const sum = (key) => docsRows.reduce((value, row) => value + (row[key] ?? 0), 0)
  lines.push(
    [
      csvCell('TOTAL'),
      '',
      totals.segments,
      totals.words,
      csvCell(`${docsRows.filter((row) => row.status === 'done').length} done`),
      totals.segments ? Math.round((totals.confirmed / totals.segments) * 100) : 0,
      totals.confirmed,
      totals.duplicates,
      totals.buckets.ice,
      totals.buckets.exact,
      totals.buckets.fuzzy85,
      totals.buckets.fuzzy70,
      totals.buckets.new,
      totals.weighted,
      sum('high'),
      sum('medium'),
      sum('low'),
    ].join(','),
  )
  lines.push('')
  lines.push('metric,value')
  for (const [key, value] of [
    ['project', project.name],
    ['client', project.client],
    ['due_at', project.dueAt],
    ['documents', docsRows.length],
    ['segments', totals.segments],
    ['words', totals.words],
    ['characters', totals.characters],
    ['confirmed', totals.confirmed],
    ['minutes', time.totalMinutes],
    ['currency', quote.currency],
    ['rate', quote.rate],
    ['unit', quote.unit],
    ['quote_subtotal', quote.subtotal],
    ['quote_total', quote.total],
    ['generated_at', quote.generatedAt],
  ]) {
    lines.push([csvCell(key), csvCell(value)].join(','))
  }
  return `${lines.join('\n')}\n`
}

function documentReportCsv(doc, status, analysis, quote, checks) {
  const lines = ['metric,value']
  const rows = [
    ['document', doc.name],
    ['languages', `${doc.sourceLang}->${doc.targetLang}`],
    ['segments', analysis.segments],
    ['words', analysis.words],
    ['characters', analysis.characters],
    ['status', status.label],
    ['percent', status.percent],
    ['confirmed', status.confirmed],
    ['translated', status.translated],
    ['duplicates', analysis.duplicates.groups],
    ['weighted', analysis.leverage.weighted],
    ['blocking', checks.counts.high],
    ['review', checks.counts.medium],
    ['notice', checks.counts.low],
    ['currency', quote.currency],
    ['rate', quote.rate],
    ['unit', quote.unit],
    ['quote_subtotal', quote.subtotal],
    ['quote_total', quote.total],
    ['generated_at', quote.generatedAt],
  ]
  for (const key of Object.keys(analysis.buckets)) {
    rows.push([`bucket_${key}_segments`, analysis.buckets[key]])
    rows.push([`bucket_${key}_words`, analysis.bucketWords?.[key] ?? 0])
  }
  for (const [key, value] of rows) lines.push([csvCell(key), csvCell(value)].join(','))
  return `${lines.join('\n')}\n`
}

function statusBadge(code, label) {
  return `<span class="badge ${escapeHtml(code)}">${escapeHtml(label)}</span>`
}

function kpi(label, value) {
  return `<div class="kpi"><b>${escapeHtml(value)}</b><span>${escapeHtml(label)}</span></div>`
}

function projectReportHtml(project, docsRows, analysis, quote, time) {
  const totals = analysis.totals
  const done = docsRows.filter((row) => row.status === 'done').length
  const sum = (key) => docsRows.reduce((value, row) => value + (row[key] ?? 0), 0)
  const percent = totals.segments ? Math.round((totals.confirmed / totals.segments) * 100) : 0
  const sections = []

  sections.push(`<h1>项目翻译报告 · ${escapeHtml(project.name)}</h1>`)
  sections.push(
    `<p class="subtitle">客户：${escapeHtml(project.client || '（未填写）')} · 截止日期：${escapeHtml(project.dueAt || '（未填写）')} · 生成时间：${escapeHtml(quote.generatedAt)}</p>`,
  )
  sections.push(
    `<div class="kpis">
      ${kpi('文档', String(docsRows.length))}
      ${kpi('已完成', `${done}/${docsRows.length}`)}
      ${kpi('句段', String(totals.segments))}
      ${kpi('字数', String(totals.words))}
      ${kpi('确认进度', `${percent}%`)}
      ${kpi('工时', `${Math.floor(time.totalMinutes / 60)}h ${time.totalMinutes % 60}m`)}
      ${kpi('报价', `${quote.total} ${quote.currency}`)}
    </div>`,
  )

  sections.push('<h2>文档状态</h2>')
  sections.push(`<table><thead><tr>
    <th>文档</th><th>语言对</th><th class="num">句段</th><th class="num">字数</th>
    <th>状态</th><th class="num">进度</th><th class="num">重复</th>
    <th class="num">高危</th><th class="num">复核</th><th class="num">提示</th>
  </tr></thead><tbody>`)
  for (const row of docsRows) {
    sections.push(`<tr>
      <td>${escapeHtml(row.name)}</td>
      <td class="muted">${escapeHtml(row.sourceLang)} → ${escapeHtml(row.targetLang)}</td>
      <td class="num">${row.segments}</td>
      <td class="num">${row.words}</td>
      <td>${statusBadge(row.status, row.statusLabel)}</td>
      <td class="num">${row.percent}%</td>
      <td class="num">${row.duplicates}</td>
      <td class="num">${row.high}</td>
      <td class="num">${row.medium}</td>
      <td class="num">${row.low}</td>
    </tr>`)
  }
  sections.push('</tbody></table>')

  sections.push('<h2>匹配分析</h2>')
  sections.push(
    `<p class="muted">匹配率 ${escapeHtml(String(totals.matchedPercent))}%（${totals.matched}/${totals.segments} 句段），加权字数 ${escapeHtml(String(totals.weighted))}。</p>`,
  )
  sections.push(`<table><thead><tr>
    <th>档位</th><th class="num">句段</th><th class="num">字数</th><th class="num">系数</th><th class="num">金额</th>
  </tr></thead><tbody>`)
  for (const line of quote.lines) {
    sections.push(`<tr><td>${escapeHtml(line.label)}</td><td class="num">${line.segments}</td><td class="num">${line.words}</td><td class="num">${line.discount}</td><td class="num">${line.amount}</td></tr>`)
  }
  sections.push(`<tr><td><b>合计</b></td><td class="num">${totals.segments}</td><td class="num">${totals.words}</td><td></td><td class="num"><b>${quote.total} ${escapeHtml(quote.currency)}</b></td></tr>`)
  sections.push('</tbody></table>')
  sections.push(
    `<p class="muted">单价 ${escapeHtml(String(quote.rate))} ${escapeHtml(quote.currency)} / ${escapeHtml(quote.unitLabel)} · 小计 ${escapeHtml(String(quote.subtotal))} · 最低收费 ${escapeHtml(String(quote.minimum))} · 合计 ${escapeHtml(String(quote.total))} ${escapeHtml(quote.currency)}</p>`,
  )

  const issueRows = []
  for (const row of docsRows) {
    for (const item of reportItems(row.items)) {
      issueRows.push(`<tr><td>${escapeHtml(row.name)}</td><td class="num">${item.index + 1}</td><td>${escapeHtml(item.code)}</td><td>${escapeHtml(item.severity)}</td><td>${escapeHtml(item.message)}</td></tr>`)
    }
  }
  sections.push('<h2>交付前检查</h2>')
  sections.push(`<p class="muted">高危 ${sum('high')} · 复核 ${sum('medium')} · 提示 ${sum('low')}</p>`)
  if (issueRows.length) {
    sections.push('<table><thead><tr><th>文档</th><th class="num">句段</th><th>代码</th><th>级别</th><th>说明</th></tr></thead><tbody>')
    sections.push(...issueRows)
    sections.push('</tbody></table>')
  }

  sections.push('<h2>工时</h2>')
  sections.push(
    `<p class="muted">已记录 ${time.recordedMinutes} 分${time.running ? ` · 计时中 ${time.runningMinutes} 分` : ''} · 合计 ${time.totalMinutes} 分</p>`,
  )
  if (time.entries.length) {
    sections.push('<table><thead><tr><th>时间</th><th class="num">分钟</th><th>备注</th></tr></thead><tbody>')
    for (const entry of reportItems(time.entries)) {
      sections.push(`<tr><td>${escapeHtml(entry.at)}</td><td class="num">${entry.minutes}</td><td>${escapeHtml(entry.note)}</td></tr>`)
    }
    sections.push('</tbody></table>')
  }

  if (project.note) {
    sections.push('<h2>项目备注</h2>')
    sections.push(`<p>${escapeHtml(project.note)}</p>`)
  }
  if (analysis.failed.length) {
    sections.push('<h2>未能分析的文档</h2>')
    sections.push(`<ul>${analysis.failed.map((line) => `<li>${escapeHtml(line)}</li>`).join('')}</ul>`)
  }

  return reportHtml({
    title: `项目翻译报告 · ${project.name}`,
    subtitle: project.client,
    sections,
  })
}

function documentReportHtml(doc, status, analysis, quote, checks) {
  const sections = []
  sections.push(`<h1>文档翻译报告 · ${escapeHtml(doc.name)}</h1>`)
  sections.push(
    `<p class="subtitle">${escapeHtml(doc.sourceLang)} → ${escapeHtml(doc.targetLang)} · 生成时间：${escapeHtml(quote.generatedAt)}</p>`,
  )
  sections.push(
    `<div class="kpis">
      ${kpi('状态', status.label)}
      ${kpi('进度', `${status.percent}%`)}
      ${kpi('句段', String(analysis.segments))}
      ${kpi('字数', String(analysis.words))}
      ${kpi('字符', String(analysis.characters))}
      ${kpi('匹配率', `${analysis.matched.percent}%`)}
      ${kpi('报价', `${quote.total} ${quote.currency}`)}
    </div>`,
  )

  sections.push('<h2>匹配分析</h2>')
  sections.push('<table><thead><tr><th>档位</th><th class="num">句段</th><th class="num">字数</th><th class="num">系数</th><th class="num">金额</th></tr></thead><tbody>')
  for (const line of quote.lines) {
    sections.push(`<tr><td>${escapeHtml(line.label)}</td><td class="num">${line.segments}</td><td class="num">${line.words}</td><td class="num">${line.discount}</td><td class="num">${line.amount}</td></tr>`)
  }
  sections.push(`<tr><td><b>合计</b></td><td class="num">${analysis.segments}</td><td class="num">${analysis.words}</td><td></td><td class="num"><b>${quote.total} ${escapeHtml(quote.currency)}</b></td></tr>`)
  sections.push('</tbody></table>')
  sections.push(
    `<p class="muted">单价 ${escapeHtml(String(quote.rate))} ${escapeHtml(quote.currency)} / ${escapeHtml(quote.unitLabel)} · 小计 ${escapeHtml(String(quote.subtotal))} · 最低收费 ${escapeHtml(String(quote.minimum))}</p>`,
  )

  sections.push('<h2>交付前检查</h2>')
  sections.push(`<p class="muted">高危 ${checks.counts.high} · 复核 ${checks.counts.medium} · 提示 ${checks.counts.low}</p>`)
  if (checks.items.length) {
    sections.push('<table><thead><tr><th class="num">句段</th><th>代码</th><th>级别</th><th>说明</th></tr></thead><tbody>')
    for (const item of reportItems(checks.items)) {
      sections.push(`<tr><td class="num">${item.index + 1}</td><td>${escapeHtml(item.code)}</td><td>${escapeHtml(item.severity)}</td><td>${escapeHtml(item.message)}</td></tr>`)
    }
    sections.push('</tbody></table>')
  }

  return reportHtml({
    title: `文档翻译报告 · ${doc.name}`,
    subtitle: `${doc.sourceLang} → ${doc.targetLang}`,
    sections,
  })
}
