/**
 * 项目（project）页：这里是插件打开后的第一个视图。
 *
 * 左边是项目列表（「未分类」固定排最后），右边是选中项目的详情：统计、
 * 共享 brief、共享 TM/术语库、文档清单（带状态与报告入口）、工时、交付。
 * 顶部次级标签切到「所有文档」，跨项目按状态筛文档。
 */

import { h, useState, useEffect } from '../react.js'
import { Spinner, Icon, Modal } from './base.js'

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

function ProjectList({ t, busy, state, projects: projectsProp, onSelect, onCreate, onProjectReport }) {
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
                  project.inbox ? h('span', { className: 'cait-proj-tag' }, t('projects.inboxTag')) : null,
                ),
                h(
                  'span',
                  { className: 'cait-proj-item-meta' },
                  `${project.documents} ${t('projects.docsUnit')} · ${project.percent ?? 0}%` +
                    (project.running ? ` · ${t('projects.running')}` : '') +
                    (project.overdue ? ` · ${t('projects.overdueShort')}` : ''),
                ),
              ),
              h(
                'button',
                {
                  type: 'button',
                  className: 'cait-linkbtn cait-proj-report',
                  title: t('projects.report'),
                  onClick: () => onProjectReport(project.id),
                },
                h(Icon, { name: 'chart', size: 12 }),
              ),
            ),
          ),
        )
      : h('p', { className: 'cait-hint' }, t('projects.empty')),
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
  onDocReport,
  onProjectReport,
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

  return h(
    'div',
    { className: 'cait-proj-detail' },
    h(
      'div',
      { className: 'cait-proj-detail-head' },
      h(
        'div',
        null,
        h(
          'h2',
          { className: 'cait-proj-title' },
          project.name,
          inbox ? h('span', { className: 'cait-proj-tag' }, t('projects.inboxTag')) : null,
        ),
        h('p', { className: 'cait-hint' }, inbox ? t('projects.inboxHint') : t('projects.detailHint')),
      ),
      h(
        'div',
        { className: 'cait-proj-head-actions' },
        h(
          'button',
          {
            type: 'button',
            className: 'cait-btn',
            disabled: Boolean(busy),
            onClick: () => onProjectReport(projectId, 'html'),
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
            onClick: () => onProjectReport(projectId, 'csv'),
          },
          h(Icon, { name: 'download', size: 13 }),
          h('span', null, t('projects.reportCsv')),
        ),
      ),
    ),
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
    project.overdue
      ? h('p', { className: 'cait-hint is-danger' }, t('projects.overdue', { dueAt: project.dueAt }))
      : null,
    h(
      'div',
      { className: 'cait-chips' },
      h('span', { className: 'cait-chip' }, `${t('projects.documents')} ${project.documents}`),
      h('span', { className: 'cait-chip' }, `${t('projects.segments')} ${project.segments}`),
      h('span', { className: 'cait-chip' }, `${t('projects.words')} ${project.words}`),
      h('span', { className: 'cait-chip' }, `${t('projects.percent')} ${project.percent ?? 0}%`),
      h('span', { className: 'cait-chip' }, `${t('projects.minutes')} ${project.minutes ?? 0}`),
      h(
        'span',
        { className: 'cait-chip' },
        `${t('projects.completed')} ${project.statusCounts?.done ?? 0}/${project.documents}`,
      ),
      quoteTotal !== undefined
        ? h(
            'span',
            { className: 'cait-chip' },
            `${t('projects.quote')} ${currency} ${Number(quoteTotal).toFixed(2)}`,
          )
        : null,
    ),
    h(
      'div',
      { className: 'cait-proj-analysis' },
      analysis
        ? h(
            'p',
            { className: 'cait-hint' },
            `${t('projects.analysis')}：${t('projects.analysisValue', {
              matched: Math.round(analysis.totals?.matchedPercent ?? 0),
              fresh: analysis.totals?.buckets?.new ?? 0,
            })}`,
          )
        : h('p', { className: 'cait-hint' }, t('projects.analysisNone')),
      stale ? h('span', { className: 'cait-hint is-danger' }, t('projects.analysisStale')) : null,
      h(
        'button',
        {
          type: 'button',
          className: 'cait-minibtn',
          disabled: Boolean(busy),
          title: t('projects.refreshAnalysis'),
          onClick: () => onRefreshAnalysis(),
        },
        h(Icon, { name: 'refresh', size: 12 }),
        h('span', null, t('projects.refreshAnalysis')),
      ),
    ),
    h(
      'div',
      { className: 'cait-proj-actions' },
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
          disabled: Boolean(busy),
          onClick: () => onExport(include),
        },
        h(Icon, { name: 'download', size: 13 }),
        h('span', null, t('projects.export')),
      ),
      dirty ? h('span', { className: 'cait-proj-dirty' }, t('projects.unsavedHint')) : null,
      inbox
        ? null
        : confirmDelete
          ? h(
              'button',
              {
                type: 'button',
                className: 'cait-btn is-danger',
                disabled: Boolean(busy),
                onClick: () => onDelete(),
              },
              t('projects.deleteConfirm'),
            )
          : h(
              'button',
              {
                type: 'button',
                className: 'cait-btn',
                disabled: Boolean(busy),
                onClick: () => setConfirmDelete(true),
              },
              h(Icon, { name: 'trash', size: 13 }),
              h('span', null, t('projects.delete')),
            ),
    ),
    h('h4', { className: 'cait-section-title' }, t('projects.docs')),
    h('p', { className: 'cait-hint' }, t('projects.docsHint')),
    !inbox
      ? h(
          'div',
          { className: 'cait-proj-docactions' },
          h(
            'button',
            {
              type: 'button',
              className: 'cait-btn',
              disabled: Boolean(busy),
              onClick: () => onNewDoc(projectId),
            },
            h(Icon, { name: 'plus', size: 13 }),
            h('span', null, t('projects.newDoc')),
          ),
          h(
            'button',
            {
              type: 'button',
              className: 'cait-btn',
              disabled: Boolean(busy),
              onClick: () => onImportDoc(projectId),
            },
            h(Icon, { name: 'upload', size: 13 }),
            h('span', null, t('projects.importDoc')),
          ),
        )
      : null,
    h(
      'div',
      { className: 'cait-proj-tablewrap' },
      h(
        'table',
        { className: 'cait-table cait-proj-table' },
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
                    h(
                      'div',
                      { className: 'cait-proj-bar', title: `${doc.percent}%` },
                      h('span', { style: { width: `${doc.percent}%` } }),
                    ),
                    h('span', { className: 'cait-hint' }, `${doc.percent}%`),
                  ),
                  h('td', null, doc.segments),
                  h('td', null, doc.words),
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
                      h(
                        'button',
                        {
                          type: 'button',
                          className: 'cait-minibtn',
                          title: t('projects.openDoc'),
                          onClick: () => onOpenDoc(doc.id),
                        },
                        h(Icon, { name: 'arrowRight', size: 12 }),
                      ),
                      h(
                        'button',
                        {
                          type: 'button',
                          className: 'cait-minibtn',
                          title: t('projects.reportHtml'),
                          onClick: () => onDocReport(doc.id, 'html'),
                        },
                        h(Icon, { name: 'chart', size: 12 }),
                      ),
                      h(
                        'button',
                        {
                          type: 'button',
                          className: 'cait-minibtn',
                          title: t('projects.reportCsv'),
                          onClick: () => onDocReport(doc.id, 'csv'),
                        },
                        h(Icon, { name: 'download', size: 12 }),
                      ),
                      inbox
                        ? null
                        : h(
                            'button',
                            {
                              type: 'button',
                              className: 'cait-minibtn',
                              title: t('projects.moveOut'),
                              onClick: () => onToggleDoc(doc.id, false),
                            },
                            h(Icon, { name: 'close', size: 12 }),
                          ),
                    ),
                  ),
                ),
              )
            : h(
                'tr',
                null,
                h('td', { colSpan: 7 }, h('span', { className: 'cait-hint' }, t('projects.noDocs'))),
              ),
        ),
      ),
    ),
    (documents ?? []).length
      ? h(
          'details',
          { className: 'cait-proj-addmore' },
          h('summary', null, t('projects.addDocs')),
          h(
            'ul',
            { className: 'cait-check-list' },
            (documents ?? []).map((item) =>
              h(
                'li',
                { key: item.id },
                h(
                  'label',
                  { className: 'cait-check' },
                  h('input', {
                    type: 'checkbox',
                    checked: item.projectId === projectId,
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
      : null,
    h('h4', { className: 'cait-section-title' }, t('projects.brief')),
    h('p', { className: 'cait-hint' }, t('projects.briefHint')),
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
    h('h4', { className: 'cait-section-title' }, t('projects.resources')),
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
    h('h4', { className: 'cait-section-title' }, t('projects.delivery')),
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
    h('h4', { className: 'cait-section-title' }, t('projects.time')),
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
                { type: 'button', className: 'cait-linkbtn', onClick: () => onDeleteTime(entry.id) },
                h(Icon, { name: 'trash', size: 12 }),
              ),
            ),
          ),
        )
      : null,
  )
}

function AllDocuments({
  t,
  busy,
  documents,
  projects,
  docId,
  onOpenDoc,
  onDocReport,
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
        { className: 'cait-table' },
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
                      h(
                        'button',
                        {
                          type: 'button',
                          className: 'cait-minibtn',
                          title: t('projects.reportHtml'),
                          onClick: () => onDocReport(doc.id, 'html'),
                        },
                        h(Icon, { name: 'chart', size: 12 }),
                      ),
                      h(
                        'button',
                        {
                          type: 'button',
                          className: 'cait-minibtn',
                          title: t('projects.reportCsv'),
                          onClick: () => onDocReport(doc.id, 'csv'),
                        },
                        h(Icon, { name: 'download', size: 12 }),
                      ),
                      h('select', {
                        className: 'cait-proj-movesel',
                        value: doc.projectId ?? '',
                        title: t('projects.moveHint'),
                        onChange: (event) => onMove(doc.id, event.target.value),
                      }, (projects ?? []).map((project) =>
                        h('option', { key: project.id, value: project.id }, project.name),
                      )),
                    ),
                  ),
                ),
              )
            : h(
                'tr',
                null,
                h('td', { colSpan: 8 }, h('span', { className: 'cait-hint' }, t('projects.noMatch'))),
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
  onMoveDoc,
  onRefreshAnalysis,
}) {
  const list = state?.list?.projects ?? projects ?? []
  const documentsCount = (documents ?? []).length
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
          onDocReport,
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
            onProjectReport: onReport,
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
            onDocReport,
            onProjectReport: onReport,
            onRefreshAnalysis,
          }),
        ),
  )
}

/** 新建文档后的归属确认：已有项目 / 新建项目 / 未分类。 */
function ProjectPicker({ t, busy, pick, onPick, onClose }) {
  const [projectId, setProjectId] = useState('')
  const [newName, setNewName] = useState('')
  const documentId = pick?.documentId ?? ''
  useEffect(() => {
    setProjectId('')
    setNewName('')
  }, [documentId])
  if (!pick) return null
  const projects = pick.projects ?? []
  return h(
    Modal,
    { title: t('projects.assignTitle'), onClose },
    h('p', { className: 'cait-hint' }, t('projects.assignHint', { name: pick.name ?? '' })),
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
