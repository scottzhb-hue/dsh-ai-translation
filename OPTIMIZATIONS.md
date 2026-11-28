# dsh-ai-translation 本地优化清单

> 发布名：`@scottzhb-hue/dsh-ai-translation@1.2.11`
> 上游：CAIT `dsh-cait@1.1.8`（作者 Jovi Lecca，Apache-2.0）→ 本分支 <https://github.com/scottzhb-hue/dsh-ai-translation>
> 基线：DSH Desktop `0.2.2-rc.5`，profile `desktop`，数据目录 `%USERPROFILE%\.dsh\cait\`
> 最后更新：2026-11-28

这份文档登记本分支相对上游 CAIT 1.1.8 的全部本地改动。**按主题分组**，每组先一句话说明“译员能得到什么”，再逐条写动机、实现位置、验证方式与边界。

阅读建议：

- 想快速知道改了什么 → 看下面的「一、总览」表；
- 想知道某条怎么做、改在哪个文件 → 按编号跳到对应章节；
- 想发版/排查 → 看「九、维护与发布须知」。

> ⚠️ 已装副本（profile 的 `node_modules`）是 DSH 启动时按 lockfile 重装的产物，直接改会被 `file:` tgz 覆盖。改代码只走「仓库副本 → `npm pack` → `_packages\` → `remove_bundle` + `install_bundle`」，详见第九章。

## 一、总览

| 编号 | 主题 | 对译员意味着什么 | 主要改动位置 |
|---|---|---|---|
| 01 | 句段合并放行（同段落、Shift 跨段落、中英拼接、缩写识别） | 被缩写点号切碎的句子可以合回去，中英混排不再多空格 | `lib/segment-edit.js`、`lib/segmenter.js`、`lib/export-document.js`、`client/components/editor.js` |
| 02 | DOCX 同段落拆分 | 一句原文里两句译文能拆开，导出仍写回同一个段落（`<w:br/>`） | `lib/segment-edit.js`、`lib/export-document.js` |
| 03 | AI 对话框（新建后 brief / 预翻译前 / 顶部常驻指令条） | 能用对话补 brief、问术语、让 AI 直接改译法 | `lib/ai-chat.js`、`lib/api.js`、`client/components/dialogs.js` |
| 04 | 选中即建术语（右键 / Ctrl+Alt+T） | 读到生词当场入库，不用切到库页面 | `lib/term-capture.js`、`client/components/editor.js` |
| 05 | 未确认译文自动暂存 | 崩溃或误关后译文还能找回 | `lib/draft-recovery.js` |
| 06 | 路由健壮性（跳过识图包装路由、真实错误透出） | 模型报错时能看到原因，而不是“转圈” | `lib/mt.js`、`lib/routes.js` |
| 07 | Token 消耗统计与预估费用 | 每次调用花了多少、累计多少，心里有数 | `lib/usage.js`、`lib/pricing.js`、`client/components/usage.js` |
| 08 | AI 消息形状防御 + 整理为项目说明 | 模型返回怪格式不崩；对话结论一键写回 brief | `lib/ai-chat.js`、`client/components/dialogs.js` |
| 09 | 界面名称统一（CAIT → AI辅助翻译） | 界面上不再出现上游旧名 | `client/components/shell.js`、`locale/*.json` |
| 10 | 插件图标重制 | 与上游 CAIT 一眼区分 | `icon.svg`、`client/components/base.js` |
| 11 | 旧版 Office 导入（.doc/.xls/.ppt） | 老客户发来的旧格式也能直接开 | `lib/legacy-office.js`、`lib/import-file.js` |
| 12 | 术语库导入/导出入口 | 术语表能带着走，不必手工整理 | `lib/library-view.js`、`client/components/panels.js` |
| 13 | 插件详情页本地化 | 市场页有中/英/日说明与插图 | `docs/DETAIL*.md`、`locale/*.json` |
| 14 | 交付包与交付前检查 | 交稿前一次看清空译/未确认/高危，并打包交付 | `lib/deliver.js`、`lib/zip.js` |
| 15 | 批量动作与筛选 | 未确认、风险句、重复句一次处理 | `lib/batch.js` |
| 16 | 本地 MT 端点（OpenAI 兼容） | 保密项目可接本机模型 | `lib/mt-local.js` |
| 17 | 报价单 + 译后编辑度量 + 项目/批次标签 | 报价有据可依，返工投入可量化 | `lib/quote.js`、`lib/workflow.js` |
| 18 | 项目（project）层 | 多文件共享 brief / TM / 术语库，项目级分析、报价、报告、交付与工时 | `lib/projects.js`、`client/components/projects.js` |
| 19 | 欢迎页、项目内建文档、可见失败 | 打开插件先看清“从哪开始”；出错不再白屏 | `client/components/home.js`、`client/components/error-boundary.js` |
| 20 | 打开/关闭文档与加载兜底 | 关文档回到项目；库和项目有超时与重试 | `client/workbench/controller.js`、`client/components/pages.js` |
| 21 | 顶栏按场景分组 | 项目页才有新建/导入；编辑器只留常用动作 | `client/components/shell.js` |
| 22 | 欢迎页单入口 + 「继续工作」列表 | 粘贴与导入合成一张卡；最近项目/文档合成一张表 | `client/components/home.js` |
| 23 | 项目详情重排 | 文档清单上提放大，设置收进可折叠分区 | `client/components/projects.js`、`client/styles.js` |
| 24 | 项目详情崩溃修复（hooks 顺序） | 点“项目”不再崩 | `client/components/projects.js` |
| 25 | 独立弹窗、文档排序与移动、库详情对话框 | 新建/导入各自独立；文档可上下移、跨项目移；库条目在对话框里改 | `client/components/forms.js`、`client/components/projects.js`、`lib/projects.js` |
| 26 | 统一导入器、导入进度与取消、整批归属 | 欢迎页与项目页的导入完全一致；多选导入可取消 | `client/components/forms.js`、`client/workbench/controller.js` |
| 27 | 项目头部、报告与「回到上次界面」 | 头部五项操作一步直达；报告/导出就地选格式；重开插件回到离开时的界面 | `client/components/projects.js`、`client/rpc.js`、`client/workbench/controller.js`、`lib/xlsx.js` |
| 28 | 项目列表收窄、名称换行与移动交互统一 | 左侧列表更窄、长名称不被截断，移动只有一个入口 | `client/components/projects.js`、`client/styles.js`、`client/workbench/controller.js` |

## 二、翻译内核

两句之间的“颗粒度”问题：该合的句段要能合，该拆的要能拆，导出的 XML 还要对得上。

### 01 句段合并放行

- **动机**：DOCX 文档里任何合并都报「当前格式不支持合并或拆分句段」；而译者最需要合并的正是被缩写点号误切的句段。
- **实现**：
  - `lib/segment-edit.js`：新增 `paragraphUnit(segment)`（`docx:<part>:<ordinal>` / `pptx:<slide>:<ordinal>` / `paragraph:<n>`）；`mergeSegments({ documentId, index, count, force })` 同段落合并对所有格式开放，跨段落需 `force`（客户端按住 Shift 传入），否则 `MERGE_PARAGRAPH_MISMATCH`；跨单元合并记录 `meta.mergedConsumed`。
  - `joinFragments(parts)`：CJK 相邻不插空格、拉丁之间插空格（原来固定 `.join(' ')`，中文会被插空格）。
  - `lib/export-document.js`：导出时按 `mergedConsumed` 把被吞段落置空，避免同段重复输出。
  - `lib/segmenter.js`：`ABBREVIATIONS` 集合 + 单字母首字母规则，避免 `Aug.` / `St.` / `Hilaire.` 被切开。
- **验证**：`Aug. St. Hilaire.` 三段合一；无 `force` 跨段报 `MERGE_PARAGRAPH_MISMATCH`、带 `force` 成功；导出段落总数不变；`zh+zh` 拼接无空格。

### 02 DOCX 同段落拆分

- **动机**：一句原文里含两句译文时，需要拆成两个句段，但仍写回同一个 `<w:p>`。
- **实现**：`SPLIT_FORMATS = {txt, md, markdown, docx}` + `splittableDocument()`；拆分出的两半继承同一 `meta.docxPart/docxParagraph` 并记 `meta.splitFrom`；`lib/export-document.js` 的 `combine()` 在同段落多句段时用 `\n` 连接，交由 `docx.js` 的 `patchParagraph` 转成 `<w:br/>`。
- **验证**：拆一段 502→503、段落数 95 不变、`<w:br/>` 405→406；同段连拆两次 → 407；再合并回去 → 405。
- **限制**：pptx/xlsx 仍不可拆（无"两句段共用一单元"锚点）。

## 三、AI 辅助与成本

把 AI 从“示范按钮”变成日常工作流的一部分，并且让每次调用的成本可见。

### 03 AI 对话框

- **动机**：新建项目时用自然语言写项目说明/指令/规则；预翻译前先对齐要求；翻译过程中随时追问。
- **实现**：
  - 服务端 `lib/ai-chat.js`：`aiChatState` / `aiChat({ documentId, message, mode })` / `clearAiChat`；系统提示包含文档上下文（名称、语向、句段数、格式、前 3 段原文、进度）与 `briefPromptBlock`；`mode: 'brief'` 时解析 `{"reply","brief"}` 并回填 `doc.brief`。
  - 对话存 `doc.aiChat`（上限 30 条），随文档持久化（`lib/persistence.js` 白名单恢复）。
  - 客户端：`AiChatModal`（消息气泡、Ctrl/Cmd+Enter 发送、brief 预览 + 「写入项目说明」、清空）；新建/导入后自动弹 brief 模式；「预翻译」先弹对话框（可一键"直接开始预翻译"）；工作台顶部常驻指令条回车即问。
- **验证**：`cait_ai_server_test.mjs`、`cait_ai_mixins_test.mjs`、`cait_ai_verify2.mjs`（均已清理）。

### 04 选中即建术语

- **动机**：翻译中发现好译法，希望能直接"选中原文 + 选中译文 → 一键入库"。
- **实现**：
  - 服务端 `lib/term-capture.js`：`termCaptureState` / `addSelectedTerm` / `setTermCaptureDefault`；`tidyTerm` 压空白、截 200 字；默认库优先级＝记住的默认库 → 挂载面板默认库 → 首个挂载库；`settings.termCapture = { defaultGlossaryId, hintSeen }` 随设置持久化。
  - 客户端：原文框 `window.getSelection()`、译文框 `selectionStart/End` 分别取词；右键菜单「定义为术语…」或 `Ctrl/Cmd+Alt+T`；`TermModal` 支持多库下拉、「以后默认写入这个术语库」、备注；首次使用有提示。
- **验证**：`cait_term_test.mjs`（645→646 条、同词更新不重复、`EMPTY_TERM`、默认库落盘后重启仍生效）。
- **界面细节（2026-11-23）**：右键菜单原本用内联 `background:#ffffff` + 主题文字色，在深色工作台里成了"白底浅灰字"，几乎看不清。改为 CSS 类 `.cait-termmenu`（`styles.js` 与 `client.js` 各一份）：背景 `--dsw-alias-bg-layer-2`、文字 `--dsw-alias-label-primary`、悬停品牌色、禁用态降级，亮/暗主题都自适应；菜单位置按视口夹取（`clampMenu`）避免出界；点击别处、滚动或 `Esc` 自动关闭；提示行缺一侧时用 `…` 占位（原文 `… → 译文`）。

### 05 未确认译文自动暂存

- **动机**：已敲进译文框但还没确认/导航的文字，重启或误操作会丢。
- **实现**：`lib/draft-recovery.js` 写入 `<dataDir>/drafts/<sanitized docId>.json`（v1，按 `segment.uid` 索引，原子写、最多 50 条、单条 20000 字）；客户端 1.2s 防抖调用 `saveDraftRecovery`，`adoptState` 时若快照与已保存译文不同则恢复并提示「已恢复未确认的草稿」；保存/确认后调 `clearDraftRecovery`。
- **验证**：`cait_draft_verify.mjs`（28 项断言）；快照永不覆盖已保存/已确认译文。

### 06 路由健壮性（跳过识图包装路由）

- **动机**：项目 MT 路由指向 `modlens-deepseek-account-vision`（识图包装）时，预翻译/单译/AI 建议全部失败，且 UI 只显示「操作失败，请稍后重试。」。
- **实现**：
  - `lib/mt.js`：`isVisionWrapper(id, name)` 识别 `modlens-*` / `deepseek-modlens` / 名称含 `(modlens vision)`；provider 加 `wrapper` 标记；排序「configured 优先、其次非包装」。
  - `lib/routes.js`：`pickRoute()` 在选中包装路由时自动降到第一个非包装且有模型的 provider，并返回 `note` 说明。
  - 错误透出：`MT_ROUTE_ERROR` / `REVIEW_ROUTE_ERROR` / `AI_ROUTE_ERROR` 带上 `provider / model` 与底层 `error.message`（不加字典键，避免又被压成通用文案）。
  - 客户端：设置下拉给包装路由加标注「识图包装，文本翻译不可用」；右侧面板当前路由是包装时同样标注。
- **验证**：`cait_route_test.mjs` 6 组用例；用户实测换成 `DeepSeek Account` 后单句翻译成功。

### 07 Token 消耗统计与预估费用

- **动机**：CAIT 直接调用宿主 `llm` 服务，这些调用不进 DSH 会话日志，看不到花了多少 token / 多少钱。
- **服务端**：
  - `lib/usage.js`：`CaitUsage` 账本，落盘 `<dataDir>/usage.json`（**v2**，新增费用字段）；`record({ purpose, provider, model, usage })` 做累计；维度 `total` / `byDay` / `byPurpose`（`mt` / `mtBatch` / `chat` / `review`）/ `byRoute`；`recent` 保留最近 40 次；`byDay` 保留 120 天；写盘 400 ms 防抖 + 临时文件 rename，失败静默（不影响翻译）；`snapshot()` 供 RPC 读。
  - `lib/pricing.js`：计价唯一来源。口径＝DeepSeek 官方价（`PRICING_UPDATED_AT = '2026-09-22'`），元/美元双币种，按 `deepseek-flash` / `deepseek-v4-pro` 分档，峰时/谷时两档（谷时 5 折）；峰时＝北京时间 09:00–12:00、14:00–18:00 的工作日（**不含法定节假日例外**）；`classifyModel()` 认不出的模型宁可显示「—」也不套用其它档位；费用按 `cacheReadTokens` 走缓存命中价、其余 input 走未命中价、output 走输出价，保留 8 位小数避免小额被抹平。
  - `lib/mt.js`：`withUsage(chunks, request, ledger)` 包住宿主流，从 `chunk.usage` 或 `finish.usage` 记账，`options.usage` 传入账本；`llm.stream` 不报 usage 时记不到（不伪造）。
  - `lib/api.js`：`createHandlers(store, usage)` 增加只读 `usage: () => usage.snapshot()`；`registerCatApi(ctx, store, usage)`。
  - `index.js`：`new CaitUsage({ dataDir })` → 传入 `createMtRuntime(ctx, { usage })` 与 `registerCatApi`；卸载时 `usage.dispose()` 落盘。
  - 迁移：v1 账本升级时把 `costFrom` 钉在升级时刻，不回头用新价目重算历史。
- **客户端**：`client/components/usage.js` 的 `UsageBadge`（顶栏「用量」徽标，tooltip 显示今日/累计 token 与请求数）+ `UsageModal`（今日/累计 token、今日/累计预估费用、当前峰谷、价目版本、按用途/按路由表格、最近 40 次调用、刷新）；`shell.js` 顶栏挂徽标、`workbench.js` 分派 `modal.type === 'usage'`、`controller.js` 的 `refreshUsage()` 在空闲时刷新（失败不影响工作台）；`locale` 的 `usage.*` 三语键。
- **验证**：`test_cait_usage.mjs`、`test_cait_pricing.mjs`（工作区，均已随会话结束清理；重跑可用 `<dataDir>/usage.json` 手工核对）。
- **已知口径**：只统计 CAIT 自己的调用（翻译/批量/对话/审校）；宿主其它会话的消耗不在此账本内；金额是估算，不替代账单。
- **已修（2026-11-23）**：账本在 v2 下首次创建时 `costFrom` 曾停在 `0`，导致弹窗「费用自 … 起统计」时间为空；现在 `CaitUsage.record()` 会在 `costFrom` 为空时把它设为本次调用时间（新账本与历史遗留的 0 都覆盖）。

### 08 AI 消息形状防御 + 整理为项目说明

- **动机**：DSH 的请求投影会读 `message.source.replayState`，assistant 消息缺 `source` 时多轮对话直接崩（`Cannot read properties of undefined (reading 'replayState')`）。
- **实现**：
  - `toModelMessage(entry, route)`：assistant 一律带 `source: { kind:'model', provider, model }`（旧记录缺 provider/model 时回落当前路由）。
  - `assertModelMessages(messages, route)`：发送前校验 role / `content[0].text` / assistant 的 `source`，不合规抛 `AI_MESSAGE_INVALID` 并写明原因与当前路由。
  - `mtRuntime.stream` 非函数时给 `AI_ROUTE_UNAVAILABLE`（提示重启 DSH）。
  - 「整理为项目说明」：`mode: 'brief'` 且 `message` 为空、已有历史时，用 `BRIEF_ONLY_PROMPT` 补齐最后一条 user 内容，且**不把这条伪输入写进对话记录**；客户端对话框底部新增按钮。
- **验证**：行为用例 4 组（整理/空消息/普通对话/防御断言）；客户端 5 文件编译 + 24 项锚点断言。

## 四、导入与格式

客户给的旧文件不该成为开工门槛。

### 11 旧版 Office 导入

- **动机**：上游的 `SUPPORTED_IMPORT_EXTENSIONS` 不含 2007 之前的二进制 Office 格式；这些扩展名会掉到纯文本读取分支，于是用户看到的是「文件内容为空。」——对 `.doc` 完全是误导。
- **实现**：
  - 新增 `lib/legacy-office.js`：`LEGACY_OFFICE_TARGETS`（doc→docx / xls→xlsx / ppt→pptx）、`extensionOfFileName`、`isLegacyOfficeExtension`、`stripLegacyExtension`、`convertLegacyOffice({ base64, fileName, extension })`。
  - 转换在**子进程**里做：把上传的 base64 写到系统临时目录，写一份 ASCII 的 PowerShell 脚本，用 `powershell.exe -NoProfile -NonInteractive -ExecutionPolicy Bypass -File` 驱动 Word / Excel / PowerPoint 的 COM 接口另存为 OOXML（Word `SaveAs2(16)`、Excel `SaveAs(51)`、PowerPoint `SaveAs(24)`），90 秒超时，读回结果后清理临时目录。
  - `lib/file-ops.js` 的 `importFile` 改为 async：命中旧扩展名时先转换，再用转换后的 base64 与 `.docx` 文件名走原来的同步解析；文档标题沿用用户输入并去掉旧扩展名。
  - `lib/import-file.js` 的 `SUPPORTED_IMPORT_EXTENSIONS` 补上 `doc` / `xls` / `ppt`（标注为「转换后可读」）。
  - 客户端：`forms.js` 与 `pages.js` 的 `accept` 列表加入 `.doc,.xls,.ppt`；`client/locales.js` 与 `client.js` 三语格式提示补 `DOC · XLS · PPT`（中文另加「旧版 Office 需本机安装 Office」/ 日文「旧形式は Office が必要」）。
- **失败语义**：转换不可用（没装 Office、PowerShell 不可用、超时、产出为空）时抛 `LEGACY_OFFICE_UNAVAILABLE`（HTTP 422），文案明确写出「请确认本机已安装 Microsoft Office（Word / Excel / PowerPoint），或把文件另存为 .docx 后重新导入」。该错误码不带 `_FAILED` / `_UNSUPPORTED` 等家族后缀，因此客户端会原样显示服务端消息，不会被压成「操作失败，请稍后重试。」。
- **验证**：`lib/legacy-office.js` / `lib/file-ops.js` / `lib/import-file.js` 均可 import；用 Word COM 现场生成 `.doc`（25,088 字节，magic `d0cf11e0`）→ 转换 6.7 秒产出 `PK` 开头 docx（14,173 字节）→ `store.importFile` 得到 format=docx、2 个句段、标题保留中文且不含 `.doc`；把 `PATH` 指到无效目录后同一调用抛出 `LEGACY_OFFICE_UNAVAILABLE`（消息含安装提示）；客户端 6 个文件 `vm.SourceTextModule` 编译通过、bundle 与源码的 accept/提示语逐项一致。
- **安全**：转换前对 Word / Excel / PowerPoint 的 COM 实例设置 `AutomationSecurity = 3`（`msoAutomationSecurityForceDisable`），文档以**禁用全部宏**的方式打开，恶意 `.doc` / `.xls` / `.ppt` 里的 `AutoOpen` / `Auto_Open` 宏不会以用户权限执行；该属性仅在 Word / Excel 上存在，PowerPoint 的赋值包在 `try/catch` 里忽略失败。文档仍以只读方式打开（`ReadOnly=true`），且 `ConfirmConversions=false` 避免交互式对话框卡死。
- **代价与边界**：需要 Windows + 已安装 Microsoft Office（WPS 未验证）；每个文件约 5–10 秒；导入期间 Office 会以后台进程启动（COM 退出时自动关闭）；转换结果只保留内容（样式、批注等由 Office 自己决定保留程度）；导出仍只有现代格式；宏被禁用，因此含 VBA 的旧文件导入后不会保留宏。

## 五、术语库与导出

术语表要能带走，也要能带回来。

### 12 术语库导入/导出入口

- **动机**：`exportGlossary` 早已支持 TBX / CSV / JSON，但入口只藏在「库」页，而且按钮文字只写格式名（`TBX` / `CSV` / `JSON`），译者反馈「找不到术语库导出」。
- **实现**：
  - 工作台右侧「术语」面板与「库」页都不再常驻格式/库下拉，只保留「导入」「导出」两个按钮；点击后弹出选择器弹窗（`LibraryIoModal`）：选目标库，导出时再选格式（TBX/CSV/JSON，TM 固定 TMX），导入时选文件。
  - 目标库候选按项目解析（`document-view.js` 的文档摘要新增 `tmIds`/`glossaryIds`）：默认 = 文档挂载的默认写入库，未挂载时用文档首个挂载库；候选只列该文档挂载的库。
  - 控制器新增 `libraryIoOptions(kind)`、`exportLibraryTo({kind,libraryId,format})`、`importLibraryTo({kind,libraryId,file})`，导入/导出统一走这两个方法（下载、提示、`replaceRemoteState` 都在这里）。
  - 服务端 `exportGlossary({documentId})` 仍支持不传 `glossaryId` 时按文档回落（`defaultGlossaryFor`）。
- **验证**：文档摘要含 `tmIds: tm_default` / `glossaryIds: glossary_default,gl_2c2c00e8`；`defaultGlossaryFor('doc_3c172d94')` → `glossary_default`；`exportGlossary({documentId})` 导出 `cait-glossary-物种起源1-20261124.csv`（25,622 字节），显式 `glossaryId` 可导出任意挂载库，XLSX 仍报 `INVALID_EXPORT_FORMAT`；6 个源码文件与 `client.js` 均通过 `vm.SourceTextModule`，弹窗/按钮/文案锚点计数全部符合预期。
- **边界**：面板导出的是「该文档实际使用的术语库」，库页可任选；导出内容仍是整库快照，不区分当前句段的临时命中；不支持的格式由服务端拒绝并显示原因。

## 六、交付与商务

交稿前的检查、整批处理、保密路线与报价，构成“一个人也敢接活”的闭环。

### 14 交付 / 批量 / 本地 MT / 报价（原 14–17）

- **动机**：自由译员的日常不是「逐句翻译」，而是「交稿前别翻车、批量动作用得少、成本与报价说得清、能换本地模型保密」。
- **实现**：
  - `lib/zip.js`：零依赖 store-only ZIP（CRC32 + 中央目录 + EOCD），交付包不引入新依赖。
  - `lib/deliver.js`：`deliveryChecks` 汇总空译 / 未确认 / 源文照抄 / 批注未关 / QA 高危，分 blocking / review / notice 三档；`exportDelivery` 逐项生成并打包，单项失败只记 `skipped`。
  - `lib/batch.js`：筛选（`batchSelection`）+ 确认 / 锁定 / 清空（复用 `segments.js` 的单段实现，保证状态机一致）。
  - `lib/mt-local.js`：`fetch` 本机 OpenAI 兼容端点，Key 存 `<dataDir>/mt-local.json`；`mt-translate.js` 在解析路由前优先用本地端点，未启用则完全走原路径。
  - `lib/quote.js` / `lib/workflow.js`：按 `MATCH_BUCKETS` 分档计价，`postEdit.keepRatio` 在 `confirmSegment` 落库，客户 / 批次标签随文档持久化。
- **验证**：真实 store 副本（488 段）—— 交付包 6 个文件、200 KB ZIP 且 `PK\x03\x04` 魔数正确；检查项 488 段中 320 已确认、321 条 medium、169 条 low；批量筛选 risk 命中 321、pending 0；报价 18,542 词 → ICE 11,661 词 × 0.3 + 新句段 6,778 词 × 1.0 = ¥1236.87；`setMtLocal` 后状态可读回；批次汇总与 `workloadSnapshot` 一致。
- **边界**：交付包不含 TMX（体积不可控）；报价是本地估算，不替代合同；本地 MT 不校验模型能力（端点自负责）；批次只是标签，不是独立作业数据库。

## 七、项目层

多文件、共享资源、项目级汇总——这一层是本分支相对上游最大的结构性新增。

### 18 项目（project）层

- **动机**：1.1.0 只给文档打了 `client` / `batch` 两个自由文本标签，批次汇总靠字符串匹配。同一批文件之间无法共享 brief 与术语库，报价要一篇篇算，交付也要一篇篇打包，文档状态也没有统一口径。
- **数据模型**：
  - 新增实体 `project`（`lib/projects.js`）：`{ id, name, client, dueAt, note, archivedAt, brief, tmIds, glossaryIds, defaultWriteTmId, time: { entries, since } }`，随 `store.json` 落在 `projects` 数组里。
  - 文档新增 `projectId`；资源继承链 `mounts → project → doc`，`doc.tmIds` 为 `null` 时先看项目，再回退全局挂载，因此旧数据不需要迁移。
  - 「未分类」（`project_inbox`）由 `ensureInboxProject()` 自动建立，无归属或悬空 `projectId` 的文档一律兜进来；它不可删除（`INBOX_PROJECT`），但可以改名。
  - store 版本仍是 8：旧的 `jobs` / `jobId` 在 restore 时自动转成 `projects` / `projectId`。
  - `lib/libraries.js`：`effectiveTmBinding` / `effectiveGlossaryBinding` 返回 `{ source: 'document'|'project'|'mounts', ids }`，`documentResourcesView` 多回 `tmSource` / `glossarySource` / `projectId`。
  - `lib/brief.js`：`mergeBriefs(projectBrief, docBrief)` 以项目为底、文档非空字段覆盖；`briefForDocument(doc)` 成为 AI 对话、MT、审校取 brief 的唯一入口。
- **状态与接口**：`documentStatus(doc)` 分四档——全部确认 `done`、全部有译文 `translated`、部分有译文 `incomplete`、其余 `untranslated`，进度 = 已确认 / 总句段。`lib/projects.js` 提供 30 个方法（createProject / updateProject / deleteProject / listProjects / projectDetail / assignDocumentProject / assignProjectDocuments / projectAnalysis / projectQuote / projectReport / documentReport / projectTime / exportProjectDelivery 等），`lib/api.js` 同步登记 handler 与 `MUTATIONS`。
  - `projectAnalysis` 逐文档复用 `analyzeDocument` 求和，并顺手用汇总数字调 `quoteSummary` 出报价，不重查 TM；`projectQuote` 复用它。
  - `projectReport` / `documentReport` 出 CSV（文档表 + TOTAL + `metric,value`，含 `quote_total`）和可打印 HTML（内联 CSS、KPI、状态表、匹配与报价、质检条目、工时），文件名 `*.report.csv|.html`。
  - `exportProjectDelivery` 打包每篇文档的目标稿与双语稿，外加合并的 `*.analysis.csv`、术语表、`*.qa.csv`、批注汇总、`*.time.csv` 与交付说明。
  - 工时：`time.since` 是秒表起点（同一时间只跑一个项目），`time.entries` 是补记；重启后仍在走的秒表继续计时。
- **客户端**：`client/components/projects.js` 的 `ProjectsPage` 两栏（左项目列表、右项目详情：文档表、状态 chip 与进度条、项目级/文档级报告、brief、资源、工时、交付），次级标签「所有文档」提供跨项目四档筛选；`ProjectPicker` 在新建 / 导入文档后弹出选归属。顶栏标签改为 项目 / 术语库 / 对齐，从项目点开文档后文档栏左侧有返回按钮。顺带修掉顶栏「交付 / 批量 / 报价」没有接点击处理的上游遗留问题。
- **验证**：`audit-workflow.mjs` 的项目段覆盖建项目 / 归集 / 未分类 / brief 继承 / TM 继承与覆盖 / 改名 / 四档状态 / 秒表与补记 / 分析与报价 / HTML+CSV 报告 / 交付 ZIP / 错误码 / 重启还原 / 删项目退回未分类，脚本总计 **137 项 PASS**。
- **边界**：项目不删文档（删项目把文档退回未分类）；`projectAnalysis` 的 TM 查询随句段数线性增长，只在打开项目页、出报告和打包时调用；项目级 TM 只影响该项目下的文档，全局挂载仍是默认值。

### 23 项目详情重排

动机：项目详情把「项目设置」和「文档清单」平铺在同一个视觉平面，五个分区标题都是 10px 全大写灰字（`.cait-section-title`），比正文还小，用户看不清「文档」这一主内容。

做法：

- 结构改为「`cait-proj-hero` 项目头 + `cait-panel` 卡片」。项目头显示 17px 项目名、一行 meta（客户 / 截止 / 篇数 / 句段 / 进度 / 工时 / 报价）与说明，右侧只留「保存设置」主按钮和「更多 ▾」菜单。
- 「更多」用新组件 `Menu`（点外部或 Esc 关闭，`item.keep` 支持点后不收起）承载 刷新分析 / HTML 报告 / CSV 报告 / 导出交付包 / 删除项目；删除仍需两步确认。
- 文档卡片：14px 标题 + 篇数徽标，右侧「新建文档 / 导入文件」；表格行高 7px 上下内边距，文档名 13px 加粗，进度条与百分比并排。
- 行内操作改为「→ 打开」加 `⋯` 菜单（HTML / CSV 报告、移出项目），菜单定位在 `.cait-menu-pop`，右对齐、`z-index:80`。
- 四个分区用 `Panel` 组件（`cait-panel-toggle` 按钮 + `aria-expanded`），默认折叠，展开状态存 `localStorage['cait.project.sections']`。
- 新文案：`projects.more / settings / note / rowMore / deliveryTime`（三语）。`交付内容` 分区改叫「交付与工时」，因为工时控件就在里面。
- 顺带修 React 警告：`Panel` 标题数组补 `key`。

验证：`_dev/test-ui-projects.mjs` 增加「项目设置默认折叠」并在展开后断言名称回填；`_dev/test-workbench-mount.mjs` 改为展开「更多」后断言导出交付包、展开「交付与工时」后断言计时控件；四套测试 32 + 17 项全过；`check-locales` 771×3、`check-undef` 96 文件、`audit-workflow` 138/138。

### 24 项目详情崩溃修复（hooks 顺序）

现象：装好 1.2.6 后，点开插件再点「项目」，界面直接抛 `Minified React error #310`（Rendered more hooks than during the previous render）。

根因：`ProjectDetail` 在函数顶部先声明 10 个 hook，随后有一句「没有选中项目 → 渲染占位」的提前 `return`；1.2.6 新增的折叠状态 `const [openSections, setOpenSections] = useState(() => readSections())` 却写在了这句 return **之后**。占位态只登记 10 个 hook，切到详情态变成 11 个，React 判定 hook 数量变化并抛错。

修法：把 `openSections` 挪到 `confirmDelete` 之后、任何提前 return 之前，并加注释说明原因。

回归：`_dev/test-ui-projects.mjs` 增加「先渲染没有选中项目的占位、再通过 state 切换加载出项目」的用例——之前的用例都以“已经有项目”的单态渲染，所以没照出这类 hook 顺序问题。

教训：**组件里任何 hook 都必须在第一个提前 return 之前**；对一个会从“空态”切到“有数据”的组件，测试必须覆盖这次切换，而不是只测终点状态。

验证：四套测试全过（项目详情 23 项）、`audit-workflow` 138/138、`check-locales` 908×3（本轮顺手补上 `check-locales` 对 `PROJECT_DICTS` 的漏检）。

### 25 独立弹窗、文档排序与移动、库详情对话框

问题（用户 1.2.7 / 1.2.8 两轮验收反馈）：

1. 项目详情里「新增文档」与「导入文件」仍共用一个对话框，只有一个标签页的区别，用户分不清在建还是导。
2. 文档表头写「报告 / 移动」，行内却是「→ 打开 ⋯」；点「⋯」没有反应，菜单浮层被表格容器的 `overflow:auto` 裁掉。
3. 库「条目详情」是常驻第三栏，点关闭只清草稿，界面回不到两栏。

修法：

- 表单聚焦：`DocumentSourceForm` 增加 `fixedMode`（`'text'` | `'file'`），为真时不渲染标签页、只显示该模式需要的字段；`DocModalShell` 负责标题、项目标签（`modal.new.joinProject`）与提交按钮。对外只有两个薄组件：`NewDocModal`（文本域 + 「创建文档」）与 `ImportDocModal`（拖放区 + 「导入文件」）。
- 项目归属：`newDocumentInProject(projectId, mode)` 直接开对应弹窗并带上 `projectId`，创建成功后用该 id 落库、直接进编辑器，不再弹归属对话框；无项目上下文时仍走原来的归属对话框。
- 排序：项目新增 `docOrder` 数组，`projectDocuments()` 按它排序（未列入的殿后），`assignDocumentProject` 在移出/移入两侧同步维护，新增 `moveProjectDocument({ projectId, documentId, direction })` 做相邻交换（`DOCUMENT_NOT_IN_PROJECT` 409 / `INVALID_DIRECTION` 422，越界返回 `{ changed:false }`）。同时删掉 `projectDetail` 里多余的按名排序——这是「排序无效」的真正原因。
- 行内操作：`→ 打开` / `↑` / `↓`（首末行禁用）/ `移动`（唯一项「移到其他项目…」，未分类等价于移出）/ `更多`（HTML、CSV 报告）。`Menu` 浮层由 `absolute` 改为 `fixed`，按按钮矩形定位，空间不足向上翻。
- 库详情：第三栏换成 `Modal`，关闭时清 `adding` / `draft` / `selectedId`，主区恢复两栏；按钮区吸底、`Esc` 可关。
- 批量导入：`DocumentSourceForm` 的 `files` 改为数组，input 加 `multiple`，拖放取 `dataTransfer.files`；前端软上限 20 个文件 / 单文件 28 MB，超出即跳过并在对话框列出文件名。控制器按顺序逐个 `importFile`，用 `importProgress` 显示「正在导入 3/8…」，结束后 toast 汇总成功与失败，失败带具体原因。
- 顺带修掉一个归属 bug：`importFile` 之前不接收 `projectId`，从项目里导入的文件会落到「未分类」；现在 `context.projectId` 一路传到各解析器的 `createDocument`。
- 行内交互：`移动` 由「只有一项的菜单」改成直接按钮（一次点击进项目选择器）；表头拆成「操作」与「报告」，报告列的 `⋯` 只放 HTML / CSV。

验证：`_dev/test-ui-projects.mjs` 44 项（两个独立弹窗、表头「操作 / 报告」、上移/下移禁用态、移动一步直达）、`_dev/test-workbench-mount.mjs` 37 项（库对话框可开可关）、`_dev/test-report-contract.mjs` 29 项（排序契约含越界与错误码）；四套测试全过，`audit-workflow` 138/138，`check-locales` 916×3，`check-api` 127 handler / 78 写操作。

边界：排序是项目内顺序，不跨项目共享；「移到其他项目」只支持单个文档，批量迁移走「所有文档」里的下拉；重排失败只提示，不改动本地已显示的顺序。

### 26 统一导入器、导入进度与整批归属

**动机**：1.2.8 把「新建文档 / 导入文件」拆成两个对话框并给导入加了多选、上限说明与批量循环，但欢迎页仍保留自己那份旧拖放区——只能选一个文件、没有上限提示、也不能取消；同一个功能在三个入口出现两套行为。

**做法**：

- `client/components/forms.js` 抽出 `FileDropField`（虚线区 + `input multiple` + 上限说明 + 跳过提示）与 `ImportProgress`（进度条 + `n/m · 文件名` + 取消），`DocumentSourceForm` / `ImportDocModal` / 欢迎页共用；`filterImportFiles` 统一「最多 20 个 / 单文件 28 MB」的筛选并返回被跳过的文件。
- `accept` 保持**字面量字符串**：`scripts/check-formats.mjs` 用 `/accept:\s*'([^']+)'/` 读取它来核对导入扩展名，抽成常量会让检查退化成 19 种。
- 控制器批量循环每轮检查 `importCancelRef`，并写 `importProgress {done,total,name}`；取消时 `break`，已导入的文档保留，收尾提示「已取消：成功 n 篇」。
- 欢迎页批量导入后只弹一次归属：`openProjectPicker({documentIds})` → `pickProject` 走 `assignProjectDocuments`，用返回的 `documents` 逐个 `applyDocumentSummary`，只打开第一篇。
- 「把已有文档加入本项目」先按 `item.projectId !== projectId` 过滤，过滤后为空就整块隐藏；勾选框固定为未选中，加入/移出各自只有一种动作（移出走行内「移动 → 未分类」）。
- 顶栏的「新建 / 导入」改成 `projectsView && !projectOpen` 才渲染：选中项目时由项目详情的文档卡提供入口，避免同一屏两套按钮。

**验证**：`_dev/test-ui-controller.mjs` 42 项（取消只留正在导入的一篇、批量两篇整批同项目）、`_dev/test-ui-projects.mjs` 49 项（上限文案、进度与取消、整批归属文案）、`_dev/test-workbench-mount.mjs` 39 项（欢迎页拖放区与上限说明）、`test-report-contract.mjs` 29 项；`audit-workflow.mjs` 138 项。

**边界**：单批上限是前端软限制（20 个文件 / 800 万字符合计），服务端仍按单文档限制（`MAX_IMPORT_CHARS` 800 万、`MAX_SEGMENTS` 20000）拒绝；导入是串行同步 RPC，取消只在两个文件之间生效。

### 27 项目头部、报告与「回到上次界面」

**动机**：1.2.10 之后项目详情仍有四处不顺：常用动作（导出交付包、删除项目）藏在「更多」里；报告格式要先猜；「所有文档」里报告和移动混在一格，点报告图标还会把面板顶掉；切到别的插件再回来总是回到欢迎页。

**做法**

- 项目头部改为并排：保存设置（primary）、导出项目交付包、删除项目（红色，两步确认）、更多（刷新分析 / 项目报告）。删除按钮对「未分类」不渲染。
- 「项目报告」改成先弹 `ReportPick` 选 HTML / CSV，再下载；文档行的「报告」列不再套二级菜单，按钮直接写「格式 ▾」→ 弹 HTML / CSV 选择。
- 「所有文档」拆成三列：操作 = 打开 + 「移动 ▾」菜单（列出去重后的目标；当前项目按 id 归一后排除，未分类的 `project_inbox` 与空 id 视为同一项）；导出 = 「格式 ▾」菜单（6 种格式）；报告 = 「格式 ▾」菜单（HTML / CSV）。裸下拉框去掉，和项目详情页的交互对齐。
- 新增 `bilingual-xlsx` 导出：`lib/xlsx.js` 的 `sheetXml` 原本写死 `A1:B{lastRow}`，改成按列数计算 dimension，并把打包逻辑抽成 `xlsxPackage(sheets)`；`buildBilingualXlsx(doc)` 输出单表 Source / Target / Status。
- 恢复上次界面：`SESSION_KEY = 'cait.session.view'` 存 `{view, projectId, tab, documentId}`；控制器挂载时读一次，`documents` 先 `openDocument(force)` 成功再切视图，失败回项目视图。`settings.startAtHome` 默认 false，设置里可打开「总是从欢迎页开始」。
- 表头与对齐：`th` / `td` 一律左对齐、表头 12px；列宽改百分比（22/10/14/7/8/13/18/8 与 18/10/9/10/6/6/11/13/8/9），避免固定像素总宽超出面板；`th+th` / `td+td` 加左竖线、行线用 `border-l2`，层次更清楚；超长文档名省略号 + `title`。
- 下载安全化：`client/rpc.js` 的 `downloadFile` 给 `<a>` 加 `target="_blank"`，并在 `finally` 里移除节点、4 秒后 revoke；这修掉了「点报告后工作台白屏」——部分桌面外壳忽略 `download`，把 blob 当作一次整页导航。

**验证**：`_dev/test-ui-projects.mjs` 70 项（头部五入口且无「更多」、项目报告就地弹 HTML/CSV、报告菜单写「格式」、所有文档导出与报告分列、移动菜单取代裸下拉且不重复、导出含双语 XLSX）、`_dev/test-ui-controller.mjs` 47 项（恢复项目视图、startAtHome 打开后回欢迎页、单篇导出触发下载与提示）、`_dev/test-workbench-mount.mjs` 42 项、`_dev/test-topbar.mjs` 2 项、`_dev/test-report-contract.mjs` 29 项；`audit-workflow.mjs` 138 项。

**边界**：会话恢复只记「视图 + 项目 + 标签 + 文档」，不记滚动位置、侧栏筛选与未保存草稿；`startAtHome` 打开后优先于会话恢复。双语 XLSX 为单表、每行三列，不按 `segment.meta.sheet` 分表；超长句段仍受 Excel 单元格上限约束。

## 八、界面与体验

同一件事的入口只留一处，出错时能看见原因。

### 09 界面名称统一（CAIT → AI辅助翻译）

- **动机**：上游把产品名 `CAIT` 写死在品牌栏 `<strong>` 和一批提示语里；本分支改名为 `dsh-ai-translation` 后，侧边栏入口、面板标题与提示语仍显示 `CAIT`，与实际插件名不一致。用户要求统一显示「AI辅助翻译」。
- **实现**：
  - `client/locales.js` + `client.js` 三语表：`app.title` → `AI辅助翻译` / `AI Translation` / `AI翻訳`；`app.subtitle` 去掉 `CAT` 前缀 → `翻译工作台` / `translation workbench` / `翻訳ワークベンチ`。
  - `client/components/shell.js`（及 bundle 内同处）：品牌栏 `h('strong', null, 'CAIT')` → `h('strong', null, t('app.title'))`，从此跟随语言表，不再硬编码。
  - 提示语按语言替换 24 处（`doc.cleanHint`、`workbench.loadFailed`、空状态引导、`modal.settings.uiHint`、`modal.settings.routeHint`、`align.hint`、`usage.hint`、`error.NETWORK` 等），文案里不再出现 `CAIT`。
  - 第二轮补干净三处仍会露出的位置：空状态标语 `CAIT · CAT WORKBENCH` → 改为跟随 `app.title` 的 `` `${t('app.title')} · CAT WORKBENCH` ``；`client/rpc.js` 的两条网络错误文案（"无法连接 CAIT 服务"、"CAIT 服务返回 HTTP …"）；以及服务端 `lib/api.js`（未授权/未知方法/内部错误三条）、`lib/libraries.js`（"请先在 CAIT 的库面板挂载它"，3 处）、`lib/demo.js`（演示文档名）。
  - `locale/{zh,en,ja}.json` 的 `meta.title` 同步为 `AI辅助翻译 (dsh-ai-translation)` 等；三份 README 的开头说明与对应标题改为 `AI辅助翻译` / `AI Translation` / `AI翻訳`，并在「来源与致谢」补一条「界面名称」说明（`CAIT` 仅作上游项目名）。
- **验证**：`client.js`、`client/locales.js`、`client/components/shell.js` 全部通过 `vm.SourceTextModule`；`client/locales.js` 内 `CAIT` 出现 0 次；`h('strong', null, 'CAIT')` 在源码与 bundle 中均为 0 处；强刷后侧边栏显示「AI辅助翻译」，面板标题同名、副标题「翻译工作台」。
- **不做**：`lib/tools.js` 里 21 个 Agent 工具的英文描述、README 的溯源段落仍保留 `CAIT`（分别属于工具契约与上游署名，改动会污染 diff 或削弱署名）。

### 10 插件图标重制

- **动机**：上游图标是「双气泡 + 大写 A + 网络线」，本分支已改名 AI辅助翻译，继续沿用会让人误以为是同一个插件；同时希望图标能体现本分支的核心场景（文档翻译）与 AI 增强。
- **实现**：
  - 图形：**折角文档**（右上折角，读作「文档 / 稿件」）＋ 文档内两行文字（第二行 60% 透明度，读作「原文 / 译文」）＋ 右下 **品牌色四角星**（AI 增强）。全部在 32×32 视口内，页面用 2.1 描边，18px 仍可辨识。
  - 落地三处，必须同步：`icon.svg`（插件包图标，`role=img` 且 `title` / `aria-label` 为「AI辅助翻译 (dsh-ai-translation)」）；`client/components/base.js` 的 `CaitMark({ size = 16 })`（侧边栏与面板顶部都用它，`CaitSidebarIcon` 只是包了一层 span）；打包产物 `client.js` 内同一组件（双引号 + 分号风格）。
  - 颜色全部走主题变量：页面 `var(--dsw-alias-bg-base, #ffffff)`、星形 `var(--dsw-alias-brand-primary, currentColor)`、描边 `currentColor` —— 深/浅色主题与侧边栏选中态自动适配，不需要额外 CSS。
- **验证**：`vm.SourceTextModule` 编译通过（`client.js` / `base.js` / `shell.js`）；13 项锚点断言确认新路径各 1 处、旧气泡 / A 字形 / 网络线 0 处；用 sharp 把 `icon.svg` 渲染到 18/32/64（深/浅两色）目视确认可辨识度。
- **注意**：用 sharp 预览时**先替换 `var(--dsw-alias-brand-primary, currentColor)` 再替换 `currentColor`**，否则 fallback 会被提前换掉、星形渲染成灰色（预览假象，不是文件问题）。
- **生效方式**：`client.js` / `base.js` 改动 → `Ctrl+Shift+R` 强刷；`icon.svg` 属包内文件，插件管理器若缓存图标，需重装或重启 DSH 才会刷新。

### 13 插件详情页本地化

- **动机**：DSH 插件详情页的正文在没有本地化文档时回退到英文 `README.md`，中文用户点进「AI辅助翻译」看到整页英文；标题下的说明也没有体现本地增强。
- **实现**：
  - 三份本地化说明文档：`docs/DETAIL.zh.md`（中文，主要能力 / 相对上游 CAIT 的本地增强 / 数据与隐私）、`docs/DETAIL.md`（English）、`docs/DETAIL.ja.md`（日本語）。
  - `locale/{zh,en,ja}.json` 的 `meta.detail` 分别指向上述文件（`zh` → `docs/DETAIL.zh.md` 等），并重写 `meta.description` 以突出优势与已实现优化。
  - 特性插图 `docs/preview.svg`（640×300，纯矢量、无文字、无脚本、无远程资源，描边 `#8b9bb4` + 品牌蓝 `#4f8ef7`，明暗主题都可读）：放在三份 README 的首屏（`<img src="docs/preview.svg" width="640">`），详情页正文不插图，保持文字简洁。
  - `package.json` 的 `files` 增加 `"docs"`，否则 `npm pack` 不会带上这些文件。
- **验证**：用 `@deepseek-ai/dsh-plugin-detail` 的 `localFiles` + `languageChain` + `readPackageDocument` 直读已装副本 —— `zh`/`zh-CN` → `docs/DETAIL.zh.md`（`origin=locale`）、`en` → `docs/DETAIL.md`、`ja` → `docs/DETAIL.ja.md`；`detailImage("docs/DETAIL.zh.md", "preview.svg")` → `{path:"docs/preview.svg", mediaType:"image/svg+xml"}`；`npm pack` 后 tarball 115 个文件（新增 4 个 docs 文件）。
- **边界**：`meta.detail` 只影响详情页正文，标题与说明仍来自 `meta.title` / `meta.description`（说明里含一句向上游 CAIT 作者 Jovi Lecca 的致谢）；文档里不要写安装步骤（安装入口在页面上）；插图只放 README，避免详情页图片与文字争夺注意力。

### 19 欢迎页、项目内建文档与可见失败

**动机**：1.2.1 验收时用户反馈「点项目名进不去文档」「库页面一直转圈」「点项目崩溃」等 7 条问题。核验后发现首屏从不载入项目详情、项目内没有建文档入口、渲染异常被宿主错误边界静默吞掉（表现成白屏或“点了没反应”）。

**做法**：

- 欢迎页 `HomePage`（`client/components/home.js`）：默认 `view === 'home'`，粘贴文本 / 导入文件 / 加载演示 / 接着上次继续，并列出最近项目与已打开文档；顶栏品牌区变成按钮，随时回首页。
- 项目内建文档：项目详情 `cait-proj-docactions` 提供「新建文档」「导入文件」，`modal.projectId` 预置项目，创建后直接进编辑器并后台刷新项目详情。
- 文档表扩充：项目文档表加「更新时间」列、整行可点；「所有文档」8 列并整行可点，单元格按钮 `stopPropagation`。
- 可见失败：`client/index.js` 用 `ErrorBoundary` 包住 `Workbench`，崩溃时显示可复制的错误文本；LibraryPage 的 `loadRows` 加请求令牌、15 秒超时与失败重试，不再无限转圈。
- 首屏自动载入项目详情（挂载 effect），同一项目再次点击强制重载。

**验证**：`_dev/test-workbench-mount.mjs`（18 项，完整 Workbench + 真实 store 副本）、`_dev/test-ui-controller.mjs`（24 项，controller 端到端）、`audit-workflow.mjs` 138 项全过。

### 20 打开/关闭文档与加载兜底

**动机**：1.2.2 验收反馈 4 条：切到「库」一直转圈；项目详情右侧空白；点「所有文档」里的文档却看到空态页（被误读成“新建文档”）；关闭当前文档直接崩溃。

**做法**：

- `openDocument(documentId, { force })` 返回布尔值：`documentId === doc?.id` 视为已打开；`busy` 时不静默失败，用户点击可用 `force` 越过；`requestOpenDocument` 只在返回 `true` 后 `setView('documents')`，否则留在项目视图。
- `closeDocumentTab`：关闭后读 `state.openDocIds`，为空则回到该文档所属项目（`setView('projects')` + `openProjects(projectId)`），不再把编辑器留在空文档上。
- `loadProjectDetail` 只请求 `projectDetail`，分析从关键路径移除；项目页操作区新增「刷新分析」按钮（`refreshProjectAnalysis`），按需计算并在 chips 下显示覆盖率与报价。
- LibraryPage：`loadRows` 去掉 `data?.revision` 依赖，超时 8 秒、保留上一次的行、失败显示重试。
- 加载看门狗：`workbench.js` 在 `loading` 超过 12 秒时给出错误说明与「重试」，并修正 `error.load` 原始键名问题（改为 `load.failed` / `load.slow` 三语文案）。
- 空态页 `EmptyState` 增加「← 返回项目」「打开已有文档」两个入口。

**验证**：`_dev/test-ui-controller.mjs` 新增「详情默认不带分析」「刷新后带分析报价」「关闭全部文档后回项目视图」三项；`npm run check`、四套 `_dev` 测试、`audit-workflow.mjs` 138 项全过。

### 21 顶栏分组与编辑器工具条精简

**动机**：三个工作台（首页 / 项目 / 库 / 对齐）右上角都常驻「新建 / 导入」，与页面职责不符；文档翻译界面的右上角一行堆了 10 个控件（用量、预翻译、交付、批量、报价、查找替换、新建、导入、导出、设置），文档区还有「＋新开页面」「打开已有文档」两个重复入口，整行在窄宽度下换行，甚至把「打开已有文档」压成竖排。

**做法**：

- 顶栏动作按视图分组：`用量` 常驻；`新建 / 导入` 只在项目视图；文档视图常驻 `预翻译 / 查找替换 / 交付`，`批量 / 报价 / 导出` 收进新增的 `MoreMenu`（点击外部或 Esc 关闭，无打开文档时置灰）；`设置` 常驻。
- 文档区精简：去掉 `DocTabs` 的「＋新开页面」与 `ClosedDocPicker`，只保留返回项目、已打开文档标签、`已确认/总数 · 百分比`。加文档改走项目详情的「新建文档 / 导入文件」。
- 删除随之失效的 `ClosedDocPicker` 组件与 `doc.openExisting`、`doc.clean` 三语文案键；新增 `nav.more`（更多 / More / その他）。
- 样式：`.cait-more` 相对定位 + `.cait-more-menu` 浮层（右对齐、`z-index:60`、最大宽度约束），并给 `.cait-doc-select-wrap span` 加 `nowrap` 防止再次被压成竖排。

**验证**：`_dev/test-workbench-mount.mjs` 增加 6 项（项目页有新建/导入、文档页无新建/导入、文档页常驻预翻译/查找替换/交付、批量/报价默认不在、展开「更多」后三项可见、文档区无「新开页面/打开已有文档」且保留进度），共 28 项全过；`check-locales` 771 键 × 3 语、死键回到 5 个；`audit-workflow.mjs` 138 项全过。

### 22 欢迎页单入口与「继续工作」列表

动机：1.2.4 的欢迎页下半部分有 4 个同权入口（粘贴卡、导入卡、演示卡、接着上次卡）和两列各只有一条的列表，新手不知道从哪开始，老手每次都要跳过演示入口。

做法：

- `HomePage` 只保留一张主卡片，`mode` 在 `text` / `file` 之间切换：文本页是 textarea，文件页是可拖放的虚线区（`onDrop` 取 `dataTransfer.files[0]`），两页共用名称/源语言/目标语言与同一个提交按钮。
- 提交仍走 `createFromForm`，文件模式传 `{ mode:'file', file, name, sourceLang, targetLang }`，因此项目归属对话框、重复文件复用等逻辑与弹窗完全一致。
- “接着上次”是 `cait-home-resume` 药丸，文案 `home.resumeShow` 带目标名；无目标时不渲染。
- “继续工作”把 `projects`（排除未分类）与 `openDocuments` 合并，按 `updatedAt` 倒序取 6 行；每行 `52px | 1fr | 84px | 96px | 66px` 网格（类型标签、名称、进度条、meta、相对时间），≤700px 时隐藏进度条与 meta。
- “加载演示文档”仅在 `projects.length === 0 && openDocs.length === 0` 时以 `cait-linkbtn` 出现。
- 文案：新增 `home.tabsPaste/tabsFile/fileHint/pickFile/startImport/workTitle/allProjects/kindProject/kindDoc/resumeShow/timeNow/timeMins/timeHours/timeDays`，删除不再使用的 `home.pasteTitle/import/importHint/demoHint/resumeEmpty/recentProjects/openDocs`（三语同步，`check-locales` 771 键）。

验证：`_dev/test-workbench-mount.mjs` 增 5 项（一张主卡片 + 两个标签页、有项目时无演示入口、继续工作含项目/文档类型标签、标题与“全部项目”链接），32 项全过；`check-undef` 96 文件、`check-locales` 771×3、`audit-workflow` 138/138。

## 九、维护与发布须知

### 9.1 客户端产物怎么来

`client.js` 由 `node scripts/build-client.mjs` 用 esbuild 把 `client/` 源码打成单个 CommonJS 包，再套 `__ModuleLoader__.load` 外框。**不要手改 `client.js`**；改完 `client/` 后跑 `node scripts/check-client.mjs` 确认产物与源码一致。受限沙箱里 esbuild 启子进程会 `spawn EPERM`，构建与校验需要放开权限跑一次。

### 9.2 每轮必跑的检查

改完代码按顺序跑（缺一项都可能漏问题）：

1. `node scripts/build-client.mjs` + `node scripts/check-client.mjs`
2. `node scripts/check-store.mjs`（mixin 数量、重复方法名）
3. `node scripts/check-api.mjs`（handler 与客户端调用一致性、MUTATIONS 覆盖）
4. `node scripts/check-locales.mjs`（三语键齐平；`UI_DICTS`、`WORKFLOW_DICTS`、`PROJECT_DICTS` 都要参与）
5. `node scripts/check-errors.mjs`（错误码与兜底文案）
6. `node scripts/check-formats.mjs`（导出的 `EXPORTERS` 与导入扩展名数量）
7. `node scripts/check-undef.mjs`（未声明变量，能抓白屏类错误）
8. `node scripts/check-shared.mjs`
9. `node scripts/run-tests.mjs`（`_dev/test-*.mjs`，含完整 Workbench 挂载）
10. `node --experimental-vm-modules scripts/check-publish.mjs`
11. 外部功能回归：`audit-workflow.mjs`（期望 138 项全过）+ `audit-zip-check.mjs <out.zip>`

### 9.3 打包与安装（唯一流程）

1. 只在仓库副本 `dsh-cait-optimized\` 改代码；
2. `npm pack --cache <工作区临时缓存> --pack-destination <workspace>\_packages`，产物是 `scottzhb-hue-dsh-ai-translation-<version>.tgz`；
3. `plugin_manager` 的 `remove_bundle` → `install_bundle`（target 用新 tgz 绝对路径）；
4. 用 `_tmp/hash-check.mjs` 逐文件比对仓库与已装副本的 SHA-256，确认 ALL SAME；
5. 服务端改动用重启 DSH 生效，客户端改动 `Ctrl+Shift+R` 强刷。

原因：DSH 启动会按 lockfile 重装 `file:` 依赖，直接改 `node_modules` 会被 tgz 内容静默覆盖。

### 9.4 推送与发布

- 推送可在沙箱内完成：`pwsh` 提权 + `GIT_TERMINAL_PROMPT=0`、`GCM_INTERACTIVE=never`，仓库已配 `http.https://github.com.proxy=http://127.0.0.1:7890`。
- 打 `v<version>` 标签会触发 GitHub Actions（`publish-github-packages`）发布到 GitHub Packages。
- GitHub Release 用缓存凭据（`git credential fill`）+ GitHub API 创建，并上传 `dsh-ai-translation.tgz` 资产；市场条目取 `releases/latest/download/dsh-ai-translation.tgz`，下载后用 `assets[0].digest` 与本地 SHA-256 比对。
- Release 标题写成 `vX.Y.Z — 本版要点`（版本号后接要点，便于市场与用户分辨）。

### 9.5 版本与数据兼容

- 包版本写在 `package.json`；功能累积升 minor（1.2.x），纯修 bug 升 patch；
- `store.json` 结构变化时同步升 `lib/limits.js` 的 `STORE_VERSION`；旧数据在 `lib/persistence.js` 的 `restore()` 里做兼容与迁移；
- `CAIT_VERSION` 保留上游值（用于交付说明落款），不随本分支递增。

### 9.6 文档同步

每次发版同步四处：`CHANGELOG.md`（本版 Added/Changed/Fixed）、三份 `README*.md`（新增小节）、`OPTIMIZATIONS.md`（新增编号 + 总览表行）、仓库外的 `HANDOFF-dsh-ai-translation.md`（状态表与版本记录）。`docs/DETAIL*.md` 与 `locale/*.json` 的 `meta.description` 是市场详情页来源，文案改动也要一起走。

### 9.7 Windows 环境注意

- 含中文的源码只能用 node 脚本或编辑器读写；PowerShell `Get-Content -Raw` 会按 ANSI 读坏，`Set-Content -Encoding UTF8` 会加 BOM；
- 下载校验一律走 GitHub API + `git credential fill`（`curl.exe` 报 `schannel ... SEC_E_NO_CREDENTIALS`，`Invoke-WebRequest` TLS 失败）；
- 临时脚本放 `_tmp/`（已 ignore），提交前 `git status` 确认没有混入。

### 9.8 常见故障对照

| 现象 | 先查什么 |
|---|---|
| 工作台白屏 / 点项目崩溃 | `check-undef`、完整 Workbench 挂载测试；hook 是否在提前 `return` 之后 |
| 文案显示成 `projects.xxx` | `check-locales`；键是否真的存在、三语是否齐 |
| 表格列被裁、按钮显示不全 | 列宽是否用百分比；浮层是否 `position:fixed` |
| 排序/移动无效 | `projectDetail` 是否按 `docOrder` 输出；`docOrder` 是否写回 |
| 导入后文档不在项目里 | `importFile` 是否透传 `projectId` |
| 保存按钮一直转圈 | `busy` 是否按动作区分 |

## 十、已知边界与后续候选

### 10.1 已知边界

- **交付包不含 TMX**：体积不可控，需要时从「库」单独导出。
- **报价是本地估算**：按 TM 匹配档位与单价计算，不替代合同；本地 MT 不校验端点能力，由端点自己负责。
- **拆分只支持 txt / md / docx**：pptx / xlsx 缺少“同单元多句段”的稳定锚点。
- **项目报告是单页 HTML + CSV**：不引 PDF 依赖，打印用浏览器“打印为 PDF”。
- **「回到上次界面」存在 localStorage**：换浏览器或清缓存后回到欢迎页；设置里可关（`startAtHome`）。
- **双语 XLSX 是单表**：`Bilingual` 工作表、三列（Source / Target / Status），不按原文分表。
- **库条目缓存无上限**：超大记忆库（十万条以上）分页仍在浏览器端聚合，极端量级建议拆分库。

### 10.2 上游遗留缺陷（建议另开 upstream issue）

- 导入文档时把「显示名称」当文件名，扩展名丢失 → 非纯文本格式报「文件内容为空」（1.1.8 仍存在）。
- 术语库只认普通 CSV，不支持 SDL MultiTerm / Trados 导出的 `>>L<<` 表头格式；语言列非法时整次导入失败。
- 句段合并/拆分被格式白名单挡住，DOCX 无法操作（本清单 01/02 已本地修复）。
- `lib/persist` 与设置字段是白名单式，新增字段容易漏（03/04 均已补 `persistence.js`）。

### 10.3 后续候选

- CAIT 用量账本与 DSH 会话用量打通（目前只看得到 CAIT 自己的调用）。
- 用量数据导出 CSV / 按月汇总图。
- pptx / xlsx 的拆分支持。
- 项目报告增加“按文档分解的报价”视图。
- 把手工补丁流程彻底脚本化（含构建、检查、打包、发布一条命令）。

### 28 项目列表收窄、名称换行与移动交互统一

**动机**：1.2.11 验收后剩下三处不一致：左列 236px 占宽、右侧详情被挤；项目名过长直接省略，看不出全名；「把已有文档加入本项目」只有 11.5px，比表头还小；项目详情行内「移动」弹独立对话框，而「所有文档」是就地菜单，同一件事两套操作。

**做法**

- 列宽：`.cait-proj-body` 由 `minmax(0,236px) 1fr` 改为 `minmax(180px,208px) 1fr`，`@media(max-width:1180px)` 固定在 180px；列表项内边距 7px → 6px 抵消收窄带来的拥挤。
- 名称换行：`.cait-proj-item-name` 去掉 `white-space:nowrap` 与 `text-overflow:ellipsis`，改 `overflow-wrap:anywhere; line-height:1.35`；`.cait-proj-item-title` 由 `align-items:center` 改 `flex-start`，长名称换行时「未分类」标签仍贴顶。
- 折叠标题：`.cait-proj-addmore summary` 11.5px → 13px、`font-weight:500`、颜色由 secondary 提为 primary，并在 `summary` 前加 `Icon plus`；位置保持在文档表下方——挪到文档卡头部会与「新建文档 / 导入文件」挤在一行，项目多、文档名长时反而更乱。
- 列表行去重：项目列表每行原本还挂一颗报告按钮，与详情页顶部的「项目报告 ▾」重复，且作为整行按钮的兄弟节点只能换行落到下一行左侧（看起来像多出来的小图标）。直接删除该按钮与 `.cait-proj-report` 样式，`ProjectList` 不再需要 `onPickReport`。
- 未分类去重：默认项目的名称就是「未分类」，再渲染一枚「未分类」标签会重复；改为 `project.inbox && project.name !== t('projects.inboxTag')` 才显示标签，改名后仍能识别它的特殊身份。
- 移动统一：抽出模块级 `moveMenuItems(t, projects, doc, onMove)`，项目详情行与「所有文档」都用它生成「移动 ▾」菜单（列出其他项目 + 未分类，按 `project_inbox` ↔ `''` 归一排除当前项目）；删除 `MoveDocModal` 与 controller 的 `openMoveDocPicker` / `pickMoveTarget`，少一条无人走的路径。

**验证**：`_dev/test-ui-projects.mjs` 增加「项目详情移动菜单列出其他项目 / 不列当前项目 / 点目标直接回传」，以及三条样式静态断言（列宽、名称换行、折叠标题字号），80 项全过；`run-tests` 五套全过；`audit-workflow` 138/138。

**边界**：菜单里项目名过长会换行撑高菜单项，未做截断；列表列宽度是固定区间，不提供拖拽调整。

## 附录 A 版本对照（项目层之后）

| 版本 | 主题 | 对应编号 |
|---|---|---|
| 1.2.0 | 作业层原名版（多文件共享 brief/TM/术语库、分析、交付、工时） | 18（前身） |
| 1.2.1 | 修复工作台白屏（解构漏变量） | 24（同类） |
| 1.2.2 | 欢迎页、项目内建文档、可见失败、报告与报价 | 19、23 |
| 1.2.3 | 打开/关闭文档与加载兜底、分析改手动 | 20 |
| 1.2.4 | 顶栏分组与编辑器工具条精简 | 21 |
| 1.2.5 | 欢迎页单入口与「继续工作」 | 22 |
| 1.2.6 | 项目详情重排（可折叠分区、行内菜单） | 23 |
| 1.2.7 | 修复项目详情 hooks 顺序崩溃 | 24 |
| 1.2.8 | 独立弹窗、文档排序与移动、库详情对话框、批量导入 | 25 |
| 1.2.9 | 统一导入器、进度可取消、整批一次归属 | 26 |
| 1.2.10 | 插件说明重写（README / 市场详情 / locale 描述） | 13、09 |
| 1.2.11 | 报告与导出就地选格式、双语 XLSX、回到上次界面、表格版式 | 27 |
| 1.2.12 | 项目列表收窄与名称换行、加入本项目放大、移动交互统一 | 28 |

更早的版本（1.0.1–1.1.1）见 `CHANGELOG.md`。

## 附录 B 文件地图

服务端（`lib/`）：

| 文件 | 职责 |
|---|---|
| `store.js` / `store-mixins.js` | 单对象 store 与 mixin 装配 |
| `documents.js` / `segments.js` | 文档创建、句段状态机 |
| `projects.js` | 项目实体：状态分档、分析、报价、报告、交付、工时、文档排序 |
| `brief.js` | brief 字段、继承合并、上下文块 |
| `libraries.js` | TM / 术语库、挂载与继承解析 |
| `deliver.js` / `zip.js` | 交付检查与零依赖 ZIP |
| `quote.js` / `analysis.js` | 分档计价与匹配分析 |
| `xlsx.js` / `export-document.js` | 导出器（含双语 XLSX） |
| `import-file.js` / `legacy-office.js` | 导入与旧版 Office 转换 |
| `persistence.js` / `limits.js` / `settings.js` | 持久化、版本、默认设置 |
| `api.js` | RPC handler 与 MUTATIONS 注入 |

客户端（`client/`）：

| 文件 | 职责 |
|---|---|
| `index.js` | 插件入口（侧边栏 + 主槽 + ErrorBoundary） |
| `components/shell.js` | 顶栏、文档标签、空态 |
| `components/home.js` | 欢迎页（粘贴/导入/继续工作） |
| `components/projects.js` | 项目列表、项目详情、所有文档、归属与移动弹窗 |
| `components/forms.js` | 新建/导入对话框与共用拖放区 |
| `components/pages.js` | 库页面（含条目对话框） |
| `components/workflow.js` | 交付、批量、报价、本地 MT 弹窗 |
| `components/editor.js` / `rail.js` / `panels.js` | 编辑器、句段栏、右侧面板 |
| `workbench/controller.js` | 状态与动作（会话恢复、项目、导入、导出） |
| `rpc.js` | RPC 与下载 |
| `locales.js` / `locales-workflow.js` | 三语字典（含 PROJECT_DICTS） |
| `styles.js` | 全部样式 |
