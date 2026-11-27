**AI Translation** brings a complete CAT (computer-aided translation) workbench into DeepSeek Harness: source on the left, target on the right, translation memory and glossary hits as you move between segments, AI draft suggestions, and exports that keep the original document layout.

It is not a web translator in a panel. It covers the path a working translator actually walks — **import → translate → review → deliver → quote → settle** — and lets a batch of files live in one project with a shared brief and shared term bases.

### What it does

- **Many formats**: import and export DOCX / XLSX / PPTX / EPUB / TXT / Markdown / SDLXLIFF / TMX / CSV, writing translations back into the original layout. Legacy `.doc / .xls / .ppt` files are accepted when Microsoft Office is installed locally, with macros forcibly disabled before conversion.
- **Translation memory and glossary**: automatic matches, batch pre-translation, term hints; multiple memories and glossaries per project, with TBX / CSV / JSON / TMX import and export.
- **AI in the loop**: per-segment drafts, whole-document pre-translation, and an AI assistant that lives in the workbench and can turn a conversation into the project brief.
- **Review and QA**: confirm/pending states, focus-review flags, consistency checks and review reports.

### Major upgrades over upstream CAIT 1.1.8

**1. A project layer — one client, one batch, one job**

The biggest addition. A client, a batch of files, one brief and one set of term bases are now a real data structure instead of a dozen unrelated tabs:

- The plugin opens on a **project list**; the right pane is the project detail (document table, four-state status and progress, segments / words / time / quote, match analysis).
- **Shared brief and shared TM/glossary**: filled once at project level and inherited by every document; a document can still override, or opt out of a library entirely.
- **Project-level analysis, quote, report and delivery**: analyse the whole batch once, price it from the same numbers, export a printable HTML report or CSV, and package target documents, bilingual copies, term list, QA and analysis CSVs, comments and a delivery note into one ZIP.
- **Unfiled and all documents**: documents without a project land in «Unfiled»; a cross-project «All documents» table filters by Untranslated / Incomplete / Translated, unconfirmed / Done.
- **Time tracking**: a project stopwatch (survives restarts) plus manual entries, summarised per client.
- **Document order**: reorder documents inside a project; the order persists, and «Unfiled» supports it too.

**2. Delivery and business workflow**

- **Pre-delivery check**: empty targets, unconfirmed segments, source copied into target, open comments, high-risk QA — visible in one screen before packaging.
- **Batch actions**: filter by pending / unconfirmed / risky / duplicate / new / fuzzy / locked / commented, then confirm, lock, unlock or clear in bulk.
- **Quotes**: priced by match band (ICE / 100% / 85–99% / 70–84% / new), exportable as TXT / CSV / JSON.
- **Post-editing effort**: the keep-ratio of MT suggestions is recorded on confirm, so rework is measurable per client.
- **Local MT**: point translation at LM Studio / Ollama / vLLM or any local OpenAI-compatible endpoint, so sensitive text never leaves the machine.

**3. The translation core**

- **Merging unlocked**: same-paragraph merges work for every format, Shift forces a cross-paragraph merge, mixed CJK/Latin joins no longer insert stray spaces, and abbreviations such as `Aug.` / `St.` stop breaking sentences.
- **DOCX split inside a paragraph**: both halves are written back to the same paragraph (separated by a line break), so the exported layout stays intact.
- **Select-to-create-term**: select source and target, press right-click or `Ctrl+Alt+T`, and the pair is written to the default glossary (with a first-use hint).
- **Draft recovery**: unconfirmed targets are snapshotted under `drafts/` and restored after a crash or a mistaken close.

**4. AI and cost**

- **AI dialogs**: brief guidance right after creating a document, instruction confirmation before pre-translation, a persistent command bar above the editor; a multi-turn conversation can be distilled into the project brief.
- **Route robustness**: vision-wrapper routes are skipped automatically, and failures show the upstream reason instead of a generic "operation failed".
- **Token usage and cost**: official prices with peak/off-peak rates, per document / model / day — estimate before and reconcile after.

**5. Interface and reliability**

- **Home screen**: paste text or drop files (multi-select, multi-drop, cancellable progress), resume the last session, and a "continue working" list.
- **Context-aware top bar**: New / Import appear on the project page only; the editor keeps Usage · Pre-translate · Find & replace · Deliver · More.
- **Visible failures**: a render error boundary (copyable message + retry), timeouts and retries for library loading — no more blank windows or endless spinners.
- **Three languages in lockstep**: 930 UI keys aligned across Chinese / English / Japanese; all 127 error codes carry readable messages.

### Data and privacy

All project data stays on this machine under `~/.dsh/cait` (documents, translation memories, glossaries, draft snapshots). Nothing is sent anywhere except the DSH model route you select.

### Credits

This plugin is a modified fork of **CAIT** (`dsh-cait`) by **Jovi Lecca**, Apache-2.0. The CAT workbench, translation memory, glossary, multi-format import/export and the agent tools are upstream design and implementation; this fork adds the project layer, the delivery and business workflow, the interface rework and the reliability fixes. Many thanks to the original author for open-sourcing such a complete workbench.
