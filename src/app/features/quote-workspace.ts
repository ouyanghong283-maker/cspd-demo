import { QuoteSolutionBasisPanel } from './quote-solution-basis-panel';
import { CRM_QUOTE_DEMO_CASES, CRM_QUOTE_DEMO_POLICY } from '../core/crm-quote-demo-policy';
import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  inject,
  input,
  OnDestroy,
  signal,
  untracked,
} from '@angular/core';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { toSignal } from '@angular/core/rxjs-interop';
import { map } from 'rxjs';
import { FormsModule } from '@angular/forms';
import { DemoStore } from '../core/store';
import { BASE_DATE, QuoteItem, QuoteVersion } from '../core/models';
import { newId } from '../core/seed';
import {
  CRM_DETAIL_FIELDS,
  CRM_SUMMARY_FIELDS,
  CrmField,
  CrmValue,
  CrmValues,
} from '../core/crm-quote-schema';
import {
  applyCrmProduct,
  calculateCrmLine,
  crmAggregate,
  crmFieldReadonly,
  crmFieldRequired,
  crmFieldVisible,
  crmNumber,
  crmQuoteErrors,
  crmReferences,
} from '../core/crm-quote';
import { CrmQuoteField } from '../shared/crm-quote-field';
import { Badge } from '../shared/badge';
import { personField } from '../core/personnel';

@Component({
  selector: 'app-quote-workspace',
  imports: [FormsModule, RouterLink, CrmQuoteField, Badge, QuoteSolutionBasisPanel],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (sale(); as opportunity) {
      <div class="page-heading">
        <div>
          @if (boardReturn()) {<a class="text-link" routerLink="/projects/board">返回高层项目总览</a>}
          @else {<a class="text-link" routerLink="/sales/quotes">返回报价系列</a>}
          <h2>报价工作区</h2>
          <p>{{ opportunity.projectName }} · {{ store.customer(opportunity.customerId)?.name }}</p>
        </div>
        @if (!series()) {
          <button class="btn primary" (click)="create()">创建报价草稿</button>
        }
      </div>
      @if (current(); as stored) {
        @if (draft(); as v) {
          <section class="panel workspace">
            <header class="workspace-head">
              <div class="version-picker">
                <label for="quote-version">{{ series()?.number }}</label
                ><select
                  id="quote-version"
                  name="quote-version"
                  [ngModel]="stored.id"
                  (ngModelChange)="selectVersion($event)"
                >
                  @for (version of series()?.versions || []; track version.id) {
                    <option [value]="version.id">
                      V{{ version.number }} · {{ version.status }}
                    </option>
                  }</select
                ><app-badge [text]="stored.status" />
              </div>
              @if (editable()) {
                <div class="primary-actions">
                  <span class="save-state" aria-live="polite">{{
                    dirty() ? '有未保存的修改' : '已保存'
                  }}</span
                  ><button class="btn" type="button" (click)="save()">保存草稿</button
                  ><button class="btn primary" type="button" (click)="submit()">提交审核</button>
                </div>
              }
            </header>
            <app-quote-solution-basis-panel [quoteVersionId]="stored.id" [dirty]="dirty()" [editable]="editable()" />
            @if (closed()) {
              <p class="inline-alert">商机已关闭，报价历史只读。</p>
            }
            @if (conflict()) {
              <p class="inline-alert warning">
                报价已在其他操作中更新。请重新打开当前版本后再修改。
              </p>
            }
            @if (legacy()) {
              <p class="legacy-note">
                此版本保留原有金额与历史记录。
                @if (editable()) {
                  保存时将按当前表单校验并采用新规则。
                } @else {
                  已发出和锁定内容保持只读。
                }
              </p>
            }
            <p class="legacy-note" data-testid="quote-demo-policy">{{ demoPolicy.notice }}</p>
            @if (current()?.crmSchemaVersion === 1 && current()?.items?.length) {
              <p class="legacy-note" data-testid="quote-header-lock-reason">
                已有报价明细，币种、价目表和销售组织已锁定，防止改变已有明细的计价与归属。
              </p>
            }
            @if (errors().length) {
              <div class="validation" role="alert">
                <strong>请完成以下内容</strong>
                <ul>
                  @for (error of errors(); track $index) {
                    <li>{{ error }}</li>
                  }
                </ul>
              </div>
            }
            <nav class="workspace-tabs" aria-label="报价内容" role="tablist">
              @for (tab of tabs; track tab) {
                <button
                  type="button"
                  role="tab"
                  [attr.aria-selected]="activeTab() === tab"
                  [attr.aria-controls]="'quote-tab-' + tab"
                  [class.active]="activeTab() === tab"
                  (click)="activeTab.set(tab)"
                >
                  {{ tab }}
                  @if (tab === '报价明细') {
                    <span>{{ v.items.length }}</span>
                  }
                </button>
              }
            </nav>
            <div [id]="'quote-tab-' + activeTab()" role="tabpanel">
              @if (activeTab() === '摘要') {
                @for (group of summaryGroups; track group) {
                  <section class="form-section" [attr.aria-label]="group">
                    <h3>{{ group }}</h3>
                    <div class="field-grid">
                      @for (field of summaryFields(group); track field.name) {
                        <app-crm-quote-field
                          [field]="field"
                          [value]="headerValue(field.name)"
                          [references]="references(field)"
                          [readonly]="headerReadonly(field)"
                          [required]="required(field, v.crmFields || {})"
                          (valueChange)="setHeader(field.name, $event)"
                        />
                      }
                    </div>
                  </section>
                }
                <section class="form-section" aria-label="支付条款详情">
                  <h3>支付条款详情</h3>
                  @if (paymentTerm(); as term) {
                    <div class="payment-detail">
                      <dl>
                        <dt>条款编码</dt>
                        <dd>{{ term.label }}</dd>
                        <dt>描述-中文</dt>
                        <dd>{{ term.data['alp_description_cn'] || '—' }}</dd>
                        <dt>描述-英文</dt>
                        <dd>{{ term.data['alp_description_en'] || '—' }}</dd>
                        <dt>描述-德文</dt>
                        <dd>{{ term.data['alp_description_de'] || '—' }}</dd>
                        <dt>负责人</dt>
                        <dd>{{ paymentOwner(term.data['_ownerid_value']) }}</dd>
                      </dl>
                      <h4>付款阶段</h4>
                      <div class="table-wrap">
                        <table>
                          <thead>
                            <tr>
                              @for (column of stageColumns; track column.name) {
                                <th>{{ column.label }}</th>
                              }
                            </tr>
                          </thead>
                          <tbody>
                            @for (stage of paymentStages(); track $index) {
                              <tr>
                                @for (column of stageColumns; track column.name) {
                                  <td>{{ stage.values?.[column.name] || '—' }}</td>
                                }
                              </tr>
                            } @empty {
                              <tr>
                                <td colspan="9" class="muted">当前条款快照中没有付款阶段。</td>
                              </tr>
                            }
                          </tbody>
                        </table>
                      </div>
                    </div>
                  } @else {
                    <p class="muted">选择支付条款后查看详情。</p>
                  }
                </section>
              } @else if (activeTab() === '报价明细') {
                <div class="detail-toolbar">
                  <p>{{ v.items.length }} 条明细 · {{ v.currency }}</p>
                  @if (editable()) {
                    <button class="btn" type="button" (click)="addItem()">新增报价明细</button>
                  }
                </div>
                <div class="table-wrap">
                  <table>
                    <thead>
                      <tr>
                        <th>产品名称</th>
                        <th class="numeric">数量</th>
                        <th class="numeric">折后单价（未税）</th>
                        <th class="numeric">折后总价（未税）</th>
                        <th class="numeric">折后总价（含税）</th>
                        <th></th>
                      </tr>
                    </thead>
                    <tbody>
                      @for (item of v.items; track item.id) {
                        <tr [class.selected-row]="selectedItem() === item.id">
                          <td>
                            <button class="text-link" (click)="selectedItem.set(item.id)">
                              {{ itemName(item) }}
                            </button>
                          </td>
                          <td class="numeric">
                            {{ item.crmFields?.['quantity'] ?? item.quantity }}
                          </td>
                          <td class="numeric">
                            {{ number(item.crmFields?.['alp_afterdiscountamount']) }}
                          </td>
                          <td class="numeric">
                            {{ number(item.crmFields?.['alp_afterdistotal']) }}
                          </td>
                          <td class="numeric">
                            {{ number(item.crmFields?.['alp_afterdistotalintax']) }}
                          </td>
                          <td>
                            @if (editable()) {
                              <button class="text-link remove" (click)="removeItem(item.id)">
                                删除
                              </button>
                            }
                          </td>
                        </tr>
                      } @empty {
                        <tr>
                          <td colspan="6" class="empty">
                            暂无报价明细。请选择价目表，再新增产品。
                          </td>
                        </tr>
                      }
                    </tbody>
                  </table>
                </div>
                @if (currentItem(); as item) {
                  <div class="line-heading">
                    <h3>{{ itemName(item) }}</h3>
                    <span>{{ item.id }}</span>
                  </div>
                  @for (group of detailGroups; track group) {
                    <section class="form-section" [attr.aria-label]="group">
                      <h3>{{ group }}</h3>
                      <div class="field-grid">
                        @for (field of detailFields(group); track field.name) {
                          <app-crm-quote-field
                            [context]="item.id"
                            [field]="field"
                            [value]="item.crmFields?.[field.name] ?? null"
                            [references]="references(field, item.crmFields || {})"
                            [readonly]="lineReadonly(field, item)"
                            [required]="lineRequired(field, item)"
                            (valueChange)="setLine(item.id, field.name, $event)"
                          />
                        }
                      </div>
                    </section>
                  }
                }
                <div class="total-strip">
                  <span
                    >未税合计
                    <strong>{{ number(headerValue('alp_quototalpriceofftax')) }}</strong></span
                  ><span
                    >税费 <strong>{{ number(headerValue('alp_taxfee')) }}</strong></span
                  ><span
                    >含税合计
                    <strong
                      >{{ number(headerValue('alp_quototalpriceintax')) }} {{ v.currency }}</strong
                    ></span
                  >
                </div>
              } @else {
                <details class="form-section" data-testid="quote-demo-cases">
                  <summary>{{ demoPolicy.label }} · 计算样例</summary>
                  <p>以下为固定演示数据，不对应CRM记录；单位仅用于演示。不同币种分别计算。</p>
                  @for (sample of demoCases; track sample.id) {
                    <p>
                      <strong>{{ sample.label }}（{{ sample.currency }}）</strong>：{{
                        sample.description
                      }}
                    </p>
                  }
                  <p>
                    明细完整计算后按字段精度保存；整单汇总使用已保存的行总额，不用显示单价反算历史。
                  </p>
                </details>
                <section class="form-section">
                  <h3>当前操作</h3>
                  <div class="record-actions">
                    @if (!closed()) {
                      @if (stored.crmSchemaVersion === 1) {
                        @if (stored.status === '待模拟审核') {
                          <button class="btn primary" (click)="review(stored)">审核报价</button>
                        }
                        @if (stored.status === '模拟审核通过') {
                          <button class="btn primary" (click)="recordSent(stored)">
                            记录报价已发出
                          </button>
                        }
                        @if (
                          stored.status === '已记录发出' &&
                          !stored.customerDecision &&
                          !stored.acceptedBy
                        ) {
                          <button class="btn primary" (click)="customerResult(stored)">
                            记录客户结果
                          </button>
                        }
                        @if (stored.status === '已记录发出' && stored.acceptedBy) {
                          <button class="btn primary" (click)="lock(stored)">主管确认锁定</button>
                        }
                      }
                      @if (
                        stored.status === '已记录发出' ||
                        store.successfulLowPriceApproval(stored) ||
                        (legacy() &&
                          ['待模拟审核', '模拟审核通过', '附条件通过'].includes(stored.status))
                      ) {
                        <button class="btn" (click)="newVersion(stored)">创建报价新版</button>
                      }
                      @if (stored.status === '最终锁定' && !stored.invalidationReason) {
                        <button class="btn" (click)="reopen(stored)">批准重新报价</button>
                      }
                    }
                  </div>
                  <p class="muted">{{ nextAction(stored) }}</p>
                </section>
                @if (store.needsLowPriceApproval(stored)) {
                  <section class="form-section">
                    <h3>低价特批</h3>
                    <p>此版本有低于指导价的明细，发出前需完成独立特批。</p>
                    @for (approval of stored.discountApprovals || []; track approval.id) {
                      <p>
                        {{ approval.status }} · {{ approval.reason }} ·
                        {{ approval.opinion || '待处理' }} · 有效期 {{ approval.expiry }}
                      </p>
                    }
                    @if (
                      !closed() && stored.crmSchemaVersion === 1 && stored.status === '模拟审核通过'
                    ) {
                      <div class="record-actions">
                        @if (lastApproval(stored)?.status === '待审批') {
                          <button class="btn primary" (click)="decideApproval(stored, '通过')">
                            特批通过</button
                          ><button class="btn" (click)="decideApproval(stored, '退回')">
                            特批退回
                          </button>
                        } @else if (!store.successfulLowPriceApproval(stored)) {
                          <button class="btn" (click)="requestApproval(stored)">
                            申请低价特批
                          </button>
                        }
                      </div>
                    }
                  </section>
                }
                <section class="form-section">
                  <h3>审核与客户结果</h3>
                  <dl class="record-grid">
                    <dt>审核</dt>
                    <dd>{{ stored.reviewBy || '待审核' }} · {{ stored.reviewNote || '—' }}</dd>
                    <dt>发出</dt>
                    <dd>
                      {{ stored.sentDate || '—' }} · {{ stored.sentMethod || '—' }} ·
                      {{ stored.sentTo || '—' }}
                    </dd>
                    <dt>发出凭据</dt>
                    <dd>{{ stored.sentEvidence || '—' }}</dd>
                    <dt>客户结果</dt>
                    <dd>
                      {{ stored.customerDecision || (stored.acceptedBy ? '接受' : '尚未确认') }}
                    </dd>
                    <dt>客户确认</dt>
                    <dd>
                      {{ stored.acceptedBy || '—' }} · {{ stored.acceptedDate || '—' }} ·
                      {{ stored.acceptedEvidence || '—' }}
                    </dd>
                    <dt>最终锁定</dt>
                    <dd>{{ stored.lockedBy || '—' }} · {{ stored.lockedDate || '—' }}</dd>
                  </dl>
                </section>
                @if (stored.invalidationReason) {
                  <p class="inline-alert warning">{{ stored.invalidationReason }}</p>
                }
                <section class="form-section">
                  <h3>操作历史</h3>
                  <ol class="audit-list">
                    @for (entry of stored.audit.slice().reverse(); track entry.id) {
                      <li>
                        <div>
                          <strong>{{ entry.action }}</strong
                          ><span>{{ entry.person }} · {{ entry.date }}</span>
                        </div>
                        <p>{{ entry.note }}</p>
                      </li>
                    } @empty {
                      <li>暂无操作记录。</li>
                    }
                  </ol>
                  @if (stored.feedback.length || stored.conditions.length) {
                    <details>
                      <summary>旧版记录</summary>
                      @for (feedback of stored.feedback; track feedback.id) {
                        <p>{{ feedback.date }} · {{ feedback.kind }} · {{ feedback.summary }}</p>
                      }
                      @for (condition of stored.conditions; track condition.id) {
                        <p>
                          {{ condition.text }} · {{ condition.closed ? '已关闭' : '历史未关闭' }}
                        </p>
                      }
                    </details>
                  }
                </section>
              }
            </div>
          </section>
        }
      } @else {
        <section class="panel padded"><p>创建报价草稿后，填写摘要并添加产品明细。</p></section>
      }
    }
  `,
  styles: `
    .workspace {
      padding: 0 24px 24px;
    }
    .workspace-head {
      display: flex;
      flex-wrap: wrap;
      justify-content: space-between;
      align-items: center;
      gap: 16px;
      padding: 20px 0;
    }
    .version-picker,
    .primary-actions,
    .record-actions {
      display: flex;
      flex-wrap: wrap;
      gap: 10px;
      align-items: center;
    }
    .version-picker label {
      font-size: 14px;
      font-weight: 650;
      color: #23344e;
    }
    .version-picker select {
      border: 1px solid #cbd4e2;
      border-radius: 5px;
      padding: 8px;
      background: white;
      color: #23344e;
    }
    .save-state,
    .muted,
    .legacy-note {
      color: #6d7b91;
      font-size: 12px;
    }
    .legacy-note {
      padding: 10px 0;
      border-top: 1px solid #e0e6ee;
    }
    .workspace-tabs {
      display: flex;
      border-bottom: 1px solid #d7e0ec;
      gap: 28px;
    }
    .workspace-tabs button {
      appearance: none;
      border: 0;
      border-bottom: 3px solid transparent;
      padding: 14px 2px;
      background: none;
      color: #6a7890;
      font-size: 14px;
      font-weight: 600;
      cursor: pointer;
    }
    .workspace-tabs button.active {
      color: #315be6;
      border-bottom-color: #315be6;
    }
    .workspace-tabs span {
      margin-left: 8px;
      color: #6a7890;
      font-size: 12px;
    }
    .form-section {
      padding: 22px 0;
      border-bottom: 1px solid #e0e6ee;
    }
    .form-section h3 {
      margin: 0 0 16px;
      color: #23344e;
      font-size: 15px;
      font-weight: 650;
    }
    .field-grid {
      display: grid;
      grid-template-columns: repeat(3, minmax(0, 1fr));
      gap: 18px 26px;
    }
    .payment-detail dl,
    .record-grid {
      display: grid;
      grid-template-columns: 120px minmax(0, 1fr);
      gap: 10px 24px;
      margin: 0;
      font-size: 13px;
    }
    dt {
      color: #6d7b91;
    }
    dd {
      margin: 0;
      white-space: pre-wrap;
      overflow-wrap: anywhere;
    }
    .detail-toolbar {
      display: flex;
      justify-content: space-between;
      align-items: center;
      gap: 16px;
      padding: 18px 0;
    }
    .detail-toolbar p {
      margin: 0;
      font-size: 13px;
      color: #6d7b91;
    }
    .numeric {
      text-align: right;
      font-variant-numeric: tabular-nums;
      white-space: nowrap;
    }
    .selected-row {
      background: #f1f5ff;
    }
    .line-heading {
      display: flex;
      gap: 16px;
      align-items: baseline;
      margin-top: 24px;
    }
    .line-heading h3 {
      margin: 0;
      font-size: 16px;
    }
    .line-heading span {
      color: #8895a9;
      font-size: 11px;
      overflow-wrap: anywhere;
    }
    .remove {
      color: #a53e49;
    }
    .total-strip {
      display: flex;
      flex-wrap: wrap;
      justify-content: flex-end;
      gap: 26px;
      padding: 22px 0 0;
      color: #6d7b91;
      font-size: 13px;
    }
    .total-strip strong {
      margin-left: 8px;
      font-size: 16px;
      color: #23344e;
      font-variant-numeric: tabular-nums;
    }
    .validation {
      background: #fff4f2;
      color: #8f3030;
      border-left: 3px solid #bf4545;
      padding: 12px 18px;
      font-size: 13px;
    }
    .validation ul {
      margin: 8px 0 0;
      padding-left: 20px;
    }
    .audit-list {
      list-style: none;
      padding: 0;
      margin: 0;
    }
    .audit-list li {
      border-bottom: 1px solid #edf0f5;
      padding: 12px 0;
      font-size: 13px;
    }
    .audit-list li > div {
      display: flex;
      justify-content: space-between;
      flex-wrap: wrap;
      gap: 8px;
    }
    .audit-list span {
      color: #6d7b91;
      font-size: 12px;
    }
    .audit-list p {
      color: #526079;
      margin: 6px 0 0;
    }
    button:focus-visible,
    select:focus-visible,
    summary:focus-visible {
      outline: 2px solid #315be6;
      outline-offset: 3px;
    }
    @media (min-width: 1600px) {
      .field-grid {
        grid-template-columns: repeat(4, minmax(0, 1fr));
      }
    }
    @media (max-width: 1000px) {
      .field-grid {
        grid-template-columns: repeat(2, minmax(0, 1fr));
      }
      .workspace-head {
        align-items: flex-start;
      }
    }
    @media (max-width: 640px) {
      .workspace {
        padding: 0 14px 18px;
      }
      .field-grid {
        grid-template-columns: 1fr;
      }
      .primary-actions {
        width: 100%;
      }
      .save-state {
        width: 100%;
      }
      .workspace-tabs {
        gap: 20px;
      }
      .payment-detail dl,
      .record-grid {
        grid-template-columns: 1fr;
        gap: 5px;
      }
      dd {
        margin-bottom: 10px;
      }
      .line-heading {
        flex-wrap: wrap;
      }
    }
  `,
})
export class QuoteWorkspace implements OnDestroy {
  readonly demoPolicy = CRM_QUOTE_DEMO_POLICY;
  readonly demoCases = CRM_QUOTE_DEMO_CASES;
  readonly opportunityId = input('');
  readonly store = inject(DemoStore);
  private readonly route = inject(ActivatedRoute);
  readonly boardReturn = toSignal(this.route.queryParamMap.pipe(map(p=>p.get('returnTo') === '/projects/board')), {initialValue:false});
  readonly routeOpportunityId = toSignal(
    this.route.paramMap.pipe(map((params) => params.get('id') || '')),
    { initialValue: '' },
  );
  readonly activeOpportunityId = computed(() => this.opportunityId() || this.routeOpportunityId());
  /** 来源链接携带的 series/version 查询参数：只用于定位用户显式关联的那个报价系列与版本。 */
  private readonly routeSeriesId = toSignal(
    this.route.queryParamMap.pipe(map((params) => params.get('series') || '')),
    { initialValue: this.route.snapshot.queryParamMap.get('series') || '' },
  );
  readonly sale = computed(() => this.store.sale(this.activeOpportunityId()));
  // 参数指向的系列必须属于当前商机，否则忽略参数，保持「该商机第一个系列」的原有行为。
  readonly series = computed(() => {
    const opportunityId = this.activeOpportunityId();
    const linked = this.store.quoteSeriesById(this.routeSeriesId());
    return linked && linked.opportunityId === opportunityId
      ? linked
      : this.store.quoteSeries(opportunityId);
  });
  readonly selectedId = signal(this.route.snapshot.queryParamMap.get('version') || '');
  readonly current = computed(
    () =>
      this.series()?.versions.find((version) => version.id === this.selectedId()) ||
      this.series()?.versions.find((version) =>
        ['草稿', '退回补充', '待模拟审核'].includes(version.status),
      ) ||
      this.series()?.versions.at(-1),
  );
  readonly draft = signal<QuoteVersion | null>(null);
  readonly dirty = signal(false);
  readonly conflict = signal(false);
  readonly errors = signal<string[]>([]);
  readonly stageColumns = [
    { name: 'alp_name', label: '付款阶段' },
    { name: 'alp_method_of_payment', label: '付款方式' },
    { name: 'alp_condition', label: '付款条件' },
    { name: 'alp_proportion', label: '比例（%）' },
    { name: 'alp_days', label: '天数' },
    { name: 'alp_follow_fixedamount', label: '固定金额付款' },
    { name: 'alp_fixedamount', label: '固定金额' },
    { name: 'alp_delivery_in_full_payment', label: '全额付款后交货' },
    { name: 'createdon', label: '创建时间' },
  ];
  readonly tabs = ['摘要', '报价明细', '审核与记录'] as const;
  readonly activeTab = signal<(typeof this.tabs)[number]>('摘要');
  readonly selectedItem = signal('');
  readonly catalog = computed(() =>
    !this.editable() && this.current()?.crmReferenceSnapshot
      ? this.current()!.crmReferenceSnapshot!
      : this.store.crmQuoteCatalog(),
  );
  readonly closed = computed(() => ['赢单', '丢单'].includes(this.sale()?.stage || ''));
  readonly editable = computed(
    () =>
      !!this.current() &&
      !this.closed() &&
      ['草稿', '退回补充'].includes(this.current()!.status) &&
      !this.store.successfulLowPriceApproval(this.current()!),
  );
  readonly legacy = computed(() => this.current()?.crmSchemaVersion !== 1);
  readonly summaryGroups = [...new Set(CRM_SUMMARY_FIELDS.map((field) => field.group))];
  readonly detailGroups = [...new Set(CRM_DETAIL_FIELDS.map((field) => field.group))];
  readonly currentItem = computed(
    () =>
      this.draft()?.items.find((item) => item.id === this.selectedItem()) || this.draft()?.items[0],
  );
  readonly paymentTerm = computed(() =>
    this.catalog().references.find(
      (row) =>
        row.entity === 'alp_paymentterms' &&
        row.id === this.draft()?.crmFields?.['alp_paymenttermsid'],
    ),
  );
  readonly paymentStages = computed(() =>
    this.catalog().paymentStages.filter((stage) => stage.termId === this.paymentTerm()?.id),
  );
  constructor() {
    effect(() => {
      const version = this.current();
      untracked(() => {
        if (!version) {
          this.draft.set(null);
          return;
        }
        if (this.draft()?.id !== version.id || !this.dirty()) this.load(version);
        else if ((this.draft()?.contentRevision || 0) !== (version.contentRevision || 0))
          this.conflict.set(true);
      });
    });
  }
  ngOnDestroy(): void {
    this.store.setPendingInlineEdit(false);
  }
  private load(version: QuoteVersion): void {
    this.draft.set(this.store.crmQuoteDraft(version));
    this.dirty.set(false);
    this.conflict.set(false);
    this.errors.set([]);
    this.store.setPendingInlineEdit(false);
  }
  private changed(version: QuoteVersion): void {
    this.draft.set(version);
    this.dirty.set(true);
    this.errors.set([]);
    this.store.setPendingInlineEdit(true);
  }
  selectVersion(id: string): void {
    const select = () => {
      this.dirty.set(false);
      this.store.setPendingInlineEdit(false);
      this.selectedId.set(id);
      this.selectedItem.set('');
      this.activeTab.set('摘要');
    };
    if (!this.dirty()) {
      select();
      return;
    }
    this.store.ui.open({
      title: '切换报价版本',
      description: '当前修改尚未保存，切换后将放弃这些修改。',
      fields: [{ key: 'confirm', label: '输入“放弃修改”继续', required: true }],
      onSave: (data) => {
        if (data['confirm'] !== '放弃修改') return this.store.ui.fail('请输入“放弃修改”');
        select();
        return true;
      },
    });
  }
  create(): void {
    const id = this.store.createQuote(this.activeOpportunityId());
    if (id) this.selectedId.set(id);
  }
  summaryFields(group: string): CrmField[] {
    return CRM_SUMMARY_FIELDS.filter(
      (field) =>
        field.group === group &&
        crmFieldVisible(field, this.draft()?.crmFields || {}, this.draft()?.crmFields || {}),
    );
  }
  detailFields(group: string): CrmField[] {
    const organization = this.catalog().references.find(
      (row) => row.id === this.draft()?.crmFields?.['alp_salesbranch'],
    );
    return CRM_DETAIL_FIELDS.filter(
      (field) =>
        field.group === group &&
        crmFieldVisible(
          field,
          this.currentItem()?.crmFields || {},
          this.draft()?.crmFields || {},
          String(organization?.data['alp_salesorganizationcode'] || ''),
        ),
    );
  }
  references(field: CrmField, line: CrmValues = {}) {
    const rows = crmReferences(this.catalog(), field, this.draft()?.crmFields || {}, line);
    if (field.name === 'customerid')
      return rows.filter((row) => row.id === this.current()?.customerId);
    if (field.name === 'quoteid')
      return [
        { id: this.current()!.id, entity: 'quote', label: this.series()?.number || '', data: {} },
      ];
    return rows;
  }
  required(field: CrmField, values: CrmValues): boolean {
    return crmFieldRequired(field, values);
  }
  headerReadonly(field: CrmField): boolean {
    return (
      !this.editable() ||
      crmFieldReadonly(
        field,
        this.draft()?.crmFields || {},
        this.current()?.crmSchemaVersion === 1 && !!this.current()?.items.length,
      )
    );
  }
  lineReadonly(field: CrmField, item: QuoteItem): boolean {
    return !this.editable() || crmFieldReadonly(field, item.crmFields || {}, false);
  }
  lineRequired(field: CrmField, item: QuoteItem): boolean {
    return (
      (field.name === 'alp_skuid' && !!this.draft()?.crmFields?.['alp_sku_pricelevelid']) ||
      crmFieldRequired(field, item.crmFields || {})
    );
  }
  headerValue(name: string): CrmValue {
    if (
      this.legacy() &&
      !this.dirty() &&
      ['alp_quototalpriceofftax', 'alp_quototalpriceintax', 'alp_quotetotalamount'].includes(name)
    ) {
      const totals = this.store.quoteTotals(this.current()!);
      return name === 'alp_quototalpriceofftax' ? totals.net : totals.total;
    }
    return this.draft()?.crmFields?.[name] ?? null;
  }
  setHeader(name: string, value: CrmValue): void {
    if (!this.editable()) return;
    const version = structuredClone(this.draft()!);
    version.crmFields![name] = value;
    if (name === 'alp_isintax' && value === 20) version.crmFields!['alp_tax_rate'] = 0;
    if (name === 'customerid') version.crmFields!['alp_paymenttermsid'] = null;
    if (['transactioncurrencyid', 'alp_price_list'].includes(name))
      version.items = version.items.map((item) => ({
        ...item,
        crmFields: calculateCrmLine(
          applyCrmProduct(
            {
              ...item.crmFields,
              transactioncurrencyid: version.crmFields!['transactioncurrencyid'] ?? null,
            },
            version.crmFields!,
            this.catalog(),
          ),
        ),
      }));
    const currency = this.catalog().references.find(
      (row) => row.id === version.crmFields!['transactioncurrencyid'],
    );
    if (currency) version.currency = String(currency.data['isocurrencycode']);
    Object.assign(version.crmFields!, crmAggregate(version.items));
    this.changed(version);
  }
  addItem(): void {
    if (!this.editable()) return;
    const version = structuredClone(this.draft()!);
    const id = newId('QI');
    const fields: CrmValues = {
      alp_quotedetailnumber: id,
      quoteid: version.id,
      transactioncurrencyid: version.crmFields!['transactioncurrencyid'] ?? null,
      alp_isintax: version.crmFields!['alp_isintax'] ?? null,
      alp_taxpercentage: version.crmFields!['alp_tax_rate'] ?? null,
      quantity: 1,
      propertyconfigurationstatus: 2,
    };
    version.items.push({
      id,
      category: '货物',
      name: '',
      spec: '',
      unit: '',
      quantity: 1,
      unitPrice: 0,
      source: '标准CRM本地资料快照',
      crmFields: calculateCrmLine(fields),
    });
    this.changed(version);
    this.selectedItem.set(id);
  }
  removeItem(id: string): void {
    if (!this.editable()) return;
    const version = structuredClone(this.draft()!);
    version.items = version.items.filter((item) => item.id !== id);
    Object.assign(version.crmFields!, crmAggregate(version.items));
    this.changed(version);
  }
  setLine(id: string, name: string, value: CrmValue): void {
    if (!this.editable()) return;
    const version = structuredClone(this.draft()!);
    const item = version.items.find((row) => row.id === id)!;
    let fields: CrmValues = { ...item.crmFields, [name]: value };
    if (name === 'alp_skuid') {
      const field = CRM_DETAIL_FIELDS.find((candidate) => candidate.name === 'alp_productcode')!;
      const candidates = crmReferences(this.catalog(), field, version.crmFields!, fields);
      fields['alp_productcode'] =
        candidates.find((row) =>
          this.catalog().skuLinks.some(
            (link) => link.skuId === value && link.productId === row.id && link.default,
          ),
        )?.id ||
        candidates[0]?.id ||
        null;
    }
    if (name === 'alp_productcode' || name === 'alp_skuid') {
      fields['alp_product_description'] = null;
      fields = applyCrmProduct(fields, version.crmFields!, this.catalog());
    }
    item.crmFields = calculateCrmLine(fields, name === 'alp_isintax' ? 'alp_taxpercentage' : name);
    if (name === 'alp_priceperunit' || name === 'alp_beforedispriceintax')
      item.crmPriceInput = name;
    item.name =
      this.catalog().references.find((row) => row.id === fields['alp_productcode'])?.label || '';
    item.quantity = crmNumber(item.crmFields, 'quantity');
    item.unitPrice = crmNumber(item.crmFields, 'alp_priceperunit');
    Object.assign(version.crmFields!, crmAggregate(version.items));
    this.changed(version);
  }
  save(): boolean {
    if (!this.editable() || this.conflict()) return false;
    const input = { ...structuredClone(this.draft()!), crmSchemaVersion: 1 as const };
    const errors = crmQuoteErrors(input, this.catalog(), true).filter(
      (error) => error !== '请添加报价明细',
    );
    if (errors.length) {
      this.errors.set(errors);
      return false;
    }
    const ok = this.store.saveCrmQuote(input);
    if (ok) this.load(this.store.quoteVersion(input.id)!);
    return ok;
  }
  submit(): void {
    if (this.save()) {
      if (this.store.submitQuote(this.draft()!.id)) this.activeTab.set('审核与记录');
    }
  }
  number(value: CrmValue | undefined): string {
    return value == null
      ? '—'
      : typeof value === 'number'
        ? value.toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
        : String(value);
  }
  itemName(item: QuoteItem): string {
    return (
      this.catalog().references.find((row) => row.id === item.crmFields?.['alp_productcode'])
        ?.label ||
      item.name ||
      '待选择产品'
    );
  }
  paymentOwner(value: CrmValue | undefined): string {
    return String(
      this.paymentTerm()?.data['ownerName'] ||
        this.catalog().references.find((row) => row.id === value)?.label ||
        (value ? '负责人记录未包含在当前快照' : '—'),
    );
  }
  lastApproval(version: QuoteVersion) {
    return version.discountApprovals?.at(-1);
  }
  nextAction(version: QuoteVersion): string {
    if (this.closed()) return '商机已关闭。';
    if (version.crmSchemaVersion !== 1 && !this.editable())
      return '旧版记录保留供查阅；需要调整时请创建新版。';
    return {
      草稿: '填写摘要和明细，保存后提交审核。',
      退回补充: '修改后重新保存并提交审核。',
      待模拟审核: '等待审核通过或退回补充。',
      模拟审核通过: '完成必要的低价特批后，记录实际发出。',
      已记录发出:
        version.customerDecision === '不接受'
          ? '客户不接受当前报价，可创建新版继续报价。'
          : '记录客户最终结果；客户接受后由主管确认锁定。',
      最终锁定: '此版本已作为最终报价锁定。',
      附条件通过: '此为历史附条件审核记录。',
      作废: '此版本已作废。',
    }[version.status];
  }
  review(version: QuoteVersion): void {
    this.store.ui.open({
      title: '审核报价',
      fields: [
        {
          key: 'result',
          label: '审核结果',
          type: 'select',
          options: ['模拟审核通过', '退回补充'],
          value: '模拟审核通过',
          required: true,
        },
        { key: 'note', label: '审核意见', type: 'textarea', required: true },
      ],
      onSave: (data) =>
        this.store.reviewQuote(
          version.id,
          data['result'] as '模拟审核通过' | '退回补充',
          data['note'],
          '',
          version.contentRevision || 0,
        ),
    });
  }
  requestApproval(version: QuoteVersion): void {
    this.store.ui.open({
      title: '申请低价特批',
      fields: [
        { key: 'reason', label: '申请理由', type: 'textarea', required: true },
        {
          key: 'expiry',
          label: '有效期截止日',
          type: 'date',
          value: version.validUntil,
          required: true,
        },
      ],
      onSave: (data) =>
        this.store.requestLowPriceApproval(version.id, data['reason'], data['expiry']),
    });
  }
  decideApproval(version: QuoteVersion, result: '通过' | '退回'): void {
    this.store.ui.open({
      title: `低价特批${result}`,
      fields: [{ key: 'opinion', label: '特批意见', type: 'textarea', required: true }],
      onSave: (data) => this.store.decideLowPriceApproval(version.id, result, data['opinion']),
    });
  }
  recordSent(version: QuoteVersion): void {
    this.store.ui.open({
      title: '记录报价已发出',
      description: '记录实际交付情况，不会自动发送邮件。',
      fields: [
        { key: 'date', label: '发出日期', type: 'date', value: BASE_DATE, required: true },
        {
          key: 'method',
          label: '发出方式',
          type: 'select',
          options: ['邮件（手工发送）', '会议交付', '其他'],
          required: true,
        },
        personField(
          'recipient',
          '接收人',
          this.store.contact(this.sale()!)?.name || '',
          true,
          this.store.customer(version.customerId)?.contacts.map((contact) => contact.name) || [],
        ),
        { key: 'evidence', label: '发出凭据', type: 'textarea', required: true },
      ],
      onSave: (data) =>
        this.store.recordQuoteSent(
          version.id,
          data['date'],
          data['method'],
          data['recipient'],
          data['evidence'],
          version.contentRevision || 0,
        ),
    });
  }
  customerResult(version: QuoteVersion): void {
    this.store.ui.open({
      title: '记录客户结果',
      fields: [
        {
          key: 'result',
          label: '最终结果',
          type: 'select',
          options: ['接受', '不接受'],
          required: true,
        },
        { key: 'date', label: '确认日期', type: 'date', value: BASE_DATE, required: true },
        personField(
          'person',
          '客户确认人',
          '',
          true,
          this.store.customer(version.customerId)?.contacts.map((contact) => contact.name) || [],
        ),
        { key: 'evidence', label: '确认凭据', type: 'textarea', required: true },
      ],
      onSave: (data) =>
        this.store.recordCrmCustomerDecision(
          version.id,
          data['result'] as '接受' | '不接受',
          data['person'],
          data['evidence'],
          data['date'],
        ),
    });
  }
  lock(version: QuoteVersion): void {
    this.store.ui.open({
      title: '主管确认锁定',
      description: '确认客户接受、报价金额及版本后，一次完成最终锁定。',
      fields: [{ key: 'confirm', label: '输入“确认锁定”继续', required: true }],
      onSave: (data) =>
        data['confirm'] === '确认锁定'
          ? this.store.lockQuote(version.id)
          : this.store.ui.fail('请输入“确认锁定”'),
    });
  }
  newVersion(version: QuoteVersion): void {
    this.store.ui.open({
      title: '创建报价新版',
      fields: [{ key: 'reason', label: '修改原因', type: 'textarea', required: true }],
      onSave: (data) => {
        const id = this.store.createQuoteVersion(version.id, data['reason']);
        if (id) this.selectedId.set(id);
        return !!id;
      },
    });
  }
  reopen(version: QuoteVersion): void {
    this.store.ui.open({
      title: '批准重新报价',
      fields: [{ key: 'reason', label: '重新报价原因', type: 'textarea', required: true }],
      onSave: (data) => {
        const id = this.store.reopenLockedQuote(version.id, data['reason']);
        if (id) this.selectedId.set(id);
        return !!id;
      },
    });
  }
}
