#!/bin/bash
cd "$(dirname "$0")"

if ! command -v node >/dev/null 2>&1; then
  echo ""
  echo "  尚未安装 Node.js，demo 需要它才能运行。"
  echo "  即将打开 Node.js 官网，请下载 LTS 版本并安装。"
  echo "  安装完成后，重新双击本文件即可。"
  echo ""
  open "https://nodejs.org/zh-cn/download"
  read -r -p "按回车键关闭窗口…"
  exit 1
fi

node serve-demo.js
