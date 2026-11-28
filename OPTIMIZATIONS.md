### 29 「AI 工作区」：预翻译 / AI 重译 / AI 审校

**动机**：用户指出右栏「AI 翻译」与中间「机器建议」各说各话——同一句段两处按钮、两处结果；AI 审校又藏在右栏另一张卡里，用的时候要来回看。希望合成一处、按重要性排列，右栏只留设置。

**做法**

- 中间列改成三张可折叠卡片：预翻译结果（原「机器建议」，只展示 `segment.suggestion` 与来源）、AI 重译（`reviseSegment`，结果写 `segment.revise`，不覆盖预翻译底稿）、AI 审校（原 `reviewSegment` 面板卡搬到这里）。折叠用 `.cait-ai-card.is-open` + `> *:not(.cait-ai-title){display:none}` 实现，卡片内容保持常驻，切开关不丢输入。
- `lib/revise.js`：`reviseSegment({documentId,index,before})` 取前 N 条**有译文**的句段（原文 => 译文，各 600 字）、项目/文档 brief、命中术语（最多 12 条，带 forbidden/preferred 标记）；优先本地 MT，其次 DSH 路由（`purpose: 'cait-revise'`）；输出清洗掉代码围栏与引号后写 `segment.revise = { text, at, provider, model, before }`。错误码 `REVISE_EMPTY_SOURCE` / `REVISE_EMPTY` / `REVISE_UNAVAILABLE` / `REVISE_ROUTE_ERROR`。
- 右栏标签改名「AI 译审」，内容变成设置页：翻译方式（路由 / 本地端点，与设置页共用 `LocalMtFields`）、三个开关（`settings.features.{suggestion,revise,review}`）、上下文条数（`settings.reviewContext` 0–5）。开关与条数走 `saveSettings` 持久化；开关只影响显示，不清除已存结果。
- 复制按钮：原文行、译文栏标题、预翻译结果、重译结果、审校建议各一颗，统一 `onCopy(text)`。
- 术语统一：「项目翻译预设 / 文档翻译预设」取代「项目说明 / 项目 brief / 文档说明 / 文档 brief」的混用；AI 助手底部改为两颗按钮（存为文档预设 / 存为项目预设），分别写 doc.brief 与 project.brief，写项目后立即刷新项目设置页。
- 编辑区文档头压成一行并吸顶（标题 + 语言对 + 进度百分比 + 预设 / 资源 / 分析三个入口），删掉与顶栏重复的大进度块；原文卡 position:sticky;top:44px，长句段滚动时原文常驻。

**验证**：`_dev/test-report-contract.mjs` 增 14 项（重译返回、前文/术语进提示词、不覆盖 suggestion、不写 review、错误码、持久化往返），52 项全过；`_dev/test-ui-controller.mjs` 增 8 项（重译写入、采纳只改草稿、清除、预览/保存/恢复默认/取消），68 项全过；新增 `_dev/test-editor-ai-cards.mjs` 21 项、`_dev/test-panel-review.mjs` 改为设置页断言 18 项；七套件全过；`audit-workflow` 138/138。

**边界**：一个句段只保留一条重译结果（再点即覆盖）；前文只取「有译文」的句段，未翻译的段落不参与上下文；关闭开关后已存的重译/审校结果仍留在数据里，只是不显示。

**预设对话框与「从参考文档归纳」（1.2.12 追加）**

- 文档头五个入口：文档翻译预设 ｜ 项目翻译预设 ｜ 资源 ｜ 分析 ｜ 项目详情，全部 `inline-flex` 对齐。
- `PresetModal`（`client/components/dialogs.js`）同时服务两种范围：标题与提示按 `scope` 切换，底部保留原有保存逻辑。
- `lib/brief-learn.js`：最多 3 个文件（DOCX 走 `parseDocx`、XLSX 走 `parseXlsx`、其余按 UTF-8），抽样 60 行 / 3 万字符，要求模型只返回六字段 JSON；结果只回填表单，不写库。
- 冲突处理：与现有字段不同时逐个给「保留 / 替换 / 合并」，默认保留；空字段自动填入新值。
- 分析提速：`tmPrepared`（按条目 updatedAt 缓存归一化）、`tmKeyIndex`（按语言对 + 原文建索引，精确命中直接返回，不再扫全库）、`analysisCache`（按文档版本 + 库修订 + TM 条数）。488 句段 × 2000 条 TM 从 21 秒降到约 2 秒。

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
