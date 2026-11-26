import { h, useMemo, useState } from '../react.js'
import { Icon, Spinner } from './base.js'
import { FileDropField, filterImportFiles } from './forms.js'

/** Relative "5 minutes ago" style stamp used by the continue-working list. */
export function relativeStamp(t, iso) {
  const stamp = Date.parse(iso || '')
  if (!stamp) return ''
  const minutes = Math.max(0, Math.round((Date.now() - stamp) / 60000))
  if (minutes < 1) return t('home.timeNow')
  if (minutes < 60) return t('home.timeMins', { n: minutes })
  const hours = Math.round(minutes / 60)
  if (hours < 24) return t('home.timeHours', { n: hours })
  return t('home.timeDays', { n: Math.round(hours / 24) })
}

/**
 * 欢迎页：打开插件后的第一屏。
 *
 * 只留一个主入口（粘贴文本 / 导入文件 两个标签页），其余是“接着上次”的小药丸
 * 和一个按更新时间排序的「继续工作」列表——新手看得懂从哪开始，老手一屏就能续上。
 */
export function HomePage({
  t,
  busy,
  data,
  onPasteCreate,
  onDemo,
  onOpenProject,
  onOpenDoc,
  onOpenProjects,
  onResume,
}) {
  const settings = data?.settings || {}
  const [mode, setMode] = useState('text')
  const [text, setText] = useState('')
  const [name, setName] = useState('')
  const [sourceLang, setSourceLang] = useState(settings.sourceLang || 'en')
  const [targetLang, setTargetLang] = useState(settings.targetLang || 'zh-CN')
  const [files, setFiles] = useState([])
  const [skipped, setSkipped] = useState([])

  const projects = (data?.projects?.projects || []).filter((item) => !item.inbox)
  const openDocs = data?.openDocuments || []
  const stats = data?.stats || {}
  const work = useMemo(() => {
    const rows = [
      ...projects.map((project) => ({
        key: `p:${project.id}`,
        kind: 'project',
        id: project.id,
        name: project.name,
        percent: project.percent ?? 0,
        meta: t('home.projectMeta', { docs: project.documents ?? 0, percent: project.percent ?? 0 }),
        updatedAt: project.updatedAt,
      })),
      ...openDocs.map((item) => ({
        key: `d:${item.id}`,
        kind: 'doc',
        id: item.id,
        name: item.name,
        percent: item.progress?.percent ?? 0,
        meta: t('home.docMeta', {
          segments: item.progress?.total ?? 0,
          percent: item.progress?.percent ?? 0,
        }),
        updatedAt: item.updatedAt,
      })),
    ]
    return rows
      .sort((a, b) => (Date.parse(b.updatedAt || '') || 0) - (Date.parse(a.updatedAt || '') || 0))
      .slice(0, 6)
  }, [projects, openDocs, t])

  const canCreate = mode === 'text' ? Boolean(text.trim()) && !busy : files.length > 0 && !busy
  const resumeTarget = openDocs[0] || projects[0] || null
  const showDemo = projects.length === 0 && openDocs.length === 0

  const submit = (event) => {
    event?.preventDefault?.()
    if (!canCreate) return
    if (mode === 'file') {
      onPasteCreate({
        mode: 'file',
        files,
        file: files[0] || null,
        name: '',
        sourceLang,
        targetLang,
      })
      return
    }
    onPasteCreate({
      mode: 'text',
      name: name.trim() || text.trim().slice(0, 40),
      text,
      sourceLang,
      targetLang,
    })
  }

  const pickFiles = (list) => {
    if (busy) return
    const { ok, skipped: rejected } = filterImportFiles(list)
    if (!ok.length) {
      setSkipped(rejected)
      return
    }
    setFiles(ok)
    setSkipped(rejected)
    setMode('file')
    if (!name.trim()) setName(ok.length === 1 ? ok[0].name.replace(/\.[^.]+$/, '') : '')
  }

  return h(
    'div',
    {
      className: 'cait-home',
      // Dropping anywhere else on the page must not make the webview navigate to the file.
      onDragOver: (event) => event.preventDefault(),
      onDrop: (event) => event.preventDefault(),
    },
    h(
      'div',
      { className: 'cait-home-hero' },
      h(
        'div',
        { className: 'cait-home-herotext' },
        h('h1', { className: 'cait-home-title' }, t('home.title')),
        h('p', { className: 'cait-home-sub' }, t('home.subtitle')),
        h(
          'div',
          { className: 'cait-home-stats' },
          h('span', null, t('home.statsDocs', { n: stats.documents ?? 0 })),
          h('span', null, t('home.statsSegments', { n: stats.segments ?? 0 })),
          h('span', null, t('home.statsTm', { n: stats.tm ?? 0 })),
        ),
      ),
      resumeTarget
        ? h(
            'button',
            {
              type: 'button',
              className: 'cait-home-resume',
              disabled: Boolean(busy),
              title: t('home.resume'),
              onClick: onResume,
            },
            h(Icon, { name: 'play', size: 13 }),
            h('span', null, t('home.resumeShow', { name: resumeTarget.name })),
          )
        : null,
    ),

    h(
      'form',
      { className: 'cait-home-card cait-home-start', onSubmit: submit },
      h(
        'div',
        { className: 'cait-home-starthead' },
        h(
          'div',
          { className: 'cait-libtabs', role: 'tablist' },
          [['text', 'home.tabsPaste'], ['file', 'home.tabsFile']].map(([id, key]) =>
            h(
              'button',
              {
                key: id,
                type: 'button',
                role: 'tab',
                'aria-selected': mode === id,
                className: `cait-libtabs-item${mode === id ? ' active' : ''}`,
                onClick: () => setMode(id),
              },
              t(key),
            ),
          ),
        ),
        h('span', { className: 'cait-hint' }, t('home.pasteHint')),
      ),
      h(
        'div',
        { className: 'cait-formrow' },
        h(
          'label',
          { className: 'cait-field' },
          h('span', null, t('modal.new.name')),
          h('input', {
            className: 'cait-input',
            value: name,
            placeholder: t('modal.new.namePlaceholder'),
            onChange: (event) => setName(event.target.value),
          }),
        ),
        h(
          'label',
          { className: 'cait-field cait-field-sm' },
          h('span', null, t('modal.new.sourceLang')),
          h('input', {
            className: 'cait-input',
            value: sourceLang,
            onChange: (event) => setSourceLang(event.target.value),
          }),
        ),
        h(
          'label',
          { className: 'cait-field cait-field-sm' },
          h('span', null, t('modal.new.targetLang')),
          h('input', {
            className: 'cait-input',
            value: targetLang,
            onChange: (event) => setTargetLang(event.target.value),
          }),
        ),
      ),
      mode === 'text'
        ? h('textarea', {
            className: 'cait-input cait-home-textarea',
            value: text,
            placeholder: t('home.pastePlaceholder'),
            onChange: (event) => setText(event.target.value),
          })
        : h(FileDropField, {
            t,
            files,
            skipped,
            onPick: pickFiles,
            disabled: Boolean(busy),
          }),
      h(
        'div',
        { className: 'cait-modal-actions cait-home-actions' },
        h('span', { className: 'cait-hint' }, t('home.pasteNote')),
        h(
          'button',
          { type: 'submit', className: 'cait-btn primary', disabled: !canCreate },
          busy === 'create' ? h(Spinner, { size: 13 }) : h(Icon, { name: 'plus', size: 14 }),
          mode === 'file' ? t('home.startImport') : t('home.create'),
        ),
      ),
    ),

    showDemo
      ? h(
          'div',
          { className: 'cait-home-extras' },
          h(
            'button',
            { type: 'button', className: 'cait-linkbtn', disabled: Boolean(busy), onClick: onDemo },
            h(Icon, { name: 'sparkles', size: 13 }),
            t('home.demo'),
          ),
        )
      : null,

    work.length
      ? h(
          'section',
          { className: 'cait-home-card cait-home-work' },
          h(
            'header',
            { className: 'cait-home-workhead' },
            h('h2', { className: 'cait-home-cardhead' }, t('home.workTitle')),
            h('span', { className: 'cait-home-count' }, work.length),
            h(
              'button',
              { type: 'button', className: 'cait-linkbtn', onClick: onOpenProjects },
              t('home.allProjects'),
              h(Icon, { name: 'arrowRight', size: 12 }),
            ),
          ),
          h(
            'ul',
            { className: 'cait-home-worklist' },
            work.map((row) =>
              h(
                'li',
                { key: row.key },
                h(
                  'button',
                  {
                    type: 'button',
                    className: 'cait-home-workrow',
                    onClick: () =>
                      row.kind === 'project' ? onOpenProject(row.id) : onOpenDoc(row.id),
                  },
                  h(
                    'span',
                    { className: `cait-home-kind is-${row.kind}` },
                    row.kind === 'project' ? t('home.kindProject') : t('home.kindDoc'),
                  ),
                  h('span', { className: 'cait-home-workname' }, row.name),
                  h(
                    'span',
                    { className: 'cait-home-bar' },
                    h('i', { style: { width: `${Math.max(0, Math.min(100, row.percent))}%` } }),
                  ),
                  h('span', { className: 'cait-home-workmeta' }, row.meta),
                  h('span', { className: 'cait-home-worktime' }, relativeStamp(t, row.updatedAt)),
                ),
              ),
            ),
          ),
        )
      : null,
  )
}
