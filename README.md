# CSPD 业务操作前端 DEMO

Angular 22 演示应用，覆盖客户与线索、商机推进、项目计划、启动交底、验收和内部移交。提供 13 个角色、34 条操作路径与连续业务接力。Minimalism 风格，使用本地中文字体和 SVG 图标。

2026-10-12完整性复核：主线动作可到达移交接收，但仍有任务状态、资料重验、数据复用和独立上手缺口，尚未达到全部需求验收。详见[最新全过程复核](docs/功能完整性与全过程复核_2026-10-12.md)。

## Windows 使用者先看这里

完整图文指南：[下载并解压仓库](https://github.com/ouyanghong283-maker/cspd-demo/archive/refs/heads/main.zip)后，双击 `引导/Windows本地使用指南.html`。含下载安装、启动、角色练习与报错排查。也可先阅读 [Windows 使用说明](Windows使用说明.md)。

建议 Node.js 24 LTS（至少 24.15.0），无需安装 Git、Python、数据库或全局 Angular。

## 启动

需要 Node.js 22.22.3 以上的受支持版本（本环境使用 26.11.1）。

```bash
# 在 package.json 所在文件夹打开命令窗口
npm ci
npm start -- --host 127.0.0.1 --port 4200
```

打开 http://127.0.0.1:4200 。先在右上角选择角色，再进入「演示控制与指南」选择案例或「去练习」。切换角色和案例保留修改；重置需要确认。

快速演示：销售登记线索 → 补需求附件转商机 → 完善商机并保存阶段沟通 → 记录赢单 → 进入交付演示 → PM接收与启动交底 → 维护计划 → SAT和客户验收分别完成 → 移交接收方确认。

重点投标使用 DEMO-O002，交底缺件使用 DEMO-P002，验收使用 DEMO-P006，待接收使用 DEMO-P007。每页提示当前应做的操作和缺失项；表单可「填入演示内容」。演示附件为可下载 PDF，也支持上传自己的 PDF、Excel 和 Word 文件。

## 文档和验证

- [开发总 PRD](docs/总PRD.md)：整合原目录全部 5 份需求文档的开发基线。
- [PRD 拆解](docs/PRD拆解.md)：13 项开发任务与操作路径映射。
- [测试报告](docs/测试报告.md)：真实执行结果、页面检查及截图。
- Windows 指南内含已有演示截图；原本机调试记录不随源码发布。

```bash
npm test                 # 关键业务规则
npm run build            # 严格生产构建
npm run browser:install  # 首次下载 Chrome for Testing
npm run test:browser     # 保持开发服务器运行，实际调用 Chrome DevTools MCP
npm run test:guides      # 逐条验证34个练习入口、共享客户与样例文件
```

浏览器验证通过本地 MCP SDK 客户端调用官方 chrome-devtools-mcp，使用工作区 roots 协商。已有 Chrome 可用 `CHROME_PATH=/absolute/path/to/chrome npm run test:browser`。Linux 需要 Chrome 的系统动态库；安装脚本会在缺库时尝试下载 Ubuntu 软件包并解压到 `.browser/libs`，无需管理员权限。Chrome、依赖和测试浏览器配置均被 Git 忽略。

## 实现与演示范围

Standalone 组件、OnPush、Signals/computed、按路由懒加载和 Reactive Forms。业务规则集中在 `src/app/core/`；记录保存在 localStorage，实际上传文件保存在 IndexedDB。附件关联、业务状态、历史和站内模拟通知同步更新；刷新可继续操作。

初始样例包含 12 个客户、12 条线索、24 个商机、6 份合同和 8 个项目，含不同国家、币种、等级、阶段、30/60 天冷却、同合同多项目、缺件、退回、验收与接收等情形。金额不跨币种相加。

审批、合同/G3、生产和账务为就近标注的模拟结果。单浏览器操作，无真实系统接口、跨设备协作或生产权限认证。PM 会议原文件没有讨论正文，相关流程沿用原 PRD，供业务走查确认。税费展示固定案例与待确认备注；预测权重、冷却阈值及模板为演示假设。

原环境没有安装名为 uiux 的技能，已使用可用的 frontend-design 技能落实用户要求的 minimalism 视觉风格。
