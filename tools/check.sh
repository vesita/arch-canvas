#!/usr/bin/env bash
# arch-canvas 一条命令跑全部门；退出码即判据（对标 dsh-pod 的 scripts/check.sh）。
# 组成：类型检查 → 构建+全测试+文档基线核对 → 已删概念残留 → Biome（真模块）。
# 说明：src/host、src/client 是「无 import、靠拼接顺序+函数提升」的函数体分片，
#       标准 linter 按单文件分析会误报 no-undef，所以 Biome 只纳入真模块目录。
set -euo pipefail
cd "$(dirname "$0")/.."

echo "== [1/4] 类型检查 =="
npm run --silent typecheck

echo "== [2/4] 构建 + 全测试 + 文档基线核对 =="
npm run --silent test:all

echo "== [3/4] 已删概念残留（扫源码/文档；产物 lib/ dist/ 不扫）=="
if [ -s tools/deleted-concepts.txt ] && grep -qE '^[[:space:]]*[^#[:space:]]' tools/deleted-concepts.txt; then
  pat="$(grep -vE '^[[:space:]]*(#|$)' tools/deleted-concepts.txt | paste -sd'|' -)"
  if hits=$(grep -rnE "\\b(${pat})\\b" src README.md AGENTS.md PROJECT_STATE.md 2>/dev/null); then
    echo "✗ 已删概念又被引入（见下）。确属新用途就更新 tools/deleted-concepts.txt" >&2
    echo "$hits" >&2
    exit 1
  fi
  echo "（无已删概念残留）"
else
  echo "（tools/deleted-concepts.txt 无条目，跳过）"
fi

echo "== [4/4] Biome 格式检查（真模块；分片 src/host|src/client 不纳入）=="
if [ -x node_modules/.bin/biome ]; then
  node_modules/.bin/biome format src/package src/bootstrap 2>&1 \
    || { echo "✗ 格式不一致（运行 npm run fmt 自动修）" >&2; exit 1; }
else
  echo "（未装 biome：npm i -D @biomejs/biome 后启用）"
fi

echo "== 全部通过 =="
