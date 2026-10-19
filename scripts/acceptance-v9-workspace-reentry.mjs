// K23 工作区重入回归脚本：按 C14 固定入口与独立预期采集 加载/刷新/接管/续接/重开 的原始结果。
// 父规格追踪：MIG06（doc/PRD/DEMO PRD/V9PRD/specs/15_保存迁移整合_SPEC.md）。
// 只写脚本与原始结果：不改迁移/重置/巡检算法，不改 src 业务代码；
// 每项检查记录 名称/预期/实际/结果 的对照，最终通过与否的判定留给 CODEX。
// 公开入口：Store 的 takeOverEditing / resumeWorkspace / reset 及已提交状态查询；
// 页面真实按钮为最高接缝，状态读取只走 ng component/store 公开状态。
import fs from 'node:fs/promises';
import path from 'node:path';
import { connect, toolText, root } from './mcp-client.mjs';

const base = (process.env.CSPD_BASE_URL || 'http://127.0.0.1:4325').replace(/\/+$/, '');
const out = path.resolve(root, process.env.CSPD_ARTIFACT_DIR || 'artifacts/v9-b05-kimi-reentry');
const evidence = path.resolve(root, process.env.CSPD_EVIDENCE_DIR || '../docs/verification/v9-b05-kimi');
await fs.mkdir(out, { recursive: true });
await fs.mkdir(evidence, { recursive: true });

const results = {
  task: 'K23 工作区重入回归脚本',
  spec: 'MIG06 — doc/PRD/DEMO PRD/V9PRD/specs/15_保存迁移整合_SPEC.md',
  runAt: new Date().toISOString(),
  baseUrl: base,
  boundary:
    'KIMI 只采集原始结果：脚本逐项记录 预期/实际/机械对照，最终通过或不通过的验收判定留给 CODEX。',
  entryPoints: ['DemoStore.takeOverEditing', 'DemoStore.resumeWorkspace', 'DemoStore.reset', '已提交状态查询(store.state/workspaceStorage 只读)'],
  checks: [],
  blocked: null,
};
const checks = results.checks;
const consoleLines = [];
const say = (line) => {
  consoleLines.push(line);
  console.log(line);
};

let c;
let pageId;
let aborted = null;
const call = (n, a = {}) => c.call(n, { pageId, ...a });
const pause = (ms = 250) => new Promise((r) => setTimeout(r, ms));

// evaluate_script 的非 undefined 返回值会被包进 ```json 代码块；这里沿用既有解析惯例。
const run = async (body) => {
  const raw = toolText(await call('evaluate_script', { function: `async()=>{${body}}` }));
  const m = raw.match(/```json\s*([\s\S]*?)\s*```/);
  if (!m) throw Error('浏览器没有返回 JSON：' + raw.slice(0, 500));
  return JSON.parse(m[1]);
};

// 每次检查只负责记录：name=检查名称，expected=独立预期原文，evaluate=返回 {pass, actual}。
const check = async (id, type, name, expected, evaluate) => {
  const entry = { id, type, name, expected };
  try {
    const r = await evaluate();
    entry.actual = r.actual;
    entry.result = r.pass ? '通过' : '失败';
  } catch (e) {
    entry.actual = { error: e instanceof Error ? e.message : String(e) };
    entry.result = '失败';
  }
  checks.push(entry);
  say(`${entry.result === '通过' ? '通过' : '失败'} ${id} ${name}`);
  return entry;
};

// 在页面里安装采集助手与原生确认桩（record-only，确认一律放行并记录原文）。
const installHelpers = () =>
  run(`
    const app = ng.getComponent(document.querySelector('app-root'));
    window.__k23 = {
      store: app.store,
      confirms: window.__k23 ? window.__k23.confirms : [],
      summarize() {
        const store = window.__k23.store;
        const s = store.state();
        const json = JSON.stringify(s);
        let hash = 0;
        for (let i = 0; i < json.length; i++) hash = (hash * 31 + json.charCodeAt(i)) >>> 0;
        const ws = s.solutionWorkspaces || [];
        return {
          roundId: s.roundId ?? null,
          storageSchemaVersion: s.storageSchemaVersion ?? null,
          dataVersion: s.dataVersion ?? null,
          projectWarningBackfillVersion: s.projectWarningBackfillVersion ?? null,
          dateMode: s.dateMode || 'normal',
          operationEvents: (s.operationEvents || []).length,
          solutionWorkspaces: ws.length,
          firstFinalizations: ws.filter((w) => w.firstFinalization).length,
          finalizations: ws.reduce((n, w) => n + (w.finalizations || []).length, 0),
          operationOriginVersions: ws.reduce(
            (n, w) => n + (w.versions || []).filter((v) => v.origin === 'operation').length,
            0,
          ),
          sales: (s.sales || []).length,
          projects: (s.projects || []).length,
          // 旧顶层集合（核价/五可/TIC 等）与统一工作区业务记录计数，供 MIG06「旧集合不复活」对照。
          legacy: (s.solutionDocuments || []).map((d) => ({
            opportunityId: d.opportunityId,
            versions: (d.versions || []).length,
            ticVersions: (d.versions || []).filter((v) => v.kind === 'TIC').length,
            confirmations: (d.confirmations || []).length,
            costings: (d.costings || []).length,
            fiveCanReviews: (d.fiveCanReviews || []).length,
          })),
          businessRecords: ws.reduce((n, w) => n + (w.businessRecords || []).length, 0),
          activeWorkspaceId: store.activeWorkspaceId ?? null,
          editingWritable: store.editingWritable(),
          archived: store.archivedWorkspaces().map((w) => ({
            id: w.id,
            roundId: w.roundId,
            dataVersion: w.dataVersion,
          })),
          digest: hash.toString(16),
          stateLength: json.length,
        };
      },
      // 有界递归差异：续接/刷新后出现 digest 不一致时，逐路径记录实际变化，便于 CODEX 判断。
      diff(a, b) {
        const out = [];
        const short = (v) => {
          const s = typeof v === 'string' ? v : JSON.stringify(v);
          return s && s.length > 80 ? s.slice(0, 80) + '…(' + s.length + ')' : s;
        };
        const walk = (x, y, path, depth) => {
          if (out.length >= 25 || depth > 8) return;
          if (JSON.stringify(x) === JSON.stringify(y)) return;
          if (
            x && y && typeof x === 'object' && typeof y === 'object' &&
            !Array.isArray(x) && !Array.isArray(y)
          ) {
            for (const k of new Set([...Object.keys(x), ...Object.keys(y)]))
              walk(x[k], y[k], path ? path + '.' + k : k, depth + 1);
            return;
          }
          if (Array.isArray(x) && Array.isArray(y) && x.length === y.length) {
            x.forEach((v, i) => walk(v, y[i], path + '[' + i + ']', depth + 1));
            return;
          }
          out.push({ path: path || '(root)', before: short(x), after: short(y) });
        };
        walk(a, b, '', 0);
        return out;
      },
    };
    if (!window.__k23ConfirmStubbed) {
      window.__nativeConfirm = window.confirm;
      window.confirm = (message) => {
        window.__k23.confirms.push(String(message));
        return true;
      };
      window.__k23ConfirmStubbed = true;
    }
    return true;
  `);

// 真实页面按钮：按可见文字找到未禁用按钮并点击（Angular 事件正常触发）。
const clickButton = (text, scope) =>
  run(`
    const root = ${scope ? `document.querySelector(${JSON.stringify(scope)})` : 'document'};
    if (!root) throw Error('找不到作用域 ' + ${JSON.stringify(scope || 'document')});
    const candidates = [...root.querySelectorAll('button')].filter(
      (b) => !b.disabled && b.textContent.trim() === ${JSON.stringify(text)},
    );
    if (!candidates.length) throw Error('找不到可用按钮 ' + ${JSON.stringify(text)});
    const b = candidates[0];
    b.scrollIntoView({ block: 'center' });
    b.click();
    return { clicked: true, count: candidates.length };
  `);

// 「续接旧工作区」区里按轮次定位某一行的真实按钮。
const clickResumeForRound = (roundId) =>
  run(`
    const section = document.querySelector('[aria-label="续接旧工作区"]');
    if (!section) throw Error('页面没有 续接旧工作区 区域');
    const rows = [...section.querySelectorAll('.control-actions')];
    const row = rows.find((r) => r.textContent.includes('轮次 ' + ${JSON.stringify(roundId)}));
    if (!row) throw Error('续接区找不到轮次 ' + ${JSON.stringify(roundId)} + '，实际行数 ' + rows.length);
    const b = row.querySelector('button');
    if (!b || b.disabled) throw Error('该行没有可用按钮');
    b.scrollIntoView({ block: 'center' });
    b.click();
    return { clicked: true, roundId: ${JSON.stringify(roundId)} };
  `);

// 轮询等待：页面内条件满足或超时（条件表达式在页面内求值）。
const waitFor = async (expr, timeoutMs = 10000) => {
  const until = Date.now() + timeoutMs;
  for (;;) {
    if (await run(`return !!( ${expr} );`)) return true;
    if (Date.now() > until) throw Error('等待超时：' + expr);
    await pause(300);
  }
};

// 修改权 lease 每 5 秒自动续期；释放后必须在 5 秒内完成无资格态的操作。
const loseEditingRights = () =>
  run(`
    const store = window.__k23.store;
    store.editingLease.release();
    store.editingWritable.set(false);
    window.dispatchEvent(new StorageEvent('storage'));
    return { editingWritable: store.editingWritable(), canEdit: store.v9CanEdit() };
  `);

// MIG06「旧集合不复活」对照：旧顶层集合（solutionDocuments 核价/五可/TIC）逐项计数 +
// 统一工作区 businessRecords 计数，全部一致才算无新增/无复活。
const sameLegacy = (a, b) =>
  !!a &&
  !!b &&
  JSON.stringify(a.legacy) === JSON.stringify(b.legacy) &&
  a.businessRecords === b.businessRecords;

// 点击头部真实「接管修改权」按钮；Angular 信号在 zone 外变更时用合成 storage 事件促使界面刷新。
const takeOverViaUi = async () => {
  for (let attempt = 0; attempt < 8; attempt++) {
    const state = await run(`
      window.dispatchEvent(new StorageEvent('storage'));
      const present = [...document.querySelectorAll('header button')].some(
        (b) => !b.disabled && b.textContent.trim() === '接管修改权',
      );
      if (!present) return { present: false, writable: window.__k23.store.editingWritable() };
      const b = [...document.querySelectorAll('header button')].find(
        (x) => !x.disabled && x.textContent.trim() === '接管修改权',
      );
      b.scrollIntoView({ block: 'center' });
      b.click();
      return { present: true, clicked: true, writable: window.__k23.store.editingWritable() };
    `);
    if (state.clicked) return state;
    await pause(400);
  }
  throw Error('接管修改权按钮未出现，无法点击');
};

try {
  // 前置探测：服务不可达时如实记录阻塞，不伪造结果。
  try {
    const res = await fetch(base, { signal: AbortSignal.timeout(5000) });
    if (!res.ok) throw Error('HTTP ' + res.status);
  } catch (e) {
    results.blocked = {
      reason: '本地服务不可达：' + (e instanceof Error ? e.message : String(e)),
      attempted: [`curl ${base}/`, `fetch(${base})`, '请先用 npm start -- --host 127.0.0.1 --port <port> 起服务并设置 CSPD_BASE_URL'],
    };
    say('阻塞：' + results.blocked.reason);
    aborted = e;
  }
  if (!aborted) {
    try {
      c = await connect({ isolated: true });
    } catch (e) {
      results.blocked = {
        reason: '浏览器 MCP 连接失败：' + (e instanceof Error ? e.message : String(e)),
        attempted: [
          `CHROME_PATH=${process.env.CHROME_PATH || '<默认 my demo/.browser/chrome-linux64/chrome>'} 启动 chrome-devtools-mcp`,
          'README：Linux 需 Chrome 系统动态库，可设 LD_LIBRARY_PATH 指向 .browser/libs/usr/lib/x86_64-linux-gnu',
        ],
      };
      say('阻塞：' + results.blocked.reason);
      aborted = e;
    }
  }
  if (!aborted) {
    const created = toolText(await c.call('new_page', { url: base + '/control' }));
    pageId = Number(created.match(/(\d+):.*\[selected\]/)?.[1]);
    if (!Number.isFinite(pageId)) throw Error('无法取得页面句柄：' + created);
    await call('wait_for', { text: ['演示控制与上手指南'], timeout: 30000 });
    await pause();
    await installHelpers();

    // ── MIG06 加载：首次打开工作区 ─────────────────────────────────────
    const loadSummary = await run('return window.__k23.summarize();');
    await check(
      'K23-load-fresh-workspace',
      '加载',
      '首次打开工作区完成 V9 初始化（schema3、取得修改权、seed 业务数据已加载，旧工作区为空）',
      'storageSchemaVersion=3；editingWritable=true；seed 业务数据存在（sales/projects>0）；首次加载无归档工作区。',
      async () => ({
        actual: loadSummary,
        pass:
          loadSummary.storageSchemaVersion === 3 &&
          loadSummary.editingWritable === true &&
          loadSummary.sales > 0 &&
          loadSummary.projects > 0 &&
          loadSummary.archived.length === 0,
      }),
    );
    await call('take_screenshot', { filePath: path.join(out, 'control-loaded.png'), fullPage: true });

    // ── 准备既有编辑：真实按钮切换预警对比档（后续刷新/续接检查"既有编辑不被 seed 覆盖"的前提）──
    const beforeEdit = await run('return window.__k23.summarize();');
    let editClick = null;
    await check(
      'K23-setup-edit-datemode',
      '准备',
      '真实按钮「对比档」写入既有编辑（dateMode 持久变更，作为后续重入检查的业务历史）',
      '点击「对比档」后 dateMode=comparison，且已提交状态发生持久变更。',
      async () => {
        editClick = await clickButton('对比档');
        await pause();
        const afterEdit = await run('return window.__k23.summarize();');
        return {
          actual: { click: editClick, before: beforeEdit, after: afterEdit },
          pass: afterEdit.dateMode === 'comparison' && afterEdit.digest !== beforeEdit.digest,
        };
      },
    );
    const w1Summary = await run('return window.__k23.summarize();');
    const w1Round = w1Summary.roundId;
    const w1WorkspaceId = w1Summary.activeWorkspaceId;

    // ── MIG06 刷新：reload 后同一业务历史保持（预期1；既有编辑不被 seed 覆盖）────────
    await check(
      'K23-refresh-keeps-history',
      '刷新',
      '刷新后同一业务历史保持：roundId/schema/归档/完整已提交状态一致，dateMode=comparison 未被 seed 覆盖',
      '预期1：刷新前后 state digest 完全一致（统一引用仍可追溯），roundId 与 storageSchemaVersion 不变，既有编辑 comparison 档保留。',
      async () => {
        await call('navigate_page', { type: 'reload' });
        await call('wait_for', { text: ['演示控制与上手指南'], timeout: 30000 });
        await pause();
        await installHelpers();
        const after = await run('return window.__k23.summarize();');
        return {
          actual: { before: w1Summary, after },
          pass:
            after.digest === w1Summary.digest &&
            after.roundId === w1Summary.roundId &&
            after.storageSchemaVersion === w1Summary.storageSchemaVersion &&
            after.dateMode === 'comparison',
        };
      },
    );
    const refreshed = await run('return window.__k23.summarize();');

    // ── MIG06 接管：无资格标签页经真实按钮获得资格且历史不变（预期1）────────────────
    await check(
      'K23-takeover-editing-rights',
      '接管',
      '无修改资格时页面出现真实「接管修改权」入口；点击后取得修改权，已提交业务历史完全不变',
      '预期1：释放 lease 后 editingWritable=false 且页面出现「接管修改权」；点击真实按钮后 editingWritable=true，state digest 与接管前一致。',
      async () => {
        const lost = await loseEditingRights();
        const ui = await takeOverViaUi();
        await pause();
        const after = await run('return window.__k23.summarize();');
        return {
          actual: { lost, ui, before: refreshed, after },
          pass:
            lost.canEdit === false &&
            ui.clicked === true &&
            after.editingWritable === true &&
            after.digest === refreshed.digest,
        };
      },
    );

    // ── MIG06 接管：旧集合不复活（核价/五可/TIC 顶层集合与 businessRecords 不新增）──────
    await check(
      'K23-takeover-no-legacy-resurrection',
      '接管',
      '接管修改权后旧顶层集合（solutionDocuments 核价/五可/TIC）与统一工作区 businessRecords 不新增事实',
      'MIG06 旧集合不复活：接管只改变修改资格，legacy 逐项计数与 businessRecords 总数同接管前完全一致。',
      async () => {
        const after = await run('return window.__k23.summarize();');
        return {
          actual: {
            before: { legacy: refreshed.legacy, businessRecords: refreshed.businessRecords },
            after: { legacy: after.legacy, businessRecords: after.businessRecords },
          },
          pass: sameLegacy(refreshed, after),
        };
      },
    );

    // ── 预期3：失败不部分发布（无修改权时公开写入被拒绝且状态不变）──────────────────
    await check(
      'K23-no-partial-publish',
      '预期3',
      '失去修改资格后公开写入 setDateMode 被拒绝，已提交状态无任何部分发布；真实「接管修改权」可恢复资格',
      '预期3：setDateMode 返回 false，state digest 不变；随后真实按钮接管成功恢复 editingWritable=true。',
      async () => {
        const lost = await loseEditingRights();
        const rejected = await run(`
          const store = window.__k23.store;
          const before = window.__k23.summarize();
          const returned = store.setDateMode('normal');
          const after = window.__k23.summarize();
          return {
            returned,
            unchanged: before.digest === after.digest && before.dateMode === after.dateMode,
            dateMode: after.dateMode,
          };
        `);
        const ui = await takeOverViaUi();
        const restored = await run('return { editingWritable: window.__k23.store.editingWritable() };');
        return {
          actual: { lost, rejected, ui, restored },
          pass:
            lost.canEdit === false &&
            rejected.returned === false &&
            rejected.unchanged === true &&
            ui.clicked === true &&
            restored.editingWritable === true,
        };
      },
    );

    // ── MIG06 重开：reset 产生新 round，无旧上传/定稿/操作事件（预期2）────────────────
    let resetSummary = null;
    await check(
      'K23-reset-new-round',
      '重开',
      '真实按钮「重置演示数据」重开新轮：新 roundId、operationEvents 为空、无旧上传/定稿、回到 seed 正常档',
      '预期2：storageSchemaVersion=3；roundId 与旧轮不同；operationEvents=0；所有方案工作区无 firstFinalization/finalizations 且 versions.origin 无 operation；dateMode 回到 normal（新轮不复制旧操作事实，旧集合不复活）。',
      async () => {
        await clickButton('重置演示数据');
        await waitFor(
          `window.__k23.summarize().roundId!==${JSON.stringify(w1Round)}`,
          15000,
        );
        await pause(300);
        resetSummary = await run('return window.__k23.summarize();');
        const confirms = await run('return window.__k23.confirms;');
        return {
          actual: { before: refreshed, after: resetSummary, confirms },
          pass:
            resetSummary.storageSchemaVersion === 3 &&
            resetSummary.roundId !== w1Round &&
            resetSummary.operationEvents === 0 &&
            resetSummary.firstFinalizations === 0 &&
            resetSummary.finalizations === 0 &&
            resetSummary.operationOriginVersions === 0 &&
            resetSummary.dateMode === 'normal' &&
            resetSummary.digest !== refreshed.digest,
        };
      },
    );
    const w2Round = resetSummary?.roundId ?? null;

    // ── MIG06 重开：旧工作区保留原 round，可在页面真实看到续接入口 ──────────────────
    await check(
      'K23-reset-old-workspace-kept',
      '重开',
      '重开后旧工作区保留原 roundId 且未改动；「续接旧工作区」区真实列出旧轮',
      '旧工作区快照仍可读且 roundId 等于旧轮；页面出现 续接旧工作区 区域并列出旧轮（既有历史不因重开丢失）。',
      async () => {
        const stored = await run(`
          const store = window.__k23.store;
          const snap = store.workspaceStorage.readWorkspace(${JSON.stringify(w1WorkspaceId)});
          return { roundId: snap ? snap.roundId ?? null : null, dateMode: snap ? snap.dateMode || 'normal' : null };
        `);
        const archivedRow = (resetSummary?.archived || []).find((w) => w.id === w1WorkspaceId);
        return {
          actual: {
            storedOldWorkspace: stored,
            archivedRow: archivedRow ?? null,
            archivedCount: resetSummary ? resetSummary.archived.length : null,
          },
          pass:
            stored.roundId === w1Round &&
            stored.dateMode === 'comparison' &&
            !!archivedRow &&
            archivedRow.roundId === w1Round,
        };
      },
    );
    await call('take_screenshot', { filePath: path.join(out, 'control-after-reset.png'), fullPage: true });

    // ── MIG06 重开：旧集合不复活（新轮不恢复旧核价/五可/TIC 事实，businessRecords 不吸收）──
    await check(
      'K23-reset-no-legacy-resurrection',
      '重开',
      '重开新轮后旧顶层集合（solutionDocuments 核价/五可/TIC）不复活出新事实，统一工作区 businessRecords 不吸收旧记录',
      'MIG06 旧集合不复活：新轮与首次加载同为 seed 血统，legacy 逐项计数应与首载基线一致，且首载与新轮 businessRecords 均为 0（旧事实只留在旧工作区快照，不复活为新事实）。',
      async () => {
        const afterReset = resetSummary;
        return {
          actual: {
            baseline: { legacy: loadSummary.legacy, businessRecords: loadSummary.businessRecords },
            afterReset: afterReset
              ? { legacy: afterReset.legacy, businessRecords: afterReset.businessRecords }
              : null,
          },
          pass:
            !!afterReset &&
            sameLegacy(loadSummary, afterReset) &&
            afterReset.businessRecords === 0 &&
            loadSummary.businessRecords === 0,
        };
      },
    );

    // ── 新轮做一次区分编辑，验证两个工作区互不串档 ─────────────────────────────
    await clickButton('对比档');
    await pause();
    const w2Summary = await run('return window.__k23.summarize();');
    await run(`
      window.__k23.savedW2 = JSON.stringify(window.__k23.store.state());
      return true;
    `);

    // ── MIG06 续接：切回旧工作区，历史保持（预期1；既有编辑不被 seed 覆盖）────────────
    await check(
      'K23-resume-old-workspace',
      '续接',
      '真实按钮「续接此工作区」切回旧轮：roundId、完整已提交状态与既有编辑全部保持',
      '预期1：续接后 roundId=旧轮、state digest 与重开前该工作区一致（统一引用仍可追溯），dateMode=comparison 为旧工作区既有编辑。',
      async () => {
        await clickResumeForRound(w1Round);
        await waitFor(
          `window.__k23.summarize().roundId===${JSON.stringify(w1Round)}`,
          10000,
        );
        await pause(300);
        const after = await run('return window.__k23.summarize();');
        const confirms = await run('return window.__k23.confirms;');
        return {
          actual: { expectedOld: refreshed, after, confirms },
          pass:
            after.roundId === w1Round &&
            after.digest === refreshed.digest &&
            after.dateMode === 'comparison',
        };
      },
    );
    await call('take_screenshot', { filePath: path.join(out, 'control-resumed-old.png'), fullPage: true });

    // ── MIG06 续接：旧集合不复活（续接回旧工作区后 legacy 保持既有内容，不新增）────────
    await check(
      'K23-resume-no-legacy-resurrection',
      '续接',
      '续接回旧工作区后旧顶层集合（solutionDocuments 核价/五可/TIC）保持既有内容，businessRecords 不新增',
      'MIG06 旧集合不复活：续接只切换活动指针，legacy 逐项计数与 businessRecords 总数同重开前旧轮基线完全一致（不新增、不复活）。',
      async () => {
        const after = await run('return window.__k23.summarize();');
        return {
          actual: {
            baseline: { legacy: refreshed.legacy, businessRecords: refreshed.businessRecords },
            afterResume: { legacy: after.legacy, businessRecords: after.businessRecords },
          },
          pass: sameLegacy(refreshed, after),
        };
      },
    );

    // ── MIG06 续接：新轮工作区同样保留，可再切回且历史不变 ──────────────────────────
    await check(
      'K23-resume-back-to-new-round',
      '续接',
      '再经真实按钮切回新轮工作区：新轮自己的编辑与 roundId 保持，两工作区互不覆盖',
      '预期1：切回后 roundId=新轮、state digest 与新轮编辑后一致，dateMode=comparison（新轮自己的既有编辑）。',
      async () => {
        await clickResumeForRound(w2Round);
        await waitFor(`window.__k23.summarize().roundId===${JSON.stringify(w2Round)}`, 10000);
        await pause(300);
        const after = await run('return window.__k23.summarize();');
        const stateDiff = await run(
          'return window.__k23.diff(JSON.parse(window.__k23.savedW2), window.__k23.store.state());',
        );
        return {
          actual: { expectedNewRound: w2Summary, after, stateDiff },
          pass: after.roundId === w2Round && after.digest === w2Summary.digest,
        };
      },
    );

    // ── 辅助：浏览器控制台无 Angular/运行时错误 ────────────────────────────────
    await check(
      'K23-aux-console-clean',
      '辅助',
      '整个重入流程浏览器控制台无 Angular 表单或运行时错误',
      'list_console_messages(error) 返回的真实错误行数为 0（MCP 的 `## Console messages` 标题与 `<no console messages found>` 占位行不计入错误）。',
      async () => {
        const text = toolText(await call('list_console_messages', { types: ['error'] }));
        // chrome-devtools-mcp 空结果文本为「## Console messages」+「<no console messages found>」，
        // 只统计排除标题与占位行后的真实错误行，避免把空表头当错误计数。
        const errorLines = text
          .split('\n')
          .map((l) => l.trim())
          .filter((l) => l && l !== '<no console messages found>' && !l.startsWith('## '));
        return {
          actual: { errorCount: errorLines.length, lines: errorLines.slice(0, 5), sample: text.slice(0, 400) },
          pass: errorLines.length === 0,
        };
      },
    );

    results.summary = {
      total: checks.length,
      passed: checks.filter((x) => x.result === '通过').length,
      failed: checks.filter((x) => x.result === '失败').length,
    };
    say(
      `汇总：共 ${results.summary.total} 项，机械对照通过 ${results.summary.passed} 项，失败 ${results.summary.failed} 项（最终判定以 CODEX 验收为准）。`,
    );
  }
} catch (e) {
  results.blocked = results.blocked || {
    reason: '运行中断：' + (e instanceof Error ? e.message : String(e)),
    attempted: ['connect({isolated:true})', `new_page ${base}/control`, 'evaluate_script / navigate_page / take_screenshot'],
  };
  results.summary = {
    total: checks.length,
    passed: checks.filter((x) => x.result === '通过').length,
    failed: checks.filter((x) => x.result === '失败').length,
  };
  say('中断：' + results.blocked.reason);
  process.exitCode = 1;
} finally {
  if (c) {
    await c.client.close().catch(() => {});
    await c.transport.close().catch(() => {});
  }
  await fs.writeFile(
    path.join(evidence, 'reentry-results.json'),
    JSON.stringify(results, null, 2) + '\n',
  );
  await fs.writeFile(path.join(out, 'run-console.json'), JSON.stringify(results, null, 2) + '\n');
  say('原始结果：' + path.join(evidence, 'reentry-results.json'));
  say('运行截图与副本：' + out);
}
