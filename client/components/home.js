import { h, useState } from '../react.js'
import { Icon, Spinner } from './base.js'

/**
 * 欢迎页：打开插件后的第一屏。
 *
 * 只做三件事——粘贴文本、导入文件、接着上次继续；另外列出最近项目和已打开
 * 文档，老用户可以直接跳进项目视图或库视图（顶部标签始终可用）。
 */
export function HomePage({
  t,
  busy,
  data,
  onPasteCreate,
  onImport,
  onDemo,
  onOpenProject,
  onOpenDoc,
  onResume,
}) {
  const settings = data?.settings || {}
  const [text, setText] = useState('')
  const [name, setName] = useState('')
  const [sourceLang, setSourceLang] = useState(settings.sourceLang || 'en')
  const [targetLang, setTargetLang] = useState(settings.targetLang || 'zh-CN')

  const projects = (data?.projects?.projects || []).filter((item) => !item.inbox).slice(0, 6)
  const openDocs = (data?.openDocuments || []).slice(0, 6)
  const stats = data?.stats || {}
  const canCreate = Boolean(text.trim()) && !busy

  const submit = (event) => {
    event?.preventDefault?.()
    if (!canCreate) return
    onPasteCreate({
      mode: 'text',
      name: name.trim() || text.trim().slice(0, 40),
      text,
      sourceLang,
      targetLang,
    })
  }

  return h(
    'div',
    { className: 'cait-home' },
    h(
      'div',
      { className: 'cait-home-hero' },
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

    h(
      'form',
      { className: 'cait-home-card cait-home-paste', onSubmit: submit },
      h('h2', { className: 'cait-home-cardhead' }, t('home.pasteTitle')),
      h('p', { className: 'cait-hint' }, t('home.pasteHint')),
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
          { className: 'cait-field' },
          h('span', null, t('modal.new.sourceLang')),
          h('input', {
            className: 'cait-input',
            value: sourceLang,
            onChange: (event) => setSourceLang(event.target.value),
          }),
        ),
        h(
          'label',
          { className: 'cait-field' },
          h('span', null, t('modal.new.targetLang')),
          h('input', {
            className: 'cait-input',
            value: targetLang,
            onChange: (event) => setTargetLang(event.target.value),
          }),
        ),
      ),
      h('textarea', {
        className: 'cait-input cait-home-textarea',
        value: text,
        placeholder: t('home.pastePlaceholder'),
        onChange: (event) => setText(event.target.value),
      }),
      h(
        'div',
        { className: 'cait-modal-actions cait-home-actions' },
        h('span', { className: 'cait-hint' }, t('home.pasteNote')),
        h(
          'button',
          { type: 'submit', className: 'cait-btn primary', disabled: !canCreate },
          busy === 'create' ? h(Spinner, { size: 13 }) : h(Icon, { name: 'plus', size: 14 }),
          t('home.create'),
        ),
      ),
    ),

    h(
      'div',
      { className: 'cait-home-cards' },
      h(
        'button',
        {
          type: 'button',
          className: 'cait-home-card cait-home-action',
          disabled: Boolean(busy),
          onClick: onImport,
        },
        h(Icon, { name: 'upload', size: 18 }),
        h('strong', null, t('home.import')),
        h('span', { className: 'cait-hint' }, t('home.importHint')),
      ),
      h(
        'button',
        {
          type: 'button',
          className: 'cait-home-card cait-home-action',
          disabled: Boolean(busy),
          onClick: onDemo,
        },
        h(Icon, { name: 'sparkles', size: 18 }),
        h('strong', null, t('home.demo')),
        h('span', { className: 'cait-hint' }, t('home.demoHint')),
      ),
      h(
        'button',
        {
          type: 'button',
          className: 'cait-home-card cait-home-action',
          disabled: Boolean(busy) || (!openDocs.length && !projects.length),
          onClick: onResume,
        },
        h(Icon, { name: 'play', size: 18 }),
        h('strong', null, t('home.resume')),
        h(
          'span',
          { className: 'cait-hint' },
          openDocs[0]?.name || projects[0]?.name || t('home.resumeEmpty'),
        ),
      ),
    ),

    projects.length || openDocs.length
      ? h(
          'div',
          { className: 'cait-home-cards cait-home-lists' },
          projects.length
            ? h(
                'div',
                { className: 'cait-home-card' },
                h('h2', { className: 'cait-home-cardhead' }, t('home.recentProjects')),
                h(
                  'ul',
                  { className: 'cait-home-list' },
                  projects.map((project) =>
                    h(
                      'li',
                      { key: project.id },
                      h(
                        'button',
                        {
                          type: 'button',
                          className: 'cait-home-item',
                          onClick: () => onOpenProject(project.id),
                        },
                        h('span', { className: 'cait-home-itemname' }, project.name),
                        h(
                          'span',
                          { className: 'cait-home-itemmeta' },
                          t('home.projectMeta', {
                            docs: project.documents ?? 0,
                            percent: project.percent ?? 0,
                          }),
                        ),
                      ),
                    ),
                  ),
                ),
              )
            : null,
          openDocs.length
            ? h(
                'div',
                { className: 'cait-home-card' },
                h('h2', { className: 'cait-home-cardhead' }, t('home.openDocs')),
                h(
                  'ul',
                  { className: 'cait-home-list' },
                  openDocs.map((item) =>
                    h(
                      'li',
                      { key: item.id },
                      h(
                        'button',
                        {
                          type: 'button',
                          className: 'cait-home-item',
                          onClick: () => onOpenDoc(item.id),
                        },
                        h('span', { className: 'cait-home-itemname' }, item.name),
                        h(
                          'span',
                          { className: 'cait-home-itemmeta' },
                          t('home.docMeta', {
                            segments: item.progress?.total ?? 0,
                            percent: item.progress?.percent ?? 0,
                          }),
                        ),
                      ),
                    ),
                  ),
                ),
              )
            : null,
        )
      : null,
  )
}
