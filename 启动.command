#!/bin/bash
# 面试辅助 启动脚本（双击运行）
cd "$(dirname "$0")"
if [ ! -f "volcano.config.json" ]; then
  echo "请先复制 volcano.config.example.json 为 volcano.config.json，并填写火山引擎 ASR 凭据。"
  read -r -p "按回车退出..." _
  exit 1
fi
if [ ! -x "node_modules/.bin/electron" ]; then
  echo "请先运行 npm ci 安装依赖。"
  read -r -p "按回车退出..." _
  exit 1
fi
env -u ELECTRON_RUN_AS_NODE ./node_modules/.bin/electron --no-sandbox "$PWD"
