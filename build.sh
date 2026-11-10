#!/usr/bin/env bash
#
# 打包 IINA 插件：把仓库根目录的插件内容压成 dist/<name>-<version>.iinaplgz
#
# 用法：
#   ./build.sh          # 打包
#   ./build.sh --link   # 打包并链接到 IINA 作为开发版插件（改代码后重启 IINA 生效）
#
# 依赖：macOS 自带的 zip；如果装了 IINA 可以使用它自带的 iina-plugin CLI 做 link。

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$ROOT"

# ---- 读取 Info.json 里的版本号（不依赖 jq）----
read_info() {
  /usr/bin/python3 - "$1" <<'PY'
import json, sys
with open("Info.json", encoding="utf-8") as f:
    print(json.load(f)[sys.argv[1]])
PY
}

NAME="$(read_info name)"
VERSION="$(read_info version)"
OUT="dist"
PKG="${NAME}-${VERSION}.iinaplgz"

echo "==> 打包 ${NAME} v${VERSION}"

# ---- 基本校验 ----
[[ -f Info.json ]]      || { echo "错误：缺少 Info.json"; exit 1; }
[[ -f src/main.js ]]    || { echo "错误：缺少 src/main.js"; exit 1; }
[[ -f ui/input-window.html ]] || { echo "错误：缺少 ui/input-window.html"; exit 1; }
[[ -f ui/overlay-input.html ]] || { echo "错误：缺少 ui/overlay-input.html"; exit 1; }

mkdir -p "$OUT"
rm -f "$OUT/$PKG"

# IINA 解包时执行的是 `mv <dir>/* <target>/`，
# 所以压缩包里必须直接是 Info.json / src/ / ui/，不能再套一层目录。
zip -qr -X "$OUT/$PKG" Info.json src ui -x "*.DS_Store" "*__MACOSX*"

echo "==> 完成：$OUT/$PKG"
/usr/bin/unzip -l "$OUT/$PKG"

# ---- 可选：链接为 IINA 开发版插件 ----
if [[ "${1:-}" == "--link" ]]; then
  if [[ -x "/Applications/IINA.app/Contents/MacOS/iina-plugin" ]]; then
    echo "==> 链接到 IINA 开发版插件"
    "/Applications/IINA.app/Contents/MacOS/iina-plugin" link "$ROOT"
  else
    echo "跳过 --link：未找到 /Applications/IINA.app"
  fi
fi
