import { h, useState, useEffect } from '../react.js'
import { rpc } from '../rpc.js'
import { Spinner, Icon, Modal } from './base.js'

// Token accounting for the requests CAIT itself sends (MT, batch pre-translate,
// assistant chat, review). The Host records them in <dataDir>/usage.json; this
// dialog reads the aggregate snapshot through the read-only `usage` RPC.

function formatTokenCount(value) {
  const number = Math.max(0, Number(value) || 0)
  const trim = (text) => text.replace(/\.0$/, '')
  if (number >= 1e9) return `${trim((number / 1e9).toFixed(1))}B`
  if (number >= 1e6) return `${trim((number / 1e6).toFixed(1))}M`
  if (number >= 1e4) return `${trim((number / 1e3).toFixed(1))}k`
  return String(number)
}

function formatUsageTime(at) {
  const date = new Date(Number(at) || 0)
  if (!at || Number.isNaN(date.getTime())) return ''
  const pad = (value) => String(value).padStart(2, '0')
  return `${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(
    date.getMinutes(),
  )}`
}

function usagePurposeLabel(t, purpose) {
  const key = String(purpose || '')
  if (key === 'cait-mt') return t('usage.purpose.mt')
  if (key === 'cait-mt-batch') return t('usage.purpose.mtBatch')
  if (key === 'cait-chat') return t('usage.purpose.chat')
  if (key === 'cait-review') return t('usage.purpose.review')
  return key || t('usage.purpose.other')
}

function formatMoney(value) {
  const number = Math.max(0, Number(value) || 0)
  if (!number) return '¥0.00'
  if (number < 0.01) return `¥${number.toFixed(4)}`
  if (number < 1) return `¥${number.toFixed(3)}`
  return `¥${number.toFixed(2)}`
}

function bucketValue(bucket) {
  const tokens = formatTokenCount(bucket?.totalTokens || 0)
  const cost = Number(bucket?.costCny) || 0
  return cost > 0 ? `${tokens} · ${formatMoney(cost)}` : tokens
}

function usageTooltip(t, usage) {
  return t('usage.tooltip', {
    today: formatTokenCount(usage?.today?.totalTokens || 0),
    total: formatTokenCount(usage?.total?.totalTokens || 0),
    count: usage?.total?.requests || 0,
  })
}

function UsageBadge({ t, usage, onOpen }) {
  const today = usage?.today?.totalTokens || 0
  const cost = Number(usage?.today?.costCny) || 0
  return h(
    'button',
    {
      type: 'button',
      className: 'cait-usage',
      title: usageTooltip(t, usage),
      onClick: onOpen,
    },
    h(Icon, { name: 'chart', size: 13 }),
    h('span', null, t('usage.badge')),
    today > 0 ? h('strong', null, formatTokenCount(today)) : null,
    cost > 0 ? h('em', null, formatMoney(cost)) : null,
  )
}

function UsageSection({ title, rows, empty }) {
  return h(
    'div',
    { className: 'cait-settings-section' },
    h('h4', { className: 'cait-settings-title' }, title),
    rows.length
      ? h(
          'div',
          { className: 'cait-usage-rows' },
          rows.map((row, index) =>
            h(
              'div',
              { key: `${row.label}-${index}`, className: 'cait-usage-row' },
              h('span', null, row.label),
              row.meta ? h('em', null, row.meta) : null,
              h('em', null, row.value),
            ),
          ),
        )
      : h('p', { className: 'cait-usage-empty' }, empty),
  )
}

function UsageModal({ t, onClose }) {
  const [state, setState] = useState(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  const load = async () => {
    setBusy(true)
    try {
      setState(await rpc('usage'))
      setError('')
    } catch (failure) {
      setError(failure?.message || String(failure))
    } finally {
      setBusy(false)
    }
  }

  useEffect(() => {
    load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const total = state?.total || null
  const today = state?.today || null
  const pricing = state?.pricing || null
  const peakNow = state?.peakNow || null
  const purposeRows = Object.entries(state?.byPurpose || {})
    .sort((left, right) => (right[1]?.totalTokens || 0) - (left[1]?.totalTokens || 0))
    .map(([purpose, bucket]) => ({
      label: usagePurposeLabel(t, purpose),
      meta: `${t('usage.requests')} ${bucket?.requests || 0}`,
      value: bucketValue(bucket),
    }))
  const routeRows = Object.entries(state?.byRoute || {})
    .sort((left, right) => (right[1]?.totalTokens || 0) - (left[1]?.totalTokens || 0))
    .map(([route, bucket]) => ({
      label: route,
      meta: `${bucket?.requests || 0} ×`,
      value: bucketValue(bucket),
    }))
  const recentRows = (state?.recent || []).slice(0, 20).map((item) => ({
    label: `${usagePurposeLabel(t, item.purpose)} · ${item.model || t('usage.unknown')}`,
    meta: formatUsageTime(item.at),
    value: item.priced ? `${formatTokenCount(item.totalTokens || 0)} · ${formatMoney(item.costCny)}` : `${formatTokenCount(item.totalTokens || 0)} · ${t('usage.unpriced')}`,
  }))

  return h(
    Modal,
    { title: t('usage.title'), onClose, wide: true },
    h(
      'div',
      { className: 'cait-usage-grid' },
      h(
        'div',
        { className: 'cait-usage-cell' },
        h('span', null, t('usage.requests')),
        h('strong', null, total ? String(total.requests || 0) : '—'),
      ),
      h(
        'div',
        { className: 'cait-usage-cell' },
        h('span', null, t('usage.today')),
        h('strong', null, today ? formatTokenCount(today.totalTokens) : '—'),
      ),
      h(
        'div',
        { className: 'cait-usage-cell' },
        h('span', null, t('usage.total')),
        h('strong', null, total ? formatTokenCount(total.totalTokens) : '—'),
      ),
      h(
        'div',
        { className: 'cait-usage-cell' },
        h('span', null, t('usage.todayCost')),
        h('strong', null, today ? formatMoney(today.costCny) : '—'),
      ),
      h(
        'div',
        { className: 'cait-usage-cell' },
        h('span', null, t('usage.totalCost')),
        h('strong', null, total ? formatMoney(total.costCny) : '—'),
      ),
      h(
        'div',
        { className: 'cait-usage-cell' },
        h('span', null, t('usage.tier')),
        h('strong', null, peakNow ? (peakNow.peak ? t('usage.peak') : t('usage.offPeak')) : '—'),
      ),
    ),
    error ? h('p', { className: 'cait-usage-empty' }, t('usage.loadError') + error) : null,
    h('p', { className: 'cait-modal-hint' }, t('usage.tip')),
    pricing
      ? h(
          'p',
          { className: 'cait-modal-hint' },
          `${t('usage.pricing')} ${pricing.updatedAt || ''} · ${t('usage.costNote')}`,
        )
      : null,
    state?.costFrom
      ? h(
          'p',
          { className: 'cait-modal-hint' },
          t('usage.costFrom', { time: formatUsageTime(state.costFrom) }),
        )
      : null,
    UsageSection({ t, title: t('usage.byPurpose'), rows: purposeRows, empty: t('usage.empty') }),
    UsageSection({ t, title: t('usage.byRoute'), rows: routeRows, empty: t('usage.empty') }),
    UsageSection({ t, title: t('usage.recent'), rows: recentRows, empty: t('usage.empty') }),
    h(
      'div',
      { className: 'cait-modal-actions' },
      h(
        'button',
        { type: 'button', className: 'cait-btn cait-btn-ghost', onClick: load, disabled: busy },
        busy ? h(Spinner) : h(Icon, { name: 'refresh', size: 13 }),
        t('usage.refresh'),
      ),
      h('button', { type: 'button', className: 'cait-btn', onClick: onClose }, t('usage.close')),
    ),
  )
}

export {
  formatTokenCount,
  formatMoney,
  formatUsageTime,
  usagePurposeLabel,
  usageTooltip,
  UsageBadge,
  UsageModal,
}
