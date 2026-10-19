@echo off
chcp 65001 >nul
cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 (
  echo.
  echo  尚未安装 Node.js，demo 需要它才能运行。
  echo  即将打开 Node.js 官网，请下载 LTS 版本并一路下一步安装。
  echo  安装完成后，重新双击本文件即可。
  echo.
  start https://nodejs.org/zh-cn/download
  pause
  exit /b 1
)

node serve-demo.js
if errorlevel 1 (
  echo.
  echo  启动遇到问题，请把本窗口截图发给交付demo的同事。
  pause
)
