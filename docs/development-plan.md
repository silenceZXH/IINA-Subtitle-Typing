# IINA 字幕打字插件 - 实际开发计划

## 一、技术调研结论（与原 PRD 的关键差异）

### ✅ 可直接落地的 IINA API
| PRD 需求 | IINA API | 说明 |
|---|---|---|
| 视频暂停/播放 | `core.pause()` / `core.resume()` | 原生支持 |
| 跳转时间点 | `core.seekTo(seconds)` | 用于"播完本句切下一句" |
| 当前播放位置 | `core.status.position` | 用于判断"本句播完" |
| 字幕轨道列表 | `core.subtitle.tracks` / `core.subtitle.id` | 可读取所有轨道并切换 |
| 加载外挂 SRT | `core.subtitle.loadTrack(url)` | 可主动加载 |
| 独立输入窗口 | `standaloneWindow.loadFile()` + `postMessage/onMessage` | 原生支持 |
| Overlay 叠加层 | `overlay.loadFile()` + `setClickable(true)` | 用于视频顶部彩色字幕 UI |
| 菜单/快捷键 | `menu.addItem(menu.item(title, fn, {keyBinding}))` | 用于"开始练习/盲打/重置" |
| 文件读取 | `iina.file` | 读取外挂 SRT 文件内容 |
| 偏好设置 | `iina.preferences` | 忽略大小写等开关 |
| mpv 属性 | `mpv.getProperty("sub-text"/"sub-start"/"sub-end")` | 内嵌字幕文本获取 |

### ⚠️ 需要调整的 PRD 假设

1. **字幕文本获取策略** — IINA 的 `SubtitleAPI` 只能管理轨道（增/删/切换），**不返回字幕文本内容**。文本获取分两条路：
   - **外挂 SRT/SSA**：通过 `iina.file` 直接读文件 + 自行解析（一次性拿到全量时间轴）
   - **内嵌软字幕**：mpv 只能通过 `sub-text` 在播放时拿"当前这一条"文本，**无法提前拿到整张时间轴表**
   - → **方案**：双轨并行
     - 优先尝试同目录外挂 SRT（覆盖 90% 场景，体验最佳）
     - 若无外挂文件，启动「内嵌字幕渐进收集模式」：后台轮询 `sub-text` + `sub-start` + `sub-end`，遇到新条目就缓存到 `state.subtitles`。已缓存的字幕可正常打字练习；尚未扫到的部分，用户打到视频当前位置时即时收集即时练习

2. **Overlay 输入框限制**（已知 IINA 1.4.4 bug，GitHub Issue #6183）：
   - `overlay.simpleMode()` 里**不能插入 `<script>` 标签**，只能用 `onclick="iina.postMessage()"`
   - `overlay.loadFile()` 在 Reload 插件时有崩溃风险
   - → **决策**：Overlay 只用于"显示彩色字幕 + 统计"，输入框放在 `standaloneWindow` 里（独立窗口，原生 `<input>`，无限制）。这正好对应 PRD 第七章架构。

3. **用户技术栈提醒**：profile 偏好 Python/PyQt5，但 IINA 插件**只能用 JavaScript**，开发语言需切换。

---

## 二、项目目录结构

```
IINA_learn-english-tool/
├── IINA字幕打字插件 - 产品需求计划书（最终版）.md   # 已存在
├── 开发计划.md                                     # 本文件
├── iina-typing-practice.iinaplugin/                # 插件主包
│   ├── Info.json                                   # 插件清单
│   ├── src/
│   │   ├── main.js                                 # 主入口（核心逻辑）
│   │   ├── subtitle-parser.js                      # SRT/SSA 解析模块
│   │   ├── embedded-collector.js                   # 内嵌字幕轮询收集器
│   │   └── state.js                                # 状态机与全局状态
│   ├── ui/
│   │   ├── input-window.html                       # 独立输入窗口
│   │   ├── input-window.js                         # 输入窗口逻辑
│   │   ├── input-window.css
│   │   ├── overlay.html                            # 视频顶部叠加层
│   │   ├── overlay.js
│   │   └── overlay.css
│   └── icons/
│       ├── 24x24.png
│       └── 48x48.png
```

---

## 三、开发阶段拆分

### 🟢 阶段 0：脚手架与冒烟测试（先验证 API 通路）

**目标**：跑通"插件能加载、能暂停视频、能弹独立窗口"的最小闭环，确认技术路线无坑。

**任务**：
1. 手动创建插件骨架（`Info.json` + `main.js` + `ui/input-window.html`），声明 `video-overlay` + `file-system` 权限
2. `main.js` 注册菜单项「开始打字练习」，点击后：
   - `core.pause()` 暂停视频
   - `standaloneWindow.open()` + `loadFile("ui/input-window.html")` 弹窗
   - 窗口里显示一个 `<input>` + "Hello" 占位
3. 验证 `postMessage` 双向通信：窗口里点按钮 → `main.js` 收到 → `core.resume()`

**验收**：能在 IINA 里点菜单 → 弹窗 → 输入框可打字 → 关窗后视频恢复。

---

### 🟢 阶段 1：MVP 核心（PRD 第一阶段，必做）

**目标**：完成"加载字幕 → 逐句打字 → 对错 → 自动播放下一句"闭环，**同时支持外挂 SRT 与内嵌软字幕**。

#### 1.1 字幕解析模块 [subtitle-parser.js]
- 输入：SRT 文件文本（UTF-8，兼容 BOM）
- 输出：`[{index, startTime, endTime, text}]`（startTime/endTime 为秒数）
- 过滤：空行、时间轴异常、重复行
- 边界：兼容 `\r\n` / `\n` / `\r`
- SSA/ASS：用正则 strip 掉所有 `{\.*?}` 样式标签，仅保留纯文本

#### 1.2 字幕加载流程 [main.js + embedded-collector.js]
- 监听 `event.on("iina.file-loaded", ...)`：视频加载后
- **优先策略**：读取 `core.status.url` 拿视频路径 → 同目录找同名 `.srt`/`.ass`
  - 找到：用 `iina.file` 读取 → `subtitle-parser.js` 解析 → 存入 `state.subtitles`
  - 找不到：启动内嵌字幕收集模式
- **内嵌字幕收集模式** [embedded-collector.js]：
  - 检测 `core.subtitle.tracks`，若存在内嵌轨道，自动选定第一条（或用户当前选定的）
  - 启动定时器（200ms 间隔）轮询 `mpv.getProperty("sub-text")` / `sub-start` / `sub-end`
  - 若 `sub-text` 非空且与上一条不同 → 推入 `state.subtitles` 缓存（去重 by start time）
  - 用户开始练习时：若 `state.subtitles` 已有条目，按时间排序后逐句练习
  - 尚未扫到的部分：当前句练习完 → 视频自动播放收集下一条 → 进入下一条练习
- 切换字幕轨道时（`event.on("mpv.track-list-changed")`）清空缓存重新收集

#### 1.3 状态机 [state.js]
四个状态：`IDLE` → `TYPING`（暂停等用户输入）→ `PLAYING`（本句播放中）→ `DONE`
```
IDLE --[开始练习]--> TYPING(currentIndex=0, core.pause, core.seekTo(sub.start))
TYPING --[输入完整正确]--> PLAYING(core.resume, 注册 position 监听)
PLAYING --[position >= sub.end]--> TYPING(currentIndex++, core.pause, seekTo(nextSub.start))
PLAYING --[position >= duration]--> DONE
```
**内嵌模式特殊处理**：若 `currentIndex+1` 超出已缓存范围，PLAYING 状态保持，等收集器推入新条目后再切 TYPING。

#### 1.4 输入窗口 UI [input-window.html + js]
- 显示：目标句（彩色 spans）+ 一个 `<input>` + 进度「3/120」
- 监听 `input` 事件：逐字符比对，更新 span 颜色（绿/红/灰）
- 完全正确时：`iina.postMessage("typed-correct", {index})`
- 按钮：跳过本行、重置本行
- 通信协议（plugin ↔ window）：
  - `plugin → window`：`load-sentence`（推送 `{index, text, total, blindMode}`）
  - `window → plugin`：`typed-correct`、`skip`、`reset`、`next`、`prev`

#### 1.5 Overlay 显示 [overlay.html + js]
- `overlay.loadFile("ui/overlay.html")` 加载完整 HTML（避开 simpleMode 的 script 限制）
- 顶部悬浮显示当前句的彩色校对副本（同步输入窗口状态）
- 显示：`正确率 95% | 第 3/120 句 | 盲打: 关`
- 监听 `plugin → overlay` 的 `update-stats` 消息刷新

**阶段 1 验收**：
- 外挂 SRT 场景：打开带 SRT 的视频 → 点"开始练习" → 视频暂停在第 1 句 → 打字变色 → 打对自动播放 → 播完自动停在第 2 句
- 内嵌字幕场景：打开带内嵌软字幕的 mkv → 点"开始练习" → 视频播放收集第 1 句 → 暂停 → 打字 → 打对播放收集第 2 句 → 循环
- 手动能跳过/重置

---

### 🟡 阶段 2：增强功能（PRD 第二阶段）

#### 2.1 盲打模式
- 菜单项「盲打模式」开关（`menu.item` + `selected` 状态）
- 开启时：`load-sentence` 消息里 `blindMode=true`，输入窗口**不渲染目标句**，只显示一个 `<input>` 和"凭记忆打完本句"
- 提交后（按 Enter 或点"提交比对"按钮）→ 一次性比对 → 显示红绿结果 → 1.5s 后进入下一句

#### 2.2 统计模块 [main.js]
- 每句记录：`{index, errors, corrections, timeSpentMs}`
- 每次输入错误字符 → `errors++`；每次退格 → `corrections++`
- 单句正确率 = `(text.length - errors) / text.length`
- 整体进度 = `currentIndex / total`
- 通过 `update-stats` 消息推送给 overlay

#### 2.3 设置项 [iina.preferences + preferencesPage]
- HTML 偏好页（`preferencesPage` 字段指向）
- 配置项：
  - `ignoreCase`（忽略大小写）
  - `ignoreLeadingTrailingSpace`（忽略首尾空格）
  - `defaultBlindMode`（默认盲打）
- 输入窗口同步读取这些开关的实时状态

#### 2.4 字幕语种切换
- 菜单「字幕轨道」子菜单：遍历 `core.subtitle.tracks` 动态生成
- 点击切换 `core.subtitle.id` → 重新解析（外挂重新读文件；内嵌清空缓存重新收集）

---

### 🟠 阶段 3：可选优化（PRD 第三阶段）

- 自定义字体大小/颜色（preferencesPage 扩展）
- 练习进度本地保存（`iina.file` 写数据文件，按视频路径哈希索引）
- 快捷键：`menu.item(..., {keyBinding: "Ctrl+Shift+T"})` 等

---

## 四、关键技术风险与预案

| 风险 | 影响 | 预案 |
|---|---|---|
| Overlay `loadFile` 在 IINA 1.4.4 有崩溃 bug | 高 | 输入框不放 Overlay，只用 standaloneWindow；Overlay 仅做展示，且仅在用户开启练习时才 `loadFile` 一次 |
| 内嵌软字幕无法预读全文 | 中 | 采用「渐进收集模式」：播放中轮询 `sub-text`，已收集即可练习，未收集部分播放到时再练 |
| SRT 时间轴与 mpv 实际播放位置有微秒级偏差 | 低 | "播完本句"判断用 `position >= sub.end - 0.1` 容差 |
| SSA/ASS 字幕的 `{\...}` 样式标签干扰打字 | 中 | 解析时用正则 strip 掉所有 `{\.*?}` |
| 用户视频与 SRT 不同名 | 低 | 提供 `utils.prompt()` 手动输入路径 |
| 内嵌字幕轮询的 `sub-text` 可能为空（如片头无字幕段） | 低 | 收集器对空文本静默跳过，不污染缓存 |

---

## 五、当前执行状态

- [x] 阶段 0.1：脚手架创建
- [ ] 阶段 0.2：冒烟测试
- [ ] 阶段 1.1：SRT 解析模块
- [ ] 阶段 1.2：字幕加载流程
- [ ] 阶段 1.3：状态机
- [ ] 阶段 1.4：输入窗口 UI
- [ ] 阶段 1.5：Overlay 显示
