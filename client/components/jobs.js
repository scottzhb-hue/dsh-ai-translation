/**
 * 作业（job）面板：把多篇文档归到一个作业下，共享 brief 与术语库/TM，
 * 按作业汇总分析与交付，并记录工时。
 *
 * 左边是作业列表，右边是当前作业的详情；所有写操作都走 RPC，
 * 服务端写完会带回新的 state，这里只管表单。
 */

import { h, useState, useEffect } from '../react.js'
import { Spinner, Icon, Modal } from './base.js'

const BRIEF_FIELDS = [
  ['domain', 'jobs.domain'],
  ['audience', 'jobs.audience'],
  ['tone', 'jobs.tone'],
  ['notes', 'jobs.notes'],
  ['doNotTranslate', 'jobs.doNotTranslate'],
  ['styleSample', 'jobs.styleSample'],
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

/** TM/术语库下拉：空字符串表示继承全局挂载，'__none__' 表示明确不读任何库。 */
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

function JobsModal({
  t,
  busy,
  state,
  documents,
  libraries,
  docId,
  onSelect,
  onCreate,
  onSave,
  onBrief,
  onToggleDoc,
  onDelete,
  onStart,
  onStop,
  onAddTime,
  onDeleteTime,
  onExport,
  onClose,
}) {
  const jobs = state?.jobs?.jobs ?? []
  const job = state?.job ?? null
  const analysis = state?.analysis ?? null
  const jobId = job?.id ?? ''
  const [name, setName] = useState('')
  const [fields, setFields] = useState({ name: '', client: '', dueAt: '', note: '' })
  const [brief, setBrief] = useState({})
  const [tmValue, setTmValue] = useState('')
  const [glossaryValue, setGlossaryValue] = useState('')
  const [defaultTm, setDefaultTm] = useState('')
  const [include, setInclude] = useState({ target: true, bilingual: true, glossary: true, qa: true, analysis: true, notes: false, readme: true })
  const [minutes, setMinutes] = useState('30')
  const [timeNote, setTimeNote] = useState('')
  const [confirmDelete, setConfirmDelete] = useState(false)

  useEffect(() => {
    if (!job) return
    setFields({
      name: job.name ?? '',
      client: job.client ?? '',
      dueAt: job.dueAt ?? '',
      note: job.note ?? '',
    })
    setBrief(job.brief ? { ...job.brief } : {})
    setTmValue(librarySelectValue(job.tmIds))
    setGlossaryValue(librarySelectValue(job.glossaryIds))
    setDefaultTm(job.defaultWriteTmId ?? '')
    setConfirmDelete(false)
  }, [jobId])

  const tmLibraries = libraries?.tm ?? []
  const glossaryLibraries = libraries?.glossary ?? []
  const effectiveTm = job?.resources?.effectiveTmIds ?? []
  const patches = () => ({
    name: fields.name,
    client: fields.client,
    dueAt: fields.dueAt,
    note: fields.note,
    tmIds: librarySelectIds(tmValue),
    glossaryIds: librarySelectIds(glossaryValue),
    defaultWriteTmId: defaultTm || null,
  })

  return h(
    Modal,
    { title: t('jobs.title'), onClose, wide: true },
    h('p', { className: 'cait-hint' }, t('jobs.hint')),
    h(
      'div',
      { className: 'cait-job-layout' },
      h(
        'div',
        { className: 'cait-job-list' },
        h(
          'div',
          { className: 'cait-formrow' },
          h('input', {
            className: 'cait-input',
            placeholder: t('jobs.namePlaceholder'),
            value: name,
            onChange: (event) => setName(event.target.value),
          }),
          h(
            'button',
            {
              type: 'button',
              className: 'cait-btn',
              disabled: Boolean(busy) || !name.trim(),
              onClick: async () => {
                const created = await onCreate(name.trim())
                if (created) setName('')
              },
            },
            h(Icon, { name: 'plus', size: 13 }),
            h('span', null, t('jobs.create')),
          ),
        ),
        jobs.length
          ? h(
              'ul',
              { className: 'cait-job-items' },
              jobs.map((item) =>
                h(
                  'li',
                  { key: item.id },
                  h(
                    'button',
                    {
                      type: 'button',
                      className: `cait-job-item${item.id === jobId ? ' is-active' : ''}`,
                      onClick: () => onSelect(item.id),
                    },
                    h('span', { className: 'cait-job-item-name' }, item.name),
                    h(
                      'span',
                      { className: 'cait-job-item-meta' },
                      `${item.documents} · ${item.percent ?? 0}%` +
                        (item.running ? ` · ${t('jobs.running')}` : ''),
                    ),
                  ),
                ),
              ),
            )
          : h('p', { className: 'cait-hint' }, t('jobs.empty')),
      ),
      job
        ? h(
            'div',
            { className: 'cait-job-detail' },
            h(
              'div',
              { className: 'cait-formrow' },
              h('label', { className: 'cait-field' }, h('span', null, t('jobs.fieldName')), h('input', {
                className: 'cait-input',
                value: fields.name,
                onChange: (event) => setFields({ ...fields, name: event.target.value }),
              })),
              h('label', { className: 'cait-field' }, h('span', null, t('jobs.client')), h('input', {
                className: 'cait-input',
                value: fields.client,
                onChange: (event) => setFields({ ...fields, client: event.target.value }),
              })),
              h('label', { className: 'cait-field' }, h('span', null, t('jobs.dueAt')), h('input', {
                className: 'cait-input',
                type: 'date',
                value: fields.dueAt,
                onChange: (event) => setFields({ ...fields, dueAt: event.target.value }),
              })),
            ),
            job.overdue
              ? h('p', { className: 'cait-hint is-danger' }, t('jobs.overdue', { dueAt: job.dueAt }))
              : null,
            h(
              'div',
              { className: 'cait-chips' },
              h('span', { className: 'cait-chip' }, `${t('jobs.documents')} ${job.documents}`),
              h('span', { className: 'cait-chip' }, `${t('jobs.segments')} ${job.segments}`),
              h('span', { className: 'cait-chip' }, `${t('jobs.words')} ${job.words}`),
              h('span', { className: 'cait-chip' }, `${job.percent ?? 0}%`),
              h('span', { className: 'cait-chip' }, `${t('jobs.minutes')} ${job.minutes ?? 0}`),
            ),
            analysis
              ? h(
                  'p',
                  { className: 'cait-hint' },
                  `${t('jobs.analysis')}：${t('jobs.analysisValue', {
                    matched: Math.round(analysis.totals?.matchedPercent ?? 0),
                    fresh: analysis.totals?.buckets?.new ?? 0,
                  })}`,
                )
              : null,
            h(
              'label',
              { className: 'cait-field' },
              h('span', null, t('jobs.note')),
              h('textarea', {
                className: 'cait-input',
                rows: 2,
                value: fields.note,
                onChange: (event) => setFields({ ...fields, note: event.target.value }),
              }),
            ),
            h('h4', { className: 'cait-section-title' }, t('jobs.brief')),
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
                        onChange: (event) => setBrief({ ...brief, [field]: event.target.value }),
                      })
                    : h('input', {
                        className: 'cait-input',
                        value: brief[field] ?? '',
                        onChange: (event) => setBrief({ ...brief, [field]: event.target.value }),
                      }),
                ),
              ),
            ),
            h('h4', { className: 'cait-section-title' }, t('jobs.resources')),
            h(
              'div',
              { className: 'cait-formrow' },
              h(
                'label',
                { className: 'cait-field' },
                h('span', null, t('jobs.tm')),
                h(
                  'select',
                  {
                    className: 'cait-input',
                    value: tmValue,
                    onChange: (event) => setTmValue(event.target.value),
                  },
                  h('option', { value: '' }, t('jobs.inherit')),
                  tmLibraries.map((lib) =>
                    h('option', { key: lib.tmId, value: lib.tmId }, lib.name),
                  ),
                  h('option', { value: '__none__' }, t('jobs.none')),
                ),
              ),
              h(
                'label',
                { className: 'cait-field' },
                h('span', null, t('jobs.glossary')),
                h(
                  'select',
                  {
                    className: 'cait-input',
                    value: glossaryValue,
                    onChange: (event) => setGlossaryValue(event.target.value),
                  },
                  h('option', { value: '' }, t('jobs.inherit')),
                  glossaryLibraries.map((lib) =>
                    h('option', { key: lib.glossaryId, value: lib.glossaryId }, lib.name),
                  ),
                  h('option', { value: '__none__' }, t('jobs.none')),
                ),
              ),
              h(
                'label',
                { className: 'cait-field' },
                h('span', null, t('jobs.defaultTm')),
                h(
                  'select',
                  {
                    className: 'cait-input',
                    value: effectiveTm.includes(defaultTm) ? defaultTm : '',
                    onChange: (event) => setDefaultTm(event.target.value),
                  },
                  h('option', { value: '' }, t('jobs.auto')),
                  effectiveTm.map((id) => {
                    const lib = tmLibraries.find((item) => item.tmId === id)
                    return h('option', { key: id, value: id }, lib?.name ?? id)
                  }),
                ),
              ),
            ),
            h('h4', { className: 'cait-section-title' }, t('jobs.docs')),
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
                      checked: item.jobId === job.id,
                      onChange: (event) => onToggleDoc(item.id, event.target.checked),
                    }),
                    h('span', null, `${item.name}${item.id === docId ? ` · ${t('jobs.current')}` : ''}`),
                  ),
                  item.jobId && item.jobId !== job.id
                    ? h('span', { className: 'cait-hint' }, `→ ${item.jobName ?? ''}`)
                    : null,
                ),
              ),
            ),
            h('h4', { className: 'cait-section-title' }, t('jobs.time')),
            h(
              'div',
              { className: 'cait-chips cait-job-timer' },
              h(
                'button',
                {
                  type: 'button',
                  className: 'cait-btn',
                  disabled: Boolean(busy) || job.running,
                  onClick: () => onStart(),
                },
                h(Icon, { name: 'play', size: 12 }),
                h('span', null, t('jobs.start')),
              ),
              h(
                'button',
                {
                  type: 'button',
                  className: 'cait-btn',
                  disabled: Boolean(busy) || !job.running,
                  onClick: () => onStop(),
                },
                h(Icon, { name: 'check', size: 12 }),
                h('span', null, t('jobs.stop')),
              ),
              h('span', { className: 'cait-hint' }, job.running ? t('jobs.running') : ''),
            ),
            h(
              'div',
              { className: 'cait-formrow' },
              h('input', {
                className: 'cait-input',
                style: { width: '80px' },
                value: minutes,
                onChange: (event) => setMinutes(event.target.value),
              }),
              h('input', {
                className: 'cait-input',
                placeholder: t('jobs.timeNote'),
                value: timeNote,
                onChange: (event) => setTimeNote(event.target.value),
              }),
              h(
                'button',
                {
                  type: 'button',
                  className: 'cait-btn',
                  disabled: Boolean(busy),
                  onClick: async () => {
                    const ok = await onAddTime(Number(minutes), timeNote)
                    if (ok) setTimeNote('')
                  },
                },
                t('jobs.addTime'),
              ),
            ),
            (job.time?.entries ?? []).length
              ? h(
                  'ul',
                  { className: 'cait-time-list' },
                  job.time.entries.map((entry) =>
                    h(
                      'li',
                      { key: entry.id },
                      h('span', null, `${entry.at.slice(0, 10)} · ${entry.minutes} ${t('jobs.minutes')}${entry.note ? ` · ${entry.note}` : ''}`),
                      h(
                        'button',
                        {
                          type: 'button',
                          className: 'cait-linkbtn',
                          onClick: () => onDeleteTime(entry.id),
                        },
                        h(Icon, { name: 'trash', size: 12 }),
                      ),
                    ),
                  ),
                )
              : null,
            h('h4', { className: 'cait-section-title' }, t('jobs.delivery')),
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
                    onChange: () => setInclude({ ...include, [key]: !include[key] }),
                  }),
                  h('span', null, t(label)),
                ),
              ),
            ),
            h(
              'div',
              { className: 'cait-modal-actions' },
              h(
                'button',
                { type: 'button', className: 'cait-btn', disabled: Boolean(busy), onClick: onClose },
                t('panel.cancel'),
              ),
              confirmDelete
                ? h(
                    'button',
                    {
                      type: 'button',
                      className: 'cait-btn is-danger',
                      disabled: Boolean(busy),
                      onClick: () => onDelete(),
                    },
                    t('jobs.deleteConfirm'),
                  )
                : h(
                    'button',
                    {
                      type: 'button',
                      className: 'cait-btn',
                      disabled: Boolean(busy),
                      onClick: () => setConfirmDelete(true),
                    },
                    t('jobs.delete'),
                  ),
              h(
                'button',
                {
                  type: 'button',
                  className: 'cait-btn',
                  disabled: Boolean(busy),
                  onClick: () => onBrief(brief),
                },
                t('jobs.saveBrief'),
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
                h('span', null, t('jobs.export')),
              ),
              h(
                'button',
                {
                  type: 'button',
                  className: 'cait-btn cait-btn-primary',
                  disabled: Boolean(busy),
                  onClick: () => onSave(patches()),
                },
                busy ? h(Spinner, { size: 13 }) : h(Icon, { name: 'save', size: 13 }),
                h('span', null, t('jobs.save')),
              ),
            ),
          )
        : h('div', { className: 'cait-job-detail' }, h('p', { className: 'cait-hint' }, t('jobs.pick'))),
    ),
  )
}

export { JobsModal }
