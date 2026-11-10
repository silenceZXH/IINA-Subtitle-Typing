# IINA_learn-english-tool — 代码库理解与架构梳理

## 1. 项目定位与用途

**IINA 字幕打字练习插件**。在 IINA 播放器中逐句播放视频字幕，用户跟随打字练习英语听力与拼写。支持外挂 SRT 字幕和内嵌软字幕两种来源，提供视频内嵌输入面板（overlay）和独立窗口两种输入模式，具备 A-B 循环播放、盲打模式、正确率统计等功能。

- confirmed：插件标识 `com.aaron.typing-practice`，版本 0.4.0（`Info.json:3-4`）。
- confirmed：核心逻辑在 `src/main.js`（864 行），UI 为 3 个 HTML 文件。

## 2. 目录/文件结构

```
IINA_learn-english-tool/
├── plugin-src/                          # 插件源码
│   ├── Info.json                        # 插件元数据（名称、版本、入口、权限、默认设置）
│   ├── src/
│   │   └── main.js                      # 插件主逻辑（字幕解析、A-B循环、状态机、消息通信）
│   └── ui/
│       ├── overlay-input.html           # 视频内嵌输入面板（深色透明主题）
│       ├── input-window.html            # 独立窗口输入面板（浅色主题，逻辑同overlay）
│       └── preferences.html             # 插件设置页（A-B循环4个参数）
├── iina-typing-practice.iinaplugin/     # 构建/打包后的插件（与plugin-src内容一致，副本）
├── IINA字幕打字插件 - 产品需求计划书（最终版）.md  # 需求文档（非代码）
└── 开发计划.md                          # 开发计划（非代码）
```

- confirmed：代码文件共 5 个（main.js + 3 个 HTML + Info.json）。`iina-typing-practice.iinaplugin/` 是 `plugin-src/` 的打包副本，内容相同。

## 3. 运行环境与入口

- **平台**：macOS（IINA 播放器插件，confirmed：`Info.json` 为 IINA 插件格式）。
- **宿主**：IINA 视频播放器（需支持插件 API 的版本）。
- **入口**：`src/main.js`（`Info.json:9` `"entry": "src/main.js"`）。
- **设置页**：`ui/preferences.html`（`Info.json:10`）。
- **权限**：`show-osd`、`file-system`、`video-overlay`（`Info.json:17`）。
- **技术栈**：纯 JavaScript（插件逻辑）+ HTML/CSS/JS（UI 面板），无构建工具、无第三方依赖。

## 4. 逐文件功能说明

### 4.1 Info.json — 插件元数据

| 字段 | 值 | 说明 |
|---|---|---|
| identifier | `com.aaron.typing-practice` | 插件唯一标识 |
| version | `0.4.0` | 版本号 |
| entry | `src/main.js` | 入口脚本 |
| preferencesPage | `ui/preferences.html` | 设置页 |
| preferenceDefaults | 4 个 A-B 参数 | 默认设置（暂停1s/延长2s/间隔阈值1s/短字幕1.5s） |
| permissions | show-osd, file-system, video-overlay | 所需权限 |

### 4.2 src/main.js — 插件主逻辑

| 模块/函数 | 行号 | 职责 |
|---|---|---|
| `getSettings` | 8-32 | 从 IINA preferences 读取 4 个 A-B 参数，带默认值和容错 |
| `state` | 34-59 | 全局状态对象（字幕列表、当前索引、模式、盲打、输入模式、各定时器、统计数据） |
| `startABLoop` / `stopABLoop` | 62-124 | A-B 循环播放控制（50ms 轮询播放位置，结束前暂停或跳回） |
| `parseTime` / `stripStyleTags` / `stripBOM` / `parseSRT` | 127-186 | SRT 字幕解析（时间码解析、样式标签清除、BOM 去除、去重排序） |
| `loadSubtitles` | 189-247 | 加载字幕：优先同目录 .srt/.ass/.ssa 外挂文件，其次检测内嵌字幕轨道 |
| `findCurrentSubtitleIndex` | 250-263 | 根据播放位置查找当前字幕索引 |
| `enterExternalTyping` / `onExternalTypedCorrect` | 276-345 | 外挂 SRT 模式：进入打字、A-B 循环、完成后播放到下一句 |
| `startEmbeddedFollowMode` / `enterEmbeddedTyping` / `onEmbeddedTypedCorrect` | 348-434 | 内嵌字幕模式：轮询 mpv `sub-text` 属性等待字幕出现、打字、完成后继续等待 |
| `pushToInput` | 450-467 | 双模式通信抽象：根据 inputMode 推送到 overlay 或 standaloneWindow |
| `openOverlayInput` / `closeOverlayInput` | 470-492 | 内嵌面板加载/隐藏 |
| `openInputWindow` | 495-506 | 独立窗口打开（先关后开） |
| `switchToWindowMode` / `switchToOverlayMode` / `toggleInputMode` | 509-536 | 输入模式切换 |
| `startPractice` | 539-574 | 统一入口：打开输入面板→注册处理器→根据字幕来源进入对应模式 |
| `onTypedCorrect` | 576-587 | 打字完成统一分发（外挂/内嵌） |
| `finishPractice` / `skipSentence` / `resetSentence` / `nextSentenceManual` / `prevSentence` | 589-681 | 练习控制：完成、跳过、重置、上一句/下一句 |
| `toggleBlindMode` | 683-698 | 盲打模式切换 |
| `computeAccuracy` | 700-713 | 计算正确率（按字符数减错误数） |
| `closeAllInput` | 715-730 | 关闭所有输入面板和定时器 |
| `menu.addItem` × 7 | 733-739 | 注册 IINA 插件菜单项 |
| `registerInputHandlers` / `registerOverlayHandlers` / `registerWindowHandlers` | 742-797 | 注册输入面板消息处理器（双模式） |
| `echoCurrentSentence` | 800-823 | 面板就绪时回显当前句子 |
| `handleInputAction` | 826-846 | 统一 action 消息分发 |
| `event.on("iina.file-loaded")` / `event.on("mpv.track-list-changed")` | 849-863 | 视频加载时自动加载字幕 |

### 4.3 ui/overlay-input.html — 内嵌输入面板

- 深色半透明面板，固定在视频底部（`overlay-input.html:17-24`）。
- 包含：目标句子显示（逐字符红绿高亮）、输入框、操作按钮（完成/跳过/重置/上一句/下一句/窗口模式/关闭）、完成画面。
- 核心 JS 逻辑（`overlay-input.html:141-383`）：
  - `isComparableChar` / `normalizeForCompare`：标点豁免，比较时忽略大小写和非比较字符（`overlay-input.html:163-175`）
  - `renderTarget`：逐字符渲染，正确绿色/错误红色/待输入灰色/标点跳过色（`overlay-input.html:235-272`）
  - `submitCorrect`：计算错误数（逐位比较+长度差），发送 `typed-correct` 到插件（`overlay-input.html:292-323`）
  - 盲打模式：先隐藏原句，Enter 后展示比对结果，再 Enter 确认继续（`overlay-input.html:293-305`）
  - Fallback 机制：面板加载后每 250ms 请求当前句，最多 8 次（`overlay-input.html:366-380`）

### 4.4 ui/input-window.html — 独立窗口输入面板

- 浅色主题（`#f7f7f7` 背景），逻辑与 overlay-input.html 基本一致（confirmed：结构、函数名、消息通信完全相同）。
- 差异：样式适配独立窗口（白色卡片、更大间距），发送 `window-ready` 而非 `overlay-ready`。

### 4.5 ui/preferences.html — 设置页

- 4 个数值输入框：A-B 循环暂停时间、循环延长秒数、间隔阈值、短字幕保护阈值（`preferences.html:14-40`）。
- 通过 `window.iina.preferences` API 异步读写设置（`preferences.html:53`）。

## 5. 核心函数/类及职责

- **`startABLoop`**（`main.js:62`）：A-B 循环核心。50ms 轮询 `core.status.position`，到达结束阈值时暂停（短字幕或循环空间不足时直接跳回），暂停时长到后 seek 回起点并 resume。阈值计算考虑了 `abPauseDuration` 和 `abShortSubThreshold`（`main.js:70-80`）。
- **`loadSubtitles`**（`main.js:189`）：字幕加载策略。将视频 URL 转本地路径，依次尝试同目录 `.srt`/`.ass`/`.ssa` 文件；无外挂字幕时检查 `core.subtitle.tracks` 启用内嵌跟随模式；均无时 OSD 提示。
- **状态机**（`main.js:37`）：`mode` 字段取值 `IDLE/TYPING/PLAYING/PLAYING_WAITING/DONE`，驱动整个练习流程。外挂模式走 `TYPING→PLAYING→TYPING`，内嵌模式走 `PLAYING_WAITING→TYPING→PLAYING_WAITING`。
- **`pushToInput`**（`main.js:450`）：双模式通信层。根据 `state.inputMode`（overlay/window）将消息推送到对应面板，面板通过 `iina.postMessage` 回传 action。

## 6. 调用链与数据流

```
视频加载 → event.on("iina.file-loaded") → loadSubtitles()
  ├─ 找到外挂SRT → parseSRT() → state.subtitles, source="external"
  └─ 找到内嵌字幕 → source="embedded"

用户菜单"开始打字练习" → startPractice()
  ├─ 打开输入面板（overlay 或 window）
  ├─ registerInputHandlers() → 监听面板消息
  ├─ external: findCurrentSubtitleIndex() → enterExternalTyping(idx)
  │   ├─ seekTo(sub.startTime) + resume
  │   ├─ startABLoop(start, end) → 循环播放
  │   └─ pushToInput("load-sentence") → 面板显示句子
  └─ embedded: startEmbeddedFollowMode() → 轮询 sub-text → enterEmbeddedTyping(text)

用户打字 → 面板 input 事件 → renderTarget() 实时高亮
用户 Enter → submitCorrect() → 计算 errors → iina.postMessage("typed-correct")
  → main.js onTypedCorrect() → stopABLoop() → resume 播放
  → external: positionTimer 等待下一句 startTime → enterExternalTyping(next)
  → embedded: startEmbeddedFollowMode() 等待下一句字幕

练习结束 → finishPractice() → computeAccuracy() → pushToInput("practice-finished")
```

## 7. 配置与参数

- **插件设置**（IINA 偏好设置页，`preferences.html`）：
  - `abPauseDuration`：循环结束前暂停秒数（默认 1.0）
  - `abExtendDuration`：循环延长秒数（默认 2.0）
  - `abGapThreshold`：间隔阈值秒数（默认 1.0）
  - `abShortSubThreshold`：短字幕保护阈值秒数（默认 1.5）
- **运行时状态**：全部在 `state` 对象中管理，无持久化（练习统计仅内存中）。
- **硬编码常量**：
  - A-B 循环轮询间隔 50ms（`main.js:109`）
  - 位置跟踪轮询 100ms（`main.js:324,354`）
  - 面板 fallback 请求间隔 250ms，最多 8 次（`overlay-input.html:367-380`）

## 8. 外部依赖与接口

| 类型 | 具体 | 位置 |
|---|---|---|
| 宿主 API | IINA 插件 API：`core`、`event`、`menu`、`standaloneWindow`、`overlay`、`mpv`、`file`、`console` | `main.js:5` |
| 宿主 API | `iina.postMessage` / `iina.onMessage`（面板与插件通信） | HTML 文件中 |
| 宿主 API | `iina.preferences`（设置读写） | `main.js:17`、`preferences.html:53` |
| 文件读取 | 同目录 .srt/.ass/.ssa 外挂字幕文件 | `main.js:216-233` |
| mpv 属性 | `sub-text`、`sub-start`、`sub-end`（内嵌字幕读取） | `main.js:356,394-395` |

## 9. 运行产物与输出

- **OSD 提示**：练习状态、设置参数、完成正确率等通过 IINA OSD 显示（`core.osd` 多处调用）。
- **控制台日志**：所有关键操作通过 `console.log` 输出到 IINA 插件控制台。
- **无文件输出**：练习统计（正确率、每句错误数）仅在内存中，练习结束后显示在面板上，不保存到文件。
- **无网络请求**：纯本地插件。

## 10. 已知限制与后续修改注意点

1. **外挂字幕仅支持 SRT 格式解析**：虽然尝试读取 `.ass`/`.ssa` 文件，但 `parseSRT` 函数是 SRT 专用解析器（`main.js:145-186`），ASS/SSA 的 `Dialogue:` 格式无法正确解析，会返回空数组（inferred）。
2. **正确率计算按字符数**：`computeAccuracy` 用 `sub.text.length`（含空格和标点）作为总字符数（`main.js:708`），但打字比较时标点被豁免（`overlay-input.html:163-165`），分母和分子口径不一致，可能导致正确率偏低（inferred）。
3. **内嵌模式无总句数和进度**：内嵌字幕实时跟随，无法预知总句数，进度显示为"内嵌字幕模式"（`overlay-input.html:201`），完成统计仅句数无正确率（`main.js:596-597`）。
4. **`startEmbeddedCollector` 为空操作**：`main.js:436-439` 创建了一个 200ms 的空 setInterval，无实际逻辑，疑似遗留代码。
5. **面板切换时可能丢失当前句**：`switchToWindowMode`/`switchToOverlayMode` 重新注册处理器，但依赖面板 ready 后 `echoCurrentSentence` 回显（`main.js:514-515,526-527`），若回显失败面板会显示"准备中..."。
6. **无暂停/恢复练习功能**：菜单无暂停按钮，关闭面板即 `closeAllInput` 重置到 IDLE（`main.js:715-730`），无法中途暂停后继续。
7. **`iina-typing-practice.iinaplugin/` 与 `plugin-src/` 重复**：两份相同代码，修改时需同步或确认以哪份为准（confirmed：文件结构和内容一致）。
8. **盲打模式下内嵌字幕仍可见**：盲打模式仅隐藏插件面板中的目标句（`overlay-input.html:236-239`），但视频画面上的 IINA 字幕可能仍在显示，无法真正盲打（inferred：代码中未关闭 IINA 原生字幕显示）。
