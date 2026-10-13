# 在 Windows 上使用 CSPD demo

完整图文教程见分享包中 `引导/Windows本地使用指南.html`，双击即可阅读。

1. 安装 Node.js 24 LTS（至少 24.15.0），保留默认 npm 和 Add to PATH 选项。
2. 从 GitHub 的 Code → Download ZIP 下载完整仓库并全部解压。
3. 找到包含 package.json 和 package-lock.json 的文件夹，在资源管理器地址栏输入 cmd 并回车。
4. 运行 `node -v` 和 `npm -v` 确认工具已安装。
5. 首次运行 `npm ci` 安装项目依赖。
6. 运行 `npm start -- --host 127.0.0.1 --port 4200`。
7. 打开 http://127.0.0.1:4200 ，保持命令窗口打开。
8. 进入“演示控制与指南”，选择角色，点击“去练习”。
9. 结束时在窗口按 Ctrl+C；下次仅需运行第 6 步。

无需安装 Git、Python、数据库或全局 Angular。首次安装需要联网。本应用没有真实业务后端，记录与上传文件保存在当前浏览器，不跨设备共享。详细演示范围与已知缺口见 README.md。

普通体验不要运行 browser:install；该脚本面向原开发验证环境，不属于 Windows 使用步骤。
