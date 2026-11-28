/**
 * 项目（project）页：这里是插件打开后的第一个视图。
 *
 * 左边是项目列表（「未分类」固定排最后），右边是选中项目的详情：统计、
 * 共享 brief、共享 TM/术语库、文档清单（带状态与报告入口）、工时、交付。
 * 顶部次级标签切到「所有文档」，跨项目按状态筛文档。
 */

import { h, useState, useEffect, useRef } from '../react.js'
import { Spinner, Icon, Modal } from './base.js'

// 「所有文档」草稿导出：客户/评审最常用的六种，完整格式仍在文档视图的导出对话框里。
const DOC_EXPORT_FORMATS = [
  ['docx', 'modal.export.docx'],
  ['bilingual-docx', 'modal.export.bilingualDocx'],
  ['bilingual-xlsx', 'modal.export.bilingualXlsx'],
  ['tmx', 'modal.export.tmx'],
  ['xliff', 'modal.export.xliff'],
  ['bilingual-csv', 'modal.export.bilingualCsv'],
]

function reportItems(t, onPickReport, target) {
  return [
    {
      key: 'html',
      label: t('projects.reportHtml'),
      icon: 'file',
      onClick: () => onPickReport({ ...target, format: 'html' }),
    },
    {
      key: 'csv',
      label: t('projects.reportCsv'),
      icon: 'download',
      onClick: () => onPickReport({ ...target, format: 'csv' }),
    },
  ]
}

const BRIEF_FIELDS = [
  ['domain', 'projects.domain'],
  ['audience', 'projects.audience'],
  ['tone', 'projects.tone'],
  ['notes', 'projects.notes'],
  ['doNotTranslate', 'projects.doNotTranslate'],
  ['styleSample', 'projects.styleSample'],
]

const INCLUDE_KEYS = [
  ['target', 'deliver.includeTarget'],
  ['bilingual', 'deliver.includeBilingual'],
  ['glossary', 'deliver.includeGlossary'],
  ['qa', 'deliver.includeQa'],
  ['analysis', 'deliver.includeAnalysis'],
  ['notes', 'deliver.includeNotes'],
  ['readme', 'deliver.includeReadme'],
]

const STATUS_FILTERS = ['', 'untranslated', 'incomplete', 'translated', 'done']

const STATUS_LABEL = {
  done: 'projects.statusDone',
  translated: 'projects.statusTranslated',
  incomplete: 'projects.statusIncomplete',
  untranslated: 'projects.statusUntranslated',
}

/** TM/术语库下拉：空字符串继承全局挂载，'__none__' 表示明确不读任何库。 */
function librarySelectValue(ids) {
  if (ids === null || ids === undefined) return ''
  if (!ids.length) return '__none__'
  return ids[0]
}

function librarySelectIds(value) {
  if (value === '') return null
  if (value === '__none__') return []
  return [value]
}

/** 文档/项目的更新时间：本地时区 `YYYY-MM-DD HH:mm`，空值显示破折号。 */
/** 移动菜单项：列出「其他项目 + 未分类」，排除文档当前所在项目（空字符串与 project_inbox 视为同一项）。 */
function moveMenuItems(t, projects, doc, onMove) {
  const list = (projects ?? []).slice()
  if (!list.some((project) => project.inbox)) {
    list.unshift({ id: '', name: t('projects.inboxTag'), inbox: true })
  }
  const currentId = doc.projectId === 'project_inbox' ? '' : doc.projectId || ''
  return list
    .filter((project) => (project.inbox ? '' : project.id) !== currentId)
    .map((project) => ({
      key: project.id || 'inbox',
      label: project.name,
      icon: 'folder',
      onClick: () => onMove(doc.id, project.id),
    }))
}

function formatStamp(value) {
  if (!value) return '—'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return '—'
  const pad = (part) => String(part).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`
}

function statusChip(t, doc) {  const code = doc.status?.code ?? doc.status ?? ''
  const label = doc.status?.label ?? doc.statusLabel ?? t(STATUS_LABEL[code] ?? 'projects.statusUntranslated')
  return h('span', { className: `cait-proj-status is-${code}` }, label)
}

function ProjectList({ t, busy, state, projects: projectsProp, onSelect, onCreate }) {
  const projects = projectsProp ?? state?.list?.projects ?? []
  const active = state?.project?.id ?? ''
  const [name, setName] = useState('')

  return h(
    'div',
    { className: 'cait-proj-list' },
    h(
      'div',
      { className: 'cait-proj-new' },
      h('input', {
        className: 'cait-input',
        placeholder: t('projects.newPlaceholder'),
        value: name,
        onChange: (event) => setName(event.target.value),
        onKeyDown: (event) => {
          if (event.key !== 'Enter' || !name.trim()) return
          onCreate(name.trim()).then((created) => {
            if (created) setName('')
          })
        },
      }),
      h(
        'button',
        {
          type: 'button',
          className: 'cait-btn cait-btn-primary',
          disabled: Boolean(busy) || !name.trim(),
          onClick: async () => {
            const created = await onCreate(name.trim())
            if (created) setName('')
          },
        },
        h(Icon, { name: 'plus', size: 13 }),
      ),
    ),
    projects.length
      ? h(
          'ul',
          { className: 'cait-proj-items' },
          projects.map((project) =>
            h(
              'li',
              { key: project.id },
              h(
                'button',
                {
                  type: 'button',
                  className: `cait-proj-item${project.id === active ? ' is-active' : ''}${project.overdue ? ' is-overdue' : ''}`,
                  onClick: () => onSelect(project.id),
                },
                h(
                  'span',
                  { className: 'cait-proj-item-title' },
                  h('span', { className: 'cait-proj-item-name' }, project.name),
                  project.inbox && project.name !== t('projects.inboxTag')
                    ? h('span', { className: 'cait-proj-tag' }, t('projects.inboxTag'))
                    : null,
                ),
                h(
                  'span',
                  { className: 'cait-proj-item-meta' },
                  `${project.documents} ${t('projects.docsUnit')} · ${project.percent ?? 0}%` +
                    (project.running ? ` · ${t('projects.running')}` : '') +
                    (project.overdue ? ` · ${t('projects.overdueShort')}` : ''),
                ),
              ),
            ),
          ),
        )
      : h('p', { className: 'cait-hint' }, t('projects.empty')),
  )
}

const SECTIONS_KEY = 'cait.project.sections'

function readSections() {
  try {
    const raw = window.localStorage.getItem(SECTIONS_KEY)
    const parsed = raw ? JSON.parse(raw) : null
    return parsed && typeof parsed === 'object' ? parsed : {}
  } catch {
    return {}
  }
}

/** 小菜单：点外部或按 Esc 关闭；item.keep 为真时点击后不收起。 */
function Menu({ t, label, icon, items, disabled, align = 'right', compact = false }) {
  const [open, setOpen] = useState(false)
  // 弹层用 fixed 定位：表格容器是 overflow:auto，绝对定位会被裁掉。
  const [pos, setPos] = useState(null)
  const box = useRef(null)
  useEffect(() => {
    if (!open) return undefined
    const onDoc = (event) => {
      if (!box.current || box.current.contains(event.target)) return
      setOpen(false)
    }
    const onKey = (event) => {
      if (event.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', onDoc)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDoc)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])
  return h(
    'span',
    { className: `cait-menu is-${align}${compact ? ' is-compact' : ''}`, ref: box },
    h(
      'button',
      {
        type: 'button',
        className: compact ? 'cait-btn is-mini cait-menu-trigger' : 'cait-btn cait-menu-trigger',
        disabled: Boolean(disabled),
        'aria-haspopup': 'menu',
        'aria-expanded': open ? 'true' : 'false',
        'aria-label': compact ? label || t('projects.rowMore') : undefined,
        title: compact ? label || t('projects.rowMore') : undefined,
        onClick: () => {
          if (!open && box.current) {
            const rect = box.current.getBoundingClientRect()
            const width = 184
            const left =
              align === 'right'
                ? Math.max(8, rect.right - width)
                : Math.min(Math.max(8, rect.left), window.innerWidth - width - 8)
            const below = rect.bottom + 4
            const flip = below + 220 > window.innerHeight && rect.top > 240
            setPos({ top: flip ? Math.max(8, rect.top - 224) : below, left })
          }
          setOpen((value) => !value)
        },
      },
      compact
        ? h('span', { className: 'cait-menu-dots' }, '⋯')
        : [
            icon ? h(Icon, { name: icon, size: 13, key: 'icon' }) : null,
            h('span', { key: 'label' }, label),
            h('span', { className: 'cait-menu-caret', key: 'caret' }, '▾'),
          ],
    ),
    open
      ? h(
          'div',
          {
            className: 'cait-menu-pop',
            role: 'menu',
            style: pos
              ? { position: 'fixed', top: `${pos.top}px`, left: `${pos.left}px`, right: 'auto' }
              : undefined,
          },
          items.map((item) =>
            h(
              'button',
              {
                key: item.key,
                type: 'button',
                role: 'menuitem',
                className: `cait-menu-item${item.danger ? ' is-danger' : ''}`,
                disabled: Boolean(item.disabled),
                onClick: () => {
                  if (!item.keep) setOpen(false)
                  item.onClick()
                },
              },
              item.icon ? h(Icon, { name: item.icon, size: 12 }) : null,
              h('span', null, item.label),
            ),
          ),
        )
      : null,
  )
}

/** 分区卡片：可折叠（onToggle 缺省时标题不可点，用于文档区）。 */
function Panel({ title, count, actions, open = true, onToggle, hint, children }) {
  const collapsible = typeof onToggle === 'function'
  const head = [
    collapsible ? h('span', { className: 'cait-panel-caret', key: 'caret' }, open ? '▾' : '▸') : null,
    h('span', { className: 'cait-panel-title', key: 'title' }, title),
    count !== undefined && count !== null
      ? h('span', { className: 'cait-panel-count', key: 'count' }, String(count))
      : null,
  ]
  return h(
    'section',
    { className: `cait-panel${open ? ' is-open' : ''}` },
    h(
      'div',
      { className: 'cait-panel-head' },
      collapsible
        ? h(
            'button',
            {
              type: 'button',
              className: 'cait-panel-toggle',
              'aria-expanded': open ? 'true' : 'false',
              onClick: onToggle,
            },
            head,
          )
        : h('div', { className: 'cait-panel-toggle is-static' }, head),
      actions ? h('div', { className: 'cait-panel-actions' }, actions) : null,
    ),
    open
      ? h(
          'div',
          { className: 'cait-panel-body' },
          hint ? h('p', { className: 'cait-hint' }, hint) : null,
          children,
        )
      : null,
  )
}

function ProjectDetail({
  t,
  busy,
  saving,
  dirty,
  state,
  documents,
  libraries,
  includePrefs,
  draft,
  epoch,
  docId,
  onDraft,
  onInclude,
  onSave,
  onToggleDoc,
  onDelete,
  onStart,
  onStop,
  onAddTime,
  onDeleteTime,
  onExport,
  onOpenDoc,
  onNewDoc,
  onImportDoc,
  onReorderDoc,
  projects,
  onMoveDoc,
  onDocReport,
  onPickReport,
  onRefreshAnalysis,
}) {
  const project = state?.project ?? null
  const analysis = state?.analysis ?? null
  const stale = Boolean(state?.analysisStale)
  const projectId = project?.id ?? ''
  const [fields, setFields] = useState({ name: '', client: '', dueAt: '', note: '' })
  const [brief, setBrief] = useState({})
  const [tmValue, setTmValue] = useState('')
  const [glossaryValue, setGlossaryValue] = useState('')
  const [defaultTm, setDefaultTm] = useState('')
  const [include, setInclude] = useState({
    target: true,
    bilingual: true,
    glossary: true,
    qa: true,
    analysis: true,
    notes: false,
    readme: true,
    ...(includePrefs ?? {}),
  })
  const [minutes, setMinutes] = useState('30')
  const [timeNote, setTimeNote] = useState('')
  const [confirmDelete, setConfirmDelete] = useState(false)
  // 折叠状态必须在任何提前 return 之前声明：ProjectDetail 在没有项目时先渲染占位，
  // 如果 useState 放在 return 之后，第二次渲染的 hook 数量会变，React 直接抛 #310。
  const [openSections, setOpenSections] = useState(() => readSections())

  // 草稿只在切换项目时回填一次；之后用户输入自己说了算，不会被刷新覆盖。
  useEffect(() => {
    if (!project || !projectId) return
    const restored = draft && draft.fields ? draft : null
    setFields(
      restored
        ? { ...restored.fields }
        : {
            name: project.name ?? '',
            client: project.client ?? '',
            dueAt: project.dueAt ?? '',
            note: project.note ?? '',
          },
    )
    setBrief(restored ? { ...(restored.brief ?? {}) } : project.brief ? { ...project.brief } : {})
    setTmValue(restored?.tmValue ?? librarySelectValue(project.tmIds))
    setGlossaryValue(restored?.glossaryValue ?? librarySelectValue(project.glossaryIds))
    setDefaultTm(restored?.defaultTm ?? project.defaultWriteTmId ?? '')
    setMinutes(restored?.minutes ?? '30')
    setTimeNote(restored?.timeNote ?? '')
    setConfirmDelete(false)
  }, [projectId, epoch])

  if (!project) {
    return h('div', { className: 'cait-proj-detail' }, h('p', { className: 'cait-hint' }, t('projects.pick')))
  }

  const tmLibraries = libraries?.tm ?? []
  const glossaryLibraries = libraries?.glossary ?? []
  const effectiveTm = project.resources?.effectiveTmIds ?? []
  const inbox = Boolean(project.inbox)
  const rows = Array.isArray(project.documentRows) ? project.documentRows : []
  const quoteTotal = analysis?.quote?.total
  const currency = analysis?.quote?.currency ?? ''

  /** 把当前整套表单作为草稿交给 controller：离开/切换时能恢复，也能提醒未保存。 */
  const pushDraft = (next, markDirty = true) => {
    onDraft(
      {
        fields: next.fields,
        brief: next.brief,
        tmValue: next.tmValue,
        glossaryValue: next.glossaryValue,
        defaultTm: next.defaultTm,
        minutes: next.minutes,
        timeNote: next.timeNote,
        settings: {
          name: next.fields.name,
          client: next.fields.client,
          dueAt: next.fields.dueAt,
          note: next.fields.note,
          tmIds: librarySelectIds(next.tmValue),
          glossaryIds: librarySelectIds(next.glossaryValue),
          defaultWriteTmId: next.defaultTm || null,
        },
      },
      markDirty,
    )
  }

  const base = () => ({ fields, brief, tmValue, glossaryValue, defaultTm, minutes, timeNote })

  const setField = (key, value) => {
    const nextFields = { ...fields, [key]: value }
    setFields(nextFields)
    pushDraft({ ...base(), fields: nextFields })
  }

  const setBriefField = (key, value) => {
    const next = { ...brief, [key]: value }
    setBrief(next)
    pushDraft({ ...base(), brief: next })
  }

  const chooseTm = (value) => {
    setTmValue(value)
    pushDraft({ ...base(), tmValue: value })
  }

  const chooseGlossary = (value) => {
    setGlossaryValue(value)
    pushDraft({ ...base(), glossaryValue: value })
  }

  const chooseDefaultTm = (value) => {
    setDefaultTm(value)
    pushDraft({ ...base(), defaultTm: value })
  }

  const editMinutes = (value) => {
    setMinutes(value)
    pushDraft({ ...base(), minutes: value }, false)
  }

  const editTimeNote = (value) => {
    setTimeNote(value)
    pushDraft({ ...base(), timeNote: value }, false)
  }

  const toggleInclude = (key) => {
    const next = { ...include, [key]: !include[key] }
    setInclude(next)
    onInclude(next)
  }

  const toggleSection = (key) =>
    setOpenSections((prev) => {
      const next = { ...prev, [key]: !prev[key] }
      try {
        window.localStorage.setItem(SECTIONS_KEY, JSON.stringify(next))
      } catch {
        // localStorage 不可用时只在本次会话生效
      }
      return next
    })
  const sectionOpen = (key) => Boolean(openSections[key])

  const meta = [
    [t('projects.client'), fields.client || '—'],
    [t('projects.dueAt'), fields.dueAt || '—'],
    [t('projects.documents'), String(project.documents ?? 0)],
    [t('projects.segments'), String(project.segments ?? 0)],
    [t('projects.percent'), `${project.percent ?? 0}%`],
    [t('projects.minutes'), String(project.minutes ?? 0)],
  ]
  if (quoteTotal !== undefined) {
    meta.push([t('projects.quote'), `${currency} ${Number(quoteTotal).toFixed(2)}`])
  }

  const docActions = !inbox
    ? [
        h(
          'button',
          {
            key: 'new',
            type: 'button',
            className: 'cait-btn cait-btn-primary',
            disabled: Boolean(busy),
            onClick: () => onNewDoc(projectId),
          },
          h(Icon, { name: 'plus', size: 13 }),
          h('span', null, t('projects.newDoc')),
        ),
        h(
          'button',
          {
            key: 'import',
            type: 'button',
            className: 'cait-btn',
            disabled: Boolean(busy),
            onClick: () => onImportDoc(projectId),
          },
          h(Icon, { name: 'upload', size: 13 }),
          h('span', null, t('projects.importDoc')),
        ),
      ]
    : null

  const docTable = h(
    'div',
    { className: 'cait-proj-tablewrap' },
    h(
      'table',
      { className: 'cait-table cait-proj-table' },
      h(
        'colgroup',
        null,
        h('col', { style: { width: '22%' } }),
        h('col', { style: { width: '10%' } }),
        h('col', { style: { width: '14%' } }),
        h('col', { style: { width: '7%' } }),
        h('col', { style: { width: '8%' } }),
        h('col', { style: { width: '13%' } }),
        h('col', { style: { width: '18%' } }),
        h('col', { style: { width: '8%' } }),
      ),
      h(
        'thead',
        null,
        h(
          'tr',
          null,
          h('th', null, t('projects.colDocument')),
          h('th', null, t('projects.colStatus')),
          h('th', null, t('projects.colProgress')),
          h('th', null, t('projects.colSegments')),
          h('th', null, t('projects.colWords')),
          h('th', null, t('projects.colUpdated')),
          h('th', null, t('projects.colActions')),
          h('th', null, t('projects.colReports')),
        ),
      ),
      h(
        'tbody',
        null,
        rows.length
          ? rows.map((doc, rowIndex) =>
              h(
                'tr',
                {
                  key: doc.id,
                  className: `cait-proj-row${doc.id === docId ? ' is-current' : ''}`,
                  title: t('projects.openDoc'),
                  onClick: () => onOpenDoc(doc.id),
                },
                h(
                  'td',
                  null,
                  h(
                    'button',
                    {
                      type: 'button',
                      className: 'cait-linkbtn cait-proj-docname',
                      onClick: (event) => {
                        event.stopPropagation()
                        onOpenDoc(doc.id)
                      },
                    },
                    doc.name,
                  ),
                ),
                h('td', null, statusChip(t, doc)),
                h(
                  'td',
                  null,
                  h('div', { className: 'cait-proj-progress' },
                    h(
                      'div',
                      { className: 'cait-proj-bar', title: `${doc.percent}%` },
                      h('span', { style: { width: `${doc.percent}%` } }),
                    ),
                    h('span', { className: 'cait-proj-percent' }, `${doc.percent}%`),
                  ),
                ),
                h('td', null, doc.segments),
                h('td', null, doc.words),
                h('td', { className: 'cait-proj-updated' }, formatStamp(doc.updatedAt)),
                h(
                  'td',
                  null,
                  h(
                    'div',
                    { className: 'cait-proj-rowactions', onClick: (event) => event.stopPropagation() },
                    h(
                      'button',
                      {
                        type: 'button',
                        className: 'cait-btn is-mini',
                        title: t('projects.openDoc'),
                        onClick: () => onOpenDoc(doc.id),
                      },
                      h(Icon, { name: 'arrowRight', size: 12 }),
                      h('span', null, t('projects.openDoc')),
                    ),
                    h(
                      'button',
                      {
                        type: 'button',
                        className: 'cait-btn is-mini is-icon',
                        title: t('projects.moveUp'),
                        'aria-label': t('projects.moveUp'),
                        disabled: Boolean(busy) || rowIndex === 0,
                        onClick: () => onReorderDoc(doc.id, 'up'),
                      },
                      h(Icon, { name: 'arrowUp', size: 13 }),
                    ),
                    h(
                      'button',
                      {
                        type: 'button',
                        className: 'cait-btn is-mini is-icon',
                        title: t('projects.moveDown'),
                        'aria-label': t('projects.moveDown'),
                        disabled: Boolean(busy) || rowIndex === rows.length - 1,
                        onClick: () => onReorderDoc(doc.id, 'down'),
                      },
                      h(Icon, { name: 'arrowDown', size: 13 }),
                    ),
                    h(Menu, {
                      t,
                      label: t('projects.moveToProject'),
                      icon: 'folder',
                      disabled: Boolean(busy),
                      items: moveMenuItems(t, projects, doc, onMoveDoc),
                    }),
                  ),
                ),
                h(
                  'td',
                  null,
                  h(
                    'div',
                    { className: 'cait-proj-rowactions', onClick: (event) => event.stopPropagation() },
                    h(Menu, {
                      t,
                      label: t('projects.format'),
                      disabled: Boolean(busy),
                      items: reportItems(t, onPickReport, { kind: 'doc', documentId: doc.id, name: doc.name }),
                    }),
                  ),
                ),
              ),
            )
          : h(
              'tr',
              null,
              h('td', { colSpan: 8 }, h('span', { className: 'cait-hint' }, t('projects.noDocs'))),
            ),
      ),
    ),
  )

  const candidates = (documents ?? []).filter((item) => item.projectId !== projectId)
  const addMore = candidates.length
    ? h(
        'details',
        { className: 'cait-proj-addmore' },
        h(
          'summary',
          null,
          h(Icon, { name: 'plus', size: 13 }),
          t('projects.addDocs'),
        ),
        h(
          'ul',
          { className: 'cait-check-list' },
          candidates.map((item) =>
            h(
              'li',
              { key: item.id },
              h(
                'label',
                { className: 'cait-check' },
                h('input', {
                  type: 'checkbox',
                  checked: false,
                  onChange: (event) => onToggleDoc(item.id, event.target.checked),
                }),
                h('span', null, `${item.name}${item.id === docId ? ` · ${t('projects.current')}` : ''}`),
              ),
              item.projectId && item.projectId !== projectId
                ? h('span', { className: 'cait-hint' }, `→ ${item.projectName ?? ''}`)
                : null,
            ),
          ),
        ),
      )
    : null

  return h(
    'div',
    { className: 'cait-proj-detail' },
    h(
      'header',
      { className: 'cait-proj-hero' },
      h(
        'div',
        { className: 'cait-proj-hero-main' },
        h(
          'h2',
          { className: 'cait-proj-title' },
          project.name,
          inbox ? h('span', { className: 'cait-proj-tag' }, t('projects.inboxTag')) : null,
        ),
        h(
          'div',
          { className: 'cait-proj-meta' },
          meta.map(([label, value]) =>
            h('span', { key: label }, h('b', null, label), value),
          ),
        ),
        h('p', { className: 'cait-hint' }, inbox ? t('projects.inboxHint') : t('projects.detailHint')),
        project.overdue
          ? h('p', { className: 'cait-hint is-danger' }, t('projects.overdue', { dueAt: project.dueAt }))
          : null,
        analysis
          ? h(
              'p',
              { className: 'cait-hint' },
              `${t('projects.analysis')}：${t('projects.analysisValue', {
                matched: Math.round(analysis.totals?.matchedPercent ?? 0),
                fresh: analysis.totals?.buckets?.new ?? 0,
              })}`,
            )
          : null,
        dirty ? h('span', { className: 'cait-proj-dirty' }, t('projects.unsavedHint')) : null,
      ),
      h(
        'div',
        { className: 'cait-proj-hero-actions' },
        h(
          'button',
          {
            type: 'button',
            className: 'cait-btn cait-btn-primary',
            disabled: Boolean(busy) || !dirty,
            onClick: () => onSave(),
          },
          saving ? h(Spinner, { size: 13 }) : h(Icon, { name: 'save', size: 13 }),
          h('span', null, t('projects.saveSettings')),
        ),
        h(
          'button',
          {
            type: 'button',
            className: 'cait-btn',
            title: t('projects.export'),
            disabled: Boolean(busy),
            onClick: () => onExport(include),
          },
          h(Icon, { name: 'download', size: 13 }),
          h('span', null, t('projects.export')),
        ),
        h(Menu, {
          t,
          label: t('projects.report'),
          icon: 'file',
          disabled: Boolean(busy),
          items: reportItems(t, onPickReport, { kind: 'project', projectId, name: project.name }),
        }),
        h(
          'button',
          {
            type: 'button',
            className: 'cait-btn',
            title: t('projects.refreshAnalysis'),
            disabled: Boolean(busy),
            onClick: () => onRefreshAnalysis(),
          },
          h(Icon, { name: 'chart', size: 13 }),
          h('span', null, t('projects.refreshAnalysis')),
        ),
        inbox
          ? null
          : confirmDelete
            ? h(
                'span',
                { className: 'cait-confirm' },
                h(
                  'button',
                  {
                    type: 'button',
                    className: 'cait-btn is-danger',
                    title: t('projects.deleteConfirm'),
                    disabled: Boolean(busy),
                    onClick: () => onDelete(),
                  },
                  h(Icon, { name: 'trash', size: 13 }),
                  h('span', null, t('projects.deleteConfirm')),
                ),
                h(
                  'button',
                  {
                    type: 'button',
                    className: 'cait-btn',
                    title: t('panel.cancel'),
                    disabled: Boolean(busy),
                    onClick: () => setConfirmDelete(false),
                  },
                  h('span', null, t('panel.cancel')),
                ),
              )
            : h(
                'button',
                {
                  type: 'button',
                  className: 'cait-btn is-danger',
                  title: t('projects.delete'),
                  disabled: Boolean(busy),
                  onClick: () => setConfirmDelete(true),
                },
                h(Icon, { name: 'trash', size: 13 }),
                h('span', null, t('projects.delete')),
              ),
      ),
    ),
    h(
      Panel,
      {
        title: t('projects.docs'),
        count: rows.length,
        actions: docActions,
        hint: t('projects.docsHint'),
      },
      docTable,
      addMore,
    ),
    h(
      Panel,
      {
        title: t('projects.settings'),
        open: sectionOpen('settings'),
        onToggle: () => toggleSection('settings'),
      },
      h(
        'div',
        { className: 'cait-formrow' },
        h(
          'label',
          { className: 'cait-field' },
          h('span', null, t('projects.fieldName')),
          h('input', {
            className: 'cait-input',
            value: fields.name,
            onChange: (event) => setField('name', event.target.value),
          }),
        ),
        h(
          'label',
          { className: 'cait-field' },
          h('span', null, t('projects.client')),
          h('input', {
            className: 'cait-input',
            value: fields.client,
            onChange: (event) => setField('client', event.target.value),
          }),
        ),
        h(
          'label',
          { className: 'cait-field' },
          h('span', null, t('projects.dueAt')),
          h('input', {
            className: 'cait-input',
            type: 'date',
            value: fields.dueAt,
            onChange: (event) => setField('dueAt', event.target.value),
          }),
        ),
      ),
      h(
        'label',
        { className: 'cait-field' },
        h('span', null, t('projects.note')),
        h('textarea', {
          className: 'cait-input',
          rows: 2,
          value: fields.note,
          onChange: (event) => setField('note', event.target.value),
        }),
      ),
    ),
    h(
      Panel,
      {
        title: t('projects.brief'),
        open: sectionOpen('brief'),
        onToggle: () => toggleSection('brief'),
        hint: t('projects.briefHint'),
      },
      h(
        'div',
        { className: 'cait-formrow' },
        BRIEF_FIELDS.map(([field, label]) =>
          h(
            'label',
            { key: field, className: 'cait-field' },
            h('span', null, t(label)),
            field === 'notes' || field === 'doNotTranslate' || field === 'styleSample'
              ? h('textarea', {
                  className: 'cait-input',
                  rows: 2,
                  value: brief[field] ?? '',
                  onChange: (event) => setBriefField(field, event.target.value),
                })
              : h('input', {
                  className: 'cait-input',
                  value: brief[field] ?? '',
                  onChange: (event) => setBriefField(field, event.target.value),
                }),
          ),
        ),
      ),
    ),
    h(
      Panel,
      {
        title: t('projects.resources'),
        open: sectionOpen('resources'),
        onToggle: () => toggleSection('resources'),
      },
      h(
        'div',
        { className: 'cait-formrow' },
        h(
          'label',
          { className: 'cait-field' },
          h('span', null, t('projects.tm')),
          h(
            'select',
            { className: 'cait-input', value: tmValue, onChange: (event) => chooseTm(event.target.value) },
            h('option', { value: '' }, t('projects.inherit')),
            tmLibraries.map((lib) => h('option', { key: lib.tmId, value: lib.tmId }, lib.name)),
            h('option', { value: '__none__' }, t('projects.none')),
          ),
        ),
        h(
          'label',
          { className: 'cait-field' },
          h('span', null, t('projects.glossary')),
          h(
            'select',
            {
              className: 'cait-input',
              value: glossaryValue,
              onChange: (event) => chooseGlossary(event.target.value),
            },
            h('option', { value: '' }, t('projects.inherit')),
            glossaryLibraries.map((lib) =>
              h('option', { key: lib.glossaryId, value: lib.glossaryId }, lib.name),
            ),
            h('option', { value: '__none__' }, t('projects.none')),
          ),
        ),
        h(
          'label',
          { className: 'cait-field' },
          h('span', null, t('projects.defaultTm')),
          h(
            'select',
            {
              className: 'cait-input',
              value: effectiveTm.includes(defaultTm) ? defaultTm : '',
              onChange: (event) => chooseDefaultTm(event.target.value),
            },
            h('option', { value: '' }, t('projects.auto')),
            effectiveTm.map((id) => {
              const lib = tmLibraries.find((item) => item.tmId === id)
              return h('option', { key: id, value: id }, lib?.name ?? id)
            }),
          ),
        ),
      ),
    ),
    h(
      Panel,
      {
        title: t('projects.deliveryTime'),
        open: sectionOpen('delivery'),
        onToggle: () => toggleSection('delivery'),
      },
      h(
        'div',
        { className: 'cait-checks' },
        INCLUDE_KEYS.map(([key, label]) =>
          h(
            'label',
            { key, className: 'cait-check' },
            h('input', {
              type: 'checkbox',
              checked: include[key],
              onChange: () => toggleInclude(key),
            }),
            h('span', null, t(label)),
          ),
        ),
      ),
      h('h5', { className: 'cait-panel-sub' }, t('projects.time')),
      h(
        'div',
        { className: 'cait-chips cait-proj-timer' },
        h(
          'button',
          {
            type: 'button',
            className: 'cait-btn',
            disabled: Boolean(busy) || project.running,
            onClick: () => onStart(),
          },
          h(Icon, { name: 'play', size: 12 }),
          h('span', null, t('projects.start')),
        ),
        h(
          'button',
          {
            type: 'button',
            className: 'cait-btn',
            disabled: Boolean(busy) || !project.running,
            onClick: () => onStop(),
          },
          h(Icon, { name: 'check', size: 12 }),
          h('span', null, t('projects.stop')),
        ),
        h('span', { className: 'cait-hint' }, project.running ? t('projects.running') : ''),
      ),
      h(
        'div',
        { className: 'cait-formrow' },
        h('input', {
          className: 'cait-input',
          style: { width: '80px' },
          value: minutes,
          onChange: (event) => editMinutes(event.target.value),
        }),
        h('input', {
          className: 'cait-input',
          placeholder: t('projects.timeNote'),
          value: timeNote,
          onChange: (event) => editTimeNote(event.target.value),
        }),
        h(
          'button',
          {
            type: 'button',
            className: 'cait-btn',
            disabled: Boolean(busy),
            onClick: async () => {
              const ok = await onAddTime(Number(minutes), timeNote)
              if (ok) {
                setTimeNote('')
                pushDraft({ ...base(), timeNote: '' }, false)
              }
            },
          },
          t('projects.addTime'),
        ),
      ),
      (project.time?.entries ?? []).length
        ? h(
            'ul',
            { className: 'cait-time-list' },
            project.time.entries.map((entry) =>
              h(
                'li',
                { key: entry.id },
                h(
                  'span',
                  null,
                  `${entry.at.slice(0, 10)} · ${entry.minutes} ${t('projects.minutesUnit')}${entry.note ? ` · ${entry.note}` : ''}`,
                ),
                h(
                  'button',
                  { type: 'button', className: 'cait-linkbtn', title: t('projects.deleteTime'), onClick: () => onDeleteTime(entry.id) },
                  h(Icon, { name: 'trash', size: 12 }),
                ),
              ),
            ),
          )
        : null,
    ),
  )
}


function AllDocuments({
  t,
  busy,
  documents,
  projects,
  docId,
  onOpenDoc,
  onPickReport,
  onExportDoc,
  onMove,
  onOpenProject,
}) {
  const [filter, setFilter] = useState('')
  const [query, setQuery] = useState('')
  const rows = (documents ?? []).filter((doc) => {
    const code = doc.status?.code ?? ''
    if (filter && code !== filter) return false
    if (!query.trim()) return true
    const text = `${doc.name} ${doc.projectName ?? ''}`.toLowerCase()
    return text.includes(query.trim().toLowerCase())
  })

  return h(
    'div',
    { className: 'cait-proj-alldocs' },
    h(
      'div',
      { className: 'cait-proj-toolbar' },
      h(
        'div',
        { className: 'cait-chips' },
        STATUS_FILTERS.map((code) =>
          h(
            'button',
            {
              key: code || 'all',
              type: 'button',
              className: `cait-chip${filter === code ? ' is-active' : ''}`,
              onClick: () => setFilter(code),
            },
            code ? t(STATUS_LABEL[code]) : t('projects.statusAll'),
          ),
        ),
      ),
      h('input', {
        className: 'cait-input',
        placeholder: t('projects.search'),
        value: query,
        onChange: (event) => setQuery(event.target.value),
      }),
    ),
    h(
      'div',
      { className: 'cait-proj-tablewrap' },
      h(
        'table',
        { className: 'cait-table cait-proj-table' },
        h(
          'colgroup',
          null,
          h('col', { style: { width: '18%' } }),
          h('col', { style: { width: '10%' } }),
          h('col', { style: { width: '9%' } }),
          h('col', { style: { width: '10%' } }),
          h('col', { style: { width: '6%' } }),
          h('col', { style: { width: '6%' } }),
          h('col', { style: { width: '11%' } }),
          h('col', { style: { width: '13%' } }),
          h('col', { style: { width: '8%' } }),
          h('col', { style: { width: '9%' } }),
        ),
        h(
          'thead',
          null,
          h(
            'tr',
            null,
            h('th', null, t('projects.colDocument')),
            h('th', null, t('projects.colProject')),
            h('th', null, t('projects.colStatus')),
            h('th', null, t('projects.colProgress')),
            h('th', null, t('projects.colSegments')),
            h('th', null, t('projects.colWords')),
            h('th', null, t('projects.colUpdated')),
            h('th', null, t('projects.colActions')),
            h('th', null, t('projects.colExport')),
            h('th', null, t('projects.colReports')),
          ),
        ),
        h(
          'tbody',
          null,
          rows.length
            ? rows.map((doc) =>
                h(
                  'tr',
                  {
                    key: doc.id,
                    className: `cait-proj-row${doc.id === docId ? ' is-current' : ''}`,
                    title: t('projects.openDoc'),
                    onClick: () => onOpenDoc(doc.id),
                  },
                  h(
                    'td',
                    null,
                    h(
                      'button',
                      {
                        type: 'button',
                        className: 'cait-linkbtn',
                        title: doc.name,
                        onClick: (event) => {
                          event.stopPropagation()
                          onOpenDoc(doc.id)
                        },
                      },
                      doc.name,
                    ),
                  ),
                  h(
                    'td',
                    null,
                    h(
                      'button',
                      {
                        type: 'button',
                        className: 'cait-linkbtn',
                        title: doc.projectName || t('projects.inboxTag'),
                        onClick: (event) => {
                          event.stopPropagation()
                          onOpenProject(doc.projectId)
                        },
                      },
                      doc.projectName || t('projects.inboxTag'),
                    ),
                  ),
                  h('td', null, statusChip(t, doc)),
                  h('td', null, `${doc.progress?.percent ?? 0}%`),
                  h('td', null, doc.progress?.total ?? 0),
                  h('td', null, doc.words ?? 0),
                  h('td', { className: 'cait-proj-updated' }, formatStamp(doc.updatedAt)),
                  h(
                    'td',
                    null,
                    h(
                      'span',
                      {
                        className: 'cait-proj-rowactions',
                        onClick: (event) => event.stopPropagation(),
                      },
                      h(Menu, {
                        t,
                        label: t('projects.moveToProject'),
                        icon: 'folder',
                        disabled: Boolean(busy),
                        items: moveMenuItems(t, projects, doc, onMove),
                      }),
                    ),
                  ),
                  h(
                    'td',
                    null,
                    h(
                      'span',
                      {
                        className: 'cait-proj-rowactions',
                        onClick: (event) => event.stopPropagation(),
                      },
                      h(Menu, {
                        t,
                        label: t('projects.format'),
                        disabled: Boolean(busy),
                        items: DOC_EXPORT_FORMATS.map(([format, key]) => ({
                          key: format,
                          label: t(key),
                          icon: 'download',
                          onClick: () => onExportDoc(doc.id, format),
                        })),
                      }),
                    ),
                  ),
                  h(
                    'td',
                    null,
                    h(
                      'span',
                      {
                        className: 'cait-proj-rowactions',
                        onClick: (event) => event.stopPropagation(),
                      },
                      h(Menu, {
                        t,
                        label: t('projects.format'),
                        disabled: Boolean(busy),
                        items: reportItems(t, onPickReport, { kind: 'doc', documentId: doc.id, name: doc.name }),
                      }),
                    ),
                  ),
                ),
              )
            : h(
                'tr',
                null,
                h('td', { colSpan: 10 }, h('span', { className: 'cait-hint' }, t('projects.noMatch'))),
              ),
        ),
      ),
    ),
  )
}

function ProjectsPage({
  t,
  busy,
  saving,
  dirty,
  state,
  documents,
  libraries,
  projects,
  includePrefs,
  draft,
  epoch,
  docId,
  tab,
  onTab,
  onSelect,
  onCreate,
  onDraft,
  onInclude,
  onSave,
  onToggleDoc,
  onDelete,
  onStart,
  onStop,
  onAddTime,
  onDeleteTime,
  onExport,
  onOpenDoc,
  onNewDoc,
  onImportDoc,
  onReport,
  onDocReport,
  onExportDoc,
  onMoveDoc,
  onReorderDoc,
  onRefreshAnalysis,
}) {
  const list = state?.list?.projects ?? projects ?? []
  const documentsCount = (documents ?? []).length
  // 报告格式统一在一个小弹窗里选（HTML 便于阅读/打印，CSV 便于核对数字）。
  const [reportPick, setReportPick] = useState(null)
  const chooseReport = (pick, format) => {
    setReportPick(null)
    const chosen = format || pick.format || 'html'
    if (pick.kind === 'project') onReport(pick.projectId, chosen)
    else onDocReport(pick.documentId, chosen)
  }
  // 「所有文档」的报告列直接给格式，项目页的入口先弹选择框。
  const pickReport = (pick) => (pick.format ? chooseReport(pick) : setReportPick(pick))
  return h(
    'div',
    { className: 'cait-projpage' },
    h(
      'div',
      { className: 'cait-proj-head' },
      h(
        'div',
        { className: 'cait-libtabs' },
        h(
          'button',
          {
            type: 'button',
            className: `cait-libtabs-item${tab === 'projects' ? ' active' : ''}`,
            onClick: () => onTab('projects'),
          },
          t('projects.tabProjects'),
          h('span', { className: 'cait-libtabs-count' }, list.length),
        ),
        h(
          'button',
          {
            type: 'button',
            className: `cait-libtabs-item${tab === 'docs' ? ' active' : ''}`,
            onClick: () => onTab('docs'),
          },
          t('projects.tabDocs'),
          h('span', { className: 'cait-libtabs-count' }, documentsCount),
        ),
      ),
      h('span', { className: 'cait-libhint' }, t('projects.hint')),
    ),
    tab === 'docs'
      ? h(AllDocuments, {
          t,
          busy,
          documents,
          projects: list,
          docId,
          onOpenDoc,
          onPickReport: pickReport,
          onExportDoc,
          onOpenProject: onSelect,
          onMove: onMoveDoc,
        })
      : h(
          'div',
          { className: 'cait-proj-body' },
          h(ProjectList, {
            t,
            busy,
            state,
            projects: list,
            onSelect,
            onCreate,
          }),
          h(ProjectDetail, {
            t,
            busy,
            saving,
            dirty,
            state,
            documents,
            libraries,
            includePrefs,
            draft,
            epoch,
            docId,
            onDraft,
            onInclude,
            onSave,
            onToggleDoc,
            onDelete,
            onStart,
            onStop,
            onAddTime,
            onDeleteTime,
            onExport,
            onOpenDoc,
            onNewDoc,
            onImportDoc,
            onReorderDoc,
            projects: list,
            onMoveDoc,
            onDocReport,
            onPickReport: pickReport,
            onRefreshAnalysis,
          }),
        ),
    reportPick
      ? h(ReportPick, { t, busy, pick: reportPick, onPick: chooseReport, onClose: () => setReportPick(null) })
      : null,
  )
}

/** 报告格式选择：HTML 便于阅读/打印，CSV 便于核对数字。 */
function ReportPick({ t, busy, pick, onPick, onClose }) {
  if (!pick) return null
  const name = pick.name ?? ''
  return h(
    Modal,
    { title: t('projects.reportTitle'), onClose },
    h(
      'p',
      { className: 'cait-hint' },
      pick.kind === 'project'
        ? t('projects.reportHintProject', { name })
        : t('projects.reportHintDoc', { name }),
    ),
    h(
      'div',
      { className: 'cait-report-pick' },
      h(
        'button',
        {
          type: 'button',
          className: 'cait-btn',
          disabled: Boolean(busy),
          onClick: () => onPick(pick, 'html'),
        },
        h(Icon, { name: 'file', size: 13 }),
        h('span', null, t('projects.reportHtml')),
      ),
      h(
        'button',
        {
          type: 'button',
          className: 'cait-btn',
          disabled: Boolean(busy),
          onClick: () => onPick(pick, 'csv'),
        },
        h(Icon, { name: 'download', size: 13 }),
        h('span', null, t('projects.reportCsv')),
      ),
    ),
  )
}

/** 新建文档后的归属确认：已有项目 / 新建项目 / 未分类。 */
function ProjectPicker({ t, busy, pick, onPick, onClose }) {
  const [projectId, setProjectId] = useState('')
  const [newName, setNewName] = useState('')
  const documentId = pick?.documentId ?? ''
  const documentIds = pick?.documentIds ?? []
  useEffect(() => {
    setProjectId('')
    setNewName('')
  }, [documentId, documentIds.join(',')])
  if (!pick) return null
  const projects = pick.projects ?? []
  const many = documentIds.length > 1
  return h(
    Modal,
    { title: t('projects.assignTitle'), onClose },
    h(
      'p',
      { className: 'cait-hint' },
      many ? t('projects.pickMany', { count: documentIds.length }) : t('projects.assignHint', { name: pick.name ?? '' }),
    ),
    h(
      'ul',
      { className: 'cait-proj-picklist' },
      h(
        'li',
        null,
        h(
          'label',
          { className: 'cait-check' },
          h('input', {
            type: 'radio',
            name: 'project-pick',
            checked: projectId === '',
            onChange: () => setProjectId(''),
          }),
          h('span', null, t('projects.assignInbox')),
        ),
      ),
      projects
        .filter((project) => !project.inbox)
        .map((project) =>
          h(
            'li',
            { key: project.id },
            h(
              'label',
              { className: 'cait-check' },
              h('input', {
                type: 'radio',
                name: 'project-pick',
                checked: projectId === project.id,
                onChange: () => setProjectId(project.id),
              }),
              h('span', null, `${project.name} · ${project.documents} ${t('projects.docsUnit')}`),
            ),
          ),
        ),
    ),
    h(
      'label',
      { className: 'cait-field' },
      h('span', null, t('projects.assignNew')),
      h('input', {
        className: 'cait-input',
        placeholder: t('projects.newPlaceholder'),
        value: newName,
        onChange: (event) => setNewName(event.target.value),
      }),
    ),
    h(
      'div',
      { className: 'cait-modal-actions' },
      h(
        'button',
        { type: 'button', className: 'cait-btn', onClick: onClose },
        t('panel.cancel'),
      ),
      h(
        'button',
        {
          type: 'button',
          className: 'cait-btn cait-btn-primary',
          disabled: Boolean(busy),
          onClick: () => onPick({ projectId, newName }),
        },
        busy ? h(Spinner, { size: 13 }) : h(Icon, { name: 'check', size: 13 }),
        h('span', null, t('projects.assign')),
      ),
    ),
  )
}

/** 未保存设置的拦截框：保存并离开 / 放弃修改 / 取消。 */
function ProjectUnsaved({ t, onChoose }) {
  return h(
    Modal,
    { title: t('projects.unsavedTitle'), onClose: () => onChoose('cancel') },
    h('p', { className: 'cait-hint' }, t('projects.unsavedBody')),
    h(
      'div',
      { className: 'cait-modal-actions' },
      h(
        'button',
        { type: 'button', className: 'cait-btn', onClick: () => onChoose('cancel') },
        t('panel.cancel'),
      ),
      h(
        'button',
        { type: 'button', className: 'cait-btn is-danger', onClick: () => onChoose('discard') },
        t('projects.unsavedDiscard'),
      ),
      h(
        'button',
        {
          type: 'button',
          className: 'cait-btn cait-btn-primary',
          onClick: () => onChoose('save'),
        },
        h(Icon, { name: 'save', size: 13 }),
        h('span', null, t('projects.unsavedSave')),
      ),
    ),
  )
}

export { ProjectsPage, ProjectPicker, ProjectUnsaved }
