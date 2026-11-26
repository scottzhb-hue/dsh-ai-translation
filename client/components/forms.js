import { h, useState, useEffect, useRef } from '../react.js'
import { LANGUAGES } from '../helpers.js'
import { formatBytes, stripExtension } from '../rpc.js'
import { Spinner, Icon, Modal } from './base.js'

// 一次批量导入的软上限：文件数与单文件大小都在这里，服务端还有字符数与段数上限。
const MAX_IMPORT_FILES = 20
const MAX_FILE_BYTES = 28 * 1024 * 1024

/** 按文件数与大小筛一遍，返回可导入的与被跳过的（含文件名，用于提示）。 */
function filterImportFiles(list) {
  const incoming = Array.from(list || []).filter((entry) => entry && entry.name)
  const ok = []
  const skipped = []
  for (const entry of incoming) {
    if (entry.size > MAX_FILE_BYTES) skipped.push(entry.name)
    else if (ok.length >= MAX_IMPORT_FILES) skipped.push(entry.name)
    else ok.push(entry)
  }
  return { ok, skipped }
}

/**
 * 拖放区：欢迎页与「导入文件」对话框共用，保证上限说明、多选与跳过提示完全一致。
 * 文件列表状态留在调用方，这里只负责呈现与收集。
 */
function FileDropField({ t, files, skipped = [], onPick, disabled = false }) {
  const inputRef = useRef(null)
  return h(
    'div',
    { className: 'cait-dropzone' },
    h(
      'label',
      {
        className: `cait-drop${disabled ? ' is-disabled' : ''}`,
        onDragOver: (event) => event.preventDefault(),
        onDrop: (event) => {
          event.preventDefault()
          if (!disabled) onPick(event.dataTransfer?.files)
        },
      },
      h('input', {
        ref: inputRef,
        type: 'file',
        multiple: true,
        accept:
          '.txt,.md,.markdown,.tmx,.docx,.epub,.csv,.srt,.vtt,.po,.pot,.xliff,.xlf,.sdlxliff,.html,.htm,.json,.rtf,.xlsx,.pptx,.doc,.xls,.ppt,.strings,.stringsdict,.resx,.arb,.yaml,.yml,.properties',
        hidden: true,
        disabled,
        onChange: (event) => {
          onPick(event.target.files)
          event.target.value = ''
        },
      }),
      h(Icon, { name: files.length ? 'file' : 'upload', size: 22 }),
      h(
        'strong',
        null,
        files.length > 1
          ? t('modal.import.pickedMany', { count: files.length })
          : files.length === 1
            ? files[0].name
            : t('empty.drop'),
      ),
      h(
        'span',
        null,
        files.length > 1
          ? files.map((entry) => entry.name).slice(0, 3).join(' · ')
          : files.length === 1
            ? formatBytes(files[0].size)
            : t('modal.new.dropHint'),
      ),
    ),
    h('p', { className: 'cait-modal-hint' }, t('modal.import.limits')),
    skipped.length
      ? h(
          'p',
          { className: 'cait-modal-hint is-warn' },
          t('modal.import.skipped', {
            count: skipped.length,
            names: skipped.slice(0, 3).join(' · '),
          }),
        )
      : null,
  )
}

/** 批量导入进行中的进度条 + 取消；导入完成后由控制器收起。 */
function ImportProgress({ t, progress, onCancel }) {
  const total = Math.max(1, progress.total || 1)
  const percent = Math.max(0, Math.min(100, Math.round((progress.done / total) * 100)))
  return h(
    'div',
    { className: 'cait-import-progress' },
    h('div', { className: 'cait-import-bar' }, h('i', { style: { width: `${percent}%` } })),
    h(
      'div',
      { className: 'cait-import-line' },
      h(
        'span',
        null,
        progress.name
          ? t('modal.import.importing', {
              done: progress.done,
              total: progress.total,
              name: progress.name,
            })
          : t('modal.import.progress', { done: progress.done, total: progress.total }),
      ),
      onCancel
        ? h(
            'button',
            { type: 'button', className: 'cait-linkbtn is-danger', onClick: onCancel },
            t('modal.import.cancel'),
          )
        : null,
    ),
  )
}

function DocumentSourceForm({
  t,
  settings,
  busy,
  submitLabel,
  onSubmit,
  defaultMode = 'text',
  fixedMode = '',
  progress = null,
  onCancelImport = null,
}) {
  const [mode, setMode] = useState(fixedMode || defaultMode)
  const [name, setName] = useState('')
  const [text, setText] = useState('')
  const [files, setFiles] = useState([])
  const [skipped, setSkipped] = useState([])
  const [sourceLang, setSourceLang] = useState(settings.sourceLang || 'en')
  const [targetLang, setTargetLang] = useState(settings.targetLang || 'zh-CN')
  const [csvSourceColumn, setCsvSourceColumn] = useState('')
  const [csvTargetColumn, setCsvTargetColumn] = useState('')

  useEffect(() => {
    if (settings.sourceLang) setSourceLang(settings.sourceLang)
    if (settings.targetLang) setTargetLang(settings.targetLang)
  }, [settings.sourceLang, settings.targetLang])

  // 独立入口（新建 / 导入）没有标签页，模式由调用方固定。
  useEffect(() => {
    if (fixedMode) setMode(fixedMode)
  }, [fixedMode])

  const pickFiles = (list) => {
    const { ok, skipped: rejected } = filterImportFiles(list)
    if (!ok.length) {
      setSkipped(rejected)
      return
    }
    setFiles(ok)
    setSkipped(rejected)
    setMode('file')
    if (!name.trim()) setName(ok.length === 1 ? stripExtension(ok[0].name) : '')
  }

  const submit = (event) => {
    event.preventDefault()
    onSubmit({
      mode,
      name,
      text,
      files,
      file: files[0] || null,
      sourceLang,
      targetLang,
      csvSourceColumn,
      csvTargetColumn,
    })
  }

  const canSubmit = mode === 'file' ? files.length > 0 : Boolean(text.trim())
  const isCsv = mode === 'file' && files.length === 1 && /\.csv$/i.test(files[0]?.name || '')
  // 主按钮跟着当前标签走：导入页不该再写「创建文档」。
  const actionLabel =
    mode === 'file'
      ? files.length > 1
        ? t('modal.import.submitMany', { count: files.length })
        : t('modal.import.submit')
      : submitLabel

  return h(
    'form',
    { className: 'cait-docform', onSubmit: submit },
    fixedMode
      ? null
      : h(
      'div',
      { className: 'cait-segmented' },
      h(
        'button',
        {
          type: 'button',
          className: mode === 'text' ? 'active' : '',
          onClick: () => setMode('text'),
        },
        t('empty.paste'),
      ),
      h(
        'button',
        {
          type: 'button',
          className: mode === 'file' ? 'active' : '',
          onClick: () => setMode('file'),
        },
        t('empty.file'),
      ),
    ),
    h(
      'label',
      { className: 'cait-field' },
      h('span', null, t('modal.new.name')),
      h('input', {
        className: 'cait-input',
        value: name,
        onChange: (event) => setName(event.target.value),
        placeholder: t('modal.new.namePlaceholder'),
      }),
    ),
    h(
      'div',
      { className: 'cait-grid2' },
      h(
        'label',
        { className: 'cait-field' },
        h('span', null, t('modal.new.sourceLang')),
        h(
          'select',
          {
            className: 'cait-input',
            value: sourceLang,
            onChange: (event) => setSourceLang(event.target.value),
          },
          LANGUAGES.map(([code, label]) =>
            h('option', { key: code, value: code }, `${label} (${code})`),
          ),
        ),
      ),
      h(
        'label',
        { className: 'cait-field' },
        h('span', null, t('modal.new.targetLang')),
        h(
          'select',
          {
            className: 'cait-input',
            value: targetLang,
            onChange: (event) => setTargetLang(event.target.value),
          },
          LANGUAGES.map(([code, label]) =>
            h('option', { key: code, value: code }, `${label} (${code})`),
          ),
        ),
      ),
    ),
    isCsv
      ? h(
          'div',
          { className: 'cait-grid2' },
          h(
            'label',
            { className: 'cait-field' },
            h('span', null, t('modal.new.csvSource')),
            h('input', {
              className: 'cait-input',
              value: csvSourceColumn,
              onChange: (event) => setCsvSourceColumn(event.target.value),
              placeholder: t('modal.new.csvColumnPlaceholder'),
            }),
          ),
          h(
            'label',
            { className: 'cait-field' },
            h('span', null, t('modal.new.csvTarget')),
            h('input', {
              className: 'cait-input',
              value: csvTargetColumn,
              onChange: (event) => setCsvTargetColumn(event.target.value),
              placeholder: t('modal.new.csvColumnPlaceholder'),
            }),
          ),
          h('p', { className: 'cait-modal-hint' }, t('modal.new.csvHint')),
        )
      : null,
    mode === 'text'
      ? h('textarea', {
          className: 'cait-formtext',
          value: text,
          onChange: (event) => setText(event.target.value),
          placeholder: t('empty.textPlaceholder'),
          rows: 6,
        })
      : h(FileDropField, {
          t,
          files,
          skipped,
          onPick: pickFiles,
          disabled: Boolean(busy),
        }),
    busy === 'create' && progress
      ? h(ImportProgress, { t, progress, onCancel: onCancelImport })
      : null,
    h(
      'div',
      { className: 'cait-formfoot' },
      h('span', { className: 'cait-muted' }, t('empty.formats')),
      h(
        'button',
        {
          className: 'cait-btn cait-btn-primary',
          type: 'submit',
          disabled: Boolean(busy) || !canSubmit,
        },
        busy === 'create' ? h(Spinner) : h(Icon, { name: 'plus', size: 13 }),
        busy === 'create'
          ? progress
            ? t('modal.import.progress', { done: progress.done, total: progress.total })
            : t('modal.new.importing')
          : actionLabel,
      ),
    ),
  )
}

function DocModalShell({
  t,
  settings,
  busy,
  title,
  projectName,
  submitLabel,
  fixedMode,
  onClose,
  onCreate,
  hint,
  progress,
  onCancelImport,
}) {
  return h(
    Modal,
    { title, onClose },
    projectName
      ? h(
          'p',
          { className: 'cait-modal-hint cait-modal-project' },
          h(Icon, { name: 'folder', size: 12 }),
          h('span', null, t('modal.new.joinProject', { name: projectName })),
        )
      : null,
    hint ? h('p', { className: 'cait-modal-hint' }, hint) : null,
    h(DocumentSourceForm, {
      t,
      settings,
      busy,
      submitLabel,
      onSubmit: onCreate,
      fixedMode,
      progress,
      onCancelImport,
    }),
    fixedMode === 'text'
      ? h(
          'div',
          { className: 'cait-demo-row' },
          h('span', null, t('modal.new.sample')),
          h(
            'button',
            {
              className: 'cait-linkbtn',
              onClick: () => onCreate({ demo: true }),
              disabled: Boolean(busy),
            },
            t('modal.new.demo'),
          ),
        )
      : null,
  )
}

function NewDocModal({ t, settings, busy, projectName = '', onClose, onCreate }) {
  return h(DocModalShell, {
    t,
    settings,
    busy,
    title: t('modal.new.title'),
    projectName,
    submitLabel: t('modal.new.create'),
    fixedMode: 'text',
    onClose,
    onCreate,
  })
}

function ImportDocModal({
  t,
  settings,
  busy,
  projectName = '',
  progress = null,
  onCancelImport,
  onClose,
  onCreate,
}) {
  return h(DocModalShell, {
    t,
    settings,
    busy,
    title: t('modal.import.title'),
    projectName,
    submitLabel: t('modal.import.submit'),
    fixedMode: 'file',
    onClose,
    onCreate,
    progress,
    onCancelImport,
  })
}

/**
 * The library workspace: browse, search, page through, edit and export the
 * translation memories and glossaries themselves. It deliberately does not
 * need an open document — the rail and the right panel stay document-scoped
 * and this page is the only place that manages whole libraries.
 */

export { DocumentSourceForm, FileDropField, filterImportFiles, NewDocModal, ImportDocModal }
