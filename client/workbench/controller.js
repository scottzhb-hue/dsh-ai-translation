import { useState, useEffect, useMemo, useRef } from '../react.js'
import {
  SYNC_POLL_MS,
  PRETRANSLATE_BLOCK_SIZE,
  shouldAdoptRemote,
  CAIT_UNIT_VAR,
  computeCaitUnit,
  CAIT_THEME_ATTR,
  detectThemeKind,
  DEFAULT_FUZZY_THRESHOLD,
  readPageSize,
} from '../helpers.js'
import { rpc, filePayload, downloadFile, decodeBase64, copyText } from '../rpc.js'
import { describeError } from '../errors.js'
import { UI_LANG_CODES } from '../locales.js'

// The server reviews at most 20 segments per call, so a longer run is split
// into batches and merged server-side.
const REVIEW_BATCH_SIZE = 20

// Workbench 的状态与动作。渲染层只从这里取数据，不直接调用 rpc。
export function useWorkbenchController({ i18n, translate }) {
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState('')
  const [busy, setBusy] = useState('')
  const [selected, setSelected] = useState(0)
  const [draft, setDraft] = useState('')
  const [dirty, setDirty] = useState(false)
  const [tab, setTab] = useState('tm')
  const [railQuery, setRailQuery] = useState('')
  const [railFilter, setRailFilter] = useState('all')
  // Two top-level workspaces: the translator's document and the library
  // manager. The latter needs no document, so it must not be a modal.
  const [view, setView] = useState('projects')
  // A seed carries the panel's search text into the library workspace.
  const [libSeed, setLibSeed] = useState(null)

  const openLibrary = (kind, query) => {
    setLibSeed({
      kind: kind === 'glossary' ? 'glossary' : 'tm',
      query: query || '',
      nonce: Date.now(),
    })
    setView('libraries')
  }
  const [pre, setPre] = useState({ running: false, done: 0, total: 0, filled: 0, failed: 0 })
  const [qa, setQa] = useState(null)
  const [review, setReview] = useState(null)
  const [reviewBusy, setReviewBusy] = useState(false)
  const [reviewFilter, setReviewFilter] = useState('open')
  const [analysis, setAnalysis] = useState(null)
  const [analysisBusy, setAnalysisBusy] = useState(false)
  const [replacePreview, setReplacePreview] = useState(null)
  const [replaceUndo, setReplaceUndo] = useState(null)
  const [replaceBusy, setReplaceBusy] = useState(false)
  const [notes, setNotes] = useState(null)
  const [notesBusy, setNotesBusy] = useState(false)
  const [concordance, setConcordance] = useState(null)
  const [concordanceQuery, setConcordanceQuery] = useState('')
  const [concordanceBusy, setConcordanceBusy] = useState(false)
  const [tmQuery, setTmQuery] = useState('')
  const [tmResults, setTmResults] = useState(null)
  const [tmRefresh, setTmRefresh] = useState(0)
  const [tmError, setTmError] = useState('')
  const [mt, setMt] = useState(null)
  const [mtError, setMtError] = useState('')
  const [mtBusy, setMtBusy] = useState(false)
  const [mtRoutes, setMtRoutes] = useState({ providers: [], fallback: true, message: '' })
  const [stale, setStale] = useState(false)
  const [toast, setToast] = useState(null)
  const [modal, setModal] = useState(null)
  const [usage, setUsage] = useState(null)
  const textareaRef = useRef(null)
  const dirtyRef = useRef(false)
  const busyRef = useRef(false)
  const rootRef = useRef(null)
  const unitRef = useRef(0)
  const draftHistoryRef = useRef({ index: -1, stack: [], cursor: 0, lastAt: 0 })

  const doc = data?.activeDocument || null
  const segments = doc?.segments || []
  const index = doc ? Math.min(selected, Math.max(0, segments.length - 1)) : 0
  const segment = segments[index] || null
  const detail = doc?.current?.index === index ? doc.current : null
  // The review report lives on the document, so it survives a reload; only the
  // run progress below is transient.
  const reviewIssues = useMemo(() => doc?.review?.issues || [], [doc])
  const reviewCounts = useMemo(() => {
    const counts = { all: reviewIssues.length, open: 0, applied: 0, ignored: 0 }
    for (const issue of reviewIssues) counts[issue.status] = (counts[issue.status] || 0) + 1
    return counts
  }, [reviewIssues])
  const visibleReviewIssues = useMemo(
    () =>
      reviewFilter === 'all'
        ? reviewIssues
        : reviewIssues.filter((issue) => issue.status === reviewFilter),
    [reviewIssues, reviewFilter],
  )
  useEffect(() => {
    draftHistoryRef.current = { index, stack: [draft], cursor: 0, lastAt: 0 }
  }, [doc?.id, index])
  const settings = data?.settings || {
    sourceLang: 'en',
    targetLang: 'zh-CN',
    fuzzyThreshold: DEFAULT_FUZZY_THRESHOLD,
    tmLimit: 5,
    uiLang: 'auto',
    mt: { provider: 'mock', model: 'cait-mock', temperature: 0.2 },
  }

  // The UI language is a plugin setting; 'auto' follows the DSH locale.
  const uiLang = UI_LANG_CODES.includes(settings.uiLang) ? settings.uiLang : 'auto'
  // A DSH language switch must re-render the workbench while 'auto' is
  // selected, so subscribe to the locale service through the entry seam.
  const [localeRevision, setLocaleRevision] = useState(0)
  useEffect(
    () =>
      i18n.subscribe
        ? i18n.subscribe(() => setLocaleRevision((revision) => revision + 1))
        : undefined,
    [i18n],
  )
  const t = useMemo(
    () => (key, vars) => translate(uiLang, key, vars),
    [translate, uiLang, localeRevision],
  )
  useEffect(() => {
    // Keep the sidebar label in sync with the in-app switch.
    i18n.set(uiLang)
  }, [i18n, uiLang])

  // 译文字段只在导航或确认时才写入项目，所以"刚敲、还没提交"的那段文字
  // 会先暂存到按项目拆分的 drafts 文件里；重新进入该句段时取回。
  const restoreDraftSnapshot = (documentId, segment) => {
    const uid = segment?.uid
    if (!documentId || !uid) return
    const savedTarget = String(segment?.target || '')
    void rpc('draftRecovery', { documentId, uid })
      .then((saved) => {
        const text = String(saved?.target || '')
        if (!text || text === savedTarget || dirtyRef.current) return
        setDraft(text)
        setDirty(true)
        notify(t('toast.draftRestored'))
      })
      .catch(() => {})
  }

  const adoptState = (next, forcedIndex) => {
    setData(next)
    setStale(false)
    const nextDoc = next?.activeDocument
    if (!nextDoc) {
      setSelected(0)
      setDraft('')
      setDirty(false)
      setMt(null)
      setMtError('')
      return
    }
    const nextIndex = Number.isInteger(forcedIndex)
      ? Math.min(Math.max(forcedIndex, 0), nextDoc.segments.length - 1)
      : Math.min(nextDoc.cursor, nextDoc.segments.length - 1)
    setSelected(nextIndex)
    const restoredSegment = nextDoc.segments[nextIndex]
    setDraft(restoredSegment?.target || '')
    setDirty(false)
    restoreDraftSnapshot(nextDoc.id, restoredSegment)
    setMt(null)
    setMtError('')
  }

  // TM／术语库／设置这类操作不会改动当前句段，所以刻意不重置草稿；
  // 但活动文档可能被另一个窗口删短，选中越界时必须退回完整采纳。
  const replaceRemoteState = (next) => {
    const nextDoc = next?.activeDocument
    if (!nextDoc || selected >= (nextDoc.segments?.length || 0)) adoptState(next)
    else setData(next)
  }

  const notify = (message, kind = 'success') => setToast({ message, kind, id: Date.now() })
  const report = (error) => notify(describeError(error, t), 'error')
  const importNotice = (result, fallback) => {
    const warning = result?.warnings?.[0]
    if (warning) {
      const message =
        warning.code === 'TMX_INLINE_MARKUP_LOST'
          ? t('toast.tmxMarkupLost', { count: warning.count })
          : warning.message || t('toast.tmxMarkupLost', { count: warning.count })
      notify(message, 'info')
    } else {
      notify(fallback)
    }
  }

  useEffect(() => {
    dirtyRef.current = dirty
  }, [dirty])

  useEffect(() => {
    busyRef.current = Boolean(busy)
  }, [busy])

  const refreshStorage = async () => {
    try {
      const next = await rpc('bootstrap')
      setData((current) => (current ? { ...current, storage: next.storage } : next))
    } catch {
      // The banner already reports the persistence error; a failed refresh
      // must not replace the editor state or the user's draft.
    }
  }

  const refreshState = async () => {
    try {
      // 必须读 ref：预翻译是「每块刷新一次」的长循环，闭包里的 dirty 是循环开始
      // 那一帧的值，用户中途输入会被判成「没改动」而被 adoptState 覆盖掉。
      if (dirtyRef.current) {
        const saved = await saveDraft(true)
        if (!saved) return
      }
      const next = await rpc('bootstrap')
      adoptState(next)
      setStale(false)
    } catch (error) {
      report(error)
    }
  }

  const preCancelRef = useRef(false)
  const reviewCancelRef = useRef(false)
  const reviewRunRef = useRef(0)

  // Token accounting for the requests CAIT itself sends; the Host owns the
  // ledger, this only mirrors the aggregate snapshot for the topbar badge.
  const refreshUsage = async () => {
    try {
      setUsage(await rpc('usage'))
    } catch {
      // A missing/failed usage snapshot must never break the workbench.
    }
  }

  useEffect(() => {
    if (!busy) refreshUsage()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [busy])

  // The client drives pre-translation block by block instead of asking the
  // host for a background job: a block is one RPC, cancellation is simply
  // "stop looping", and every finished block is already persisted.
  const runPreTranslate = async () => {
    const active = data?.activeDocument
    if (!active || pre.running) return
    preCancelRef.current = false
    const initial = active.progress || { confirmed: 0, translated: 0, total: 0 }
    setPre({
      running: true,
      done: initial.confirmed + initial.translated,
      total: initial.total,
      filled: 0,
      failed: 0,
    })
    let from = 0
    let filled = 0
    let failed = 0
    try {
      while (from !== null) {
        if (preCancelRef.current) break
        const result = await rpc('preTranslate', {
          documentId: active.id,
          from,
          count: PRETRANSLATE_BLOCK_SIZE,
        })
        filled += result.filled
        failed += result.failed.length
        from = result.next
        const progress = result.progress
        setPre((current) => ({
          ...current,
          done: progress.confirmed + progress.translated,
          total: progress.total,
          filled,
          failed,
        }))
        await refreshState()
      }
      if (preCancelRef.current) notify(t('toast.preCancelled'))
      else if (failed) notify(t('toast.preFailed', { count: failed }))
      else notify(t('toast.preDone', { count: filled }))
    } catch (error) {
      report(error)
    } finally {
      setPre((current) => ({ ...current, running: false }))
    }
  }

  const cancelPreTranslate = () => {
    preCancelRef.current = true
  }

  useEffect(() => {
    let alive = true
    setLoading(true)
    rpc('bootstrap')
      .then((state) => {
        if (!alive) return
        adoptState(state)
        setLoadError('')
      })
      .catch((error) => {
        if (!alive) return
        setLoadError(describeError(error, t, t('workbench.loadFailed')))
      })
      .finally(() => {
        if (alive) setLoading(false)
      })
    return () => {
      alive = false
    }
  }, [])

  useEffect(() => {
    let alive = true
    let inFlight = false
    const tick = async () => {
      if (!alive || inFlight || busyRef.current) return
      inFlight = true
      try {
        // Two round trips only when something actually changed: the revision
        // probe is a few dozen bytes, a bootstrap carries every segment of the
        // active document.
        const head = await rpc('currentRevision')
        if (!alive) return
        if (Number(head?.revision) === Number(data?.revision)) return
        const next = await rpc('bootstrap')
        if (!alive) return
        if (Number(next.revision) !== Number(data?.revision)) {
          if (
            shouldAdoptRemote({
              currentRevision: data?.revision,
              nextRevision: next.revision,
              dirty: dirtyRef.current,
            })
          ) {
            adoptState(next)
          } else if (dirtyRef.current) {
            setStale(true)
          }
        }
      } catch {
        // A transient poll failure should not replace the workbench state.
      } finally {
        inFlight = false
      }
    }
    const timer = setInterval(tick, SYNC_POLL_MS)
    return () => {
      alive = false
      clearInterval(timer)
    }
  }, [data?.revision])

  useEffect(() => {
    const id = data?.activeDocument?.id
    if (!id) {
      setQa(null)
      return
    }
    let alive = true
    rpc('getQaReport', { documentId: id })
      .then((report) => {
        if (alive) setQa(report)
      })
      .catch(() => {
        // QA is advisory: a failure must never disturb the workbench.
        if (alive) setQa(null)
      })
    return () => {
      alive = false
    }
  }, [data?.activeDocument?.id, data?.revision])

  useEffect(() => {
    reviewRunRef.current += 1
    reviewCancelRef.current = true
    setReview(null)
  }, [data?.activeDocument?.id])

  useEffect(() => {
    let alive = true
    rpc('listMtRoutes')
      .then((routes) => {
        if (alive) setMtRoutes(routes || { providers: [], fallback: true, message: '' })
      })
      .catch(() => {
        if (alive) setMtRoutes({ providers: [], fallback: true, message: '' })
      })
    return () => {
      alive = false
    }
  }, [])

  useEffect(() => {
    if (!toast) return undefined
    const timer = setTimeout(() => setToast(null), 3200)
    return () => clearTimeout(timer)
  }, [toast])

  useEffect(() => {
    setRailQuery('')
    setTmQuery('')
    setTmResults(null)
    setTmError('')
    setConcordance(null)
    setConcordanceQuery('')
    setReplacePreview(null)
    setReplaceUndo(null)
    setNotes(null)
  }, [doc?.id])

  useEffect(() => {
    const query = tmQuery.trim()
    if (!query) {
      setTmResults(null)
      setTmError('')
      return undefined
    }
    let cancelled = false
    const timer = setTimeout(() => {
      rpc('lookupTM', {
        query,
        sourceLang: doc?.sourceLang,
        targetLang: doc?.targetLang,
        threshold: settings.fuzzyThreshold,
        limit: settings.tmLimit,
      })
        .then((result) => {
          if (!cancelled) {
            setTmResults(result)
            setTmError('')
          }
        })
        .catch((error) => {
          if (!cancelled) setTmError(describeError(error, t))
        })
    }, 260)
    return () => {
      cancelled = true
      clearTimeout(timer)
    }
  }, [
    tmQuery,
    tmRefresh,
    doc?.id,
    doc?.sourceLang,
    doc?.targetLang,
    settings.fuzzyThreshold,
    settings.tmLimit,
  ])

  const saveDraft = async (silent = true) => {
    if (!doc || !dirtyRef.current) return true
    try {
      const recoveredUid = doc.segments?.[selected]?.uid
      const result = await rpc('saveDraft', { documentId: doc.id, index: selected, target: draft })
      if (recoveredUid) void rpc('clearDraftRecovery', { documentId: doc.id, uid: recoveredUid }).catch(() => {})
      if (result.state) adoptState(result.state)
      setDirty(false)
      if (!silent) notify(t('toast.draftSaved'))
      return true
    } catch (error) {
      report(error)
      return false
    }
  }

  // 未确认的译文最多每 1.2 秒写一次草稿文件：只在 dirty 时才写，
  // 内容与已存 target 相同时服务端会自行丢弃该条，因此不会残留脏数据。
  useEffect(() => {
    if (!doc?.id || !dirty) return undefined
    const documentId = doc.id
    const uid = doc.segments?.[selected]?.uid
    if (!uid) return undefined
    const timer = setTimeout(() => {
      void rpc('saveDraftRecovery', { documentId, index: selected, uid, target: draft }).catch(() => {})
    }, 1200)
    return () => clearTimeout(timer)
  }, [doc, selected, draft, dirty])

  const chooseSegment = async (nextIndex) => {
    if (!doc || busy || nextIndex === selected) return
    setBusy('select')
    try {
      if (dirtyRef.current) {
        const recoveredUid = doc.segments?.[selected]?.uid
        await rpc('saveDraft', { documentId: doc.id, index: selected, target: draft })
        if (recoveredUid) void rpc('clearDraftRecovery', { documentId: doc.id, uid: recoveredUid }).catch(() => {})
        setDirty(false)
      }
      const result = await rpc('selectSegment', { documentId: doc.id, index: nextIndex })
      adoptState(result.state)
    } catch (error) {
      report(error)
    } finally {
      setBusy('')
    }
  }

  const changeDraft = (value) => {
    const history = draftHistoryRef.current
    if (history.index !== index) {
      history.index = index
      history.stack = [draft]
      history.cursor = 0
    }
    if (history.stack[history.cursor] !== value) {
      const now = Date.now()
      if (now - history.lastAt < 650 && history.cursor > 0) {
        history.stack[history.cursor] = value
      } else {
        history.stack = history.stack.slice(0, history.cursor + 1)
        history.stack.push(value)
        if (history.stack.length > 200) history.stack.shift()
        history.cursor = history.stack.length - 1
      }
      history.lastAt = now
    }
    setDraft(value)
    setDirty(true)
  }

  const undoDraft = () => {
    const history = draftHistoryRef.current
    if (history.cursor <= 0) return
    history.cursor -= 1
    history.lastAt = 0
    const value = history.stack[history.cursor]
    setDraft(value)
    setDirty(value !== (segment?.target || ''))
  }

  const redoDraft = () => {
    const history = draftHistoryRef.current
    if (history.cursor >= history.stack.length - 1) return
    history.cursor += 1
    history.lastAt = 0
    const value = history.stack[history.cursor]
    setDraft(value)
    setDirty(value !== (segment?.target || ''))
  }

  const confirmSegment = async () => {
    if (!doc || busy) return
    if (!draft.trim()) {
      notify(t('editor.emptyTarget'), 'error')
      textareaRef.current?.focus()
      return
    }
    setBusy('confirm')
    try {
      const recoveredUid = doc.segments?.[selected]?.uid
      const result = await rpc('confirmSegment', {
        documentId: doc.id,
        index: selected,
        target: draft,
        targetTmId: data?.mounts?.defaultTmId,
      })
      if (recoveredUid) void rpc('clearDraftRecovery', { documentId: doc.id, uid: recoveredUid }).catch(() => {})
      adoptState(result.state)
      notify(result.done ? t('editor.done') : t('toast.confirmed'))
    } catch (error) {
      report(error)
      if (error?.code === 'PERSISTENCE_FAILED') await refreshStorage()
    } finally {
      setBusy('')
    }
  }

  const adoptSuggestion = async () => {
    if (!doc || busy || !segment?.suggestion) return
    if (dirtyRef.current) {
      const saved = await saveDraft(true)
      if (!saved) return
    }
    setBusy('adopt')
    try {
      const result = await rpc('adoptSuggestion', { documentId: doc.id, index: selected })
      adoptState(result.state)
      notify(t('toast.suggestionAdopted'))
    } catch (error) {
      report(error)
    } finally {
      setBusy('')
    }
  }

  const moveSegment = async (delta) => {
    if (!doc || busy) return
    setBusy('move')
    try {
      if (dirtyRef.current) {
        const recoveredUid = doc.segments?.[selected]?.uid
        await rpc('saveDraft', { documentId: doc.id, index: selected, target: draft })
        if (recoveredUid) void rpc('clearDraftRecovery', { documentId: doc.id, uid: recoveredUid }).catch(() => {})
        setDirty(false)
      }
      const result = await rpc('moveSegment', { documentId: doc.id, delta })
      adoptState(result.state)
    } catch (error) {
      report(error)
    } finally {
      setBusy('')
    }
  }

  const openDocument = async (documentId) => {
    if (!documentId || documentId === doc?.id || busy) return
    setBusy('open')
    try {
      if (dirtyRef.current) {
        const recoveredUid = doc.segments?.[selected]?.uid
        await rpc('saveDraft', { documentId: doc.id, index: selected, target: draft })
        if (recoveredUid) void rpc('clearDraftRecovery', { documentId: doc.id, uid: recoveredUid }).catch(() => {})
        setDirty(false)
      }
      const result = await rpc('openDocument', { documentId })
      adoptState(result.state)
    } catch (error) {
      report(error)
    } finally {
      setBusy('')
    }
  }

  const closeDocumentTab = async (documentId) => {
    if (!documentId || busy) return
    setBusy('close')
    try {
      if (dirtyRef.current) {
        const saved = await saveDraft(true)
        if (!saved) return
      }
      const result = await rpc('closeDocument', { documentId })
      adoptState(result.state)
      notify(t('toast.docClosed'))
    } catch (error) {
      report(error)
    } finally {
      setBusy('')
    }
  }

  const createFromForm = async (form) => {
    if (form.demo) {
      await loadDemo()
      return
    }
    setBusy('create')
    try {
      let result
      if (form.mode === 'file' && form.file) {
        const payload = await filePayload(form.file)
        result = await rpc('importFile', {
          ...payload,
          name: form.name.trim() || form.file.name,
          fileName: form.file.name,
          sourceLang: form.sourceLang,
          targetLang: form.targetLang,
          csvSourceColumn: form.csvSourceColumn,
          csvTargetColumn: form.csvTargetColumn,
        })
      } else {
        result = await rpc('createDocument', {
          name: form.name,
          text: form.text,
          sourceLang: form.sourceLang,
          targetLang: form.targetLang,
        })
      }
      adoptState(result.state)
      if (result.reused) {
        setModal(null)
        notify(t('toast.docAlreadyOpen'))
        return
      }
      importNotice(result, t('toast.imported'))
      // Every new document is filed into a project before translation starts,
      // so the picker opens right here instead of leaving it to the user.
      if (result.document?.id) {
        setModal(null)
        await openProjectPicker({
          documentId: result.document.id,
          name: result.document.name ?? '',
          afterBrief: true,
        })
      } else {
        setModal({ type: 'ai', mode: 'brief' })
      }
    } catch (error) {
      report(error)
    } finally {
      setBusy('')
    }
  }

  const loadDemo = async () => {
    setBusy('demo')
    try {
      const result = await rpc('loadDemo')
      adoptState(result.state)
      setModal(null)
      notify(result.reused ? t('toast.docAlreadyOpen') : t('toast.created'))
    } catch (error) {
      report(error)
    } finally {
      setBusy('')
    }
  }

  const applyTm = (match) => {
    setDraft(match.target)
    setDirty(true)
    setMt(null)
    setTimeout(() => textareaRef.current?.focus(), 0)
  }

  const applyTerm = (term) => {
    if (term?.forbidden) {
      notify(t('toast.termForbidden'), 'error')
      return
    }
    const separator = /^(zh|ja|ko)/i.test(doc?.targetLang || '') ? '' : ' '
    setDraft((current) => {
      const value = current.replace(/\s+$/, '')
      return value ? `${value}${separator}${term.target}` : term.target
    })
    setDirty(true)
    setTimeout(() => textareaRef.current?.focus(), 0)
  }

  const unconfirmCurrent = async () => {
    if (!doc || busy) return
    setBusy('unconfirm')
    try {
      if (dirtyRef.current) {
        const saved = await saveDraft(true)
        if (!saved) return
      }
      const result = await rpc('unconfirmSegment', { documentId: doc.id, index: selected })
      adoptState(result.state)
      notify(t('toast.unconfirmed'))
    } catch (error) {
      // Saving a dirty confirmed segment already revokes the confirmation.
      // Treat the second call as idempotent instead of showing an error.
      if (error?.code === 'NOT_CONFIRMED') notify(t('toast.unconfirmed'))
      else report(error)
    } finally {
      setBusy('')
    }
  }

  const toggleLock = async () => {
    if (!doc || busy || !segment) return
    setBusy('lock')
    try {
      await rpc('setSegmentLocked', {
        documentId: doc.id,
        index: selected,
        locked: !segment.locked,
      })
      const next = await rpc('bootstrap')
      adoptState(next, selected)
      notify(t(segment.locked ? 'toast.unlocked' : 'toast.locked'))
    } catch (error) {
      report(error)
    } finally {
      setBusy('')
    }
  }

  const mergeCurrent = (event) => {
    if (!doc || !segment || busy) return
    openConfirm({
      title: t('modal.confirm.mergeTitle'),
      message: t('modal.confirm.merge'),
      confirmLabel: t('editor.merge'),
      action: async () => {
        const result = await rpc('mergeSegments', {
          documentId: doc.id,
          index: selected,
          count: 2,
          force: Boolean(event?.shiftKey),
        })
        adoptState(result.state, result.index)
        notify(t('toast.merged'))
      },
    })
  }

  const splitCurrent = (at) => {
    if (!doc || !segment || busy) return
    openConfirm({
      title: t('modal.confirm.splitTitle'),
      message: t('modal.confirm.split'),
      confirmLabel: t('editor.split'),
      action: async () => {
        const result = await rpc('splitSegment', { documentId: doc.id, index: selected, at })
        adoptState(result.state, result.index)
        notify(t('toast.split'))
      },
    })
  }

  const mergeCue = () => {
    if (!doc || !segment || busy) return
    openConfirm({
      title: t('modal.confirm.mergeTitle'),
      message: t('modal.confirm.mergeCue'),
      confirmLabel: t('editor.mergeCue'),
      action: async () => {
        const result = await rpc('mergeCues', { documentId: doc.id, index: selected, count: 2 })
        adoptState(result.state, result.index)
        notify(t('toast.cuesMerged'))
      },
    })
  }

  const splitCueAt = (at) => {
    if (!doc || !segment || busy) return
    openConfirm({
      title: t('modal.confirm.splitTitle'),
      message: t('modal.confirm.splitCue'),
      confirmLabel: t('editor.splitCue'),
      action: async () => {
        const result = await rpc('splitCue', { documentId: doc.id, index: selected, at })
        adoptState(result.state, result.index)
        notify(t('toast.cueSplit'))
      },
    })
  }

  const shiftSubtitles = (offsetMs) => {
    if (!doc || !offsetMs || busy) return
    openConfirm({
      title: t('modal.confirm.shiftTitle'),
      message: t('modal.confirm.shiftCue'),
      confirmLabel: t('editor.shift'),
      action: async () => {
        const result = await rpc('shiftSubtitles', { documentId: doc.id, offsetMs })
        adoptState(result.state)
        notify(t('toast.subtitlesShifted'))
      },
    })
  }

  const [ai, setAi] = useState({ messages: [], busy: false, error: "", brief: null, mode: "chat" })

  useEffect(() => {
    if (modal?.type !== "ai" || !doc?.id) return undefined
    let alive = true
    setAi((current) => ({ ...current, busy: true, error: "" }))
    rpc("aiChatState", { documentId: doc.id })
      .then((state) => {
        if (!alive) return
        setAi((current) => {
          const incoming = state.messages || []
          return {
            ...current,
            busy: false,
            messages: current.messages.length > incoming.length ? current.messages : incoming,
          }
        })
      })
      .catch((error) => {
        if (!alive) return
        setAi((current) => ({
          ...current,
          busy: false,
          error: describeError(error, t, t("ai.loadFailed")),
        }))
      })
    return () => {
      alive = false
    }
  }, [modal?.type, doc?.id])

  const openAiChat = (mode) => {
    if (!doc) {
      notify(t("ai.noDocument"), "error")
      return
    }
    const nextMode = mode || "chat"
    setAi((current) => ({ ...current, mode: nextMode, error: "", brief: null }))
    setModal({ type: "ai", mode: nextMode })
  }

  const sendAi = async (message, modeOverride) => {
    if (!doc || ai.busy) return
    const text = String(message || "").trim()
    if (!text) return
    setAi((current) => ({ ...current, busy: true, error: "" }))
    try {
      const result = await rpc("aiChat", {
        documentId: doc.id,
        message: text,
        mode: (modeOverride || ai.mode) === "brief" ? "brief" : "chat",
      })
      setAi((current) => ({
        ...current,
        busy: false,
        messages: result.messages || current.messages,
        brief: result.brief || null,
      }))
      if (result.state) adoptState(result.state)
    } catch (error) {
      setAi((current) => ({
        ...current,
        busy: false,
        error: describeError(error, t, t("ai.failed")),
      }))
    }
  }

  const applyAiBrief = async () => {
    if (!doc || !ai.brief || ai.busy) return
    setBusy("ai-brief")
    try {
      const result = await rpc("setBrief", { documentId: doc.id, brief: ai.brief })
      adoptState(result.state)
      setAi((current) => ({ ...current, brief: null }))
      notify(t("ai.applied"))
    } catch (error) {
      report(error)
    } finally {
      setBusy("")
    }
  }

  const clearAi = async () => {
    if (!doc || ai.busy) return
    setAi((current) => ({ ...current, busy: true, error: "" }))
    try {
      const result = await rpc("clearAiChat", { documentId: doc.id })
      if (result.state) adoptState(result.state)
      setAi((current) => ({ ...current, busy: false, messages: [], brief: null }))
    } catch (error) {
      setAi((current) => ({
        ...current,
        busy: false,
        error: describeError(error, t, t("ai.failed")),
      }))
    }
  }

  const summarizeBrief = async () => {
    if (!doc || ai.busy) return
    setAi((current) => ({ ...current, busy: true, error: "" }))
    try {
      const result = await rpc("aiChat", { documentId: doc.id, mode: "brief" })
      setAi((current) => ({
        ...current,
        busy: false,
        messages: result.messages || current.messages,
        brief: result.brief || null,
      }))
      if (result.state) adoptState(result.state)
    } catch (error) {
      setAi((current) => ({
        ...current,
        busy: false,
        error: describeError(error, t, t("ai.failed")),
      }))
    }
  }

  const [termCapture, setTermCapture] = useState({
    mounted: [],
    defaultGlossaryId: "",
    hintSeen: true,
  })
  const [termPick, setTermPick] = useState(null)

  const openTermDialog = async (pick) => {
    if (!doc) {
      notify(t("term.noDocument"), "error")
      return
    }
    setTermPick({ source: pick?.source || "", target: pick?.target || "" })
    setModal({ type: "term" })
    try {
      const state = await rpc("termCaptureState", { documentId: doc.id })
      setTermCapture(state)
    } catch (error) {
      report(error)
    }
  }

  const saveTerm = async ({ source, target, note, glossaryId, remember }) => {
    if (!doc) return
    setBusy("term")
    try {
      const result = await rpc("addSelectedTerm", {
        documentId: doc.id,
        source,
        target,
        note,
        glossaryId: glossaryId || undefined,
        remember: Boolean(remember),
      })
      if (result.state) adoptState(result.state)
      if (result.termCapture) setTermCapture(result.termCapture)
      setModal(null)
      setTermPick(null)
      notify(t("term.saved"))
    } catch (error) {
      report(error)
    } finally {
      setBusy("")
    }
  }

  const setTermDefault = async (glossaryId) => {
    if (!doc || !glossaryId) return
    try {
      const state = await rpc("setTermCaptureDefault", { documentId: doc.id, glossaryId })
      setTermCapture(state)
      notify(t("term.defaultSaved"))
    } catch (error) {
      report(error)
    }
  }

  // —— P0/P1：交付、批量、报价、本地 MT ——
  const [deliverChecks, setDeliverChecks] = useState(null)
  const [batchState, setBatchState] = useState({ filter: 'pending', indexes: [], total: 0, advice: null })
  const [quoteConfig, setQuoteConfig] = useState(null)
  const [quoteData, setQuoteData] = useState(null)
  const [postEdit, setPostEdit] = useState(null)
  const [mtLocalConfig, setMtLocalConfig] = useState(null)

  const openDelivery = async () => {
    if (!doc?.id) {
      notify(t('deliver.noDocument'), 'error')
      return
    }
    setModal({ type: 'deliver' })
    try {
      setDeliverChecks(await rpc('deliveryChecks', { documentId: doc.id }))
    } catch (error) {
      report(error)
    }
  }

  const runDelivery = async ({ include, client, batch }) => {
    if (!doc?.id) return
    setBusy('delivery')
    try {
      await rpc('setDocumentBatch', { documentId: doc.id, client, batch })
      const result = await rpc('exportDelivery', { documentId: doc.id, include })
      downloadFile(result.filename, decodeBase64(result.content), result.mime)
      notify(t('deliver.done', { entries: (result.entries || []).length, skipped: (result.skipped || []).length }))
      setModal(null)
    } catch (error) {
      report(error)
    } finally {
      setBusy('')
    }
  }

  const loadBatch = async (filter) => {
    if (!doc?.id) return
    try {
      const [selection, advice] = await Promise.all([
        rpc('batchSelection', { documentId: doc.id, filter }),
        rpc('batchAdvice', { documentId: doc.id }),
      ])
      setBatchState({ filter, indexes: selection.indexes || [], total: selection.total || 0, advice })
    } catch (error) {
      report(error)
    }
  }

  const openBatch = async () => {
    if (!doc?.id) {
      notify(t('batch.noDocument'), 'error')
      return
    }
    setModal({ type: 'batch' })
    await loadBatch('pending')
  }

  const runBatchOp = async ({ action, documentId, indexes }) => {
    if (!documentId || !indexes?.length) return
    setBusy('batch')
    try {
      let result
      if (action === 'confirm') result = await rpc('batchConfirmSegments', { documentId, indexes, addToTm: true })
      else if (action === 'clear') result = await rpc('batchClearTargets', { documentId, indexes })
      else result = await rpc('batchSetLocked', { documentId, indexes, locked: action === 'lock' })
      if (result?.state) replaceRemoteState(result.state)
      notify(t('batch.done', { count: indexes.length }))
      await loadBatch(batchState.filter)
    } catch (error) {
      report(error)
    } finally {
      setBusy('')
    }
  }

  const openQuote = async () => {
    if (!doc?.id) {
      notify(t('quote.noDocument'), 'error')
      return
    }
    setModal({ type: 'quote' })
    try {
      const [config, quote, stats] = await Promise.all([
        rpc('quoteState'),
        rpc('quoteDocument', { documentId: doc.id }),
        rpc('postEditStats', { documentId: doc.id }),
      ])
      setQuoteConfig(config)
      setQuoteData({ ...quote, client: doc.client || '', batch: doc.batch || '' })
      setPostEdit(stats)
    } catch (error) {
      report(error)
    }
  }

  const saveQuote = async (patch) => {
    if (!doc?.id) return
    setBusy('quote')
    try {
      const config = await rpc('setQuote', patch)
      setQuoteConfig(config)
      const quote = await rpc('quoteDocument', { documentId: doc.id })
      setQuoteData({ ...quote, client: doc.client || '', batch: doc.batch || '' })
      notify(t('quote.saved'))
    } catch (error) {
      report(error)
    } finally {
      setBusy('')
    }
  }

  const exportQuoteFile = async (format) => {
    if (!doc?.id) return
    setBusy('quote')
    try {
      const result = await rpc('exportQuote', { documentId: doc.id, format })
      downloadFile(result.filename, result.content, result.mime)
      notify(t('quote.exported'))
    } catch (error) {
      report(error)
    } finally {
      setBusy('')
    }
  }

  const saveDocLabels = async ({ client, batch }) => {
    if (!doc?.id) return
    setBusy('labels')
    try {
      await rpc('setDocumentBatch', { documentId: doc.id, client, batch })
      notify(t('quote.labelsSaved'))
      setQuoteData((current) => (current ? { ...current, client, batch } : current))
    } catch (error) {
      report(error)
    } finally {
      setBusy('')
    }
  }

  const openLocalMt = async () => {
    setModal({ type: 'localmt' })
    try {
      setMtLocalConfig(await rpc('mtLocalState'))
    } catch (error) {
      report(error)
    }
  }

  const saveLocalMt = async (patch) => {
    setBusy('mtlocal')
    try {
      const state = await rpc('setMtLocal', patch)
      setMtLocalConfig(state)
      notify(t('mtlocal.saved'))
      return state
    } catch (error) {
      report(error)
      return null
    } finally {
      setBusy('')
    }
  }

  const testLocalMt = async (patch) => {
    setBusy('mtlocal')
    try {
      await rpc('setMtLocal', patch)
      const result = await rpc('mtLocalTest')
      setMtLocalConfig(await rpc('mtLocalState'))
      return { ok: true, latencyMs: result.latencyMs, model: result.model }
    } catch (error) {
      return { ok: false, message: error?.message || String(error) }
    } finally {
      setBusy('')
    }
  }

  // —— 项目（project）层：多文件共享 brief 与库，按项目汇总、交付、出报告 ——
  const [projectsState, setProjectsState] = useState(null)
  const [projectPick, setProjectPick] = useState(null)
  const [projectTab, setProjectTab] = useState('projects')
  const [projectDrafts, setProjectDrafts] = useState({})
  const [projectEpoch, setProjectEpoch] = useState(0)
  const [pendingNav, setPendingNav] = useState(null)
  const [includePrefs, setIncludePrefs] = useState(() => {
    try {
      const raw = window.localStorage.getItem('cait.project.include')
      const parsed = raw ? JSON.parse(raw) : null
      return parsed && typeof parsed === 'object' ? parsed : null
    } catch {
      return null
    }
  })

  /** 交付勾选是界面偏好，不进 store；存 localStorage，下次打开沿用。 */
  const rememberInclude = (include) => {
    setIncludePrefs(include)
    try {
      window.localStorage.setItem('cait.project.include', JSON.stringify(include))
    } catch {
      /* 偏好存不下不影响功能 */
    }
  }

  const currentProjectId = () => projectsState?.project?.id ?? ''
  const projectDirty = Boolean(projectsState?.dirty)

  const clearProjectDraft = (projectId) => {
    if (!projectId) return
    setProjectDrafts((current) => {
      if (!current[projectId]) return current
      const next = { ...current }
      delete next[projectId]
      return next
    })
    setProjectsState((current) =>
      current?.project?.id === projectId ? { ...current, dirty: false } : current,
    )
  }

  /** 项目详情的编辑立刻进草稿，离开 / 切换项目时才有东西可恢复或提醒。 */
  const updateProjectDraft = (draft, dirty = true) => {
    const projectId = currentProjectId()
    if (!projectId) return
    setProjectDrafts((current) => ({ ...current, [projectId]: draft }))
    if (dirty) {
      setProjectsState((current) =>
        current?.project?.id === projectId ? { ...current, dirty: true } : current,
      )
    }
  }

  const guardProjectNav = (nav) => {
    if (!projectDirty) return false
    setPendingNav(nav)
    return true
  }

  const requestView = (next) => {
    if (next === 'projects') {
      if (view === 'projects') void refreshProjectList().catch(report)
      else void openProjects()
      return
    }
    if (guardProjectNav({ kind: 'view', view: next })) return
    setView(next)
  }

  /** 项目详情里的文档行：点开即进编辑器，有未保存设置时先拦一下。 */
  const requestOpenDocument = async (documentId) => {
    if (!documentId) return
    if (view === 'projects' && guardProjectNav({ kind: 'doc', documentId })) return
    await openDocument(documentId)
    setView('documents')
  }

  const flattenProjectDetail = (detail) => ({
    ...detail.project,
    brief: detail.brief,
    note: detail.note ?? detail.project?.note ?? '',
    resources: detail.resources,
    time: detail.time,
    documentRows: Array.isArray(detail.documents) ? detail.documents : [],
  })

  const applyDocumentSummary = (summary) => {
    if (!summary?.id) return
    setData((current) => {
      if (!current?.documents) return current
      const documents = current.documents.map((item) => (item.id === summary.id ? summary : item))
      return { ...current, documents }
    })
  }

  const refreshProjectList = async () => {
    const list = await rpc('projectsList')
    setProjectsState((current) => ({ ...(current ?? {}), list }))
    return list
  }

  const loadProjectDetail = async (projectId, { analyze = false, stale = false } = {}) => {
    const [detail, analysis] = await Promise.all([
      rpc('projectDetail', { projectId }),
      analyze ? rpc('projectAnalysis', { projectId }) : Promise.resolve(null),
    ])
    setProjectsState((current) => {
      const same = current?.project?.id === projectId
      return {
        ...(current ?? {}),
        project: flattenProjectDetail(detail),
        analysis: analysis ?? (same ? current.analysis : null),
        analysisStale: analyze ? false : same ? Boolean(current.analysisStale) || stale : false,
      }
    })
    setProjectEpoch((value) => value + 1)
    return detail
  }

  const openProjects = async (projectId) => {
    setBusy('projects')
    try {
      const list = await rpc('projectsList')
      setProjectsState((current) => ({ ...(current ?? {}), list }))
      const dirtyId = projectDirty ? currentProjectId() : ''
      const target = projectId || dirtyId || currentProjectId() || doc?.projectId
      if (view !== 'projects') setView('projects')
      // 带着未保存的草稿回到项目视图：只刷新列表，详情与草稿原样保留。
      if (dirtyId && (!projectId || projectId === dirtyId)) return
      const fallback = list.projects.find((item) => !item.inbox) ?? list.projects[0]
      const pick = target || fallback?.id
      if (pick) await loadProjectDetail(pick, { analyze: true })
    } catch (error) {
      report(error)
    } finally {
      setBusy('')
    }
  }

  const selectProject = async (projectId) => {
    if (!projectId) return
    setBusy('projects')
    try {
      await loadProjectDetail(projectId, { analyze: true })
    } catch (error) {
      report(error)
    } finally {
      setBusy('')
    }
  }

  const requestProject = (projectId) => {
    if (!projectId || projectId === currentProjectId()) return
    if (guardProjectNav({ kind: 'project', projectId })) return
    void selectProject(projectId)
  }

  const requestProjectTab = (next) => {
    if (next === projectTab) return
    if (guardProjectNav({ kind: 'tab', tab: next })) return
    setProjectTab(next)
  }

  const createProjectAction = async (name) => {
    setBusy('projects')
    try {
      const result = await rpc('createProject', { name })
      clearProjectDraft(result.project.id)
      await refreshProjectList()
      await loadProjectDetail(result.project.id, { analyze: true })
      notify(t('projects.created'))
      return result.project
    } catch (error) {
      report(error)
      return null
    } finally {
      setBusy('')
    }
  }

  /**
   * One explicit save for the whole settings pane: name/client/due/note, brief,
   * shared libraries and the default write library. Include checkboxes are a UI
   * preference (localStorage) and hour inputs are operations, not settings.
   */
  const saveProjectSettings = async () => {
    const projectId = currentProjectId()
    if (!projectId) return false
    const draft = projectDrafts[projectId]
    setBusy('project-save')
    try {
      const result = await rpc('updateProject', {
        projectId,
        ...(draft?.settings ?? {}),
      })
      if (draft?.brief) await rpc('setProjectBrief', { projectId, brief: draft.brief })
      setProjectsState((current) => ({ ...(current ?? {}), list: result.projects }))
      clearProjectDraft(projectId)
      await loadProjectDetail(projectId, { stale: true })
      notify(t('projects.settingsSaved'))
      return true
    } catch (error) {
      report(error)
      return false
    } finally {
      setBusy('')
    }
  }

  const refreshProjectAnalysis = async () => {
    const projectId = currentProjectId()
    if (!projectId) return
    setBusy('project-analysis')
    try {
      const analysis = await rpc('projectAnalysis', { projectId })
      setProjectsState((current) => ({ ...(current ?? {}), analysis, analysisStale: false }))
    } catch (error) {
      report(error)
    } finally {
      setBusy('')
    }
  }

  /** 离开项目设置前的三选一：保存并离开 / 放弃修改 / 取消。 */
  const resolvePendingNav = async (choice) => {
    const nav = pendingNav
    if (!nav) return
    setPendingNav(null)
    if (choice === 'cancel') return
    if (choice === 'save') {
      const ok = await saveProjectSettings()
      if (!ok) return
    } else {
      const projectId = currentProjectId()
      clearProjectDraft(projectId)
      if (projectId) await loadProjectDetail(projectId)
    }
    if (nav.kind === 'view') setView(nav.view)
    else if (nav.kind === 'tab') setProjectTab(nav.tab)
    else if (nav.kind === 'project') await selectProject(nav.projectId)
    else if (nav.kind === 'doc') {
      await openDocument(nav.documentId)
      setView('documents')
    }
  }

  /** Move one document in or out of the selected project (unchecked → 未分类). */
  const toggleProjectDoc = async (documentId, checked) => {
    const projectId = currentProjectId()
    if (!projectId) return
    setBusy('projects')
    try {
      const result = await rpc('assignDocumentProject', {
        documentId,
        projectId: checked ? projectId : '',
      })
      applyDocumentSummary(result.document)
      setProjectsState((current) => ({ ...(current ?? {}), list: result.projects }))
      await loadProjectDetail(projectId, { stale: true })
    } catch (error) {
      report(error)
    } finally {
      setBusy('')
    }
  }

  const assignDocToProject = async (documentId, projectId) => {
    setBusy('projects')
    try {
      const result = await rpc('assignDocumentProject', { documentId, projectId })
      applyDocumentSummary(result.document)
      setProjectsState((current) => ({ ...(current ?? {}), list: result.projects }))
      notify(t('projects.moved'))
      if (currentProjectId()) await loadProjectDetail(currentProjectId(), { stale: true })
      return true
    } catch (error) {
      report(error)
      return false
    } finally {
      setBusy('')
    }
  }

  const startProjectTimerAction = async () => {
    const projectId = currentProjectId()
    if (!projectId) return
    setBusy('projects')
    try {
      const result = await rpc('startProjectTimer', { projectId })
      setProjectsState((current) => ({
        ...(current ?? {}),
        list: result.projects,
        project: { ...current.project, running: true, time: result.time },
      }))
    } catch (error) {
      report(error)
    } finally {
      setBusy('')
    }
  }

  const stopProjectTimerAction = async () => {
    const projectId = currentProjectId()
    if (!projectId) return
    setBusy('projects')
    try {
      const result = await rpc('stopProjectTimer', { projectId })
      setProjectsState((current) => ({
        ...(current ?? {}),
        list: result.projects,
        project: { ...current.project, running: false, time: result.time },
        analysisStale: true,
      }))
    } catch (error) {
      report(error)
    } finally {
      setBusy('')
    }
  }

  const addProjectTime = async (minutes, note) => {
    const projectId = currentProjectId()
    if (!projectId) return false
    setBusy('projects')
    try {
      const result = await rpc('addTimeEntry', { projectId, minutes, note })
      setProjectsState((current) => ({
        ...(current ?? {}),
        list: result.projects,
        project: { ...current.project, time: result.time },
        analysisStale: true,
      }))
      return true
    } catch (error) {
      report(error)
      return false
    } finally {
      setBusy('')
    }
  }

  const deleteProjectTime = async (entryId) => {
    const projectId = currentProjectId()
    if (!projectId) return
    setBusy('projects')
    try {
      const result = await rpc('deleteTimeEntry', { projectId, entryId })
      setProjectsState((current) => ({
        ...(current ?? {}),
        list: result.projects,
        project: { ...current.project, time: result.time },
        analysisStale: true,
      }))
    } catch (error) {
      report(error)
    } finally {
      setBusy('')
    }
  }

  const exportProjectDeliveryAction = async (include) => {
    const projectId = currentProjectId()
    if (!projectId) return
    rememberInclude(include)
    setBusy('project-export')
    try {
      const result = await rpc('exportProjectDelivery', { projectId, include })
      downloadFile(result.filename, decodeBase64(result.content), result.mime)
      notify(
        t('projects.exported', {
          entries: (result.entries || []).length,
          skipped: (result.skipped || []).length,
        }),
      )
    } catch (error) {
      report(error)
    } finally {
      setBusy('')
    }
  }

  const downloadProjectReport = async (projectId, format = 'html') => {
    const target = projectId || currentProjectId()
    if (!target) return
    setBusy('project-report')
    try {
      const result = await rpc('projectReport', { projectId: target, format })
      downloadFile(result.filename, result.content, result.mime)
      notify(t('projects.reportReady'))
    } catch (error) {
      report(error)
    } finally {
      setBusy('')
    }
  }

  const downloadDocumentReport = async (documentId, format = 'html') => {
    setBusy('report')
    try {
      const result = await rpc('documentReport', { documentId, format })
      downloadFile(result.filename, result.content, result.mime)
      notify(t('projects.reportReady'))
    } catch (error) {
      report(error)
    } finally {
      setBusy('')
    }
  }

  const deleteProjectAction = async () => {
    const projectId = currentProjectId()
    if (!projectId) return
    setBusy('project-delete')
    try {
      const result = await rpc('deleteProject', { projectId, confirm: true })
      clearProjectDraft(projectId)
      notify(t('projects.deleted', { released: (result.released || []).length }))
      const list = result.projects ?? (await rpc('projectsList'))
      setProjectsState({ list, project: null, analysis: null, analysisStale: false })
      const fallback = list.projects[0]
      if (fallback) await loadProjectDetail(fallback.id, { analyze: true })
    } catch (error) {
      report(error)
    } finally {
      setBusy('')
    }
  }

  /**
   * The project picker every new document goes through: pick an existing
   * project, type a new name, or fall back to「未分类」and sort it out later.
   */
  const openProjectPicker = async ({ documentId, name, afterBrief = false }) => {
    try {
      const list = await rpc('projectsList')
      setProjectPick({ documentId, name, afterBrief, projects: list.projects, newName: '' })
    } catch (error) {
      report(error)
    }
  }

  const closeProjectPicker = () => setProjectPick(null)

  const pickProject = async ({ projectId, newName }) => {
    if (!projectPick) return
    const pending = { ...projectPick }
    let targetId = ''
    setBusy('projects')
    try {
      targetId = String(projectId ?? '')
      if (!targetId && String(newName ?? '').trim()) {
        const created = await rpc('createProject', { name: String(newName).trim() })
        targetId = created.project.id
      }
      const result = await rpc('assignDocumentProject', {
        documentId: pending.documentId,
        projectId: targetId,
      })
      applyDocumentSummary(result.document)
      setProjectsState((current) => ({ ...(current ?? {}), list: result.projects }))
      setProjectPick(null)
      notify(t('projects.assigned'))
    } catch (error) {
      report(error)
    } finally {
      setBusy('')
    }
    if (!pending.documentId) return
    if (view === 'projects' && targetId) await loadProjectDetail(targetId, { stale: true })
    await openDocument(pending.documentId)
    setView('documents')
    if (pending.afterBrief) setModal({ type: 'ai', mode: 'brief' })
  }

  const saveBrief = async (brief) => {
    if (!doc || busy) return false
    setBusy('brief')
    try {
      const result = await rpc('setBrief', { documentId: doc.id, brief })
      adoptState(result.state)
      setModal(null)
      notify(t('toast.briefSaved'))
      return true
    } catch (error) {
      report(error)
      return false
    } finally {
      setBusy('')
    }
  }

  const saveResources = async (resources) => {
    if (!doc || busy) return false
    setBusy('resources')
    try {
      const result = await rpc('setDocumentResources', { documentId: doc.id, ...resources })
      adoptState(result.state)
      setModal(null)
      notify(t('toast.resourcesSaved'))
      return true
    } catch (error) {
      report(error)
      return false
    } finally {
      setBusy('')
    }
  }

  const openAnalysis = async () => {
    if (!doc) return
    setAnalysis(null)
    setModal({ type: 'analysis' })
    setAnalysisBusy(true)
    try {
      setAnalysis(await rpc('analyzeDocument', { documentId: doc.id }))
    } catch (error) {
      report(error)
    } finally {
      setAnalysisBusy(false)
    }
  }

  const openReplace = () => {
    if (!doc) return
    setReplacePreview(null)
    setModal({ type: 'replace' })
  }

  const previewReplace = async (form) => {
    if (!doc || replaceBusy) return
    setReplaceBusy(true)
    try {
      setReplacePreview(await rpc('replaceInDocument', { documentId: doc.id, ...form }))
    } catch (error) {
      report(error)
    } finally {
      setReplaceBusy(false)
    }
  }

  const applyReplace = async (form) => {
    if (!doc || replaceBusy) return
    setReplaceBusy(true)
    try {
      const result = await rpc('replaceInDocument', { documentId: doc.id, ...form, apply: true })
      setReplaceUndo(Array.isArray(result.undo) && result.undo.length ? result.undo : null)
      setReplacePreview(null)
      adoptState(result.state, result.undo?.[0]?.index)
      notify(t('toast.replaced', { count: result.applied ?? 0 }))
    } catch (error) {
      report(error)
    } finally {
      setReplaceBusy(false)
    }
  }

  const undoReplace = async () => {
    if (!doc || !replaceUndo || replaceBusy) return
    setReplaceBusy(true)
    try {
      const result = await rpc('undoReplace', { documentId: doc.id, undo: replaceUndo })
      adoptState(result.state, replaceUndo[0]?.index)
      setReplaceUndo(null)
      setReplacePreview(null)
      notify(t('toast.replaceUndone'))
    } catch (error) {
      report(error)
    } finally {
      setReplaceBusy(false)
    }
  }

  const openNotes = async () => {
    if (!doc) return
    setNotes(null)
    setNotesBusy(true)
    setModal({ type: 'notes' })
    try {
      const result = await rpc('notesForSegment', { documentId: doc.id, index })
      setNotes(result.notes)
    } catch (error) {
      report(error)
    } finally {
      setNotesBusy(false)
    }
  }

  const addNote = async (text) => {
    if (!doc || notesBusy) return
    setNotesBusy(true)
    try {
      const result = await rpc('addSegmentNote', { documentId: doc.id, index, text })
      setNotes(result.notes)
      adoptState(result.state, index)
      notify(t('toast.noteSaved'))
    } catch (error) {
      report(error)
    } finally {
      setNotesBusy(false)
    }
  }

  const updateNote = async (noteId, text) => {
    if (!doc || notesBusy) return
    setNotesBusy(true)
    try {
      const result = await rpc('updateSegmentNote', { documentId: doc.id, index, noteId, text })
      setNotes(result.notes)
      adoptState(result.state, index)
      notify(t('toast.noteSaved'))
    } catch (error) {
      report(error)
    } finally {
      setNotesBusy(false)
    }
  }

  const deleteNote = async (noteId) => {
    if (!doc || notesBusy) return
    setNotesBusy(true)
    try {
      const result = await rpc('deleteSegmentNote', { documentId: doc.id, index, noteId })
      setNotes(result.notes)
      adoptState(result.state, index)
      notify(t('toast.noteDeleted'))
    } catch (error) {
      report(error)
    } finally {
      setNotesBusy(false)
    }
  }

  const refreshQa = async () => {
    if (!doc) return
    setQa(null)
    try {
      setQa(await rpc('getQaReport', { documentId: doc.id }))
    } catch {
      // QA is advisory; a failure must not disturb the editor.
    }
  }

  const jumpQa = (nextIndex) => {
    if (Number.isInteger(nextIndex)) chooseSegment(nextIndex)
  }

  // Which segments a review run covers. "This page" follows the segment the
  // user is editing (the rail jumps to it), "high risk" reuses the rule-based
  // check instead of letting the model pick, and both are capped per request
  // by the server, so a run is split into batches below.
  const reviewIndexes = (target) => {
    if (!doc) return []
    const total = doc.segments.length
    if (target === 'risk') {
      return (qa?.risks || [])
        .filter((item) => item.risk === 'high' && Number.isInteger(item.index))
        .map((item) => item.index)
    }
    const storage = typeof localStorage === 'undefined' ? null : localStorage
    const size = readPageSize(storage)
    const start = Math.floor(Math.min(Math.max(0, selected), Math.max(0, total - 1)) / size) * size
    const end = Math.min(total, start + size)
    return Array.from({ length: Math.max(0, end - start) }, (_, offset) => start + offset)
  }

  const runReview = async (target = 'page') => {
    if (!doc || reviewBusy) return
    const indexes = reviewIndexes(target)
    if (!indexes.length) {
      notify(t(target === 'risk' ? 'qa.reviewRiskEmpty' : 'qa.reviewEmptyRange'), 'info')
      return
    }
    const token = ++reviewRunRef.current
    reviewCancelRef.current = false
    setReviewBusy(true)
    setReview({
      target,
      running: true,
      cancelled: false,
      done: 0,
      total: indexes.length,
    })
    try {
      for (let offset = 0; offset < indexes.length; offset += REVIEW_BATCH_SIZE) {
        if (reviewCancelRef.current || reviewRunRef.current !== token) break
        const batch = indexes.slice(offset, offset + REVIEW_BATCH_SIZE)
        const result = await rpc('reviewDocument', { documentId: doc.id, indexes: batch })
        if (reviewRunRef.current !== token) break
        // Each batch is persisted server side and comes back with the whole
        // state, so the report in the panel is always what the store holds.
        replaceRemoteState(result.state)
        setReview((prev) =>
          prev ? { ...prev, done: Math.min(prev.total, offset + batch.length) } : prev,
        )
      }
    } catch (error) {
      if (reviewRunRef.current === token) report(error)
    } finally {
      if (reviewRunRef.current === token) {
        setReviewBusy(false)
        setReview((prev) =>
          prev ? { ...prev, running: false, cancelled: reviewCancelRef.current } : prev,
        )
      }
    }
  }

  const cancelReview = () => {
    reviewCancelRef.current = true
  }

  const applyReview = (issue) => {
    if (!doc || !issue || !Number.isInteger(issue.index)) return
    chooseSegment(issue.index)
    if (issue.suggestion) {
      setDraft(issue.suggestion)
      setDirty(true)
    }
  }

  const setReviewIssueState = async (issue, status) => {
    if (!doc || !issue || issue.status === status) return
    try {
      const result = await rpc('setReviewIssueState', {
        documentId: doc.id,
        index: issue.index,
        status,
      })
      replaceRemoteState(result.state)
    } catch (error) {
      report(error)
    }
  }

  const exportReview = async (format) => {
    if (!doc) return
    try {
      const file = await rpc('exportReview', { documentId: doc.id, format })
      downloadFile(file.filename, file.content, file.mime)
      notify(t('qa.reviewExported', { count: file.count }))
    } catch (error) {
      report(error)
    }
  }

  const clearReview = () => {
    if (!doc || !reviewIssues.length) return
    openConfirm({
      title: t('qa.reviewClearTitle'),
      message: t('qa.reviewClearMessage', { count: reviewIssues.length }),
      confirmLabel: t('qa.reviewClear'),
      action: async () => {
        try {
          const result = await rpc('clearReview', { documentId: doc.id })
          replaceRemoteState(result.state)
          notify(t('qa.reviewCleared', { count: result.cleared }))
        } catch (error) {
          report(error)
        }
      },
    })
  }

  const applyQaFix = async (item, action) => {
    if (!doc || busy || !item) return
    const segment = doc.segments[item.index]
    if (!segment) return
    let target = segment.target || ''
    if (action === 'copy-source') {
      target = segment.source
    } else if (action === 'clear') {
      target = ''
    } else if (action === 'term') {
      const term = String(item.termTarget || '')
      if (!term || target.includes(term)) return
      const separator = /[A-Za-z0-9]$/.test(target) && /^[A-Za-z0-9]/.test(term) ? ' ' : ''
      target = `${target}${separator}${term}`
    } else {
      return
    }
    setBusy('qa-fix')
    try {
      const result = await rpc('saveDraft', {
        documentId: doc.id,
        index: item.index,
        target,
      })
      if (result.state) adoptState(result.state, item.index)
      setQa(await rpc('getQaReport', { documentId: doc.id }))
      notify(t('toast.qaFixed'))
    } catch (error) {
      report(error)
    } finally {
      setBusy('')
    }
  }

  const runConcordance = async () => {
    const query = concordanceQuery.trim()
    if (!doc || !query) {
      setConcordance(null)
      return
    }
    setConcordanceBusy(true)
    try {
      setConcordance(await rpc('concordance', { documentId: doc.id, query, limit: 50 }))
    } catch (error) {
      report(error)
    } finally {
      setConcordanceBusy(false)
    }
  }

  const applyConcordance = (entry) => {
    if (!entry?.target) return
    setDraft(entry.target)
    setDirty(true)
    setMt(null)
    setTimeout(() => textareaRef.current?.focus(), 0)
  }

  const editTm = async ({ id, target }) => {
    setBusy('tm-edit')
    try {
      const result = await rpc('updateTM', { id, target })
      replaceRemoteState(result.state)
      setTmRefresh((value) => value + 1)
      notify(t('toast.tmUpdated'))
      return true
    } catch (error) {
      report(error)
      return false
    } finally {
      setBusy('')
    }
  }

  const deleteTm = (match) => {
    setModal({
      type: 'confirm',
      title: t('modal.confirm.title'),
      message: `${t('modal.confirm.deleteTm')} “${match.source} → ${match.target}”？`,
      confirmLabel: t('panel.delete'),
      action: async () => {
        const result = await rpc('deleteTM', { id: match.id })
        replaceRemoteState(result.state)
        setTmRefresh((value) => value + 1)
        notify(t('toast.tmDeleted'))
      },
    })
  }

  const confirmAllTranslated = () => {
    const active = data?.activeDocument
    const awaiting = active?.progress?.translated || 0
    if (!active || !awaiting) return
    setModal({
      type: 'confirm',
      title: t('rail.confirmAll'),
      message: t('rail.confirmAllMessage', { count: awaiting }),
      confirmLabel: t('rail.confirmAll'),
      action: async () => {
        const result = await rpc('confirmSegments', { documentId: active.id, status: 'translated' })
        await refreshState()
        setTmRefresh((value) => value + 1)
        notify(t('toast.confirmedMany', { count: result.confirmed.length }))
      },
    })
  }

  const propagateRepeats = () => {
    const active = data?.activeDocument
    if (!active) return
    setModal({
      type: 'confirm',
      title: t('rail.propagate'),
      message: t('rail.propagateMessage'),
      confirmLabel: t('rail.propagate'),
      action: async () => {
        const result = await rpc('propagateDocument', { documentId: active.id })
        await refreshState()
        notify(t('toast.propagated', { count: result.filled }))
      },
    })
  }

  const clearPretranslated = async () => {
    const active = data?.activeDocument
    if (!active) return
    try {
      const preview = await rpc('getClearUnconfirmedPreview', { documentId: active.id })
      const counts = preview?.counts || {}
      const total = counts.total || 0
      if (!total) {
        notify(t('toast.nothingToClear'), 'info')
        return
      }
      setModal({
        type: 'confirm',
        title: t('modal.confirm.clearPretranslatedTitle'),
        message: t('modal.confirm.clearPretranslatedMessage', {
          count: total,
          mt: counts.mt || 0,
          tm: counts.tm || 0,
          auto: counts.auto || 0,
        }),
        confirmLabel: t('modal.confirm.clearPretranslatedConfirm', { count: total }),
        action: async () => {
          const result = await rpc('clearUnconfirmedTranslations', {
            documentId: active.id,
            confirm: true,
          })
          adoptState(result.state, result.cursor)
          notify(t('toast.pretranslatedCleared', { count: result.cleared }))
        },
      })
    } catch (error) {
      report(error)
    }
  }

  const addTerm = async (form) => {
    setBusy('term')
    try {
      const result = await rpc('addGlossary', {
        ...form,
        sourceLang: doc?.sourceLang || settings.sourceLang,
        glossaryId: data?.mounts?.defaultGlossaryId,
      })
      replaceRemoteState(result.state)
      notify(t('toast.termSaved'))
      return true
    } catch (error) {
      report(error)
      return false
    } finally {
      setBusy('')
    }
  }

  const deleteTerm = (term) => {
    setModal({
      type: 'confirm',
      title: t('modal.confirm.title'),
      message: `${t('modal.confirm.deleteTerm')} “${term.source} → ${term.target}”？`,
      confirmLabel: t('panel.delete'),
      action: async () => {
        const result = await rpc('deleteGlossary', { id: term.id })
        replaceRemoteState(result.state)
        notify(t('toast.termDeleted'))
      },
    })
  }

  const importTmxFile = async (file) => {
    setBusy('tm-import')
    try {
      const text = await file.text()
      const result = await rpc('importTmx', {
        text,
        importAs: 'tm',
        sourceLang: doc?.sourceLang || settings.sourceLang,
        targetLang: doc?.targetLang || settings.targetLang,
        tmId: data?.mounts?.defaultTmId,
      })
      replaceRemoteState(result.state)
      importNotice(result, `${t('toast.tmImported')} · +${result.added} / ~${result.updated}`)
    } catch (error) {
      report(error)
    } finally {
      setBusy('')
    }
  }

  const importGlossaryFile = async (file) => {
    setBusy('glossary-import')
    try {
      const text = await file.text()
      const result = await rpc('importGlossary', {
        text,
        glossaryId: data?.mounts?.defaultGlossaryId,
      })
      replaceRemoteState(result.state)
      notify(`${t('toast.glossaryImported')} · +${result.added} / ~${result.updated}`)
    } catch (error) {
      report(error)
    } finally {
      setBusy('')
    }
  }

  const exportGlossaryFile = async (format = 'tbx') => {
    setBusy('glossary-export')
    try {
      const result = await rpc('exportGlossary', {
        documentId: doc?.id,
        format,
      })
      downloadFile(result.filename, result.content, result.mime)
      notify(t('library.exported'))
    } catch (error) {
      report(error)
    } finally {
      setBusy('')
    }
  }

  const libraryIoOptions = (kind) => {
    const mountedGlossary = Array.isArray(doc?.glossaryIds) && doc.glossaryIds.length
      ? doc.glossaryIds
      : (data?.mounts?.glossaryIds || [])
    const mountedTm = Array.isArray(doc?.tmIds) && doc.tmIds.length
      ? doc.tmIds
      : (data?.mounts?.tmIds || [])
    const isTm = kind === 'tm'
    const source = isTm ? (data?.libraries?.tm || []) : (data?.libraries?.glossary || [])
    const libraries = source
      .filter((item) => (isTm ? mountedTm.includes(item.tmId) : mountedGlossary.includes(item.glossaryId)))
      .map((item) => ({ id: isTm ? item.tmId : item.glossaryId, name: item.name }))
    const preferred = isTm ? data?.mounts?.defaultTmId : data?.mounts?.defaultGlossaryId
    const mountedIds = isTm ? mountedTm : mountedGlossary
    const libraryId = preferred && mountedIds.includes(preferred) ? preferred : mountedIds[0] || libraries[0]?.id || ''
    return { libraries, libraryId }
  }

  const exportLibraryTo = async ({ kind, libraryId, format }) => {
    setBusy('library-export')
    try {
      const result = kind === 'tm'
        ? await rpc('exportTM', { tmId: libraryId, format: 'tmx' })
        : await rpc('exportGlossary', { glossaryId: libraryId, format })
      downloadFile(result.filename, result.content, result.mime)
      notify(t('library.exported'))
      return true
    } catch (error) {
      report(error)
      return false
    } finally {
      setBusy('')
    }
  }

  const importLibraryTo = async ({ kind, libraryId, file }) => {
    if (!file || !libraryId) return false
    setBusy('library-import')
    try {
      const text = await file.text()
      if (kind === 'tm') {
        const result = await rpc('importTmx', {
          text,
          importAs: 'tm',
          tmId: libraryId,
          sourceLang: settings.sourceLang,
          targetLang: settings.targetLang,
        })
        replaceRemoteState(result.state)
        notify(`${t('toast.tmImported')} · +${result.added} / ~${result.updated}`)
      } else {
        const result = await rpc('importGlossary', { text, glossaryId: libraryId })
        replaceRemoteState(result.state)
        notify(`${t('toast.glossaryImported')} · +${result.added} / ~${result.updated}`)
      }
      return true
    } catch (error) {
      report(error)
      return false
    } finally {
      setBusy('')
    }
  }

  const generateMt = async () => {
    if (!doc || !segment || mtBusy) return
    setMtBusy(true)
    setMtError('')
    try {
      const result = await rpc('mtSuggest', {
        text: segment.source,
        documentId: doc.id,
        index: selected,
        sourceLang: doc.sourceLang,
        targetLang: doc.targetLang,
      })
      setMt(result)
      notify(t('toast.mtReady'), 'info')
    } catch (error) {
      setMtError(describeError(error, t))
    } finally {
      setMtBusy(false)
    }
  }

  const saveSettings = async (patch) => {
    setBusy('settings')
    try {
      const result = await rpc('saveSettings', patch)
      replaceRemoteState(result.state)
      setModal(null)
      notify(t('toast.settingsSaved'))
      return true
    } catch (error) {
      report(error)
      return false
    } finally {
      setBusy('')
    }
  }

  const setMounts = async (patch) => {
    setBusy('mounts')
    try {
      const result = await rpc('setMounts', patch)
      replaceRemoteState(result.state)
      setTmResults(null)
      notify(t('libraries.mountSaved'))
      return true
    } catch (error) {
      report(error)
      return false
    } finally {
      setBusy('')
    }
  }

  const createLibrary = async ({ kind, name }) => {
    setBusy('library')
    try {
      const result = await rpc('createLibrary', { kind, name })
      replaceRemoteState(result.state)
      notify(t('libraries.created'))
      return true
    } catch (error) {
      report(error)
      return false
    } finally {
      setBusy('')
    }
  }

  const renameLibrary = async ({ kind, id, name }) => {
    setBusy('library')
    try {
      const result = await rpc('renameLibrary', { kind, id, name })
      replaceRemoteState(result.state)
      notify(t('libraries.renamed'))
      return true
    } catch (error) {
      report(error)
      return false
    } finally {
      setBusy('')
    }
  }

  // The library page already asks for confirmation, so this only runs the
  // deletion: opening a second confirm here swallowed the answer and left the
  // library in place.
  const deleteLibrary = async ({ kind, id } = {}) => {
    try {
      const result = await rpc('deleteLibrary', { kind, id })
      replaceRemoteState(result.state)
      setTmResults(null)
      notify(t('libraries.deleted'))
      return true
    } catch (error) {
      report(error)
      return false
    }
  }

  const exportAs = async (format) => {
    if (!doc) return
    setBusy('export')
    try {
      const result = await rpc('exportDocument', { format, documentId: doc.id })
      const content = result.encoding === 'base64' ? decodeBase64(result.content) : result.content
      downloadFile(result.filename, content, result.mime)
      notify(t('toast.exported'))
      setModal(null)
    } catch (error) {
      report(error)
    } finally {
      setBusy('')
    }
  }

  const importReview = (file) => {
    if (!doc || !file) return
    const reader = new FileReader()
    reader.onload = async () => {
      setBusy('review')
      try {
        const result = await rpc('applyXliffReview', {
          documentId: doc.id,
          text: String(reader.result || ''),
        })
        adoptState(result.state)
        notify(
          t('toast.reviewApplied', {
            applied: result.applied,
            unmatched: result.unmatched + result.sourceMismatch,
          }),
        )
        setModal(null)
      } catch (error) {
        report(error)
      } finally {
        setBusy('')
      }
    }
    reader.readAsText(file, 'utf-8')
  }

  const openConfirm = (state) => setModal({ type: 'confirm', ...state })

  const clearTm = () =>
    openConfirm({
      title: t('modal.confirm.title'),
      message: t('modal.confirm.clearTm'),
      confirmLabel: t('panel.clearTm'),
      action: async () => {
        const result = await rpc('clearTM', { tmIds: data?.mounts?.tmIds || [], confirm: true })
        replaceRemoteState(result.state)
        setTmResults(null)
        notify(t('toast.tmCleared'))
      },
    })

  const clearGlossary = () =>
    openConfirm({
      title: t('modal.confirm.title'),
      message: t('modal.confirm.clearGlossary'),
      confirmLabel: t('panel.clearGlossary'),
      action: async () => {
        const result = await rpc('clearGlossary', {
          glossaryIds: data?.mounts?.glossaryIds || [],
          confirm: true,
        })
        replaceRemoteState(result.state)
        notify(t('toast.glossaryCleared'))
      },
    })

  const runConfirm = async () => {
    if (!modal?.action) return
    setBusy('confirm-action')
    try {
      await modal.action()
      setModal(null)
    } catch (error) {
      report(error)
    } finally {
      setBusy('')
    }
  }

  const copy = async (value) => {
    try {
      await copyText(value)
      notify(t('toast.copied'))
    } catch (error) {
      report(error)
    }
  }

  const openIds = new Set((data?.openDocuments || []).map((item) => item.id))
  const closedDocuments = (data?.documents || []).filter((item) => !openIds.has(item.id))
  const qaRisk = (qa?.risks || []).find((item) => item.index === index) || null

  const deleteClosedDocument = (document) =>
    openConfirm({
      title: t('doc.deleteTitle'),
      message: t('doc.deleteMessage', { name: document.name }),
      confirmLabel: t('doc.delete'),
      action: async () => {
        const result = await rpc('deleteDocument', { documentId: document.id })
        adoptState(result.state)
        notify(t('toast.docDeleted'))
      },
    })

  const clearClosedDocuments = () =>
    openConfirm({
      title: t('doc.cleanTitle'),
      message: t('doc.cleanAllMessage', { count: closedDocuments.length }),
      confirmLabel: t('doc.cleanAll'),
      action: async () => {
        let lastState = null
        for (const document of closedDocuments) {
          const result = await rpc('deleteDocument', { documentId: document.id })
          lastState = result.state
        }
        if (lastState) adoptState(lastState)
        notify(t('toast.docsCleared', { count: closedDocuments.length }))
      },
    })

  // Track the size DSH gives the panel and publish it as a CSS unit. The
  // observer watches the stable root element and writes the property
  // directly, so resizing never triggers a React render.
  useEffect(() => {
    const element = rootRef.current
    if (!element) return undefined
    const measure = () => {
      const rect = element.getBoundingClientRect()
      const unit = computeCaitUnit({ width: rect.width, height: rect.height })
      if (Math.abs(unit - unitRef.current) < 0.002) return
      unitRef.current = unit
      element.style.setProperty(CAIT_UNIT_VAR, String(unit))
    }
    measure()

    // Mirror the host theme so native widgets follow `color-scheme`. DSH
    // toggles the marker on <body>, so observe that instead of guessing
    // from colours.
    const syncTheme = () => {
      const kind = detectThemeKind(document)
      if (element.getAttribute(CAIT_THEME_ATTR) !== kind)
        element.setAttribute(CAIT_THEME_ATTR, kind)
    }
    syncTheme()
    let themeObserver = null
    if (typeof MutationObserver !== 'undefined' && document.body) {
      themeObserver = new MutationObserver(syncTheme)
      themeObserver.observe(document.body, {
        attributes: true,
        attributeFilter: ['data-ds-dark-theme', 'data-theme', 'class'],
      })
    }
    const stopTheme = () => {
      if (themeObserver) themeObserver.disconnect()
    }

    if (typeof ResizeObserver === 'undefined') {
      window.addEventListener('resize', measure)
      return () => {
        window.removeEventListener('resize', measure)
        stopTheme()
      }
    }
    const observer = new ResizeObserver(measure)
    observer.observe(element)
    return () => {
      observer.disconnect()
      stopTheme()
    }
  }, [])

  useEffect(() => {
    const onKey = (event) => {
      const mod = event.metaKey || event.ctrlKey
      if (!mod) return
      const key = event.key.toLowerCase()
      if (key === 'k') {
        event.preventDefault()
        setModal((current) => (current?.type === 'palette' ? null : { type: 'palette' }))
      } else if (key === 'f' && doc && !modal) {
        event.preventDefault()
        openReplace()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [doc?.id, modal])

  return {
    data,
    setData,
    loading,
    loadError,
    busy,
    selected,
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
    setReviewIssueState,
    exportReview,
    clearReview,
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
    libraryIoOptions,
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
    projectDrafts,
    projectEpoch,
    openProjects,
    selectProject,
    createProjectAction,
    saveProjectSettings,
    refreshProjectAnalysis,
    requestView,
    requestProject,
    requestProjectTab,
    requestOpenDocument,
    projectTab,
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
    setTermDefault,
  }
}
