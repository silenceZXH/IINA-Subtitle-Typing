# Changelog

本项目遵循语义化版本：`MAJOR.MINOR.PATCH`。
`Info.json` 里的 `ghVersion`（整数）供 IINA 判断更新，每次发布递增。

## [0.4.0] - 2026-09-08

内嵌输入面板上线，形成「内嵌 / 独立窗口」双输入模式。

### Added

- 视频内嵌输入面板 `ui/overlay-input.html`：深色半透明悬浮层，输入时不用离开播放器窗口
- `inputMode` 状态与 `切换输入模式（内嵌/窗口）` 菜单项，练习中可随时互换面板
- `video-overlay` 权限
- 双面板统一的消息分发 `handleInputAction()` 与句子回显 `echoCurrentSentence()`

### Changed

- `pushToWindow()` 重命名为 `pushToInput()`，作为双模式通信抽象
- 面板打开后会用 `request-current` 主动拉取当前句（250ms × 8 次兜底），避免面板打开时机早于句子推送时显示空白
- 清理 A-B 循环与内嵌跟随模式中的冗余注释

## [0.3.4] - 2026-08-21

### Added

- 内嵌软字幕实时跟随模式：轮询 mpv `sub-text`，字幕出现即进入打字
- 独立窗口输入面板 `ui/input-window.html`
- 设置页 `ui/preferences.html`：四项 A-B 循环参数
- 盲打模式（隐藏原句 → 提交后展示红绿结果）
- 正确率与修正次数统计

### Changed

- A-B 循环改为可配置：暂停时长、尾部延长、间隔阈值、短字幕保护

## [0.1.0]

- 初版：外挂 SRT 解析、逐句 A-B 循环、逐字符红绿比对、打对自动放行
