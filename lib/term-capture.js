import { CatError } from './errors.js'
import { DEFAULT_GLOSSARY_ID } from './limits.js'

const MAX_TERM_CHARS = 200

function tidyTerm(value) {
  return String(value ?? '')
    .replace(/\r\n?/g, '\n')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, MAX_TERM_CHARS)
}

/**
 * 术语捕获：在工作台里选中原文 + 译文，直接建一条术语。
 *
 * 术语库的选择规则（与用户的期望一致）：
 *   - 显式传入 glossaryId 时用它（必须已挂载）；
 *   - 否则用上次记住的默认库（settings.termCapture.defaultGlossaryId）；
 *   - 再否则用挂载序列里的第一个库；
 *   - 都没有时退回默认库。
 * 第一次捕获时会返回 hintSeen=false，客户端据此提示"以后新术语默认加入哪个库"。
 */
export const termCaptureMethods = {
  termCaptureState({ documentId } = {}) {
    const doc = documentId ? this.requireDocument(documentId) : null
    const mountedIds = doc ? this.effectiveGlossaryIds(doc) : [...this.mounts.glossaryIds]
    const mounted = mountedIds.map((id) => {
      const library = this.glossaryLibraries.find((item) => item.glossaryId === id)
      return {
        glossaryId: id,
        name: library?.name || id,
        entries: this.glossary.filter(
          (entry) => (entry.glossaryId || DEFAULT_GLOSSARY_ID) === id,
        ).length,
      }
    })

    const remembered = String(this.settings.termCapture?.defaultGlossaryId ?? '').trim()
    const fallback = this.mounts.defaultGlossaryId
    const defaultGlossaryId = mounted.some((item) => item.glossaryId === remembered)
      ? remembered
      : mounted.some((item) => item.glossaryId === fallback)
        ? fallback
        : (mounted[0]?.glossaryId ?? DEFAULT_GLOSSARY_ID)

    return {
      documentId: doc?.id ?? null,
      mounted,
      defaultGlossaryId,
      hintSeen: Boolean(this.settings.termCapture?.hintSeen),
      sourceLang: doc?.sourceLang ?? this.settings.sourceLang,
      targetLang: doc?.targetLang ?? this.settings.targetLang,
    }
  },

  addSelectedTerm({
    documentId,
    source,
    target,
    glossaryId,
    remember = false,
    note = '',
    caseSensitive = false,
  } = {}) {
    const doc = this.requireDocument(documentId)
    const term = tidyTerm(source)
    const translation = tidyTerm(target)
    if (!term || !translation) {
      throw new CatError(
        'EMPTY_TERM',
        '术语和译文都不能为空：请先在原文栏与译文栏里各选中一段文字。',
      )
    }

    const remembered = String(this.settings.termCapture?.defaultGlossaryId ?? '').trim()
    const requested = String(glossaryId ?? '').trim() || remembered || this.mounts.glossaryIds[0]
    const libraryId = this.requireMountedGlossaryLibrary(requested)

    const result = this.addGlossary({
      source: term,
      target: translation,
      note,
      sourceLang: doc.sourceLang,
      caseSensitive,
      glossaryId: libraryId,
    })

    this.settings.termCapture = {
      ...(this.settings.termCapture ?? {}),
      hintSeen: true,
      ...(remember ? { defaultGlossaryId: libraryId } : {}),
    }
    this.touch()
    this.persist()

    return {
      ...result,
      glossaryId: libraryId,
      termCapture: this.termCaptureState({ documentId }),
    }
  },

  setTermCaptureDefault({ documentId, glossaryId } = {}) {
    const libraryId = this.requireMountedGlossaryLibrary(glossaryId)
    this.settings.termCapture = {
      ...(this.settings.termCapture ?? {}),
      defaultGlossaryId: libraryId,
      hintSeen: true,
    }
    this.touch()
    this.persist()
    return this.termCaptureState({ documentId })
  },
}
