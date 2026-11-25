**AI Translation** brings a complete CAT (computer-aided translation) workbench into DeepSeek Harness: source on the left, target on the right, translation memory and glossary hits as you move between segments, AI draft suggestions, and exports that keep the original document layout.

### What it does

- **Many formats**: import and export DOCX / XLSX / PPTX / EPUB / TXT / Markdown / SDLXLIFF / TMX / CSV, writing translations back into the original layout. Legacy `.doc / .xls / .ppt` files are also accepted when Microsoft Office is installed locally.
- **Translation memory and glossary**: automatic matches, batch pre-translation, term hints; multiple memories and glossaries mounted per project, with TBX / CSV / JSON / TMX import and export.
- **AI in the loop**: per-segment drafts, whole-document pre-translation, and an AI assistant that lives in the workbench and can turn a conversation into the project brief.
- **Review and QA**: confirm/pending states, focus-review flags, consistency checks and review reports.

### Local enhancements over upstream CAIT

- Segments can be merged and split: name abbreviations such as `Aug.` and `St.` no longer break sentences, and DOCX halves stay in the same paragraph (separated by a line break on export).
- Select source and target text to define a term; hold Shift to merge across paragraphs.
- Unconfirmed drafts are saved automatically and restored when you reopen the project.
- The AI assistant keeps multi-turn history, can summarise it into the project brief, and validates message shapes defensively.
- Model routing skips vision-wrapper routes and shows the real error instead of a generic failure.
- Built-in token usage and cost tracking at official prices, with peak/off-peak rates.
- Several documents can share one **job**: a common brief, shared memories and glossaries, whole-batch match analysis and delivery packaging, plus time tracking per job.

### Data and privacy

All project data stays on this machine under `~/.dsh/cait` (documents, translation memories, glossaries, draft snapshots). Nothing is sent anywhere except the DSH model route you select.

