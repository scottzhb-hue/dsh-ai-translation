import { h, useEffect, useRef, useState } from '../react.js'
import { Icon } from './base.js'
import { TmMatchCard } from './editor.js'

function CatPanel({
  t,
  doc,
  data,
  settings,
  mtRoutes,
  tab,
  setTab,
  tmQuery,
  setTmQuery,
  tmResults,
  tmError,
  onApplyTm,
  onEditTm,
  onDeleteTm,
  onImportTmx,
  onClearTm,
  onApplyTerm,
  onImportGlossary,
  onExportGlossary,
  onOpenIo,
  onClearGlossary,
  segmentReview,
  onReviewSegment,
  onApplySegmentReview,
  onCloseSegmentReview,
  mtLocal,
  onCopy,
  onOpenSettings,
  features,
  reviewContext,
  onPreviewAiSettings,
  onSaveAiSettings,
  onCancelAiSettings,
  onResetAiSettings,
  onMtMode,
  onSearchLibrary,
  qa,
  onRefreshQa,
  onJumpQa,
  onFixQa,
  review,
  reviewBusy,
  reviewIssues,
  reviewCounts,
  visibleReviewIssues,
  reviewFilter,
  onSetReviewFilter,
  onReview,
  onCancelReview,
  onApplyReview,
  onReviewState,
  onExportReview,
  onClearReview,
  concordance,
  concordanceQuery,
  setConcordanceQuery,
  onConcordance,
  onApplyConcordance,
  busy,
}) {
  const tmxInput = useRef(null)
  const glossaryInput = useRef(null)
  const [exportFormat, setExportFormat] = useState('tbx')
  const [aiDraft, setAiDraft] = useState({
    features: {
      suggestion: features?.suggestion !== false,
      revise: features?.revise !== false,
      review: features?.review !== false,
    },
    reviewContext: reviewContext ?? 3,
  })
  useEffect(() => {
    setAiDraft({
      features: {
        suggestion: features?.suggestion !== false,
        revise: features?.revise !== false,
        review: features?.review !== false,
      },
      reviewContext: reviewContext ?? 3,
    })
  }, [features?.suggestion, features?.revise, features?.review, reviewContext])
  const aiDirty =
    aiDraft.reviewContext !== (reviewContext ?? 3) ||
    aiDraft.features.suggestion !== (features?.suggestion !== false) ||
    aiDraft.features.revise !== (features?.revise !== false) ||
    aiDraft.features.review !== (features?.review !== false)
  const patchAi = (next) => {
    const merged = {
      ...aiDraft,
      ...next,
      features: { ...aiDraft.features, ...(next?.features ?? {}) },
    }
    setAiDraft(merged)
    onPreviewAiSettings(merged)
  }
  const routes = Array.isArray(mtRoutes?.providers) ? mtRoutes.providers : []
  const currentRoute = routes.find((route) => route.id === settings.mt.provider)
  const localMtReady = Boolean(mtLocal?.enabled && mtLocal?.baseUrl && mtLocal?.model)
  const mtProviderLabel =
    settings.mt.provider === 'mock'
      ? t('mt.mock')
      : currentRoute?.wrapper
        ? `${currentRoute.name || settings.mt.provider} · ${t('modal.settings.wrapperRoute')}`
        : currentRoute?.name || settings.mt.provider || t('mt.mock')
  const mtModeLabel = localMtReady
    ? t('panel.mtModeLocal', { model: mtLocal.model })
    : t('panel.mtModeRoute', { model: settings.mt.model || mtProviderLabel })

  const current = doc.current
  const tmMatches = tmResults?.matches ?? current?.tmMatches ?? []
  const hits = current?.glossaryHits ?? []

  return h(
    'aside',
    { className: 'cait-cat' },
    h(
      'div',
      { className: 'cait-cat-head' },
      h('span', { className: 'cait-cat-title' }, t('panel.title')),
      h(
        'div',
        { className: 'cait-cat-head-actions' },
        h(
          'button',
          {
            className: 'cait-btn cait-libopen',
            onClick: () =>
              onSearchLibrary(tab === 'glossary' ? 'glossary' : 'tm', tab === 'tm' ? tmQuery : ''),
            disabled: Boolean(busy),
            title: t('libraries.open'),
          },
          h(Icon, { name: 'database', size: 12 }),
          t('libraries.short'),
        ),
        h('span', { className: 'cait-live-dot', title: t('panel.live') }),
      ),
    ),
    h(
      'div',
      { className: 'cait-tabs' },
      h(
        'button',
        { className: `cait-tab${tab === 'tm' ? ' active' : ''}`, onClick: () => setTab('tm') },
        h(Icon, { name: 'database', size: 13 }),
        t('panel.tm'),
        h('span', { className: 'cait-count' }, data.tm.count),
      ),
      h(
        'button',
        {
          className: `cait-tab${tab === 'glossary' ? ' active' : ''}`,
          onClick: () => setTab('glossary'),
        },
        h(Icon, { name: 'book', size: 13 }),
        t('panel.glossary'),
        h('span', { className: 'cait-count' }, data.glossary.length),
      ),
      h(
        'button',
        { className: `cait-tab${tab === 'mt' ? ' active' : ''}`, onClick: () => setTab('mt') },
        h(Icon, { name: 'sparkles', size: 13 }),
        t('panel.mt'),
      ),
      h(
        'button',
        { className: `cait-tab${tab === 'qa' ? ' active' : ''}`, onClick: () => setTab('qa') },
        h(Icon, { name: 'alert', size: 13 }),
        t('panel.qa'),
        qa?.issueCount ? h('span', { className: 'cait-count' }, qa.issueCount) : null,
      ),
      h(
        'button',
        {
          className: `cait-tab${tab === 'concordance' ? ' active' : ''}`,
          onClick: () => setTab('concordance'),
        },
        h(Icon, { name: 'search', size: 13 }),
        t('panel.concordance'),
      ),
    ),
    h(
      'div',
      { className: 'cait-tabbody' },
      tab === 'tm'
        ? h(
            'div',
            null,
            h(
              'form',
              {
                className: 'cait-search',
                onSubmit: (event) => {
                  event.preventDefault()
                  setTmQuery(tmQuery)
                },
              },
              h(Icon, { name: 'search', size: 13 }),
              h('input', {
                value: tmQuery,
                onChange: (event) => {
                  setTmQuery(event.target.value)
                  if (tmResults) {
                    // clearing the field returns to current-segment matches
                  }
                },
                placeholder: t('panel.searchPlaceholder'),
                'aria-label': t('panel.searchPlaceholder'),
              }),
              h(
                'button',
                { className: 'cait-iconbtn', type: 'submit', title: t('panel.search') },
                h(Icon, { name: 'arrowRight', size: 13 }),
              ),
            ),
            // The panel searches what is mounted; the library workspace
            // searches everything. This carries the typed query across.
            h(
              'div',
              { className: 'cait-paneljump' },
              h(
                'button',
                {
                  className: 'cait-linkbtn',
                  type: 'button',
                  onClick: () => onSearchLibrary('tm', tmQuery),
                },
                t('panel.searchInLibrary'),
              ),
            ),
            h(
              'div',
              { className: 'cait-listhead' },
              h('span', null, tmResults ? t('panel.searchResults') : t('panel.currentMatches')),
              h('span', { className: 'cait-count' }, tmError ? '!' : tmMatches.length),
            ),
            tmError ? h('div', { className: 'cait-mt-error' }, tmError) : null,
            tmMatches.length
              ? tmMatches.map((match) =>
                  h(TmMatchCard, {
                    key: match.id,
                    t,
                    match,
                    busy,
                    onApply: onApplyTm,
                    onEdit: onEditTm,
                    onDelete: onDeleteTm,
                  }),
                )
              : h(
                  'p',
                  { className: 'cait-empty-note' },
                  tmResults ? t('panel.noMatches') : t('panel.noCurrentMatches'),
                ),
            h('p', { className: 'cait-mt-hint' }, t('panel.tmHint')),
            h(
              'div',
              { className: 'cait-panel-foot' },
              h('input', {
                ref: tmxInput,
                type: 'file',
                accept: '.tmx,application/xml,text/xml',
                hidden: true,
                onChange: (event) => {
                  const file = event.target.files?.[0]
                  if (file) onImportTmx(file)
                  event.target.value = ''
                },
              }),
              h(
                'button',
                {
                  className: 'cait-btn',
                  onClick: () => tmxInput.current?.click(),
                  disabled: Boolean(busy),
                },
                h(Icon, { name: 'download', size: 12 }),
                t('panel.importTmx'),
              ),
              h(
                'button',
                {
                  className: 'cait-btn cait-btn-danger',
                  onClick: onClearTm,
                  disabled: Boolean(busy) || data.tm.count === 0,
                },
                t('panel.clearTm'),
              ),
            ),
          )
        : null,
      tab === 'glossary'
        ? h(
            'div',
            null,
            h(
              'div',
              { className: 'cait-subhead' },
              h('span', null, t('panel.termHits')),
              h('span', { className: 'cait-count' }, hits.length),
            ),
            hits.length
              ? h(
                  'div',
                  { className: 'cait-hitrow', style: { marginTop: 0, marginBottom: 10 } },
                  hits.map((hit) =>
                    h(
                      'button',
                      {
                        key: hit.id,
                        className: 'cait-chip cait-chip-action',
                        onClick: () => onApplyTerm(hit),
                        title: hit.note || hit.target,
                      },
                      `${hit.term} → ${hit.target}${hit.forbidden ? ` · ${t('panel.termForbidden')}` : hit.preferred ? ` · ${t('panel.termPreferred')}` : ''}`,
                    ),
                  ),
                )
              : h('p', { className: 'cait-empty-note' }, t('panel.noHits')),
            // The panel is a per-segment view: whole-library browsing,
            // adding and editing live on the library page, so the panel
            // stays short instead of dumping the mounted glossary.
            h('p', { className: 'cait-mt-hint' }, t('panel.glossaryMatchesOnly')),
            h(
              'div',
              { className: 'cait-panel-foot' },
              h(
                'button',
                {
                  className: 'cait-btn',
                  onClick: () => onSearchLibrary('glossary', ''),
                  disabled: Boolean(busy),
                },
                h(Icon, { name: 'book', size: 12 }),
                t('panel.viewAll'),
              ),
            ),
            h(
              'div',
              { className: 'cait-panel-foot' },
              h('input', {
                ref: glossaryInput,
                type: 'file',
                accept: '.csv,.tsv,.txt',
                hidden: true,
                onChange: (event) => {
                  const file = event.target.files?.[0]
                  if (file) onImportGlossary(file)
                  event.target.value = ''
                },
              }),
              h(
                'button',
                {
                  className: 'cait-btn',
                  onClick: () => onOpenIo?.('import'),
                  disabled: Boolean(busy),
                },
                h(Icon, { name: 'download', size: 12 }),
                t('panel.importCsv'),
              ),
              h(
                'button',
                {
                  className: 'cait-btn',
                  onClick: () => onOpenIo?.('export'),
                  disabled: Boolean(busy) || data.glossary.length === 0,
                  title: t('library.export'),
                },
                h(Icon, { name: 'upload', size: 12 }),
                t('library.export'),
              ),
              h(
                'button',
                {
                  className: 'cait-btn cait-btn-danger',
                  onClick: onClearGlossary,
                  disabled: Boolean(busy) || data.glossary.length === 0,
                },
                t('panel.clearGlossary'),
              ),
            ),
          )
        : null,
      tab === 'mt'
        ? h(
            'div',
            { className: 'cait-ai-settings' },
            h('p', { className: 'cait-mt-hint' }, t('panel.aiSettingsHint')),
            h(
              'section',
              { className: 'cait-ai-block' },
              h('div', { className: 'cait-ai-title' }, t('panel.aiRouteTitle')),
              h(
                'div',
                { className: 'cait-segmented' },
                h(
                  'button',
                  {
                    className: `cait-seg${localMtReady ? '' : ' active'}`,
                    type: 'button',
                    onClick: () => onMtMode('route'),
                    disabled: Boolean(busy),
                  },
                  t('panel.aiRouteDsh'),
                ),
                h(
                  'button',
                  {
                    className: `cait-seg${localMtReady ? ' active' : ''}`,
                    type: 'button',
                    onClick: () => onMtMode('local'),
                    disabled: Boolean(busy) || !mtLocal?.baseUrl,
                    title: mtLocal?.baseUrl ? undefined : t('panel.aiRouteLocalHint'),
                  },
                  t('panel.aiRouteLocal'),
                ),
              ),
              h('p', { className: 'cait-mt-hint' }, mtModeLabel),
              h(
                'button',
                { className: 'cait-linkbtn', type: 'button', onClick: onOpenSettings },
                t('panel.aiRouteConfig'),
              ),
            ),
            h(
              'section',
              { className: 'cait-ai-block' },
              h('div', { className: 'cait-ai-title' }, t('panel.aiCardsTitle')),
              h('p', { className: 'cait-mt-hint' }, t('panel.aiCardsHint')),
              h(
                'label',
                { className: 'cait-check cait-ai-toggle' },
                h('input', {
                  type: 'checkbox',
                  checked: aiDraft.features.suggestion !== false,
                  onChange: (event) => patchAi({ features: { suggestion: event.target.checked } }),
                }),
                h('span', null, t('panel.aiCardSuggestion')),
              ),
              h(
                'label',
                { className: 'cait-check cait-ai-toggle' },
                h('input', {
                  type: 'checkbox',
                  checked: aiDraft.features.revise !== false,
                  onChange: (event) => patchAi({ features: { revise: event.target.checked } }),
                }),
                h('span', null, t('panel.aiCardRevise')),
              ),
              h(
                'label',
                { className: 'cait-check cait-ai-toggle' },
                h('input', {
                  type: 'checkbox',
                  checked: aiDraft.features.review !== false,
                  onChange: (event) => patchAi({ features: { review: event.target.checked } }),
                }),
                h('span', null, t('panel.aiCardReview')),
              ),
            ),
            h(
              'section',
              { className: 'cait-ai-block' },
              h('div', { className: 'cait-ai-title' }, t('panel.aiContextTitle')),
              h('p', { className: 'cait-mt-hint' }, t('panel.aiContextHint')),
              h('input', {
                className: 'cait-input cait-ai-context',
                type: 'number',
                min: 0,
                max: 5,
                value: aiDraft.reviewContext,
                onChange: (event) =>
                  patchAi({
                    reviewContext: Math.max(0, Math.min(5, Number(event.target.value) || 0)),
                  }),
              }),
            ),
            h(
              'div',
              { className: 'cait-panel-foot cait-ai-foot' },
              h(
                'button',
                {
                  className: 'cait-btn cait-btn-primary',
                  type: 'button',
                  onClick: () => onSaveAiSettings(aiDraft),
                  disabled: Boolean(busy) || !aiDirty,
                },
                t('panel.aiSave'),
              ),
              h(
                'button',
                { className: 'cait-btn', type: 'button', onClick: onCancelAiSettings, disabled: Boolean(busy) },
                t('panel.cancel'),
              ),
              h(
                'button',
                { className: 'cait-linkbtn', type: 'button', onClick: onResetAiSettings, disabled: Boolean(busy) },
                t('panel.aiReset'),
              ),
            ),
            h('p', { className: 'cait-mt-hint' }, t('panel.aiFooterHint')),
          )
        : null,
      tab === 'qa'
        ? h(
            'div',
            null,
            h(
              'div',
              { className: 'cait-subhead' },
              h('span', null, t('qa.title')),
              h(
                'div',
                { className: 'cait-subhead-actions' },
                h(
                  'button',
                  {
                    className: 'cait-btn cait-btn-primary',
                    onClick: () => onReview('page'),
                    disabled: Boolean(busy) || Boolean(reviewBusy),
                    title: t('qa.reviewPageHint'),
                  },
                  h(Icon, { name: 'sparkles', size: 12 }),
                  reviewBusy ? t('qa.reviewing') : t('qa.reviewPage'),
                ),
                h(
                  'button',
                  {
                    className: 'cait-linkbtn',
                    onClick: () => onReview('risk'),
                    disabled:
                      Boolean(busy) ||
                      Boolean(reviewBusy) ||
                      (qa?.risks || []).every((item) => item.risk !== 'high'),
                    title: t('qa.reviewRiskHint'),
                  },
                  t('qa.reviewRisk', {
                    count: (qa?.risks || []).filter((item) => item.risk === 'high').length,
                  }),
                ),
                h(
                  'button',
                  { className: 'cait-linkbtn', onClick: onRefreshQa, disabled: Boolean(busy) },
                  h(Icon, { name: 'refresh', size: 12 }),
                  t('qa.refresh'),
                ),
              ),
            ),
            qa
              ? h(
                  'div',
                  null,
                  h(
                    'div',
                    { className: 'cait-riskcounts' },
                    ['high', 'medium', 'low'].map((level) =>
                      h(
                        'span',
                        { key: level, className: `cait-riskcount ${level}` },
                        `${t(`qa.${level}`)} ${qa.riskCounts?.[level] || 0}`,
                      ),
                    ),
                  ),
                  (qa.risks || []).length
                    ? qa.risks.map((item) => {
                        const segment = doc.segments[item.index]
                        const codes = (item.codes || [])
                          .map((code) => t(`qa.code.${code}`))
                          .join(' · ')
                        return h(
                          'div',
                          {
                            key: item.index,
                            className: `cait-riskrow ${item.risk}`,
                            role: 'button',
                            tabIndex: 0,
                            onClick: () => onJumpQa(item.index),
                            onKeyDown: (event) => {
                              if (event.key === 'Enter' || event.key === ' ') {
                                event.preventDefault()
                                onJumpQa(item.index)
                              }
                            },
                            title: codes,
                          },
                          h('span', { className: 'cait-riskrow-index' }, `${item.index + 1}`),
                          h(
                            'div',
                            { className: 'cait-riskrow-body' },
                            h('span', { className: 'cait-riskrow-source' }, segment?.source || ''),
                            h('span', { className: 'cait-riskrow-codes' }, codes),
                            onFixQa
                              ? h(
                                  'div',
                                  { className: 'cait-riskactions' },
                                  h(
                                    'button',
                                    {
                                      className: 'cait-riskaction',
                                      onClick: (event) => {
                                        event.stopPropagation()
                                        onFixQa(item, 'copy-source')
                                      },
                                      disabled: Boolean(busy),
                                    },
                                    t('qa.fixCopy'),
                                  ),
                                  h(
                                    'button',
                                    {
                                      className: 'cait-riskaction',
                                      onClick: (event) => {
                                        event.stopPropagation()
                                        onFixQa(item, 'clear')
                                      },
                                      disabled: Boolean(busy),
                                    },
                                    t('qa.fixClear'),
                                  ),
                                  item.termTarget
                                    ? h(
                                        'button',
                                        {
                                          className: 'cait-riskaction',
                                          onClick: (event) => {
                                            event.stopPropagation()
                                            onFixQa(item, 'term')
                                          },
                                          disabled: Boolean(busy),
                                        },
                                        t('qa.fixTerm'),
                                      )
                                    : null,
                                )
                              : null,
                          ),
                          h(Icon, { name: 'chevronRight', size: 12 }),
                        )
                      })
                    : h('p', { className: 'cait-empty-note' }, t('qa.empty')),
                )
              : h('p', { className: 'cait-empty-note' }, t('qa.loading')),
            review || reviewIssues.length
              ? h(
                  'div',
                  { className: 'cait-reviewlist' },
                  h(
                    'div',
                    { className: 'cait-listhead' },
                    t('qa.reviewTitle'),
                    h(
                      'span',
                      { className: 'cait-reviewmeta' },
                      review
                        ? h(
                            'span',
                            { className: 'cait-muted' },
                            t('qa.reviewProgress', { done: review.done, total: review.total }),
                          )
                        : null,
                      review && review.running
                        ? h(
                            'button',
                            { className: 'cait-linkbtn', onClick: onCancelReview },
                            t('qa.reviewCancel'),
                          )
                        : null,
                      reviewIssues.length
                        ? h(
                            'button',
                            {
                              className: 'cait-linkbtn',
                              onClick: () => onExportReview('csv'),
                              title: t('qa.reviewExportCsvHint'),
                            },
                            h(Icon, { name: 'download', size: 12 }),
                            t('qa.reviewExportCsv'),
                          )
                        : null,
                      reviewIssues.length
                        ? h(
                            'button',
                            {
                              className: 'cait-linkbtn',
                              onClick: () => onExportReview('markdown'),
                              title: t('qa.reviewExportMarkdownHint'),
                            },
                            h(Icon, { name: 'download', size: 12 }),
                            t('qa.reviewExportMarkdown'),
                          )
                        : null,
                      reviewIssues.length
                        ? h(
                            'button',
                            { className: 'cait-linkbtn', onClick: onClearReview },
                            t('qa.reviewClear'),
                          )
                        : null,
                    ),
                  ),
                  review && review.cancelled && !review.running
                    ? h('p', { className: 'cait-empty-note' }, t('qa.reviewCancelled'))
                    : null,
                  reviewIssues.length
                    ? h(
                        'div',
                        { className: 'cait-reviewfilters' },
                        ['open', 'applied', 'ignored', 'all'].map((status) =>
                          h(
                            'button',
                            {
                              key: status,
                              className: `cait-filterchip${reviewFilter === status ? ' active' : ''}`,
                              onClick: () => onSetReviewFilter(status),
                            },
                            `${t(`qa.reviewFilter.${status}`)} ${reviewCounts[status] || 0}`,
                          ),
                        ),
                      )
                    : null,
                  visibleReviewIssues.length
                    ? visibleReviewIssues.map((issue) => {
                        const severity = ['high', 'medium', 'low'].includes(issue.severity)
                          ? issue.severity
                          : 'medium'
                        return h(
                          'div',
                          {
                            key: issue.index,
                            className: `cait-reviewrow is-${issue.status}`,
                            role: 'button',
                            tabIndex: 0,
                            onClick: () => onJumpQa(issue.index),
                            onKeyDown: (event) => {
                              if (event.key === 'Enter' || event.key === ' ') {
                                event.preventDefault()
                                onJumpQa(issue.index)
                              }
                            },
                          },
                          h('span', { className: 'cait-reviewrow-index' }, `${issue.index + 1}`),
                          h(
                            'div',
                            { className: 'cait-reviewrow-body' },
                            h(
                              'span',
                              { className: `cait-reviewrow-msg ${severity}` },
                              `[${t(`qa.${severity}`)}] ${issue.message}`,
                            ),
                            h(
                              'div',
                              { className: 'cait-riskactions' },
                              h(
                                'span',
                                { className: `cait-reviewstatus ${issue.status}` },
                                t(`qa.reviewStatus.${issue.status}`),
                              ),
                              issue.suggestion
                                ? h(
                                    'button',
                                    {
                                      className: 'cait-riskaction',
                                      onClick: (event) => {
                                        event.stopPropagation()
                                        onApplyReview(issue)
                                      },
                                    },
                                    t('qa.reviewApply'),
                                  )
                                : null,
                              issue.status === 'applied'
                                ? h(
                                    'button',
                                    {
                                      className: 'cait-riskaction',
                                      onClick: (event) => {
                                        event.stopPropagation()
                                        onReviewState(issue, 'open')
                                      },
                                    },
                                    t('qa.reviewReopen'),
                                  )
                                : h(
                                    'button',
                                    {
                                      className: 'cait-riskaction',
                                      onClick: (event) => {
                                        event.stopPropagation()
                                        onReviewState(issue, 'applied')
                                      },
                                    },
                                    t('qa.reviewMarkApplied'),
                                  ),
                              issue.status === 'ignored'
                                ? h(
                                    'button',
                                    {
                                      className: 'cait-riskaction',
                                      onClick: (event) => {
                                        event.stopPropagation()
                                        onReviewState(issue, 'open')
                                      },
                                    },
                                    t('qa.reviewReopen'),
                                  )
                                : h(
                                    'button',
                                    {
                                      className: 'cait-riskaction',
                                      onClick: (event) => {
                                        event.stopPropagation()
                                        onReviewState(issue, 'ignored')
                                      },
                                    },
                                    t('qa.reviewMarkIgnored'),
                                  ),
                            ),
                          ),
                        )
                      })
                    : reviewIssues.length
                      ? h('p', { className: 'cait-empty-note' }, t('qa.reviewFilterEmpty'))
                      : review && !review.running
                        ? h('p', { className: 'cait-empty-note' }, t('qa.reviewEmpty'))
                        : null,
                )
              : null,
          )
        : null,
      tab === 'concordance'
        ? h(
            'div',
            null,
            h(
              'form',
              {
                className: 'cait-search',
                onSubmit: (event) => {
                  event.preventDefault()
                  onConcordance()
                },
              },
              h(Icon, { name: 'search', size: 13 }),
              h('input', {
                value: concordanceQuery,
                onChange: (event) => setConcordanceQuery(event.target.value),
                placeholder: t('panel.concordancePlaceholder'),
                'aria-label': t('panel.concordancePlaceholder'),
              }),
              h(
                'button',
                { className: 'cait-iconbtn', type: 'submit', title: t('panel.searchConcordance') },
                h(Icon, { name: 'arrowRight', size: 13 }),
              ),
            ),
            h('p', { className: 'cait-mt-hint' }, t('panel.concordanceHint')),
            concordance
              ? h(
                  'div',
                  null,
                  h(
                    'div',
                    { className: 'cait-listhead' },
                    h('span', null, t('panel.concordance')),
                    h(
                      'span',
                      { className: 'cait-count' },
                      concordance.total ?? concordance.entries?.length ?? 0,
                    ),
                  ),
                  (concordance.entries || []).length
                    ? concordance.entries.map((entry, i) =>
                        h(
                          'button',
                          {
                            key: `${entry.tmId || entry.library || 'c'}-${i}`,
                            className: 'cait-concordance-row',
                            onClick: () => onApplyConcordance(entry),
                          },
                          h('span', { className: 'cait-concordance-source' }, entry.source),
                          h('span', { className: 'cait-concordance-target' }, entry.target),
                          h('span', { className: 'cait-concordance-meta' }, entry.library || ''),
                        ),
                      )
                    : h('p', { className: 'cait-empty-note' }, t('panel.noConcordance')),
                )
              : null,
          )
        : null,
    ),
  )
}

export { CatPanel }
