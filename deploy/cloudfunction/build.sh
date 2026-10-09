#!/bin/bash
# 组装 CloudBase HTTP 云函数代码包。
#
# 用法：
#   bash deploy/cloudfunction/build.sh
#
# 产出：deploy/cloudfunction/meal-order-api/
#   ├── scf_bootstrap     （可执行启动文件）
#   ├── server/           （后端源码 + 生产依赖 node_modules）
#   └── web/              （前端静态文件，必须一起打进去）
#
# 目录名要与 cloudbaserc.json 里的 functionRoot + 函数名对上：
#   functionRoot = "deploy/cloudfunction"，函数名 = "meal-order-api"
#
# 为什么 web/ 要在包内：本项目前端由 Node 托管，config.js 的 resolveWebDir()
# 会在 <包>/server/web 找到它。云函数没有前置 Nginx，前端必须由应用自己提供。

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
PKG="$ROOT/deploy/cloudfunction/meal-order-api"

echo "仓库根目录：$ROOT"
echo "输出目录：  $PKG"

rm -rf "$PKG"
mkdir -p "$PKG/server" "$PKG/web"

echo
echo "[1/4] 复制后端源码"
cp "$ROOT/server/package.json" "$ROOT/server/package-lock.json" "$PKG/server/"
cp -r "$ROOT/server/src" "$ROOT/server/scripts" "$PKG/server/"
cp "$ROOT/server/schema.sql" "$PKG/server/"

echo "[2/4] 复制前端静态文件"
cp -r "$ROOT/web/." "$PKG/web/"

echo "[3/4] 安装生产依赖（--omit=dev，HTTP 云函数不支持平台自动装依赖）"
( cd "$PKG/server" && npm ci --omit=dev --no-audit --no-fund )

echo "[4/4] 放置启动文件并加执行权限"
cp "$ROOT/deploy/cloudfunction/scf_bootstrap" "$PKG/scf_bootstrap"
chmod +x "$PKG/scf_bootstrap"

# 换行符自检：CRLF 会让 scf_bootstrap 在 Linux 上无法执行（静默失败）
if grep -q $'\r' "$PKG/scf_bootstrap"; then
  echo "  ✗ scf_bootstrap 含 CRLF 换行，正在修正为 LF"
  sed -i 's/\r$//' "$PKG/scf_bootstrap"
fi
echo "  ✓ scf_bootstrap 换行符为 LF"

echo
echo "完成。包内容："
du -sh "$PKG" 2>/dev/null | sed 's/^/  总大小 /'
ls -la "$PKG" | tail -n +2 | sed 's/^/  /'

cat <<'EOF'

下一步（任选其一）：

【推荐】用 tcb CLI 部署（CLI 会重新打包并正确处理文件权限）
  npm i -g @cloudbase/cli
  tcb login
  tcb env use <你的环境ID>
  tcb fn deploy meal-order-api --httpFn
  详见 deploy/CLOUDBASE-FUNCTION.md

【备选】控制台手动上传
  把 meal-order-api/ 目录整体压缩成 zip 上传。
  ⚠️ Windows 自带压缩/PowerShell Compress-Archive【不保留 Linux 可执行位】，
     上传后若报启动失败，先确认 scf_bootstrap 在云端是否有执行权限。
EOF
