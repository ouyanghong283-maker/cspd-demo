import { LifecycleProgressPanel } from '../core/lifecycle-progress/progress-panel';
import { selectLifecycleProgress } from '../core/lifecycle-progress';
import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { toSignal } from '@angular/core/rxjs-interop';
import { map } from 'rxjs';
import { DemoStore } from '../core/store';
import { FiveCanKey, SolutionDocumentKind } from '../core/models';
import { Badge } from '../shared/badge';
import { SolutionService } from './solution-service';

const DOCUMENT_KINDS: SolutionDocumentKind[] = ['技术方案', 'TIC', '设计BOM', 'SLD'];
const FIVE_CAN_KEYS: FiveCanKey[] = ['可承诺', '可交付', '可运维', '可验收', '可续约'];

@Component({
  selector: 'app-solution-workspace',
  imports: [RouterLink, Badge, SolutionService, LifecycleProgressPanel],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (overview(); as view) {
      <main class="solution-workspace">
        <header class="workspace-heading">
          <div>
            @if (returnTo(); as source) {
              <a class="back-link" [routerLink]="source">{{ returnLabel() }}</a>
            } @else {
              <a class="back-link" routerLink="/sales/solutions">返回方案清单</a>
            }
            <h1>{{ view.sale.projectName || '商机方案工作区' }}</h1>
            <p class="source-line">
              <span class="record-id">{{ view.sale.id }}</span>
              <span>{{ view.customerName }}</span>
              <span>商机负责人：{{ view.sale.owner || '未记录' }}</span>
              <span>方案负责人：{{ view.solutionOwner }}</span>
            </p>
          </div>
          <nav class="record-links" aria-label="商机相关记录">
            <a [routerLink]="['/sales/detail', view.sale.id]" [queryParams]="{ tab: '概览' }">
              查看商机
            </a>
            <a [routerLink]="['/sales/quotes', view.sale.id]">报价来源</a>
          </nav>
        </header>

        <section class="source-context" aria-label="来源商机">
          <div class="source-mark" aria-hidden="true">S</div>
          <div>
            <h2>来源商机</h2>
            <p>
              {{ view.sale.id }} · {{ view.sale.projectName || '项目名称待补' }} ·
              {{ view.customerName }}
            </p>
            <small>
              {{ view.sale.stage }} · 产品需求修订 {{ view.requirementRevision }} ·
              {{ view.needCount }} 条配置行
              @if (view.sale.leadId) {
                · 来源线索 {{ view.sale.leadId }}
              }
            </small>
          </div>
          <app-badge [text]="view.sale.submittedAt ? '已有效提交' : '商机持续补充中'" />
        </section>

        <app-solution-service [opportunityId]="view.sale.id" section="方案" />
        <details class="progress-details">
          <summary>查看全流程业务进度明细</summary>
          <app-lifecycle-progress-panel [view]="lifecycleProgress()" />
        </details>
        <section class="ledger" aria-label="方案工作摘要">
          <div class="ledger-title">
            <div>
              <h2>资料、核价与五可状态</h2>
              <p>每项都保留版本、负责人和来源；状态只反映本地演示记录。</p>
            </div>
            <span class="simulation-stamp">本地演示工作区</span>
          </div>

          <div class="status-ledger">
            <div class="status-cell">
              <span class="status-label">资料确认</span>
              <strong>{{ view.confirmationLabel }}</strong>
              <small>{{ view.confirmationDetail }}</small>
            </div>
            <div class="status-cell">
              <span class="status-label">最近核价</span>
              <strong>{{ view.costingLabel }}</strong>
              <small>{{ view.costingDetail }}</small>
            </div>
            <div class="status-cell five-can-cell">
              <span class="status-label">五可责任状态</span>
              @if (view.fiveCan.length) {
                <div class="five-can-list">
                  @for (item of view.fiveCan; track item.key) {
                    <span>
                      <b>{{ item.key }}</b>
                      {{ item.result }} · {{ item.owner }}
                    </span>
                  }
                </div>
              } @else {
                <strong>尚无五可评估</strong>
                <small>资料保存不会自动生成评估或确认。</small>
              }
            </div>
          </div>
        </section>

        <aside class="meaning-note" aria-label="演示范围说明">
          <strong>保存 ≠ 确认</strong>
          <span>
            资料记录、模拟核价及五可评估是分开的动作。金额、核价系数和指导价均为本地模拟值，
            不代表正式定价、审批或 G3 通过。
          </span>
        </aside>
      </main>
    } @else {
      <main class="solution-workspace missing-record">
        @if (returnTo(); as source) {
          <a class="back-link" [routerLink]="source">{{ returnLabel() }}</a>
        } @else {
          <a class="back-link" routerLink="/sales/solutions">返回方案清单</a>
        }
        <h1>找不到来源商机</h1>
        <p>该方案工作区需要关联一条现有商机。请从方案清单选择商机后再打开。</p>
      </main>
    }
  `,
  styles: `
    :host {
      --solution-ink: #16324a;
      --solution-body: #33475b;
      --solution-muted: #5d7183;
      --solution-faint: #8296a6;
      --solution-blue: #245d87;
      --solution-teal: #147d78;
      --solution-line: #dee6ec;
      --solution-line-soft: #edf2f5;
      --solution-surface: #f7fafb;
      --solution-amber: #8a5f1c;
      --solution-amber-line: #c88e36;
      --solution-amber-bg: #fff9ed;
      display: block;
    }
    .progress-details {
      margin-block: 16px;
      padding: 16px;
      border: 1px solid var(--solution-line);
      border-radius: 8px;
    }
    .progress-details summary {
      cursor: pointer;
    }
    .solution-workspace {
      max-width: 1320px;
      margin: 0 auto;
      padding: 8px 0 40px;
      color: var(--solution-body);
      font-size: 13.5px;
      line-height: 1.6;
    }
    .workspace-heading {
      display: flex;
      justify-content: space-between;
      align-items: flex-end;
      gap: 24px;
      padding: 14px 0 22px;
      border-bottom: 2px solid var(--solution-ink);
    }
    .back-link {
      display: inline-block;
      margin-bottom: 10px;
      color: var(--solution-muted);
      font-size: 12.5px;
      text-decoration: none;
    }
    .back-link:hover,
    .record-links a:hover {
      text-decoration: underline;
    }
    .workspace-heading h1 {
      margin: 0;
      color: var(--solution-ink);
      font-size: clamp(24px, 1.4vw + 18px, 32px);
      font-weight: 750;
      letter-spacing: -0.02em;
      line-height: 1.25;
    }
    .source-line {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: 6px 16px;
      margin: 10px 0 0;
      color: var(--solution-muted);
      font-size: 13px;
    }
    .record-id {
      padding: 2px 8px;
      border: 1px solid var(--solution-line);
      border-radius: 3px;
      background: var(--solution-surface);
      color: var(--solution-blue);
      font-size: 12px;
      font-weight: 700;
      letter-spacing: 0.02em;
    }
    .record-links {
      display: flex;
      flex-shrink: 0;
      gap: 10px;
      padding-bottom: 2px;
    }
    .record-links a {
      padding: 7px 14px;
      border: 1px solid var(--solution-line);
      border-radius: 4px;
      color: var(--solution-blue);
      font-size: 12.5px;
      font-weight: 650;
      text-decoration: none;
    }
    .record-links a:hover {
      border-color: var(--solution-blue);
      text-decoration: none;
    }
    .source-context {
      display: grid;
      grid-template-columns: 38px minmax(0, 1fr) auto;
      gap: 14px;
      align-items: center;
      margin: 20px 0;
      padding: 15px 18px;
      border: 1px solid var(--solution-line);
      border-left: 4px solid var(--solution-teal);
      background: var(--solution-surface);
    }
    .source-mark {
      display: grid;
      width: 34px;
      height: 34px;
      place-items: center;
      border-radius: 50%;
      background: #dcefeb;
      color: #12635f;
      font-size: 14px;
      font-weight: 750;
    }
    .source-context h2,
    .ledger-title h2 {
      margin: 0;
      color: var(--solution-ink);
      font-size: 16px;
      font-weight: 700;
      letter-spacing: 0.01em;
    }
    .source-context p {
      margin: 4px 0 2px;
      color: var(--solution-body);
      font-size: 13.5px;
      font-weight: 550;
    }
    .source-context small {
      color: var(--solution-faint);
      font-size: 12px;
    }
    .ledger {
      overflow: hidden;
      border: 1px solid var(--solution-line);
      background: #fff;
    }
    .ledger-title {
      display: flex;
      justify-content: space-between;
      align-items: center;
      gap: 16px;
      padding: 15px 19px;
      border-bottom: 1px solid var(--solution-line);
    }
    .ledger-title p {
      margin: 4px 0 0;
      color: var(--solution-muted);
      font-size: 12.5px;
    }
    .simulation-stamp {
      padding: 5px 9px;
      border: 1px solid #a7d2ca;
      border-radius: 3px;
      color: #12635f;
      background: #f0faf7;
      font-size: 11px;
      font-weight: 700;
      white-space: nowrap;
    }
    .document-ledger {
      padding: 0 19px;
    }
    .document-row {
      display: grid;
      grid-template-columns: 118px minmax(120px, 1fr) 76px minmax(90px, 0.55fr);
      gap: 12px;
      align-items: center;
      min-height: 42px;
      border-bottom: 1px solid var(--solution-line-soft);
      font-size: 13px;
    }
    .document-row:last-child {
      border-bottom: 0;
    }
    .document-head {
      min-height: 32px;
      border-bottom: 1px solid var(--solution-line);
      color: var(--solution-faint);
      font-size: 11.5px;
      font-weight: 600;
    }
    .document-kind {
      color: var(--solution-ink);
      font-weight: 650;
    }
    .document-row strong {
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
      color: var(--solution-ink);
      font-weight: 650;
    }
    .document-row > span:nth-child(3),
    .document-owner {
      color: var(--solution-muted);
    }
    .document-row > span.missing,
    .document-row > strong.missing {
      color: var(--solution-faint);
      font-weight: 400;
    }
    .document-owner {
      text-align: right;
    }
    .status-ledger {
      display: grid;
      grid-template-columns: minmax(160px, 0.75fr) minmax(180px, 0.9fr) minmax(360px, 1.7fr);
      border-top: 1px solid var(--solution-line);
      background: var(--solution-surface);
    }
    .status-cell {
      min-height: 88px;
      padding: 14px 19px;
      border-right: 1px solid var(--solution-line);
    }
    .status-cell:last-child {
      border-right: 0;
    }
    .status-label {
      display: block;
      margin-bottom: 7px;
      color: var(--solution-faint);
      font-size: 11.5px;
      font-weight: 600;
    }
    .status-cell > strong {
      display: block;
      color: var(--solution-ink);
      font-size: 14px;
      font-weight: 700;
    }
    .status-cell > small {
      display: block;
      margin-top: 4px;
      color: var(--solution-muted);
      font-size: 12px;
    }
    .five-can-list {
      display: flex;
      flex-wrap: wrap;
      gap: 6px;
    }
    .five-can-list span {
      padding: 4px 8px;
      border: 1px solid var(--solution-line);
      border-radius: 3px;
      background: #fff;
      color: var(--solution-muted);
      font-size: 12px;
    }
    .five-can-list b {
      color: var(--solution-ink);
      font-weight: 700;
    }
    .meaning-note {
      display: flex;
      gap: 12px;
      align-items: baseline;
      margin: 14px 0 20px;
      padding: 11px 14px;
      border-left: 3px solid var(--solution-amber-line);
      background: var(--solution-amber-bg);
      color: var(--solution-amber);
      font-size: 12.5px;
      line-height: 1.65;
    }
    .meaning-note strong {
      flex-shrink: 0;
    }
    .missing-record {
      min-height: 250px;
      padding-top: 28px;
    }
    .missing-record h1 {
      margin: 0 0 8px;
      color: var(--solution-ink);
      font-size: 24px;
    }
    .missing-record p {
      color: var(--solution-muted);
      font-size: 13.5px;
    }
    :host a:focus-visible {
      outline: 3px solid #e0a630;
      outline-offset: 3px;
    }
    @media (max-width: 860px) {
      .workspace-heading {
        align-items: flex-start;
        flex-direction: column;
      }
      .record-links {
        padding-bottom: 0;
      }
      .status-ledger {
        grid-template-columns: 1fr 1fr;
      }
      .five-can-cell {
        grid-column: 1 / -1;
        border-top: 1px solid var(--solution-line);
      }
    }
    @media (max-width: 580px) {
      .solution-workspace {
        padding-top: 0;
      }
      .source-context {
        grid-template-columns: 34px minmax(0, 1fr);
      }
      .source-context app-badge {
        grid-column: 2;
        justify-self: start;
      }
      .document-ledger {
        padding: 0 12px;
      }
      .document-head {
        display: none;
      }
      .document-row {
        grid-template-columns: 90px minmax(0, 1fr);
        gap: 3px 10px;
        padding: 9px 0;
      }
      .document-row > span:nth-child(3) {
        grid-column: 1;
      }
      .document-owner {
        grid-column: 2;
        grid-row: 2;
        text-align: left;
      }
      .status-ledger {
        grid-template-columns: 1fr;
      }
      .status-cell {
        min-height: auto;
        border-right: 0;
        border-bottom: 1px solid var(--solution-line);
      }
      .five-can-cell {
        grid-column: auto;
        border-top: 0;
      }
      .meaning-note {
        align-items: flex-start;
        flex-direction: column;
        gap: 3px;
      }
    }
  `,
})
export class SolutionWorkspace {
  private route = inject(ActivatedRoute);
  private router = inject(Router);
  readonly returnTo = toSignal(
    this.route.queryParamMap.pipe(
      map((params) => {
        const value = params.get('returnTo') || '';
        return /^(?:\/sales\/opportunities|\/projects\/board)(\?|$)/.test(value)
          ? this.router.parseUrl(value)
          : null;
      }),
    ),
    { initialValue: null },
  );
  readonly returnLabel = toSignal(
    this.route.queryParamMap.pipe(map((p) => p.get('returnLabel') || '返回部门记录')),
    { initialValue: '返回部门记录' },
  );
  readonly store = inject(DemoStore);
  readonly lifecycleProgress = computed(() =>
    selectLifecycleProgress(this.store.state(), this.opportunityId(), null),
  );
  readonly opportunityId = toSignal(
    this.route.paramMap.pipe(map((params) => params.get('id') || '')),
    { initialValue: '' },
  );

  readonly overview = computed(() => {
    const sale = this.store.sale(this.opportunityId());
    if (!sale || sale.type !== 'opportunity') return undefined;
    const docs = this.store.solutionDocuments(sale.id);
    const versions = docs?.versions || [];
    const confirmations = docs?.confirmations || [];
    const currentConfirmation = this.store.solutionConfirmation(sale.id);
    const latestCosting = docs?.costings.at(-1);
    const costingIsCurrent =
      !!latestCosting &&
      !!currentConfirmation &&
      latestCosting.confirmationId === currentConfirmation.id;
    const latestFiveCan = docs?.fiveCanReviews.at(-1);
    return {
      sale,
      customerName:
        this.store.customer(sale.customerId)?.shortName ||
        this.store.customer(sale.customerId)?.name ||
        '客户资料待补',
      solutionOwner: docs?.owner || '待指定',
      needCount: sale.productNeeds?.length || 0,
      requirementRevision: sale.productNeedRevision || 0,
      documents: DOCUMENT_KINDS.map((kind) => {
        const version = versions.filter((item) => item.kind === kind).at(-1);
        const current = docs?.current[kind];
        const attachment =
          version && this.store.state().attachments.find((item) => item.id === version.documentId);
        return {
          kind,
          hasVersion: !!version,
          name: attachment?.name || '尚无资料版本',
          versionLabel: version
            ? `${version.id === current ? '当前' : '历史'} V${version.number}`
            : '待补',
          owner: version?.owner || '未指定负责人',
        };
      }),
      confirmationLabel: currentConfirmation ? '当前版本已确认' : '待确认或来源已变化',
      confirmationDetail: currentConfirmation
        ? `${currentConfirmation.owner} · 修订 ${currentConfirmation.productNeedRevision}`
        : confirmations.length
          ? `已有 ${confirmations.length} 条历史确认，不能代替当前确认`
          : '没有确认记录',
      costingLabel: latestCosting
        ? `${latestCosting.id} · 模拟核价 · ${costingIsCurrent ? '当前' : '依据待复核'}`
        : '尚无核价',
      costingDetail: latestCosting
        ? `${latestCosting.rows.length} 条产品行 · ${latestCosting.coefficientSource}`
        : '核价需要当前资料确认及完整产品成本',
      fiveCan: latestFiveCan
        ? FIVE_CAN_KEYS.map((key) => ({
            key,
            result: latestFiveCan.items[key].result,
            owner: latestFiveCan.items[key].owner,
          }))
        : [],
    };
  });
}
