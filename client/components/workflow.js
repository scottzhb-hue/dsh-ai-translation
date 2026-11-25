/**
 * 工作流面板：交付、批量、报价、本地 MT。
 *
 * 四个弹窗共用一套排版（Modal + cait-field + cait-modal-actions），
 * 数据全部来自服务端 RPC，前端只负责「选什么、看什么、点哪个按钮」。
 */

import { h, useState, useEffect } from '../react.js'
import { Spinner, Icon, Modal } from './base.js'

const SEVERITY_LABEL = { high: 'blocking', medium: 'review', low: 'notice' }

function DeliveryModal({ t, busy, checks, onRun, onClose, onJump, labels, onLabels, jobName }) {
  const [include, setInclude] = useState({
    target: true,
    bilingual: true,
    glossary: true,
    qa: true,
    analysis: true,
    notes: false,
    readme: true,
  })
  const [client, setClient] = useState(labels?.client ?? '')
  const [batch, setBatch] = useState(labels?.batch ?? '')
  const counts = checks?.counts ?? { high: 0, medium: 0, low: 0 }
  const items = checks?.items ?? []
  const toggle = (key) => setInclude((current) => ({ ...current, [key]: !current[key] }))

  return h(
    Modal,
    { title: t('deliver.title'), onClose, wide: true },
    h('p', { className: 'cait-hint' }, t('deliver.hint')),
    jobName ? h('p', { className: 'cait-hint' }, t('deliver.jobHint', { name: jobName })) : null,
    h(
      'div',
      { className: 'cait-formrow' },
      h('label', { className: 'cait-field' }, h('span', null, t('deliver.client')), h('input', {
        className: 'cait-input',
        value: client,
        onChange: (event) => setClient(event.target.value),
      })),
      h('label', { className: 'cait-field' }, h('span', null, t('deliver.batch')), h('input', {
        className: 'cait-input',
        value: batch,
        onChange: (event) => setBatch(event.target.value),
      })),
    ),
    h(
      'div',
      { className: 'cait-chips' },
      h('span', { className: 'cait-chip is-danger' }, `${t('deliver.blocking')} ${counts.high}`),
      h('span', { className: 'cait-chip is-warn' }, `${t('deliver.review')} ${counts.medium}`),
      h('span', { className: 'cait-chip' }, `${t('deliver.notice')} ${counts.low}`),
      h('span', { className: 'cait-chip' }, `${t('deliver.unconfirmed')} ${checks?.unconfirmed ?? 0}`),
    ),
    items.length
      ? h(
          'ul',
          { className: 'cait-issues' },
          items.slice(0, 12).map((item) =>
            h(
              'li',
              { key: `${item.index}-${item.code}`, className: `cait-issue is-${item.severity}` },
              h('button', { type: 'button', className: 'cait-linkbtn', onClick: () => onJump(item.index) }, `#${item.index + 1}`),
              h('span', { className: 'cait-issue-code' }, item.code),
              h('span', { className: 'cait-issue-msg' }, item.message),
            ),
          ),
        )
      : h('p', { className: 'cait-hint' }, t('deliver.clean')),
    h(
      'div',
      { className: 'cait-checks' },
      [
        ['target', 'deliver.includeTarget'],
        ['bilingual', 'deliver.includeBilingual'],
        ['glossary', 'deliver.includeGlossary'],
        ['qa', 'deliver.includeQa'],
        ['analysis', 'deliver.includeAnalysis'],
        ['notes', 'deliver.includeNotes'],
        ['readme', 'deliver.includeReadme'],
      ].map(([key, label]) =>
        h(
          'label',
          { key, className: 'cait-check' },
          h('input', { type: 'checkbox', checked: include[key], onChange: () => toggle(key) }),
          h('span', null, t(label)),
        ),
      ),
    ),
    h(
      'div',
      { className: 'cait-modal-actions' },
      h('button', { type: 'button', className: 'cait-btn', onClick: onClose }, t('panel.cancel')),
      h(
        'button',
        {
          type: 'button',
          className: 'cait-btn cait-btn-primary',
          disabled: Boolean(busy),
          onClick: () => onRun({ include, client, batch }),
        },
        busy ? h(Spinner, { size: 13 }) : h(Icon, { name: 'download', size: 13 }),
        h('span', null, t('deliver.download')),
      ),
    ),
  )
}

function BatchModal({ t, busy, documentId, selection, advice, onSelect, onRun, onClose }) {
  const filters = ['pending', 'unconfirmed', 'risk', 'duplicate', 'new', 'fuzzy', 'locked', 'notes']
  return h(
    Modal,
    { title: t('batch.title'), onClose, wide: true },
    h('p', { className: 'cait-hint' }, t('batch.hint')),
    advice?.message ? h('p', { className: 'cait-hint' }, advice.message) : null,
    h(
      'div',
      { className: 'cait-chips' },
      filters.map((filter) =>
        h(
          'button',
          {
            key: filter,
            type: 'button',
            className: `cait-chip${selection?.filter === filter ? ' is-active' : ''}`,
            onClick: () => onSelect(filter),
          },
          t(`batch.filter.${filter}`),
        ),
      ),
    ),
    h(
      'p',
      { className: 'cait-hint' },
      t('batch.selected', { count: selection?.indexes?.length ?? 0 }),
    ),
    h(
      'div',
      { className: 'cait-modal-actions' },
      h('button', { type: 'button', className: 'cait-btn', onClick: onClose }, t('panel.cancel')),
      h(
        'button',
        {
          type: 'button',
          className: 'cait-btn',
          disabled: Boolean(busy) || !selection?.indexes?.length,
          onClick: () => onRun({ action: 'confirm', documentId, indexes: selection.indexes }),
        },
        t('batch.confirm'),
      ),
      h(
        'button',
        {
          type: 'button',
          className: 'cait-btn',
          disabled: Boolean(busy) || !selection?.indexes?.length,
          onClick: () => onRun({ action: 'lock', documentId, indexes: selection.indexes }),
        },
        t('batch.lock'),
      ),
      h(
        'button',
        {
          type: 'button',
          className: 'cait-btn',
          disabled: Boolean(busy) || !selection?.indexes?.length,
          onClick: () => onRun({ action: 'unlock', documentId, indexes: selection.indexes }),
        },
        t('batch.unlock'),
      ),
      h(
        'button',
        {
          type: 'button',
          className: 'cait-btn',
          disabled: Boolean(busy) || !selection?.indexes?.length,
          onClick: () => onRun({ action: 'clear', documentId, indexes: selection.indexes }),
        },
        t('batch.clear'),
      ),
    ),
  )
}

function QuoteModal({ t, busy, state, quote, postEdit, onSave, onRefresh, onExport, onLabels, onClose }) {
  const [currency, setCurrency] = useState(state?.currency ?? 'CNY')
  const [rate, setRate] = useState(String(state?.rate ?? 120))
  const [minimum, setMinimum] = useState(String(state?.minimum ?? 0))
  const [discounts, setDiscounts] = useState(state?.discounts ?? {})
  const [client, setClient] = useState(quote?.client ?? '')
  const [batch, setBatch] = useState(quote?.batch ?? '')
  useEffect(() => {
    if (!state) return
    setCurrency(state.currency)
    setRate(String(state.rate))
    setMinimum(String(state.minimum))
    setDiscounts(state.discounts ?? {})
  }, [state])
  const lines = quote?.lines ?? []
  const setDiscount = (key, value) => setDiscounts((current) => ({ ...current, [key]: Number(value) }))
  return h(
    Modal,
    { title: t('quote.title'), onClose, wide: true },
    h('p', { className: 'cait-hint' }, t('quote.hint')),
    h(
      'div',
      { className: 'cait-formrow' },
      h('label', { className: 'cait-field' }, h('span', null, t('quote.currency')), h('input', {
        className: 'cait-input',
        value: currency,
        onChange: (event) => setCurrency(event.target.value),
      })),
      h('label', { className: 'cait-field' }, h('span', null, `${t('quote.rate')} (${state?.unitLabel ?? ''})`), h('input', {
        className: 'cait-input',
        value: rate,
        onChange: (event) => setRate(event.target.value),
      })),
      h('label', { className: 'cait-field' }, h('span', null, t('quote.minimum')), h('input', {
        className: 'cait-input',
        value: minimum,
        onChange: (event) => setMinimum(event.target.value),
      })),
    ),
    h(
      'table',
      { className: 'cait-table' },
      h(
        'thead',
        null,
        h(
          'tr',
          null,
          h('th', null, t('quote.bucket')),
          h('th', null, t('quote.segments')),
          h('th', null, t('quote.words')),
          h('th', null, t('quote.discount')),
          h('th', null, t('quote.amount')),
        ),
      ),
      h(
        'tbody',
        null,
        lines.map((line) =>
          h(
            'tr',
            { key: line.bucket },
            h('td', null, line.label),
            h('td', null, line.segments),
            h('td', null, line.words),
            h(
              'td',
              null,
              h('input', {
                className: 'cait-input',
                style: { width: '64px' },
                value: discounts[line.bucket] ?? line.discount,
                onChange: (event) => setDiscount(line.bucket, event.target.value),
              }),
            ),
            h('td', null, `${line.amount} ${quote?.currency ?? ''}`),
          ),
        ),
      ),
    ),
    h(
      'p',
      { className: 'cait-hint' },
      `${t('quote.subtotal')}：${quote?.subtotal ?? 0} ${quote?.currency ?? ''} · ${t('quote.total')}：${quote?.total ?? 0} ${
        quote?.currency ?? ''
      }`,
    ),
    postEdit
      ? h(
          'p',
          { className: 'cait-hint' },
          `${t('quote.postEdit')}：${t('quote.postEditValue', {
            entries: postEdit.entries,
            keep: Math.round((postEdit.averageKeep ?? 0) * 100),
          })}`,
        )
      : null,
    h(
      'div',
      { className: 'cait-formrow' },
      h('label', { className: 'cait-field' }, h('span', null, t('deliver.client')), h('input', {
        className: 'cait-input',
        value: client,
        onChange: (event) => setClient(event.target.value),
      })),
      h('label', { className: 'cait-field' }, h('span', null, t('deliver.batch')), h('input', {
        className: 'cait-input',
        value: batch,
        onChange: (event) => setBatch(event.target.value),
      })),
    ),
    h(
      'div',
      { className: 'cait-modal-actions' },
      h('button', { type: 'button', className: 'cait-btn', onClick: onClose }, t('panel.cancel')),
      h(
        'button',
        {
          type: 'button',
          className: 'cait-btn',
          disabled: Boolean(busy),
          onClick: () => onLabels({ client, batch }),
        },
        t('quote.saveLabels'),
      ),
      h(
        'button',
        {
          type: 'button',
          className: 'cait-btn',
          disabled: Boolean(busy),
          onClick: () => onSave({ currency, rate, minimum, discounts }),
        },
        t('quote.save'),
      ),
      h(
        'button',
        { type: 'button', className: 'cait-btn', disabled: Boolean(busy), onClick: () => onRefresh() },
        t('quote.refresh'),
      ),
      h(
        'button',
        {
          type: 'button',
          className: 'cait-btn cait-btn-primary',
          disabled: Boolean(busy),
          onClick: () => onExport('txt'),
        },
        h(Icon, { name: 'download', size: 13 }),
        h('span', null, t('quote.export')),
      ),
    ),
  )
}

function LocalMtModal({ t, busy, state, onSave, onTest, onClose }) {
  const [enabled, setEnabled] = useState(Boolean(state?.enabled))
  const [baseUrl, setBaseUrl] = useState(state?.baseUrl ?? '')
  const [model, setModel] = useState(state?.model ?? '')
  const [apiKey, setApiKey] = useState('')
  const [timeoutMs, setTimeoutMs] = useState(String(state?.timeoutMs ?? 60000))
  const [result, setResult] = useState(null)
  useEffect(() => {
    if (!state) return
    setEnabled(Boolean(state.enabled))
    setBaseUrl(state.baseUrl ?? '')
    setModel(state.model ?? '')
    setTimeoutMs(String(state.timeoutMs ?? 60000))
  }, [state])
  return h(
    Modal,
    { title: t('mtlocal.title'), onClose, wide: true },
    h('p', { className: 'cait-hint' }, t('mtlocal.hint')),
    h(
      'label',
      { className: 'cait-check' },
      h('input', { type: 'checkbox', checked: enabled, onChange: (event) => setEnabled(event.target.checked) }),
      h('span', null, t('mtlocal.enable')),
    ),
    h(
      'div',
      { className: 'cait-formrow' },
      h('label', { className: 'cait-field' }, h('span', null, 'Base URL'), h('input', {
        className: 'cait-input',
        placeholder: 'http://127.0.0.1:1234/v1',
        value: baseUrl,
        onChange: (event) => setBaseUrl(event.target.value),
      })),
      h('label', { className: 'cait-field' }, h('span', null, 'Model'), h('input', {
        className: 'cait-input',
        placeholder: 'qwen2.5-14b-instruct',
        value: model,
        onChange: (event) => setModel(event.target.value),
      })),
    ),
    h(
      'div',
      { className: 'cait-formrow' },
      h('label', { className: 'cait-field' }, h('span', null, t('mtlocal.apiKey')), h('input', {
        className: 'cait-input',
        type: 'password',
        placeholder: state?.hasKey ? '••••••' : '',
        value: apiKey,
        onChange: (event) => setApiKey(event.target.value),
      })),
      h('label', { className: 'cait-field' }, h('span', null, t('mtlocal.timeout')), h('input', {
        className: 'cait-input',
        value: timeoutMs,
        onChange: (event) => setTimeoutMs(event.target.value),
      })),
    ),
    result
      ? h(
          'p',
          { className: 'cait-hint' },
          result.ok
            ? t('mtlocal.testOk', { ms: result.latencyMs, model: result.model ?? '' })
            : t('mtlocal.testFailed', { message: result.message ?? '' }),
        )
      : null,
    h(
      'div',
      { className: 'cait-modal-actions' },
      h('button', { type: 'button', className: 'cait-btn', onClick: onClose }, t('panel.cancel')),
      h(
        'button',
        {
          type: 'button',
          className: 'cait-btn',
          disabled: Boolean(busy),
          onClick: async () => {
            const next = await onSave({ enabled, baseUrl, model, apiKey, timeoutMs })
            if (next) setResult({ ok: true, latencyMs: 0, model: next.model, message: '' })
          },
        },
        t('mtlocal.save'),
      ),
      h(
        'button',
        {
          type: 'button',
          className: 'cait-btn cait-btn-primary',
          disabled: Boolean(busy),
          onClick: async () => setResult(await onTest({ enabled, baseUrl, model, apiKey, timeoutMs })),
        },
        t('mtlocal.test'),
      ),
    ),
  )
}

export { DeliveryModal, BatchModal, QuoteModal, LocalMtModal, SEVERITY_LABEL }
