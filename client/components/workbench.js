import { h, useState } from '../react.js'
import { CSS_SCALED } from '../styles.js'
import { Spinner, Icon, Toast } from './base.js'
import { SaveBanner, RecentDocsModal, Topbar, EmptyState } from './shell.js'
import { SegmentRail } from './rail.js'
import { EditorPane } from './editor.js'
import { CatPanel } from './panels.js'
import { NewDocModal } from './forms.js'
import { HomePage } from './home.js'
import { AlignPage, LibraryPage } from './pages.js'
import {
  ExportModal,
  SettingsModal,
  ConfirmModal,
  BriefModal,
  LibraryIoModal,
  AiChatModal,
  TermModal,
  NoteModal,
  ReplaceModal,
  CommandPalette,
  ResourceModal,
  AnalysisModal,
} from './dialogs.js'
import { DeliveryModal, BatchModal, QuoteModal, LocalMtModal } from './workflow.js'
import { ProjectsPage, ProjectPicker, ProjectUnsaved } from './projects.js'
import { useWorkbenchController } from '../workbench/controller.js'
import { UsageModal } from './usage.js'

function Workbench({ i18n, translate }) {
  const {
    data,
    setData,
    loading,
    loadError,
    busy,
    draft,
    setDraft,
    dirty,
    setDirty,
    tab,
    setTab,
    railQuery,
    setRailQuery,
    railFilter,
    setRailFilter,
    view,
    setView,
    libSeed,
    openLibrary,
    pre,
    qa,
    review,
    reviewBusy,
    reviewIssues,
    reviewCounts,
    visibleReviewIssues,
    reviewFilter,
    setReviewFilter,
    analysis,
    analysisBusy,
    replacePreview,
    replaceUndo,
    replaceBusy,
    notes,
    notesBusy,
    concordance,
    concordanceQuery,
    setConcordanceQuery,
    concordanceBusy,
    tmQuery,
    setTmQuery,
    tmResults,
    tmError,
    mt,
    mtError,
    mtBusy,
    mtRoutes,
    stale,
    toast,
    modal,
    setModal,
    textareaRef,
    rootRef,
    draftHistoryRef,
    doc,
    index,
    segment,
    detail,
    settings,
    t,
    notify,
    report,
    refreshState,
    runPreTranslate,
    cancelPreTranslate,
    saveDraft,
    chooseSegment,
    changeDraft,
    undoDraft,
    redoDraft,
    confirmSegment,
    adoptSuggestion,
    moveSegment,
    openDocument,
    closeDocumentTab,
    createFromForm,
    loadDemo,
    applyTm,
    applyTerm,
    unconfirmCurrent,
    toggleLock,
    mergeCurrent,
    splitCurrent,
    mergeCue,
    splitCueAt,
    shiftSubtitles,
    saveBrief,
    ai,
    openAiChat,
    sendAi,
    applyAiBrief,
    clearAi,
    summarizeBrief,
    saveResources,
    openAnalysis,
    openReplace,
    previewReplace,
    applyReplace,
    undoReplace,
    openNotes,
    addNote,
    updateNote,
    deleteNote,
    refreshQa,
    jumpQa,
    runReview,
    cancelReview,
    applyReview,
    setReviewIssueState,
    exportReview,
    clearReview,
    applyQaFix,
    runConcordance,
    applyConcordance,
    editTm,
    deleteTm,
    confirmAllTranslated,
    propagateRepeats,
    clearPretranslated,
    addTerm,
    deleteTerm,
    importTmxFile,
    importGlossaryFile,
    exportGlossaryFile,
    deliverChecks,
    batchState,
    quoteConfig,
    quoteData,
    postEdit,
    mtLocalConfig,
    openDelivery,
    runDelivery,
    openBatch,
    loadBatch,
    runBatchOp,
    openQuote,
    saveQuote,
    exportQuoteFile,
    saveDocLabels,
    openLocalMt,
    saveLocalMt,
    testLocalMt,
    projectsState,
    projectPick,
    openProjects,
    selectProject,
    createProjectAction,
    saveProjectSettings,
    refreshProjectAnalysis,
    requestView,
    requestProject,
    requestProjectTab,
    requestOpenDocument,
    openHome,
    openProjectFromHome,
    newDocumentInProject,
    resumeLast,
    projectTab,
    projectDrafts,
    projectEpoch,
    includePrefs,
    rememberInclude,
    updateProjectDraft,
    pendingNav,
    resolvePendingNav,
    toggleProjectDoc,
    assignDocToProject,
    refreshProjectList,
    startProjectTimerAction,
    stopProjectTimerAction,
    addProjectTime,
    deleteProjectTime,
    exportProjectDeliveryAction,
    deleteProjectAction,
    downloadProjectReport,
    downloadDocumentReport,
    openProjectPicker,
    closeProjectPicker,
    pickProject,
    libraryIoOptions,
    exportLibraryTo,
    importLibraryTo,
    generateMt,
    saveSettings,
    setMounts,
    createLibrary,
    renameLibrary,
    deleteLibrary,
    exportAs,
    importReview,
    openConfirm,
    clearTm,
    clearGlossary,
    runConfirm,
    copy,
    closedDocuments,
    qaRisk,
    deleteClosedDocument,
    clearClosedDocuments,
    termCapture,
    usage,
    termPick,
    openTermDialog,
    saveTerm,
  } = useWorkbenchController({ i18n, translate })
  const [aiQuick, setAiQuick] = useState('')
  const [libraryIo, setLibraryIo] = useState(null)
  const ioOptions = libraryIo ? libraryIoOptions(libraryIo.kind) : { libraries: [], libraryId: '' }

  if (loading) {
    return h(
      'div',
      { className: 'cait-root', ref: rootRef },
      h('style', null, CSS_SCALED),
      h('div', { className: 'cait-center' }, h(Spinner), t('common.loading')),
    )
  }

  if (loadError) {
    return h(
      'div',
      { className: 'cait-root', ref: rootRef },
      h('style', null, CSS_SCALED),
      h(
        'div',
        { className: 'cait-center' },
        h(
          'div',
          { className: 'cait-errorcard' },
          h('p', null, `${t('error.load')}: ${loadError}`),
          h(
            'button',
            { className: 'cait-btn cait-btn-primary', onClick: () => window.location.reload() },
            h(Icon, { name: 'refresh', size: 13 }),
            t('common.retry'),
          ),
        ),
      ),
    )
  }

  const commands = [
    {
      id: 'new',
      title: t('cmd.new'),
      hint: t('cmd.newHint'),
      run: () => setModal({ type: 'new', defaultMode: 'text' }),
    },
    {
      id: 'import',
      title: t('cmd.import'),
      hint: '',
      run: () => setModal({ type: 'new', defaultMode: 'file' }),
    },
    {
      id: 'export',
      title: t('cmd.export'),
      hint: '',
      docOnly: true,
      run: () => setModal({ type: 'export' }),
    },
    {
      id: 'pretranslate',
      title: t('cmd.pretranslate'),
      hint: '',
      docOnly: true,
      run: () => openAiChat('pretranslate'),
    },
    {
      id: 'replace',
      title: t('cmd.replace'),
      hint: 'Ctrl+F',
      docOnly: true,
      run: () => openReplace(),
    },
    {
      id: 'brief',
      title: t('cmd.brief'),
      hint: '',
      docOnly: true,
      run: () => setModal({ type: 'brief' }),
    },
    {
      id: 'resources',
      title: t('cmd.resources'),
      hint: '',
      docOnly: true,
      run: () => setModal({ type: 'resources' }),
    },
    {
      id: 'analysis',
      title: t('cmd.analysis'),
      hint: '',
      docOnly: true,
      run: () => openAnalysis(),
    },
    { id: 'notes', title: t('cmd.notes'), hint: '', docOnly: true, run: () => openNotes() },
    {
      id: 'review',
      title: t('cmd.review'),
      hint: t('cmd.reviewHint'),
      docOnly: true,
      run: () => {
        setTab('qa')
        runReview('page')
      },
    },
    {
      id: 'review-risk',
      title: t('cmd.reviewRisk'),
      hint: t('cmd.reviewRiskHint'),
      docOnly: true,
      run: () => {
        setTab('qa')
        runReview('risk')
      },
    },
    {
      id: 'clear-pretranslated',
      title: t('cmd.clearPretranslated'),
      hint: '',
      docOnly: true,
      run: () => clearPretranslated(),
    },
    {
      id: 'deliver',
      title: t('deliver.open'),
      hint: '',
      docOnly: true,
      run: () => openDelivery(),
    },
    { id: 'batch', title: t('batch.open'), hint: '', docOnly: true, run: () => openBatch() },
    { id: 'quote', title: t('quote.open'), hint: '', docOnly: true, run: () => openQuote() },
    { id: 'projects', title: t('projects.title'), hint: '', run: () => requestView('projects') },
    { id: 'documents', title: t('cmd.documents'), hint: '', run: () => requestView('documents') },
    { id: 'libraries', title: t('cmd.libraries'), hint: '', run: () => requestView('libraries') },
    { id: 'align', title: t('cmd.align'), hint: '', run: () => requestView('align') },
    {
      id: 'settings',
      title: t('cmd.settings'),
      hint: '',
      run: () => setModal({ type: 'settings' }),
    },
  ].filter((item) => !item.docOnly || doc)

  const runCommand = (item) => {
    setModal(null)
    setTimeout(() => item.run(), 0)
  }

  return h(
    'div',
    { className: 'cait-root', ref: rootRef },
    h('style', null, CSS_SCALED),
    h(Topbar, {
      t,
      doc,
      data,
      usage,
      onUsage: () => setModal({ type: 'usage' }),
      busy,
      onNew: () => setModal({ type: 'new', defaultMode: 'text' }),
      onImport: () => setModal({ type: 'new', defaultMode: 'file' }),
      onExport: () => setModal({ type: 'export' }),
      onSettings: () => setModal({ type: 'settings' }),
      onOpenDoc: requestOpenDocument,
      onCloseDoc: closeDocumentTab,
      onNewTab: () => setModal({ type: 'new', defaultMode: 'file' }),
      onCleanClosed: () => setModal({ type: 'recent' }),
      pre,
      onPreTranslate: () => openAiChat('pretranslate'),
      onCancelPreTranslate: cancelPreTranslate,
      onOpenDelivery: openDelivery,
      onOpenBatch: openBatch,
      onOpenQuote: openQuote,
      onReplace: openReplace,
      view,
      onView: requestView,
      onHome: openHome,
    }),
    h(SaveBanner, { t, storage: data?.storage, stale, onRefresh: refreshState }),
    view === 'home'
      ? h(HomePage, {
          t,
          busy,
          data,
          onPasteCreate: createFromForm,
          onImport: () => setModal({ type: 'new', defaultMode: 'file' }),
          onDemo: () => createFromForm({ demo: true }),
          onOpenProject: openProjectFromHome,
          onOpenDoc: requestOpenDocument,
          onResume: resumeLast,
        })
      : null,
    view === 'projects'
      ? h(ProjectsPage, {
          t,
          busy,
          saving: busy === 'project-save',
          dirty: Boolean(projectsState?.dirty),
          state: projectsState,
          documents: data?.documents ?? [],
          libraries: data?.libraries,
          projects: data?.projects?.projects ?? [],
          includePrefs,
          draft: projectsState?.project?.id ? projectDrafts?.[projectsState.project.id] : null,
          epoch: projectEpoch,
          docId: doc?.id,
          tab: projectTab,
          onTab: requestProjectTab,
          onSelect: requestProject,
          onCreate: createProjectAction,
          onDraft: updateProjectDraft,
          onInclude: rememberInclude,
          onSave: saveProjectSettings,
          onToggleDoc: toggleProjectDoc,
          onDelete: deleteProjectAction,
          onStart: startProjectTimerAction,
          onStop: stopProjectTimerAction,
          onAddTime: addProjectTime,
          onDeleteTime: deleteProjectTime,
          onExport: exportProjectDeliveryAction,
          onOpenDoc: requestOpenDocument,
          onNewDoc: (projectId) => newDocumentInProject(projectId, 'text'),
          onImportDoc: (projectId) => newDocumentInProject(projectId, 'file'),
          onReport: downloadProjectReport,
          onDocReport: downloadDocumentReport,
          onMoveDoc: assignDocToProject,
          onRefreshAnalysis: refreshProjectAnalysis,
        })
      : null,
    view === 'libraries'
      ? h(LibraryPage, {
          t,
          data,
          settings,
          busy,
          notify,
          report,
          seed: libSeed,
          onApplyState: (state) => setData(state),
          onConfirm: openConfirm,
          onCreateLibrary: createLibrary,
          onRenameLibrary: renameLibrary,
          onDeleteLibrary: deleteLibrary,
          onSetMounts: setMounts,
          onOpenIo: (mode, kind) => setLibraryIo({ mode, kind }),
        })
      : null,
    view === 'align'
      ? h(AlignPage, {
          t,
          data,
          busy,
          notify,
          report,
          onApplyState: (state) => setData(state),
          onConfirm: openConfirm,
        })
      : null,
    view === 'documents'
      ? h(
          'div',
          { className: `cait-body${doc ? '' : ' cait-no-doc'}` },
          doc
            ? h(SegmentRail, {
                t,
                doc,
                selected: index,
                query: railQuery,
                setQuery: setRailQuery,
                filter: railFilter,
                setFilter: setRailFilter,
                onSelect: chooseSegment,
                onConfirmAll: confirmAllTranslated,
                onPropagate: propagateRepeats,
                onClearPretranslated: clearPretranslated,
                busy,
                qa,
              })
            : null,
          h(
            'div',
            {
              className: `cait-main${doc ? '' : ' cait-main-empty'}`,
              style: doc ? { gridTemplateRows: 'auto minmax(0, 1fr)' } : undefined,
            },
            doc
              ? h(
                  'div',
                  {
                    style: {
                      gridColumn: '1 / -1',
                      display: 'flex',
                      gap: 8,
                      alignItems: 'center',
                      padding: '5px 14px',
                      borderBottom: '1px solid var(--dsw-alias-border-l1)',
                    },
                  },
                  h('span', { style: { fontSize: 11, opacity: 0.62, whiteSpace: 'nowrap' } }, t('ai.barLabel')),
                  h('input', {
                    className: 'cait-input',
                    style: { flex: 1, minWidth: 0 },
                    value: aiQuick,
                    placeholder: t('ai.barPlaceholder'),
                    onChange: (event) => setAiQuick(event.target.value),
                    onKeyDown: (event) => {
                      if (event.key !== 'Enter') return
                      event.preventDefault()
                      const value = aiQuick.trim()
                      setAiQuick('')
                      openAiChat('chat')
                      if (value) sendAi(value, 'chat')
                    },
                  }),
                  h(
                    'button',
                    { className: 'cait-btn cait-btn-ghost', onClick: () => openAiChat('chat') },
                    t('ai.barOpen'),
                  ),
                )
              : null,
            doc
              ? h(EditorPane, {
                  t,
                  doc,
                  index,
                  segment,
                  detail,
                  draft,
                  setDraft: changeDraft,
                  dirty,
                  busy,
                  canUndo: draftHistoryRef.current.cursor > 0,
                  canRedo:
                    draftHistoryRef.current.cursor < draftHistoryRef.current.stack.length - 1,
                  onUndo: undoDraft,
                  onRedo: redoDraft,
                  onConfirm: confirmSegment,
                  onUnconfirm: unconfirmCurrent,
                  onToggleLock: toggleLock,
                  onMerge: mergeCurrent,
                  onSplit: splitCurrent,
                  onMergeCue: mergeCue,
                  onSplitCue: splitCueAt,
                  onShiftSubtitles: shiftSubtitles,
                  onNext: () => moveSegment(1),
                  onPrev: () => moveSegment(-1),
                  onSave: () => saveDraft(false),
                  onAdopt: adoptSuggestion,
                  onApplyTerm: applyTerm,
                  onDefineTerm: openTermDialog,
                  onOpenBrief: () => setModal({ type: 'brief' }),
                  onOpenResources: () => setModal({ type: 'resources' }),
                  onOpenAnalysis: openAnalysis,
                  onOpenNotes: openNotes,
                  noteCount: segment?.notes?.length || 0,
                  qaRisk,
                  textareaRef,
                })
              : h(EmptyState, { t, settings, busy, onCreate: createFromForm, onDemo: loadDemo }),
            doc
              ? h(CatPanel, {
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
                  onApplyTm: applyTm,
                  onEditTm: editTm,
                  onDeleteTm: deleteTm,
                  onImportTmx: importTmxFile,
                  onClearTm: clearTm,
                  onAddTerm: addTerm,
                  onDeleteTerm: deleteTerm,
                  onApplyTerm: applyTerm,
                  onDefineTerm: openTermDialog,
                  onImportGlossary: importGlossaryFile,
                  onOpenIo: (mode) => setLibraryIo({ mode, kind: 'glossary' }),
              onOpenLocalMt: openLocalMt,
                  onClearGlossary: clearGlossary,
                  mt,
                  mtError,
                  mtBusy,
                  onGenerateMt: generateMt,
                  onApplyMt: () => {
                    if (mt?.text) {
                      setDraft(mt.text)
                      setDirty(true)
                      setTimeout(() => textareaRef.current?.focus(), 0)
                    }
                  },
                  onCopy: copy,
                  onOpenSettings: () => setModal({ type: 'settings' }),
                  onSearchLibrary: openLibrary,
                  qa,
                  onRefreshQa: refreshQa,
                  onJumpQa: jumpQa,
                  onFixQa: applyQaFix,
                  review,
                  reviewBusy,
                  reviewIssues,
                  reviewCounts,
                  visibleReviewIssues,
                  reviewFilter,
                  onSetReviewFilter: setReviewFilter,
                  onReview: runReview,
                  onCancelReview: cancelReview,
                  onApplyReview: applyReview,
                  onReviewState: setReviewIssueState,
                  onExportReview: exportReview,
                  onClearReview: clearReview,
                  concordance,
                  concordanceQuery,
                  setConcordanceQuery,
                  onConcordance: runConcordance,
                  onApplyConcordance: applyConcordance,
                  busy: busy || (concordanceBusy ? 'concordance' : ''),
                })
              : null,
          ),
        )
      : null,
    modal?.type === 'new'
      ? h(NewDocModal, {
          t,
          settings,
          busy,
          defaultMode: modal.defaultMode,
          onClose: () => setModal(null),
          onCreate: createFromForm,
        })
      : null,
    modal?.type === 'export'
      ? h(ExportModal, {
          t,
          busy,
          qa,
          onClose: () => setModal(null),
          onExport: exportAs,
          onImportReview: importReview,
        })
      : null,
    modal?.type === 'brief'
      ? h(BriefModal, { t, doc, busy, onClose: () => setModal(null), onSave: saveBrief })
      : null,
    modal?.type === 'ai'
      ? h(AiChatModal, {
          t,
          doc,
          ai,
          busy,
          mode: modal.mode || 'chat',
          onClose: () => setModal(null),
          onSend: sendAi,
          onApplyBrief: applyAiBrief,
          onSummarize: summarizeBrief,
          onClear: clearAi,
          onStartPreTranslate: () => {
            setModal(null)
            runPreTranslate()
          },
        })
      : null,
    modal?.type === 'term'
      ? h(TermModal, {
          t,
          doc,
          state: termCapture,
          busy: Boolean(busy),
          initial: termPick,
          onClose: () => setModal(null),
          onSave: saveTerm,
        })
      : null,
    modal?.type === 'resources'
      ? h(ResourceModal, {
          t,
          doc,
          libraries: data?.libraries,
          mounts: data?.mounts,
          busy,
          onClose: () => setModal(null),
          onSave: saveResources,
        })
      : null,
    libraryIo
      ? h(LibraryIoModal, {
          t,
          busy: Boolean(busy),
          mode: libraryIo.mode,
          kind: libraryIo.kind,
          libraries: ioOptions.libraries,
          initialLibraryId: ioOptions.libraryId,
          initialFormat: libraryIo.kind === 'tm' ? 'tmx' : 'tbx',
          formats: libraryIo.kind === 'tm' ? ['tmx'] : ['tbx', 'csv', 'json'],
          onCancel: () => setLibraryIo(null),
          onConfirm: async (payload) => {
            setLibraryIo(null)
            if (libraryIo.mode === 'import') {
              await importLibraryTo({ kind: libraryIo.kind, libraryId: payload.libraryId, file: payload.file })
            } else {
              await exportLibraryTo({ kind: libraryIo.kind, libraryId: payload.libraryId, format: payload.format })
            }
          },
        })
      : null,
    modal?.type === 'deliver'
          ? h(DeliveryModal, {
              t,
              busy: Boolean(busy),
              checks: deliverChecks,
              labels: { client: doc?.client || '', batch: doc?.batch || '' },
              projectName: doc?.projectName || '',
              onRun: runDelivery,
              onJump: (index) => chooseSegment(index),
              onClose: () => setModal(null),
            })
          : null,
        modal?.type === 'batch'
          ? h(BatchModal, {
              t,
              busy: Boolean(busy),
              documentId: doc?.id,
              selection: batchState,
              advice: batchState?.advice,
              onSelect: loadBatch,
              onRun: runBatchOp,
              onClose: () => setModal(null),
            })
          : null,
        modal?.type === 'quote'
          ? h(QuoteModal, {
              t,
              busy: Boolean(busy),
              state: quoteConfig,
              quote: quoteData,
              postEdit,
              onSave: saveQuote,
              onRefresh: openQuote,
              onExport: exportQuoteFile,
              onLabels: saveDocLabels,
              onClose: () => setModal(null),
            })
          : null,
        modal?.type === 'localmt'
          ? h(LocalMtModal, {
              t,
              busy: Boolean(busy),
              state: mtLocalConfig,
              onSave: saveLocalMt,
              onTest: testLocalMt,
              onClose: () => setModal(null),
            })
          : null,
    modal?.type === 'analysis'
      ? h(AnalysisModal, {
          t,
          doc,
          analysis,
          busy: analysisBusy,
          onClose: () => setModal(null),
        })
      : null,
    modal?.type === 'replace'
      ? h(ReplaceModal, {
          t,
          doc,
          busy: replaceBusy,
          preview: replacePreview,
          undoCount: replaceUndo ? replaceUndo.length : 0,
          onPreview: previewReplace,
          onApply: applyReplace,
          onUndo: undoReplace,
          onClose: () => setModal(null),
        })
      : null,
    modal?.type === 'notes'
      ? h(NoteModal, {
          t,
          doc,
          index,
          segment,
          notes,
          busy: notesBusy,
          onAdd: addNote,
          onUpdate: updateNote,
          onDelete: deleteNote,
          onClose: () => setModal(null),
        })
      : null,
    modal?.type === 'palette'
      ? h(CommandPalette, { t, items: commands, onClose: () => setModal(null), onRun: runCommand })
      : null,
    modal?.type === 'usage'
      ? h(UsageModal, { t, onClose: () => setModal(null) })
      : null,
    modal?.type === 'settings'
      ? h(SettingsModal, {
          t,
          settings,
          mtRoutes,
          busy,
          onClose: () => setModal(null),
          onSave: saveSettings,
        })
      : null,
    modal?.type === 'recent'
      ? h(RecentDocsModal, {
          t,
          documents: closedDocuments,
          busy,
          onClose: () => setModal(null),
          onDelete: deleteClosedDocument,
          onClear: clearClosedDocuments,
        })
      : null,
    modal?.type === 'confirm'
      ? h(ConfirmModal, {
          t,
          state: modal,
          busy,
          onClose: () => setModal(null),
          onConfirm: runConfirm,
        })
      : null,
    h(ProjectPicker, {
      t,
      busy,
      pick: projectPick,
      onPick: pickProject,
      onClose: closeProjectPicker,
    }),
    pendingNav
      ? h(ProjectUnsaved, { t, onChoose: resolvePendingNav })
      : null,
    toast ? h(Toast, { toast }) : null,
  )
}

export { Workbench }
