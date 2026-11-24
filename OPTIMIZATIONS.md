# dsh-ai-translation 本地优化清单


> 发布名：`@scottzhb-hue/dsh-ai-translation@1.0.9`（fork 自 CAIT `dsh-cait@1.1.8`，上游作者 Jovi Lecca，Apache-2.0）。
> 上游仓库：<https://github.com/JoviLecca/dsh-CAIT>；本分支仓库：<https://github.com/scottzhb-hue/dsh-ai-translation>。
本文件登记我在本机对 **dsh-cait 1.1.8**（上游 npm 最新版）所做的全部本地优化，
用于：① 本对话后续继续迭代时作为基线参考；② 将来把优化版发布到 GitHub 时作为变更来源。

- 基线：`dsh-cait@1.1.8`，安装位置 `%USERPROFILE%\.dsh\profiles\desktop\node_modules\@scottzhb-hue\dsh-ai-translation\`（以 `file:` 本地 tgz 安装）
- 运行环境：DSH Desktop `0.2.2-rc.5`，profile `desktop`，数据目录 `%USERPROFILE%\.dsh\cait\`
- 启用方式：改服务端 `lib/` 需**重启 DSH**；改客户端 `client.js`（打包产物）需 **Ctrl+Shift+R 强刷**
- 最后更新：2026-11-23

> ⚠️ 已装副本（profile 的 `node_modules`）是 **DSH 启动时按 lockfile 重装的产物**：直接改那里的文件，下次启动会被 `file:` tgz 里的内容覆盖还原。
> 改代码请只走「仓库副本 → `npm pack` → `_packages\` 新 tgz → `remove_bundle` + `install_bundle`」，详见「维护与发布须知」第 8 条。

## 总表

| 编号 | 主题 | 状态 | 服务端文件 | 客户端文件 | 备份后缀 |
|---|---|---|---|---|---|
| 01 | 句段合并放行（同段落 + Shift 跨段落）+ 中英拼接 + 缩写识别 | 已上线 | `lib/segment-edit.js`、`lib/export-document.js`、`lib/segmenter.js` | `client/components/editor.js`、`client/workbench/controller.js`、`client/locales.js`、`client.js` | `.bak-merge-20261122083805`、`.bak-20261122-merge2` |
| 02 | DOCX 同段落拆分（导出 `<w:br/>`） | 已上线 | `lib/segment-edit.js`、`lib/export-document.js` | `client/locales.js`、`client.js` | `.bak-split-202611221720` |
| 03 | AI 对话框（新建后 brief / 预翻译前 / 顶部常驻指令条） | 已上线 | `lib/ai-chat.js`、`lib/store-mixins.js`、`lib/api.js`、`lib/persistence.js` | `client/components/dialogs.js`、`client/components/workbench.js`、`client/workbench/controller.js`、`client/locales.js`、`client.js` | `.bak-20261122-ai` |
| 04 | 选中即建术语（右键 / Ctrl+Alt+T、默认库 + 首次提示） | 已上线 | `lib/term-capture.js`、`lib/settings.js`、`lib/persistence.js`、`lib/store-mixins.js`、`lib/api.js` | `client/components/editor.js`、`client/components/dialogs.js`、`client/components/workbench.js`、`client/workbench/controller.js`、`client/locales.js`、`client.js` | `.bak-term-20261122-1905` |
| 05 | 未确认译文自动暂存（`drafts/<docId>.json`） | 已上线 | `lib/draft-recovery.js`、`lib/store-mixins.js`、`lib/api.js` | `client/workbench/controller.js`、`client/locales.js`、`client.js` | `.bak-recovery-20261122-2005` |
| 06 | 路由健壮性：跳过 modlens 识图包装路由 + 真实错误透出 + 下拉标注 | 已上线 | `lib/mt.js`、`lib/routes.js`、`lib/mt-translate.js`、`lib/review.js`、`lib/ai-chat.js` | `client/components/dialogs.js`、`client/components/panels.js`、`client/locales.js`、`client.js` | `.bak-wrapper-20261122-1945` |
| 07 | **Token 消耗统计与预估费用** | 已上线 | `lib/usage.js`、`lib/pricing.js`、`lib/mt.js`、`lib/api.js`、`index.js` | `client/components/usage.js`、`client/components/shell.js`、`client/components/workbench.js`、`client/workbench/controller.js`、`client/locales.js`、`client.js` | `cait-usage-backup-20261122-225245`（工作区） |
| 08 | AI 对话消息形状防御 + 「整理为项目说明」 | 已上线 | `lib/ai-chat.js` | `client/components/dialogs.js`、`client/components/workbench.js`、`client/workbench/controller.js`、`client/locales.js`、`client.js` | `.bak-summarize-20261122-2215` |
| 09 | 界面名称统一：写死的 `CAIT` → 「AI辅助翻译」（入口 / 品牌 / 提示语） | 已上线 | —（纯前端） | `client/components/shell.js`、`client/locales.js`、`client.js`、`locale/{zh,en,ja}.json` | `.bak-title-*`、`.bak-subtitle-*`（已清理） |
| 10 | 插件图标重制：折角文档 + 两行文字 + 品牌色四角星（与上游 CAIT 的双气泡区分） | 已上线 | —（纯前端） | `icon.svg`、`client/components/base.js`、`client.js` | 无（改动前内容见本文件 09/10 说明） |
| 11 | 旧版 Office 导入：`.doc` / `.xls` / `.ppt` 先经本机 Office 转 OOXML 再导入 | 已上线 | `lib/legacy-office.js`（新增）、`lib/file-ops.js`、`lib/import-file.js` | `client/components/forms.js`、`client/components/pages.js`、`client/locales.js`、`client.js` | 无（新模块，无覆盖式改动） |
| 12 | 术语库导入/导出入口（术语面板 + 库页，选择器弹窗） | 已上线 | `lib/library-view.js`（`exportGlossary` + `defaultGlossaryFor`） | `client/components/panels.js`、`client/components/pages.js`、`client/components/workbench.js`、`client/workbench/controller.js`、`client/styles.js`、`client.js` | 无（仅新增入口与目标库解析，复用既有 RPC） |

## 明细

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

### 06 路由健壮性（modlens 识图包装路由）

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

### 08 AI 对话消息形状防御 + 整理为项目说明

- **动机**：DSH 的请求投影会读 `message.source.replayState`，assistant 消息缺 `source` 时多轮对话直接崩（`Cannot read properties of undefined (reading 'replayState')`）。
- **实现**：
  - `toModelMessage(entry, route)`：assistant 一律带 `source: { kind:'model', provider, model }`（旧记录缺 provider/model 时回落当前路由）。
  - `assertModelMessages(messages, route)`：发送前校验 role / `content[0].text` / assistant 的 `source`，不合规抛 `AI_MESSAGE_INVALID` 并写明原因与当前路由。
  - `mtRuntime.stream` 非函数时给 `AI_ROUTE_UNAVAILABLE`（提示重启 DSH）。
  - 「整理为项目说明」：`mode: 'brief'` 且 `message` 为空、已有历史时，用 `BRIEF_ONLY_PROMPT` 补齐最后一条 user 内容，且**不把这条伪输入写进对话记录**；客户端对话框底部新增按钮。
- **验证**：行为用例 4 组（整理/空消息/普通对话/防御断言）；客户端 5 文件编译 + 24 项锚点断言。

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

### 10 插件图标重制（与上游 CAIT 区分）

- **动机**：上游图标是「双气泡 + 大写 A + 网络线」，本分支已改名 AI辅助翻译，继续沿用会让人误以为是同一个插件；同时希望图标能体现本分支的核心场景（文档翻译）与 AI 增强。
- **实现**：
  - 图形：**折角文档**（右上折角，读作「文档 / 稿件」）＋ 文档内两行文字（第二行 60% 透明度，读作「原文 / 译文」）＋ 右下 **品牌色四角星**（AI 增强）。全部在 32×32 视口内，页面用 2.1 描边，18px 仍可辨识。
  - 落地三处，必须同步：`icon.svg`（插件包图标，`role=img` 且 `title` / `aria-label` 为「AI辅助翻译 (dsh-ai-translation)」）；`client/components/base.js` 的 `CaitMark({ size = 16 })`（侧边栏与面板顶部都用它，`CaitSidebarIcon` 只是包了一层 span）；打包产物 `client.js` 内同一组件（双引号 + 分号风格）。
  - 颜色全部走主题变量：页面 `var(--dsw-alias-bg-base, #ffffff)`、星形 `var(--dsw-alias-brand-primary, currentColor)`、描边 `currentColor` —— 深/浅色主题与侧边栏选中态自动适配，不需要额外 CSS。
- **验证**：`vm.SourceTextModule` 编译通过（`client.js` / `base.js` / `shell.js`）；13 项锚点断言确认新路径各 1 处、旧气泡 / A 字形 / 网络线 0 处；用 sharp 把 `icon.svg` 渲染到 18/32/64（深/浅两色）目视确认可辨识度。
- **注意**：用 sharp 预览时**先替换 `var(--dsw-alias-brand-primary, currentColor)` 再替换 `currentColor`**，否则 fallback 会被提前换掉、星形渲染成灰色（预览假象，不是文件问题）。
- **生效方式**：`client.js` / `base.js` 改动 → `Ctrl+Shift+R` 强刷；`icon.svg` 属包内文件，插件管理器若缓存图标，需重装或重启 DSH 才会刷新。

### 11 旧版 Office 导入（.doc / .xls / .ppt）

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

### 12 术语库导出入口

- **动机**：`exportGlossary` 早已支持 TBX / CSV / JSON，但入口只藏在「库」页，而且按钮文字只写格式名（`TBX` / `CSV` / `JSON`），译者反馈「找不到术语库导出」。
- **实现**：
  - 工作台右侧「术语」面板与「库」页都不再常驻格式/库下拉，只保留「导入」「导出」两个按钮；点击后弹出选择器弹窗（`LibraryIoModal`）：选目标库，导出时再选格式（TBX/CSV/JSON，TM 固定 TMX），导入时选文件。
  - 目标库候选按项目解析（`document-view.js` 的文档摘要新增 `tmIds`/`glossaryIds`）：默认 = 文档挂载的默认写入库，未挂载时用文档首个挂载库；候选只列该文档挂载的库。
  - 控制器新增 `libraryIoOptions(kind)`、`exportLibraryTo({kind,libraryId,format})`、`importLibraryTo({kind,libraryId,file})`，导入/导出统一走这两个方法（下载、提示、`replaceRemoteState` 都在这里）。
  - 服务端 `exportGlossary({documentId})` 仍支持不传 `glossaryId` 时按文档回落（`defaultGlossaryFor`）。
- **验证**：文档摘要含 `tmIds: tm_default` / `glossaryIds: glossary_default,gl_2c2c00e8`；`defaultGlossaryFor('doc_3c172d94')` → `glossary_default`；`exportGlossary({documentId})` 导出 `cait-glossary-物种起源1-20261124.csv`（25,622 字节），显式 `glossaryId` 可导出任意挂载库，XLSX 仍报 `INVALID_EXPORT_FORMAT`；6 个源码文件与 `client.js` 均通过 `vm.SourceTextModule`，弹窗/按钮/文案锚点计数全部符合预期。
- **边界**：面板导出的是「该文档实际使用的术语库」，库页可任选；导出内容仍是整库快照，不区分当前句段的临时命中；不支持的格式由服务端拒绝并显示原因。

## 维护与发布须知

1. **为什么手改 `client.js`**：本机 profile 里没有可用的 esbuild（`node_modules\@esbuild` 是空目录，DSH 安装包内也没有），`scripts/build-client.mjs` 跑不起来；插件的 `exports["./client"]` 指向打包产物 `client.js`，所以每次改客户端都要**源码 `client/*.js` 与 `client.js` 同步改**（bundle 是全双引号 + 分号风格）。
   插件的 `devDependencies` 里有 `esbuild ^0.28.2`：若在插件目录装好开发依赖（`npm install --include=dev`），可用 `npm run build:client` 从 `client/` 重新生成 `client.js`。本地每轮补丁都保持源码与产物一致，理论上重新构建可复现；首次重建后**务必与现有 `client.js` 做一次差异比对**再替换。
2. **npm 打包白名单**：`package.json` 的 `files` 已加入 `OPTIMIZATIONS.md`；若再新增文档（如 `docs/`），记得同步该数组，否则 `npm pack` 不会带上。
3. **备份命名**：每轮改动前把要改的文件复制成 `<原文件名>.bak-<主题>-<时间戳>`（如 `client.js.bak-term-20261122-1905`）；07 的备份放在工作区 `cait-usage-backup-20261122-225245/`。
4. **回滚**：用对应 `.bak-*` 覆盖回去即可；改过服务端要重启 DSH，改过 `client.js` 要强刷。
5. **写权限**：仓库副本在工作区内，可直接改；已装副本在 `%USERPROFILE%\.dsh\profiles\...` 下，写它必须显式申请更宽的文件权限（否则报 `EPERM` / `file access denied under workspace-write mode`）。但正常流程不需要改已装副本（见第 8 条）。
6. **PowerShell 坑**：`Get-Content -Raw` 默认按 ANSI 读，含中文的文件会被写坏；读用 `-Encoding UTF8`，写用 node 脚本或编辑工具。
7. **发布前检查**：把 `lib/`、`client/`、`client.js`、`index.js`、`OPTIMIZATIONS.md` 一并同步；`README*.md` 与 `CHANGELOG.md` 建议追加"本地优化"章节；不要把 `*.bak-*`、`cait-*.mjs` 测试脚本、`node_modules/` 提交进仓库。
8. **推荐工作流（唯一流程，避免改动被还原）**：
   - 只在仓库副本 `<workspace>\dsh-cait-optimized\` 里改代码（服务端 `lib/`、客户端 `client/*.js` 与打包产物 `client.js` 同步改）；
   - `npm pack --cache <工作区临时缓存>` 生成 `scottzhb-hue-dsh-ai-translation-<version>.tgz`，挪到 `<workspace>\_packages\`（该目录不要删，profile 的 `file:` 依赖指向它）；
   - `plugin_manager remove_bundle target: @scottzhb-hue/dsh-ai-translation`，再 `install_bundle target: <新 tgz 绝对路径>`；
   - 重启 DSH（服务端 `lib/`）+ `Ctrl+Shift+R` 强刷（客户端），验证通过后提交仓库并推送；
   - 原因：DSH 启动时会按 lockfile 重装 `file:` 依赖，直接改 `node_modules` 里的文件会在下次启动被 tgz 内容静默覆盖（2026-11-23 就是这样把新图标还原成旧图标的）。
   - 例外：只想临时验证、且不重启时可以改已装副本；一旦重启即失效，务必回到上面的流程。
9. **发布门禁**：`npm run check:publish`（`scripts/check-publish.mjs`，`prepublishOnly` 会自动调用）校验包身份（name/version/license/author/contributors）、`files` 白名单与实际文件、`LICENSE` 与 `NOTICE` 的上游署名、三语 locale 键一致性与全部 `.js` 模块的 ESM 语法。上游的 `npm run check` 依赖 `eslint`/`prettier`/`esbuild` 与 `_dev/`，在发布树里无法运行，因此不作为发布门禁。

10. **版本号约定**：包名 `@scottzhb-hue/dsh-ai-translation`，当前 `1.0.2`（已发布到 GitHub Packages）。改动累积后递增 patch（`1.0.3`、`1.0.4`…），新增功能递增 minor；同步更新 `CHANGELOG.md` 并打 `v<version>` 标签触发发布流水线。


## 已知上游缺陷（建议 upstream issue）

- 导入文档时把「显示名称」当文件名，扩展名丢失 → 非纯文本格式一律报「文件内容为空」（1.1.8 仍存在）。
- 术语库只认普通 CSV，不支持 SDL MultiTerm / Trados 导出的 `>>L<<` 表头格式；语言列非法时整次导入失败。
- 句段合并/拆分被格式白名单挡住，DOCX 无法操作（本清单 01/02 已本地修复）。
- `lib/persist` 与设置字段是白名单式，新增字段容易漏（03/04 均已补 `persistence.js`）。

## 后续候选

- CAIT 用量账本与 DSH 会话用量打通（目前只看得到 CAIT 自己的调用）。
- 用量数据支持导出 CSV / 按月汇总图。
- pptx / xlsx 的拆分支持（需要"同单元多句段"的稳定锚点）。

- 把手工补丁流程改成可复现脚本（含 esbuild 构建链），便于发布与回滚。
