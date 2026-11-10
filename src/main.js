/**
 * IINA 字幕打字练习插件 - 主入口（v8：Overlay 内嵌输入 + 独立窗口双模式）
 */

const { core, event, menu, standaloneWindow, overlay, mpv, file, console } = iina;

// ============ 设置读取 ============
function getSettings() {
  const defaults = {
    abPauseDuration: 1.0,
    abExtendDuration: 2.0,
    abGapThreshold: 1.0,
    abShortSubThreshold: 1.5,
  };
  function getNum(key, def) {
    try {
      const v = iina.preferences.get(key);
      if (v == null) return def;
      const n = parseFloat(v);
      return isNaN(n) ? def : n;
    } catch (e) {
      console.log("[typing-practice] 读取设置失败:", key, e);
      return def;
    }
  }
  return {
    abPauseDuration: getNum("abPauseDuration", defaults.abPauseDuration),
    abExtendDuration: getNum("abExtendDuration", defaults.abExtendDuration),
    abGapThreshold: getNum("abGapThreshold", defaults.abGapThreshold),
    abShortSubThreshold: getNum("abShortSubThreshold", defaults.abShortSubThreshold),
  };
}

const state = {
  subtitles: [],
  currentIndex: -1,
  mode: "IDLE", // IDLE, TYPING, PLAYING, PLAYING_WAITING, DONE
  source: null, // null, "external", "embedded"
  blindMode: false,
  inputMode: "overlay", // "overlay" 内嵌视频画面 | "window" 独立窗口
  overlayReady: false,
  positionTimer: null,
  embeddedTimer: null,
  embeddedWaitTimer: null,
  abLoopTimer: null,
  abStartTime: null,
  abEndTime: null,
  abPaused: false,
  abPauseAt: 0,
  abShouldPause: false,
  abPauseDurationMs: 1000,
  abThreshold: null,
  lastSubKey: null,
  lastSubText: "",
  currentSubText: "",
  stats: { perSentence: [], embeddedErrors: 0, embeddedCorrections: 0, embeddedCount: 0 },
  sentenceStartTime: 0,
  handlersRegistered: false,
};

// ============ A-B 循环（字幕段循环播放，结束前暂停） ============
function startABLoop(startTime, endTime) {
  const s = getSettings();
  state.abStartTime = startTime;
  state.abEndTime = endTime;
  state.abPaused = false;
  state.abPauseAt = 0;

  const loopDuration = endTime - startTime;
  const enoughRoom = s.abPauseDuration < (loopDuration - 0.3);
  state.abShouldPause = loopDuration > s.abShortSubThreshold && enoughRoom;
  state.abPauseDurationMs = s.abPauseDuration * 1000;

  let threshold;
  if (state.abShouldPause) {
    threshold = Math.max(startTime + 0.3, endTime - s.abPauseDuration);
  } else {
    threshold = endTime - 0.05;
  }
  state.abThreshold = threshold;

  if (state.abLoopTimer) clearInterval(state.abLoopTimer);
  state.abLoopTimer = setInterval(() => {
    try {
      const pos = core.status.position;
      const now = Date.now();

      if (state.abPaused) {
        if (now - state.abPauseAt >= state.abPauseDurationMs) {
          core.seekTo(state.abStartTime);
          core.resume();
          state.abPaused = false;
          state.abPauseAt = 0;
        }
      } else {
        if (state.abEndTime != null && pos >= state.abThreshold) {
          if (state.abShouldPause) {
            core.pause();
            state.abPaused = true;
            state.abPauseAt = now;
          } else {
            core.seekTo(state.abStartTime);
          }
        }
      }
    } catch (e) {
      console.log("[typing-practice] A-B 循环错误:", e);
    }
  }, 50);
}

function stopABLoop() {
  if (state.abLoopTimer) {
    clearInterval(state.abLoopTimer);
    state.abLoopTimer = null;
  }
  state.abStartTime = null;
  state.abEndTime = null;
  state.abPaused = false;
  state.abPauseAt = 0;
  state.abShouldPause = false;
  state.abPauseDurationMs = 1000;
  state.abThreshold = null;
}

// ============ SRT 解析 ============
function parseTime(t) {
  if (!t) return NaN;
  const s = t.trim().replace(",", ".");
  const parts = s.split(":").map(parseFloat);
  if (parts.some(isNaN)) return NaN;
  let secs = 0;
  for (const p of parts) secs = secs * 60 + p;
  return secs;
}

function stripStyleTags(line) {
  return line.replace(/\{[^}]*\}/g, "");
}

function stripBOM(s) {
  return s && s.charCodeAt(0) === 0xfeff ? s.slice(1) : s;
}

function parseSRT(raw) {
  const text = stripBOM(raw || "");
  if (!text.trim()) return [];
  const normalized = text.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  const blocks = normalized.split(/\n\s*\n/);
  const result = [];
  const seen = new Set();
  for (const block of blocks) {
    const lines = block.split("\n").filter((l) => l.length > 0);
    if (lines.length < 2) continue;
    let timeIdx = -1;
    for (let i = 0; i < Math.min(2, lines.length); i++) {
      if (lines[i].indexOf("-->") !== -1) {
        timeIdx = i;
        break;
      }
    }
    if (timeIdx === -1) continue;
    const m = lines[timeIdx].match(
      /(\d{1,2}:\d{2}:\d{2}[,.]\d{1,3}|\d{1,2}:\d{2}[,.]\d{1,3})\s*-->\s*(\d{1,2}:\d{2}:\d{2}[,.]\d{1,3}|\d{1,2}:\d{2}[,.]\d{1,3})/
    );
    if (!m) continue;
    const startTime = parseTime(m[1]);
    const endTime = parseTime(m[2]);
    if (isNaN(startTime) || isNaN(endTime) || endTime < startTime) continue;
    const fullText = lines
      .slice(timeIdx + 1)
      .map(stripStyleTags)
      .map((l) => l.trim())
      .join(" ")
      .replace(/\s+/g, " ")
      .trim();
    if (!fullText) continue;
    const key = `${startTime}|${endTime}|${fullText}`;
    if (seen.has(key)) continue;
    seen.add(key);
    result.push({ index: result.length, startTime, endTime, text: fullText });
  }
  result.sort((a, b) => a.startTime - b.startTime);
  result.forEach((item, i) => (item.index = i));
  return result;
}

// ============ 字幕加载 ============
async function loadSubtitles() {
  state.subtitles = [];
  state.currentIndex = -1;
  state.mode = "IDLE";
  state.source = null;
  state.lastSubKey = null;
  state.lastSubText = "";
  stopEmbeddedCollector();
  stopEmbeddedFollowMode();
  stopABLoop();

  const url = core.status.url;
  console.log(`[typing-practice] loadSubtitles, url=${url}`);
  if (url) {
    let videoPath = url;
    try {
      if (url.startsWith("file://")) {
        const u = new URL(url);
        videoPath = decodeURIComponent(u.pathname);
      }
    } catch (e) {
      try {
        videoPath = decodeURIComponent(url.replace(/^file:\/\//, "").replace(/^localhost?\//, "/"));
      } catch (e2) {}
    }
    console.log(`[typing-practice] videoPath=${videoPath}`);

    for (const ext of [".srt", ".ass", ".ssa"]) {
      const srtPath = videoPath.replace(/\.[^.]+$/, ext);
      try {
        const content = await file.read(srtPath);
        if (content) {
          const subs = parseSRT(content);
          if (subs.length > 0) {
            state.subtitles = subs;
            state.source = "external";
            core.osd(`已加载外挂字幕 ${subs.length} 条`);
            console.log(`[typing-practice] 加载外挂字幕: ${srtPath} (${subs.length} 条)`);
            return;
          }
        }
      } catch (e) {
        console.log(`[typing-practice] 读取 ${srtPath} 失败:`, e);
      }
    }
  }

  // 无外挂 SRT，检查内嵌字幕
  const tracks = core.subtitle.tracks;
  if (tracks && tracks.length > 0) {
    state.source = "embedded";
    core.osd("检测到内嵌字幕，实时跟随模式");
    console.log("[typing-practice] 启用内嵌实时跟随模式");
    return;
  }

  core.osd("未找到字幕，请放 .srt 到视频同目录");
  console.log("[typing-practice] 未找到字幕");
}

// ============ 外挂 SRT 模式 ============
function findCurrentSubtitleIndex() {
  const pos = core.status.position;
  if (pos == null || state.subtitles.length === 0) return 0;
  for (let i = 0; i < state.subtitles.length; i++) {
    const s = state.subtitles[i];
    if (s.startTime <= pos && (s.endTime == null || s.endTime > pos)) {
      return i;
    }
  }
  for (let i = 0; i < state.subtitles.length; i++) {
    if (state.subtitles[i].startTime > pos) return i;
  }
  return state.subtitles.length - 1;
}

function pushCurrentSentence() {
  if (state.currentIndex < 0 || !state.subtitles[state.currentIndex]) return false;
  const sub = state.subtitles[state.currentIndex];
  return pushToInput("load-sentence", {
    index: state.currentIndex,
    text: sub.text,
    total: state.subtitles.length,
    blindMode: state.blindMode,
  });
}

function enterExternalTyping(index) {
  if (index < 0 || index >= state.subtitles.length) {
    finishPractice();
    return;
  }
  state.currentIndex = index;
  state.mode = "TYPING";
  state.sentenceStartTime = Date.now();
  state.stats.perSentence[index] = { errors: 0, corrections: 0, timeSpentMs: 0 };

  const sub = state.subtitles[index];
  if (sub.startTime != null) core.seekTo(sub.startTime);
  core.resume();

  const s = getSettings();
  let loopEnd = sub.endTime;
  if (sub.startTime != null && sub.endTime != null && sub.endTime > sub.startTime) {
    if (index + 1 < state.subtitles.length) {
      const nextSub = state.subtitles[index + 1];
      const gap = nextSub.startTime - sub.endTime;
      if (gap > s.abGapThreshold) {
        loopEnd = Math.min(sub.endTime + s.abExtendDuration, nextSub.startTime - 0.3);
      }
    } else {
      loopEnd = sub.endTime + s.abExtendDuration;
    }
    startABLoop(sub.startTime, loopEnd);
  }

  pushCurrentSentence();
  core.osd(`第 ${index + 1}/${state.subtitles.length} 句 (A-B 循环)`);
  console.log(`[typing-practice] TYPING(external): 第 ${index + 1}/${state.subtitles.length} 句, A-B [${sub.startTime}-${loopEnd}]`);
}

function onExternalTypedCorrect(data) {
  const idx = state.currentIndex;
  const d = data || {};
  if (d.errors != null) state.stats.perSentence[idx].errors = d.errors;
  if (d.corrections != null) state.stats.perSentence[idx].corrections = d.corrections;
  state.stats.perSentence[idx].timeSpentMs = Date.now() - state.sentenceStartTime;

  stopABLoop();

  state.mode = "PLAYING";
  core.resume();
  core.osd(`第 ${idx + 1} 句完成 ✓ 继续播放至下一句...`);

  if (state.positionTimer) clearInterval(state.positionTimer);
  state.positionTimer = setInterval(() => {
    const pos = core.status.position;
    const duration = core.status.duration;
    const nextIdx = idx + 1;

    if (nextIdx < state.subtitles.length) {
      const nextSub = state.subtitles[nextIdx];
      if (nextSub.startTime != null && pos >= nextSub.startTime - 0.1) {
        clearInterval(state.positionTimer);
        state.positionTimer = null;
        core.pause();
        enterExternalTyping(nextIdx);
      }
    } else {
      if (duration != null && pos >= duration - 0.05) {
        clearInterval(state.positionTimer);
        state.positionTimer = null;
        finishPractice();
      }
    }
  }, 100);
}

// ============ 内嵌字幕实时跟随模式 ============
function startEmbeddedFollowMode() {
  state.mode = "PLAYING_WAITING";
  core.resume();
  core.osd("[内嵌] 播放中，等待下一句字幕出现...");

  if (state.embeddedWaitTimer) clearInterval(state.embeddedWaitTimer);
  state.embeddedWaitTimer = setInterval(() => {
    try {
      const text = mpv.getString("sub-text");
      const trimmed = text ? text.trim() : "";
      const pos = core.status.position;
      const duration = core.status.duration;

      if (duration != null && pos >= duration - 0.05) {
        stopEmbeddedFollowMode();
        finishPractice();
        return;
      }

      if (trimmed && !state.lastSubText) {
        state.lastSubText = trimmed;
        stopEmbeddedFollowMode();
        enterEmbeddedTyping(trimmed);
      } else if (!trimmed && state.lastSubText) {
        state.lastSubText = "";
      }
    } catch (e) {
      console.log("[typing-practice] embedded follow error:", e);
    }
  }, 100);
}

function stopEmbeddedFollowMode() {
  if (state.embeddedWaitTimer) {
    clearInterval(state.embeddedWaitTimer);
    state.embeddedWaitTimer = null;
  }
}

function enterEmbeddedTyping(text) {
  state.mode = "TYPING";
  state.currentSubText = text;
  state.sentenceStartTime = Date.now();

  let subStart = null, subEnd = null;
  try {
    subStart = mpv.getNumber("sub-start");
    subEnd = mpv.getNumber("sub-end");
  } catch (e) {
    console.log("[typing-practice] 获取 sub-start/sub-end 失败:", e);
  }

  if (subStart != null && subStart >= 0) {
    core.seekTo(subStart);
  }
  core.resume();
  if (subStart != null && subEnd != null && subEnd > subStart) {
    const s = getSettings();
    const loopEnd = subEnd + s.abExtendDuration;
    startABLoop(subStart, loopEnd);
    core.osd("[内嵌] 字幕出现，A-B 循环播放");
  } else {
    core.osd("[内嵌] 字幕出现（无时间范围，不循环）");
  }

  pushToInput("load-sentence", {
    index: -1,
    text: text,
    total: -1,
    blindMode: state.blindMode,
  });
  console.log(`[typing-practice] TYPING(embedded): ${text.slice(0, 30)}..., A-B 循环 [${subStart}-${subEnd}]`);
}

function onEmbeddedTypedCorrect(data) {
  const d = data || {};
  state.stats.embeddedErrors += (d.errors || 0);
  state.stats.embeddedCorrections += (d.corrections || 0);
  state.stats.embeddedCount += 1;

  stopABLoop();

  state.mode = "PLAYING_WAITING";
  core.resume();
  core.osd("本句完成 ✓ 继续播放，等待下一句...");
  startEmbeddedFollowMode();
}

function startEmbeddedCollector() {
  if (state.embeddedTimer) return;
  state.embeddedTimer = setInterval(() => {}, 200);
}

function stopEmbeddedCollector() {
  if (state.embeddedTimer) {
    clearInterval(state.embeddedTimer);
    state.embeddedTimer = null;
  }
}

// ============ 双模式通信抽象 ============
// 根据当前 inputMode 推送到 overlay 或 standaloneWindow
function pushToInput(name, data) {
  try {
    if (state.inputMode === "overlay") {
      if (!state.overlayReady) {
        console.log(`[typing-practice] pushToInput(${name}) 跳过：overlay 尚未 ready`);
        return false;
      }
      overlay.postMessage(name, data);
    } else {
      standaloneWindow.postMessage(name, data);
    }
    console.log(`[typing-practice] pushToInput(${name}) 已发送 (mode=${state.inputMode})`);
    return true;
  } catch (e) {
    console.log("[typing-practice] 推送输入面板消息失败:", e);
    return false;
  }
}

// ============ Overlay 内嵌输入模式 ============
function openOverlayInput() {
  try {
    state.overlayReady = false;
    overlay.loadFile("ui/overlay-input.html");
    overlay.setClickable(true);
    overlay.show();
    console.log("[typing-practice] openOverlayInput 已调用");
  } catch (e) {
    console.log("[typing-practice] openOverlayInput 错误:", e);
    core.osd(`打开内嵌输入面板失败: ${e}`);
  }
}

function closeOverlayInput() {
  try {
    overlay.setClickable(false);
    overlay.hide();
    state.overlayReady = false;
    console.log("[typing-practice] closeOverlayInput 已调用");
  } catch (e) {
    console.log("[typing-practice] closeOverlayInput 错误:", e);
  }
}

// ============ 独立窗口模式 ============
function openInputWindow() {
  try {
    try { standaloneWindow.close(); } catch (e) {}
    standaloneWindow.loadFile("ui/input-window.html");
    standaloneWindow.setProperty({ title: "字幕打字练习", resizable: true });
    standaloneWindow.open();
    console.log("[typing-practice] openInputWindow 已调用（先关后开）");
  } catch (e) {
    console.log("[typing-practice] openInputWindow 错误:", e);
    core.osd(`openInputWindow 错误: ${e}`);
  }
}

// ============ 模式切换 ============
function switchToWindowMode() {
  if (state.inputMode === "window") return;
  console.log("[typing-practice] 切换到独立窗口模式");
  state.inputMode = "window";
  closeOverlayInput();
  openInputWindow();
  registerInputHandlers();
  core.osd("已切换到独立窗口模式");
  // 窗口 ready 后会自动回显当前句
}

function switchToOverlayMode() {
  if (state.inputMode === "overlay") return;
  console.log("[typing-practice] 切换到内嵌模式");
  state.inputMode = "overlay";
  try { standaloneWindow.close(); } catch (e) {}
  openOverlayInput();
  registerInputHandlers();
  core.osd("已切换到视频内嵌模式");
}

function toggleInputMode() {
  if (state.inputMode === "overlay") {
    switchToWindowMode();
  } else {
    switchToOverlayMode();
  }
}

// ============ 统一入口 ============
function startPractice() {
  console.log(`[typing-practice] startPractice, source=${state.source}, subs=${state.subtitles.length}, mode=${state.mode}, inputMode=${state.inputMode}`);
  const s = getSettings();
  console.log("[typing-practice] 当前设置:", JSON.stringify(s));
  core.osd(`[设置] 暂停${s.abPauseDuration}s 延长${s.abExtendDuration}s 间隔${s.abGapThreshold}s 短字幕${s.abShortSubThreshold}s`);
  core.osd(`[1] startPractice (source=${state.source}, input=${state.inputMode})`);

  try {
    // 打开输入面板
    if (state.inputMode === "overlay") {
      openOverlayInput();
    } else {
      openInputWindow();
    }
    registerInputHandlers();

    if (state.source === "embedded") {
      core.osd("[2] 内嵌模式，开始播放等待字幕");
      startEmbeddedFollowMode();
      return;
    }

    if (state.subtitles.length === 0) {
      core.osd("无字幕可用，请确保视频同目录有 .srt 文件或带内嵌软字幕");
      return;
    }

    // 外挂 SRT 模式
    const startIdx = findCurrentSubtitleIndex();
    core.osd(`[2] 外挂模式，从第 ${startIdx + 1} 句开始`);
    enterExternalTyping(startIdx);
  } catch (e) {
    console.log("[typing-practice] startPractice 错误:", e);
    core.osd(`startPractice 错误: ${e}`);
  }
}

function onTypedCorrect(data) {
  if (state.mode !== "TYPING") {
    console.log(`[typing-practice] onTypedCorrect ignored, mode=${state.mode}`);
    return;
  }
  console.log(`[typing-practice] onTypedCorrect, source=${state.source}`);
  if (state.source === "embedded") {
    onEmbeddedTypedCorrect(data);
  } else {
    onExternalTypedCorrect(data);
  }
}

function finishPractice() {
  state.mode = "DONE";
  if (state.positionTimer) { clearInterval(state.positionTimer); state.positionTimer = null; }
  stopEmbeddedFollowMode();
  stopABLoop();

  if (state.source === "embedded") {
    pushToInput("practice-finished", { accuracy: 1, total: state.stats.embeddedCount, embedded: true });
    core.osd(`练习完成！共打 ${state.stats.embeddedCount} 句`);
  } else {
    pushToInput("practice-finished", { accuracy: computeAccuracy(), total: state.subtitles.length });
    const acc = Math.round(computeAccuracy() * 100);
    core.osd(`练习完成！正确率 ${acc}%`);
  }
}

function skipSentence() {
  console.log(`[typing-practice] skipSentence, mode=${state.mode}, source=${state.source}`);
  if (state.mode !== "TYPING" && state.mode !== "PLAYING" && state.mode !== "PLAYING_WAITING") {
    core.osd("当前不在练习中");
    return;
  }
  if (state.positionTimer) { clearInterval(state.positionTimer); state.positionTimer = null; }
  stopEmbeddedFollowMode();
  stopABLoop();

  if (state.source === "embedded") {
    state.mode = "PLAYING_WAITING";
    core.resume();
    core.osd("跳过本句，继续播放...");
    startEmbeddedFollowMode();
    return;
  }
  if (state.currentIndex + 1 >= state.subtitles.length) {
    finishPractice();
  } else {
    enterExternalTyping(state.currentIndex + 1);
  }
}

function resetSentence() {
  console.log(`[typing-practice] resetSentence, mode=${state.mode}`);
  if (state.mode !== "TYPING") {
    core.osd("仅可在打字状态重置");
    return;
  }
  state.sentenceStartTime = Date.now();

  if (state.source === "embedded") {
    pushToInput("load-sentence", {
      index: -1,
      text: state.currentSubText,
      total: -1,
      blindMode: state.blindMode,
    });
    return;
  }
  if (state.currentIndex < 0) return;
  state.stats.perSentence[state.currentIndex] = { errors: 0, corrections: 0, timeSpentMs: 0 };
  pushCurrentSentence();
}

function nextSentenceManual() {
  console.log(`[typing-practice] nextSentenceManual, mode=${state.mode}, idx=${state.currentIndex}`);
  if (state.source === "embedded") {
    core.osd("内嵌模式不支持下一句，请用「跳过本行」跳过当前句");
    return;
  }
  if (state.currentIndex < 0) {
    core.osd("尚未开始练习");
    return;
  }
  if (state.positionTimer) { clearInterval(state.positionTimer); state.positionTimer = null; }
  if (state.currentIndex + 1 >= state.subtitles.length) {
    finishPractice();
  } else {
    enterExternalTyping(state.currentIndex + 1);
  }
}

function prevSentence() {
  console.log(`[typing-practice] prevSentence, mode=${state.mode}, idx=${state.currentIndex}`);
  if (state.source === "embedded") {
    core.osd("内嵌模式不支持上一句，请用进度条拖动");
    return;
  }
  if (state.currentIndex <= 0) {
    core.osd("已是第一句");
    return;
  }
  if (state.positionTimer) { clearInterval(state.positionTimer); state.positionTimer = null; }
  enterExternalTyping(state.currentIndex - 1);
}

function toggleBlindMode() {
  state.blindMode = !state.blindMode;
  core.osd(`盲打模式: ${state.blindMode ? "开" : "关"}`);
  if (state.mode === "TYPING") {
    if (state.source === "embedded") {
      pushToInput("load-sentence", {
        index: -1,
        text: state.currentSubText,
        total: -1,
        blindMode: state.blindMode,
      });
    } else if (state.currentIndex >= 0) {
      pushCurrentSentence();
    }
  }
}

function computeAccuracy() {
  let totalChars = 0;
  let totalErrors = 0;
  for (let i = 0; i < state.stats.perSentence.length; i++) {
    const s = state.stats.perSentence[i];
    if (!s) continue;
    const sub = state.subtitles[i];
    if (!sub) continue;
    totalChars += sub.text.length;
    totalErrors += s.errors;
  }
  if (totalChars === 0) return 1;
  return Math.max(0, (totalChars - totalErrors) / totalChars);
}

function closeAllInput() {
  if (state.positionTimer) { clearInterval(state.positionTimer); state.positionTimer = null; }
  stopEmbeddedFollowMode();
  stopABLoop();
  state.mode = "IDLE";
  state.currentIndex = -1;
  core.resume();

  if (state.inputMode === "overlay") {
    closeOverlayInput();
  } else {
    try { standaloneWindow.close(); } catch (e) {
      console.log("[typing-practice] 关闭窗口失败:", e);
    }
  }
}

// ============ 菜单注册 ============
menu.addItem(menu.item("开始打字练习", () => startPractice()));
menu.addItem(menu.item("切换输入模式（内嵌/窗口）", () => toggleInputMode()));
menu.addItem(menu.item("上一句", () => prevSentence()));
menu.addItem(menu.item("下一句", () => nextSentenceManual()));
menu.addItem(menu.item("跳过本行", () => skipSentence()));
menu.addItem(menu.item("重置本行", () => resetSentence()));
menu.addItem(menu.item("切换盲打模式", () => toggleBlindMode()));

// ============ 输入面板消息处理（双模式统一注册） ============
function registerInputHandlers() {
  state.handlersRegistered = false;
  try {
    if (state.inputMode === "overlay") {
      registerOverlayHandlers();
    } else {
      registerWindowHandlers();
    }
    state.handlersRegistered = true;
    console.log(`[typing-practice] registerInputHandlers 成功 (mode=${state.inputMode})`);
  } catch (e) {
    console.log("[typing-practice] 注册处理器失败:", e);
    core.osd(`注册处理器失败: ${e}`);
  }
}

// ---- Overlay 消息处理器 ----
function registerOverlayHandlers() {
  overlay.onMessage("overlay-ready", () => {
    console.log(`[typing-practice] 收到 overlay-ready, mode=${state.mode}, source=${state.source}`);
    state.overlayReady = true;
    core.osd(`[4] 收到 overlay-ready (mode=${state.mode})`);
    echoCurrentSentence();
  });

  overlay.onMessage("request-current", () => {
    console.log(`[typing-practice] 收到 request-current(overlay), mode=${state.mode}`);
    echoCurrentSentence();
  });

  overlay.onMessage("action", (data) => {
    handleInputAction(data);
  });

  overlay.onMessage("typed-correct", (data) => onTypedCorrect(data || {}));
}

// ---- StandaloneWindow 消息处理器 ----
function registerWindowHandlers() {
  standaloneWindow.onMessage("window-ready", () => {
    console.log(`[typing-practice] 收到 window-ready, mode=${state.mode}, source=${state.source}`);
    core.osd(`[4] 收到 window-ready (mode=${state.mode})`);
    echoCurrentSentence();
  });

  standaloneWindow.onMessage("request-current", () => {
    console.log(`[typing-practice] 收到 request-current(window), mode=${state.mode}`);
    echoCurrentSentence();
  });

  standaloneWindow.onMessage("action", (data) => {
    handleInputAction(data);
  });

  standaloneWindow.onMessage("typed-correct", (data) => onTypedCorrect(data || {}));
}

// ---- 统一回显当前句（overlay-ready / window-ready / request-current 时调用） ----
function echoCurrentSentence() {
  if (state.mode === "TYPING") {
    if (state.source === "embedded" && state.currentSubText) {
      pushToInput("load-sentence", {
        index: -1, text: state.currentSubText, total: -1, blindMode: state.blindMode,
      });
    } else if (state.currentIndex >= 0) {
      pushCurrentSentence();
    } else {
      pushToInput("load-sentence", {
        index: -1, text: "正在加载字幕...", total: -1, blindMode: state.blindMode,
      });
    }
  } else if (state.mode === "PLAYING_WAITING") {
    pushToInput("load-sentence", {
      index: -1, text: "[内嵌模式] 播放中，等待下一句字幕出现...", total: -1,
      blindMode: state.blindMode,
    });
  } else {
    pushToInput("load-sentence", {
      index: -1, text: "准备中...", total: -1, blindMode: state.blindMode,
    });
  }
}

// ---- 统一 action 分发 ----
function handleInputAction(data) {
  const d = data || {};
  console.log(`[typing-practice] 收到 action: ${d.type} (mode=${state.inputMode})`);
  if (d.type === "typed-correct") {
    onTypedCorrect(d);
  } else if (d.type === "skip") {
    skipSentence();
  } else if (d.type === "reset") {
    resetSentence();
  } else if (d.type === "next") {
    nextSentenceManual();
  } else if (d.type === "prev") {
    prevSentence();
  } else if (d.type === "switch-to-window") {
    switchToWindowMode();
  } else if (d.type === "switch-to-overlay") {
    switchToOverlayMode();
  } else if (d.type === "window-closed") {
    closeAllInput();
  }
}

// ============ 事件监听 ============
event.on("iina.file-loaded", () => {
  console.log("[typing-practice] 视频加载:", core.status.title);
  loadSubtitles().then(() => {
    if (state.source === "external") {
      core.osd(`已加载外挂字幕 ${state.subtitles.length} 条，菜单点「开始打字练习」`);
    } else if (state.source === "embedded") {
      core.osd("检测到内嵌字幕，菜单点「开始打字练习」开始");
    }
  });
});

event.on("mpv.track-list-changed", () => {
  if (state.source === "external") return;
  if (state.mode === "IDLE") loadSubtitles();
});
