import { TrackingCharts } from './tracking-charts';
import { planWarningDate } from '../core/plan-warning-backfill';
import { ContractMilestones } from './contract-milestones';
import { ContractMainFields } from './contract-main-fields';
import { contractDemoDetails } from '../core/contract-demo-details';
import { ContractOriginalFile } from './contract-original-file';
import { ContractQuoteReference } from './contract-quote-reference';
import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  inject,
  signal,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { toSignal } from '@angular/core/rxjs-interop';
import { map } from 'rxjs';
import { DemoStore } from '../core/store';
import { personField, PROJECT_MANAGERS } from '../core/personnel';
import { BASE_DATE, Contract, FieldOption, Project } from '../core/models';
import {
  collectPlanRiskRows,
  isPlanWarningRead,
  planWarningPersonKey,
  planWarningStats,
  planWarningViews,
  PlanRiskRow,
  PlanWarningView,
} from '../core/plan-warnings';
import { Icon } from '../shared/icon';
import { parseRouteHref } from '../core/route-href';
import { Badge } from '../shared/badge';

type Page = 'solutions' | 'quotes' | 'contracts' | 'plans' | 'tracking' | 'logistics' | 'service';

@Component({
  imports: [
    FormsModule,
    RouterLink,
    Icon,
    Badge,
    ContractMainFields,
    ContractOriginalFile,
    ContractQuoteReference,
    ContractMilestones,
    TrackingCharts,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (!(page() === 'contracts' && id())) {
      <div class="page-heading">
        <div>
          <h1>{{ title() }}</h1>
          <p>{{ description() }}</p>
        </div>
        @if (page() === 'quotes') {
          <button class="btn primary" [disabled]="!store.salesEditable()" (click)="newQuote()">
            创建报价草稿
          </button>
        }
        @if (page() === 'contracts') {
          <button class="btn primary" [disabled]="!store.salesEditable()" (click)="newContract()">
            创建合同草稿
          </button>
        }
      </div>
    }
    @if (
      !(page() === 'contracts' && id()) &&
      (page() === 'solutions' ||
        page() === 'quotes' ||
        page() === 'contracts' ||
        isDeliveryPage() ||
        page() === 'tracking')
    ) {
      <div class="filter-bar">
        <label class="search-box"
          ><app-icon name="search" /><input
            aria-label="搜索记录"
            placeholder="搜索客户、项目或编号"
            [(ngModel)]="query"
        /></label>
        @if (page() === 'solutions') {
          <select aria-label="方案负责人筛选" [(ngModel)]="owner">
            <option value="">全部负责人</option>
            @for (person of owners(); track person) {
              <option [value]="person">{{ person }}</option>
            }
          </select>
        }
        @if (page() === 'solutions' || page() === 'quotes') {
          <select aria-label="状态筛选" [(ngModel)]="status">
            <option value="">全部状态</option>
            @for (item of statusOptions(); track item) {
              <option [value]="item">{{ item }}</option>
            }
          </select>
        }
        @if (isDeliveryPage()) {
          <select aria-label="项目经理筛选" [(ngModel)]="owner">
            <option value="">全部项目经理</option>
            @for (person of owners(); track person) {
              <option [value]="person">{{ person }}</option>
            }
          </select>
        }
        @if (page() === 'tracking') {
          <select aria-label="追踪类别" [(ngModel)]="status">
            <option value="">全部任务</option>
            <option value="延期">已逾期</option>
            <option value="临近到期">临期（预警窗口内）</option>
            <option value="预警待设置">预警待设置</option>
            <option value="日期待补">日期待补</option>
            <option value="已完成（逾期）">已完成（逾期）</option>
            <option value="财务">应收逾期</option>
          </select>
          <select aria-label="追踪项目筛选" [(ngModel)]="trackingProject">
            <option value="">全部项目</option>
            @for (project of trackingProjectOptions(); track project.id) {
              <option [value]="project.id">{{ project.name }}</option>
            }
          </select>
          <select aria-label="追踪负责人筛选" [(ngModel)]="trackingOwner">
            <option value="">全部负责人</option>
            @for (person of trackingOwnerOptions(); track person) {
              <option [value]="person">{{ person }}</option>
            }
          </select>
        }
        <span class="grow"></span><span class="count-label">{{ count() }}条记录</span>
      </div>
    }

    @switch (page()) {
      @case ('solutions') {
        <section class="panel">
          <div class="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>商机 / 项目</th>
                  <th>客户</th>
                  <th>负责人</th>
                  <th>商机阶段</th>
                  <th>最新方案版本</th>
                  <th>最终确认版</th>
                  <th>方案状态</th>
                  <th>入口</th>
                </tr>
              </thead>
              <tbody>
                @for (sale of solutions(); track sale.id) {
                  <tr>
                    <td>
                      <a class="main-link" [routerLink]="['/sales/solutions', sale.id]">{{
                        sale.projectName
                      }}</a>
                      <p>{{ sale.id }}</p>
                    </td>
                    <td>{{ store.customer(sale.customerId)?.shortName }}</td>
                    <td>{{ solutionOwner(sale.id) }}</td>
                    <td><app-badge [text]="sale.stage" /></td>
                    <td>{{ solutionLatest(sale.id) }}</td>
                    <td>{{ solutionFinal(sale.id) }}</td>
                    <td>{{ solutionStatus(sale.id) }}</td>
                    <td>
                      <a class="text-link" [routerLink]="['/sales/solutions', sale.id]">打开方案</a>
                      · <a class="text-link" [routerLink]="['/sales/quotes', sale.id]">进入报价</a>
                    </td>
                  </tr>
                } @empty {
                  <tr>
                    <td colspan="8" class="empty">
                      没有匹配的有效商机；调整筛选后可继续查找待制作方案。
                    </td>
                  </tr>
                }
              </tbody>
            </table>
          </div>
        </section>
      }
      @case ('quotes') {
        @if (quoteCurrencyTotals().length) {
          <div class="currency-summary">
            @for (item of quoteCurrencyTotals(); track item.currency) {
              <span
                >报价总额（{{ item.currency }}） <strong>{{ item.total }}</strong></span
              >
            }
          </div>
        }
        <section class="panel">
          <div class="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>报价系列</th>
                  <th>商机 / 客户</th>
                  <th>当前版本</th>
                  <th>负责人</th>
                  <th>报价金额</th>
                  <th>计划发出 / 有效期</th>
                  <th>最终锁定版本</th>
                  <th>操作</th>
                </tr>
              </thead>
              <tbody>
                @for (series of quoteSeries(); track series.id) {
                  @if (quoteMatches(series)) {
                    @let sale = store.sale(series.opportunityId);
                    @let current = currentQuote(series);
                    <tr>
                      <td>
                        <strong>{{ series.number }}</strong>
                        <p>{{ series.id }}</p>
                      </td>
                      <td>
                        <a
                          class="main-link"
                          [routerLink]="['/sales/quotes', series.opportunityId]"
                          >{{ sale?.projectName }}</a
                        >
                        <p>
                          {{ store.customer(sale?.customerId || '')?.shortName }} · {{ sale?.id }}
                        </p>
                      </td>
                      <td>
                        <app-badge [text]="current?.status || '无版本'" />
                        <p>V{{ current?.number || '—' }} · {{ current?.title || '' }}</p>
                      </td>
                      <td>{{ current?.owner }}</td>
                      <td>{{ quoteAmount(current) }}</td>
                      <td>
                        {{ current?.plannedSendDate || '待补' }} /
                        {{ current?.validUntil || '待补' }}
                      </td>
                      <td>{{ lockedQuote(series) }}</td>
                      <td>
                        <a class="text-link" [routerLink]="['/sales/quotes', series.opportunityId]"
                          >打开工作区</a
                        >
                      </td>
                    </tr>
                  }
                } @empty {
                  <tr>
                    <td colspan="8" class="empty">
                      还没有报价系列。可以选择已进入方案报价阶段的商机创建草稿。
                    </td>
                  </tr>
                }
              </tbody>
            </table>
          </div>
        </section>
        <div class="inline-alert space-top">
          <app-icon name="info" /><span
            >同一系列只计一条记录；版本、审核、发出和锁定沿用原报价工作区及门禁。</span
          >
        </div>
      }
      @case ('contracts') {
        @if (selectedContract(); as sourceContract) {
          @let contract = contractPresentation(sourceContract);
          <div class="contract-workspace">
            <div class="contract-breadcrumb">
              <a routerLink="/contracts">合同管理</a><app-icon name="chevron" /><span>{{
                contract.id
              }}</span>
            </div>
            <section class="panel contract-detail">
              <header class="contract-header">
                <div class="contract-heading-copy">
                  <div class="contract-status-line">
                    <span class="document-label"><app-icon name="file" />采购合同</span
                    ><app-badge [text]="contract.status || '历史登记'" />
                    @if (contract.id === 'DEMO-CON001') {
                      <span class="sample-label">模拟业务资料</span>
                    }
                  </div>
                  <h1>{{ contract.title || '合同草稿' }}</h1>
                  <p>
                    {{ contract.crmFields?.['alp_contractcode'] || contract.id
                    }}<span class="header-divider"></span
                    >{{ contract.customerAdoptedName || store.customer(contract.customerId)?.name }}
                  </p>
                </div>
                <div class="contract-header-actions">
                  @if (contract.status === '草稿') {
                    <button class="btn" (click)="editContract(contract)">
                      <app-icon name="edit" />编辑草稿
                    </button>
                    <button class="btn primary" (click)="registerContract(contract)">
                      登记签约信息
                    </button>
                  } @else {
                    <button class="btn" (click)="loadG3(contract)">加载G3模拟结果</button>
                    <button class="btn primary" (click)="createProject(contract)">
                      <app-icon name="plus" />创建关联项目
                    </button>
                  }
                </div>
              </header>
              <div class="contract-overview">
                <div class="contract-amount">
                  <span>合同总额 · {{ contract.currency }}</span
                  ><strong>{{ store.money(contract.amount, contract.currency) }}</strong
                  ><small>金额以当前合同记录为准</small>
                </div>
                <div>
                  <span>付款约定</span><strong>{{ contract.payment || '尚未约定' }}</strong
                  ><small>按合同约定的业务节点支付</small>
                </div>
                <div>
                  <span>{{ contract.status === '草稿' ? '计划签约日期' : '签约日期' }}</span
                  ><strong>{{
                    contract.signedDate ||
                      (contract.status === '草稿' ? contract.plannedSignDate : '') ||
                      '尚未登记'
                  }}</strong
                  ><small>{{
                    contract.signedDate
                      ? '已记录签约日期'
                      : '计划签约：' + (contract.plannedSignDate || '尚未约定')
                  }}</small>
                </div>
              </div>
              <nav class="contract-tabs" aria-label="合同详情板块">
                @for (tab of contractTabs; track tab) {
                  <button
                    type="button"
                    [class.active]="contractTab() === tab"
                    [attr.aria-pressed]="contractTab() === tab"
                    (click)="contractTab.set(tab)"
                  >
                    {{ tab }}
                  </button>
                }
              </nav>
            </section>
            @if (contract.id === 'DEMO-CON001') {
              <p class="contract-demo-note">
                <app-icon name="info" />补充资料为本地演示示例；签约、审批及附件状态以实际记录为准。
              </p>
            }
            <div class="contract-body-layout">
              <main class="contract-main-column">
                <div [hidden]="contractTab() !== '合同信息'">
                  <section class="contract-section contract-parties" aria-label="合同双方">
                    <div class="contract-section-heading">
                      <h2>合同双方</h2>
                      <span>主体与商务联系</span>
                    </div>
                    <div class="party-grid">
                      <div>
                        <span class="party-role">采购方 · 甲方</span>
                        <h3>
                          {{
                            contract.customerAdoptedName ||
                              store.customer(contract.customerId)?.name
                          }}
                        </h3>
                        <p>
                          {{
                            contract.crmFields?.['alp_address'] ||
                              store.customer(contract.customerId)?.address ||
                              '尚未填写地址'
                          }}
                        </p>
                        <a [routerLink]="['/sales/customers', contract.customerId]"
                          >查看客户档案 <app-icon name="chevron"
                        /></a>
                      </div>
                      <div>
                        <span class="party-role">供货方 · 乙方</span>
                        <h3>{{ contract.sellerEntity || '尚未填写供货主体' }}</h3>
                        <p>{{ contract.product || '尚未约定供货产品' }}</p>
                        <span class="party-support"
                          >{{
                            store.sale(contract.opportunityId)?.owner ||
                              contract.createdBy ||
                              '尚未分配'
                          }}
                          · 业务负责人</span
                        >
                      </div>
                    </div>
                  </section>
                  <app-contract-main-fields [contract]="contract" />
                  <app-contract-quote-reference [contract]="contract" />
                  <app-contract-original-file [contract]="contract" />
                  <section class="contract-section" aria-label="供货与履约约定">
                    <div class="contract-section-heading">
                      <h2>供货与履约约定</h2>
                      <span>交付团队共同参考</span>
                    </div>
                    <dl class="contract-terms">
                      <div>
                        <dt>供货范围</dt>
                        <dd>{{ contract.scope || '尚未约定' }}</dd>
                      </div>
                      <div>
                        <dt>交付安排</dt>
                        <dd>{{ contract.delivery || '尚未约定' }}</dd>
                      </div>
                      <div>
                        <dt>质保条款</dt>
                        <dd>{{ contract.warranty || '尚未约定' }}</dd>
                      </div>
                      <div>
                        <dt>服务支持</dt>
                        <dd>{{ contract.service || '尚未约定' }}</dd>
                      </div>
                      <div>
                        <dt>违约约定</dt>
                        <dd>{{ contract.penalty || '尚未约定' }}</dd>
                      </div>
                      <div>
                        <dt>其他说明</dt>
                        <dd>{{ contract.note || '暂无补充说明' }}</dd>
                      </div>
                    </dl>
                  </section>
                </div>
                <div [hidden]="contractTab() !== '商务与支付'">
                  <section class="contract-section" aria-label="付款安排">
                    <div class="contract-section-heading">
                      <h2>付款安排</h2>
                      <span>合同金额 {{ store.money(contract.amount, contract.currency) }}</span>
                    </div>
                    <p class="payment-agreement">{{ contract.payment || '尚未约定付款条件' }}</p>
                    @if (
                      contract.id === 'DEMO-CON001' &&
                      contract.payment.includes('签约30% / 发货60% / 验收10%')
                    ) {
                      <div class="payment-schedule">
                        @for (stage of demoPaymentStages; track stage.name) {
                          <article>
                            <span>{{ stage.name }}</span
                            ><strong>{{ stage.percent }}<small>%</small></strong>
                            <p>
                              {{
                                store.money(
                                  (contract.amount * stage.percent) / 100,
                                  contract.currency
                                )
                              }}
                            </p>
                            <small>{{ stage.condition }}</small>
                          </article>
                        }
                      </div>
                      <p class="schedule-note">
                        按本示例 30% / 60% / 10% 拆分，仅用于展示约定金额，不表示已开票或已收款。
                      </p>
                    }
                  </section>
                  <section class="contract-departments" aria-label="合同支付条款">
                    <div>
                      <h3>支付条款与付款方式</h3>
                      @if (contract.paymentSnapshot; as snapshot) {
                        <p>
                          签约时固定的采用摘要 · {{ snapshot.adoptedAt }} · {{ snapshot.adoptedBy }}
                        </p>
                        <strong
                          >{{ snapshot.term.code }} ·
                          {{ snapshot.term.descriptionZh || snapshot.adoptedText }}</strong
                        >
                        @for (method of snapshot.methods; track method.id) {
                          <p>
                            {{ method.name }} · {{ method.condition }} ·
                            {{ method.proportion ?? '比例待核' }}% ·
                            {{ method.days ?? '天数待核' }}天 · 支付方式 {{ method.method }} ·
                            按固定金额 {{ method.followFixedAmount ? '是' : '否' }} · 固定金额
                            {{ method.fixedAmount ?? '未提供' }} · 款清发货
                            {{ method.deliveryInFullPayment || '空' }} ·
                            {{ method.deliveryInFullPaymentNeedsReview ? '来源冲突待核' : '' }} ·
                            创建时间 {{ method.createdAt || '未记录' }} · 负责人
                            {{ method.ownerName || '未记录' }}
                          </p>
                        }
                      } @else if (contract.status === '草稿') {
                        <label
                          >采用主条款
                          <select
                            aria-label="合同采用支付条款"
                            [ngModel]="contract.paymentTermId || ''"
                            (ngModelChange)="chooseContractTerm(contract, $event)"
                          >
                            <option value="">未选择结构化条款</option>
                            @for (term of store.paymentTerms(); track term.id) {
                              <option [value]="term.id">
                                {{ term.code }} · {{ term.descriptionZh }}
                              </option>
                            }
                          </select>
                        </label>
                        @for (term of store.paymentTerms(); track term.id) {
                          <p>
                            {{ term.code }} · {{ term.descriptionZh }} · {{ term.descriptionEn }} ·
                            {{ term.descriptionDe }} · 负责人 {{ term.ownerName || '未记录' }} ·
                            修订
                            {{ term.revision }}
                            <button class="text-link" type="button" (click)="editPaymentTerm(term)">
                              维护主记录
                            </button>
                          </p>
                        }
                        @if (contract.paymentTermId) {
                          @for (
                            method of store.paymentMethods(contract.paymentTermId);
                            track method.id
                          ) {
                            <label class="inline-control"
                              ><input
                                type="checkbox"
                                [ngModel]="contract.paymentMethodIds?.includes(method.id) || false"
                                (ngModelChange)="
                                  toggleContractPaymentMethod(contract, method.id, $event)
                                "
                              />{{ method.name }} · {{ method.condition }} ·
                              {{ method.proportion ?? '比例待核' }}% ·
                              {{ method.days ?? '天数待核' }}天 · 支付方式 {{ method.method }} ·
                              按固定金额 {{ method.followFixedAmount ? '是' : '否' }} · 固定金额
                              {{ method.fixedAmount ?? '未提供' }} · 款清发货
                              {{ method.deliveryInFullPayment || '空' }} ·
                              {{ method.deliveryInFullPaymentNeedsReview ? '来源冲突待核' : '' }} ·
                              创建时间 {{ method.createdAt || '未记录' }} · 负责人
                              {{ method.ownerName || '未记录' }}
                              <button
                                class="text-link"
                                type="button"
                                (click)="$event.preventDefault(); editPaymentMethod(method)"
                              >
                                维护
                              </button></label
                            >
                          }
                        }
                        <div class="row-actions">
                          <button class="btn" (click)="newPaymentTerm()">财务新增支付条款</button>
                          <button
                            class="btn"
                            [disabled]="!contract.paymentTermId"
                            (click)="newPaymentMethod(contract.paymentTermId || '')"
                          >
                            财务新增付款方式
                          </button>
                        </div>
                        <small
                          >结构化主数据与合同现有付款条件文本分别保存；签约后会将采用版本复制为历史摘要。</small
                        >
                      } @else {
                        <p>
                          历史合同没有结构化采用快照；原付款条件保留：{{
                            contract.payment || '待补'
                          }}
                        </p>
                      }
                    </div>
                  </section>
                </div>
                <div [hidden]="contractTab() !== '协作与关联'">
                  <app-contract-milestones [contractId]="contract.id" />
                  <section class="contract-departments" aria-label="合同部门共用视图">
                    <div>
                      <h3>同一合同 · 部门查看状态</h3>
                      <p>
                        各部门引用统一合同记录
                        {{ contract.id }}；页面不复制合同主体，也不把空子表显示成已评审。
                      </p>
                    </div>
                    <div class="contract-department-grid">
                      @for (department of contractDepartments; track department) {
                        <article>
                          <strong>{{ department }}</strong>
                          @if (department === '销售') {
                            <span>统一合同主体见上方</span>
                          } @else {
                            <span>暂无 {{ department }} 独立子表记录</span>
                          }
                        </article>
                      }
                    </div>
                  </section>
                  <div class="row-actions" aria-label="合同财务只读历史">
                    <a class="btn" [routerLink]="['/contracts', contract.id, 'orders']"
                      >订单与明细历史（只读）</a
                    >
                    <a class="btn" [routerLink]="['/contracts', contract.id, 'invoices']"
                      >发票与余额历史（只读）</a
                    >
                    <a class="btn" [routerLink]="['/contracts', contract.id, 'receipts']"
                      >水单认领历史（只读）</a
                    >
                  </div>
                  <small class="muted"
                    >合同订单、明细、发票和水单认领已停用新增与编辑；以上入口只展示历史、稳定ID、余额和项目引用。</small
                  >
                  @if (contractProjects(contract.id).length) {
                    <div class="related-projects">
                      <h3>关联项目</h3>
                      @for (project of contractProjects(contract.id); track project.id) {
                        <a
                          [routerLink]="['/projects', project.id]"
                          queryParamsHandling="merge"
                          [preserveFragment]="true"
                          >{{ project.name }} · {{ project.id }} <app-badge [text]="project.status"
                        /></a>
                      }
                    </div>
                  }
                  @if (contract.status !== '草稿' && unlinkedProjects(contract).length) {
                    <button class="btn" (click)="associateProject(contract)">
                      关联已有项目草稿
                    </button>
                  }
                </div>
              </main>
              <aside class="contract-side-column" aria-label="合同业务摘要">
                <section class="contract-section">
                  <div class="contract-section-heading">
                    <h2>业务摘要</h2>
                    <app-icon name="file" />
                  </div>
                  <dl class="contract-summary-list">
                    <div>
                      <dt>合同状态</dt>
                      <dd><app-badge [text]="contract.status || '历史登记'" /></dd>
                    </div>
                    <div>
                      <dt>业务负责人</dt>
                      <dd>
                        {{
                          store.sale(contract.opportunityId)?.owner ||
                            contract.createdBy ||
                            '尚未分配'
                        }}
                      </dd>
                    </div>
                    <div>
                      <dt>来源商机</dt>
                      <dd>
                        <a [routerLink]="['/sales/detail', contract.opportunityId]">{{
                          store.sale(contract.opportunityId)?.projectName || contract.opportunityId
                        }}</a
                        ><small>{{ contract.opportunityId }}</small>
                      </dd>
                    </div>
                    <div>
                      <dt>引用报价</dt>
                      <dd>{{ quoteReference(contract) }}</dd>
                    </div>
                    <div>
                      <dt>合同版本</dt>
                      <dd>
                        V{{ contract.crmFields?.['alp_version'] || 1
                        }}<small>主字段修订 {{ contract.mainFieldsRevision || 0 }}</small>
                      </dd>
                    </div>
                  </dl>
                </section>
                <section class="contract-section">
                  <div class="contract-section-heading">
                    <h2>签约与原件</h2>
                    <app-icon name="lock" />
                  </div>
                  <div class="contract-record">
                    <span>签约凭据</span>
                    <p>{{ contract.evidence || '尚未登记签约凭据' }}</p>
                  </div>
                  <div class="contract-record">
                    <span>合同原件</span>
                    <p>
                      {{
                        contract.currentContractFileVersionId
                          ? '已关联合同原件版本'
                          : '尚未关联合同原件'
                      }}
                    </p>
                  </div>
                  <div class="contract-record">
                    <span>G3 结果</span>
                    <p>{{ contract.g3 || '尚未评审' }}</p>
                  </div>
                </section>
                <section class="contract-section related-summary">
                  <div class="contract-section-heading">
                    <h2>关联业务</h2>
                    <span>{{ contractProjects(contract.id).length }} 个项目</span>
                  </div>
                  <a [routerLink]="['/contracts', contract.id, 'orders']"
                    ><app-icon name="sales" /><span>合同订单与明细（只读）</span
                    ><app-icon name="chevron"
                  /></a>
                  <a [routerLink]="['/contracts', contract.id, 'invoices']"
                    ><app-icon name="file" /><span>合同发票（只读）</span><app-icon name="chevron"
                  /></a>
                  <a [routerLink]="['/contracts', contract.id, 'receipts']"
                    ><app-icon name="building" /><span>水单认领（只读）</span
                    ><app-icon name="chevron"
                  /></a>
                </section>
                <p class="contract-side-note">
                  <app-icon name="lock" />{{
                    contract.status === '草稿'
                      ? '完成资料确认后，由主管登记签约。'
                      : '合同主体、报价依据与项目关联在此统一查看。'
                  }}
                </p>
              </aside>
            </div>
          </div>
        } @else if (id() && id() !== 'new') {
          <section class="panel padded" aria-label="找不到合同">
            <h2>找不到合同</h2>
            <p>请求的合同 ID：{{ id() }}。该记录不存在或已不在当前工作区。</p>
            <a class="text-link" routerLink="/contracts">返回合同台账</a>
          </section>
        } @else {
          <section class="panel">
            <div class="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>合同 / 客户</th>
                    <th>来源商机</th>
                    <th>引用报价版本</th>
                    <th>金额 / 币种</th>
                    <th>登记状态</th>
                    <th>签约日期</th>
                    <th>项目数</th>
                    <th>G3模拟</th>
                    <th>操作</th>
                  </tr>
                </thead>
                <tbody>
                  @for (contract of contracts(); track contract.id) {
                    <tr>
                      <td>
                        <a class="main-link" [routerLink]="['/contracts', contract.id]">{{
                          contract.title || contract.product || '合同记录'
                        }}</a>
                        <p>
                          {{ contract.id }} · {{ store.customer(contract.customerId)?.shortName }}
                        </p>
                      </td>
                      <td>
                        {{ store.sale(contract.opportunityId)?.projectName }}
                        <p>{{ contract.opportunityId }}</p>
                      </td>
                      <td>{{ quoteReference(contract) }}</td>
                      <td>{{ store.money(contract.amount, contract.currency) }}</td>
                      <td><app-badge [text]="contract.status || '历史样例'" /></td>
                      <td>{{ contract.signedDate || '待补' }}</td>
                      <td>{{ contractProjects(contract.id).length }}</td>
                      <td>{{ contract.g3 || '待补' }}</td>
                      <td>
                        <a class="text-link" [routerLink]="['/contracts', contract.id]"
                          >查看 / 处理</a
                        >
                      </td>
                    </tr>
                  } @empty {
                    <tr>
                      <td colspan="9" class="empty">没有匹配的合同记录，可从有效商机创建草稿。</td>
                    </tr>
                  }
                </tbody>
              </table>
            </div>
          </section>
          <div class="inline-alert space-top">
            <app-icon name="info" /><span
              >草稿不会自动赢单、通过G3或创建项目；历史样例缺少签约信息时会明确显示待补。</span
            >
          </div>
        }
      }
      @case ('plans') {
        <section class="stats-grid compact-stats">
          <div class="stat">
            <div class="stat-top">交付项目</div>
            <div class="stat-number">{{ plans().length }}<small>个</small></div>
            <div class="stat-bottom">合同、计划和现场记录按项目关联</div>
          </div>
          <div class="stat">
            <div class="stat-top">未完成任务</div>
            <div class="stat-number">{{ openTasks() }}<small>项</small></div>
            <div class="stat-bottom">按模拟观察日 {{ observationDate() }}</div>
          </div>
          <div class="stat">
            <div class="stat-top">待处理节点</div>
            <div class="stat-number">{{ warningTasks().length }}<small>项</small></div>
            <div class="stat-bottom">包含延期、临近到期与日期待补</div>
          </div>
        </section>
        <section class="panel">
          <div class="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>项目</th>
                  <th>客户</th>
                  <th>项目经理</th>
                  <th>阶段 / 启动</th>
                  <th>计划进展</th>
                  <th>未完成节点</th>
                  <th>下一步</th>
                </tr>
              </thead>
              <tbody>
                @for (project of plans(); track project.id) {
                  <tr>
                    <td>
                      <a
                        class="main-link"
                        [routerLink]="['/projects', project.id]"
                        [queryParams]="{ tab: 'overview' }"
                        queryParamsHandling="merge"
                        [preserveFragment]="true"
                        >{{ project.name }}</a
                      >
                      <p>{{ project.id }}</p>
                    </td>
                    <td>{{ store.customer(project.customerId)?.shortName }}</td>
                    <td>{{ project.pm }}</td>
                    <td>
                      <app-badge [text]="project.status" />
                      <p>{{ project.accepted ? 'PM已接收' : '待PM接收' }}</p>
                    </td>
                    <td>{{ progress(project) }}%</td>
                    <td>{{ project.plans.filter(isOpen).length }} 项</td>
                    <td>
                      <a
                        class="text-link"
                        [routerLink]="['/projects', project.id]"
                        queryParamsHandling="merge"
                        [preserveFragment]="true"
                        [queryParams]="{ tab: '计划执行' }"
                        >编排计划</a
                      >
                    </td>
                  </tr>
                } @empty {
                  <tr>
                    <td colspan="7" class="empty">当前筛选下没有项目。</td>
                  </tr>
                }
              </tbody>
            </table>
          </div>
        </section>
        <div class="row-actions">
          <a
            class="btn"
            routerLink="/plans/tracking"
            queryParamsHandling="merge"
            [queryParams]="{ tab: null }"
            [preserveFragment]="true"
            >打开追踪看板</a
          >
        </div>
      }
      @case ('tracking') {
        <div class="inline-alert">
          <app-icon name="calendar" /><span
            >模拟观察日
            {{ observationDate() }}。风险级别与计划视图同规则；日期缺失单独显示；标记已读只记录本人，不解除风险。应收逾期独立分类。</span
          >
        </div>
        <section class="stats-grid compact-stats space-top">
          <div class="stat">
            <div class="stat-top">当前筛选下预警</div>
            <div class="stat-number">{{ trackingStats().total }}<small>项</small></div>
            <div class="stat-bottom">客户主节点与内部WBS的临期／逾期</div>
          </div>
          <div class="stat">
            <div class="stat-top">已逾期</div>
            <div class="stat-number">{{ trackingStats().red }}<small>项</small></div>
            <div class="stat-bottom">红色：观察日已超过计划结束日</div>
          </div>
          <div class="stat">
            <div class="stat-top">临期</div>
            <div class="stat-number">{{ trackingStats().yellow }}<small>项</small></div>
            <div class="stat-bottom">黄色：已进入预警窗口</div>
          </div>
          <div class="stat">
            <div class="stat-top">我未读</div>
            <div class="stat-number">{{ trackingStats().unread }}<small>项</small></div>
            <div class="stat-bottom">涉及 {{ trackingStats().projects }} 个项目 · 已读不影响他人</div>
          </div>
        </section>
        <app-tracking-charts
          [rows]="trackingRows()"
          [observationDate]="observationDate()"
          (selectKind)="status.set($event)"
          (selectProject)="trackingProject.set($event)"
        />
        <section class="panel space-top">
          <div class="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>类别</th>
                  <th>项目 / 客户</th>
                  <th>计划类型</th>
                  <th>任务 / 节点</th>
                  <th>责任人</th>
                  <th>接收人</th>
                  <th>依据日期</th>
                  <th>预警天数 / 日期</th>
                  <th>预计完成</th>
                  <th>状态</th>
                  <th>处理</th>
                </tr>
              </thead>
              <tbody>
                @for (item of trackingRows(); track item.key) {
                  <tr [attr.data-plan-id]="item.planId">
                    <td><span [class]="trackingKindBadgeClass(item)">{{ trackingKindLabel(item) }}</span></td>
                    <td>
                      <a class="main-link" [routerLink]="['/projects', item.project.id]">{{
                        item.project.name
                      }}</a>
                      <p>
                        {{ store.customer(item.project.customerId)?.shortName }} ·
                        {{ item.project.id }}
                      </p>
                    </td>
                    <td>{{ item.type }}</td>
                    <td>
                      @if (item.warning && !isWarningRead(item.warning.id)) {
                        <span class="row-unread-dot" title="本人未读" aria-label="本人未读"></span>
                      }
                      {{ item.name }}
                      @if (item.planId) {
                        <p class="fine-print">Plan ID：{{ item.planId }}</p>
                      }
                    </td>
                    <td>{{ item.ownerLabel || item.owner || '待分配' }}</td>
                    <td>
                      @if (item.warningScope) {
                        {{
                          item.recipients && item.recipients.length
                            ? item.recipients.join('、')
                            : '待补'
                        }}
                        @if (item.missing && item.missing.length) {
                          <p class="fine-print">待补：{{ item.missing.join('、') }}</p>
                        }
                      } @else {
                        <span class="fine-print">—</span>
                      }
                    </td>
                    <td class="nowrap">{{ item.basisDate || '待补' }}</td>
                    <td class="nowrap">
                      @if (item.planId) {
                        {{ item.warningLeadDays ?? '待补' }}{{ item.warningLeadDays != null ? '天' : '' }}
                        <p>{{ item.warningDate || '日期待补' }}</p>
                        @if (item.warningLeadDaysSource) { <p class="fine-print">{{ item.warningLeadDaysSource }}</p> }
                      } @else { — }
                    </td>
                    <td class="nowrap">{{ item.due || '待补' }}</td>
                    <td><app-badge [text]="item.status" /></td>
                    <td>
                      <div class="tracking-actions">
                        <a
                          class="tracking-locate"
                          [routerLink]="trackingHref(item).path"
                          [queryParams]="trackingHref(item).query"
                          (click)="locateWarning(item)"
                        >
                          <app-icon name="link" />定位处理
                        </a>
                        @if (item.warning) {
                          @if (isWarningRead(item.warning.id)) {
                            <span class="tracking-read read"
                              ><app-icon name="check" />本人已读</span
                            >
                          } @else {
                            <button
                              class="tracking-read unread"
                              type="button"
                              (click)="markWarningRead(item.warning)"
                            >
                              <span class="unread-dot" aria-hidden="true"></span>标记已读
                            </button>
                          }
                        } @else {
                          <span class="tracking-read none">无需标记</span>
                        }
                      </div>
                    </td>
                  </tr>
                } @empty {
                  <tr>
                    <td colspan="11" class="empty">当前筛选下没有待处理节点。</td>
                  </tr>
                }
              </tbody>
            </table>
          </div>
        </section>
      }
      @case ('logistics') {
        <section class="panel">
          <div class="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>项目 / 客户</th>
                  <th>要货与发运</th>
                  <th>调试备件</th>
                  <th>FAT / SAT / 验收</th>
                  <th>内部移交</th>
                  <th>下一步</th>
                </tr>
              </thead>
              <tbody>
                @for (project of plans(); track project.id) {
                  <tr>
                    <td>
                      <a
                        class="main-link"
                        [routerLink]="['/projects', project.id]"
                        [queryParams]="{ tab: 'overview' }"
                        queryParamsHandling="merge"
                        [preserveFragment]="true"
                        >{{ project.name }}</a
                      >
                      <p>{{ store.customer(project.customerId)?.shortName }} · {{ project.pm }}</p>
                    </td>
                    <td>
                      {{ planStatus(project, '要货发货') }}
                      <p>需求 / 预计 / 实际日期分别记录</p>
                    </td>
                    <td>
                      {{ planStatus(project, '调试备件') }}
                      <p>{{ spareSummary(project) }}</p>
                    </td>
                    <td>
                      {{ planStatus(project, 'FAT测试') }} / {{ project.sat.result || 'SAT待补' }} /
                      {{ project.acceptanceComplete ? '验收完成' : '待验收' }}
                    </td>
                    <td>
                      <app-badge [text]="project.handover.status" />
                      <p>{{ project.handover.issues.length }} 项遗留</p>
                    </td>
                    <td>
                      <a
                        class="text-link"
                        [routerLink]="['/projects', project.id]"
                        queryParamsHandling="merge"
                        [preserveFragment]="true"
                        [queryParams]="{ tab: '计划执行' }"
                        >打开项目执行</a
                      >
                      ·
                      <a
                        class="text-link"
                        [routerLink]="['/projects', project.id]"
                        queryParamsHandling="merge"
                        [preserveFragment]="true"
                        [queryParams]="{ tab: '移交' }"
                        >准备移交</a
                      >
                    </td>
                  </tr>
                } @empty {
                  <tr>
                    <td colspan="6" class="empty">当前筛选下没有项目。</td>
                  </tr>
                }
              </tbody>
            </table>
          </div>
        </section>
        <div class="inline-alert space-top">
          <app-icon name="info" /><span
            >本页聚合已有计划和确认记录。无来源的询船、SN、实际到货或安装信息显示待补，不模拟外部物流跟踪。</span
          >
        </div>
      }
      @case ('service') {
        <section class="panel">
          <div class="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>项目 / 客户</th>
                  <th>成交服务引用</th>
                  <th>质保 / SLA</th>
                  <th>备件接续</th>
                  <th>移交接收</th>
                  <th>遗留项</th>
                  <th>处理入口</th>
                </tr>
              </thead>
              <tbody>
                @for (project of plans(); track project.id) {
                  @let service = serviceFor(project);
                  <tr>
                    <td>
                      <a
                        class="main-link"
                        [routerLink]="['/projects', project.id]"
                        [queryParams]="{ tab: 'overview' }"
                        queryParamsHandling="merge"
                        [preserveFragment]="true"
                        >{{ project.name }}</a
                      >
                      <p>{{ store.customer(project.customerId)?.shortName }} · {{ project.id }}</p>
                    </td>
                    <td>
                      {{ service ? '引用成交报价服务快照' : '历史服务引用待补' }}
                      <p>
                        {{ service?.quoteVersionId ? '引用锁定报价版本' : '未猜测当前最新版本' }}
                      </p>
                    </td>
                    <td>
                      {{ service?.warranty || '待补' }}
                      <p>{{ service?.sla || 'SLA待补' }}</p>
                    </td>
                    <td>{{ spareSummary(project) }}</td>
                    <td>
                      <app-badge [text]="project.handover.status" />
                      <p>{{ project.handover.receiver || '接收方待补' }}</p>
                    </td>
                    <td>{{ project.handover.issues.length }} 项未关闭</td>
                    <td>
                      <a
                        class="text-link"
                        [routerLink]="['/projects', project.id]"
                        queryParamsHandling="merge"
                        [preserveFragment]="true"
                        [queryParams]="{ tab: '移交' }"
                        >接收 / 退回</a
                      >
                    </td>
                  </tr>
                } @empty {
                  <tr>
                    <td colspan="7" class="empty">当前筛选下没有项目。</td>
                  </tr>
                }
              </tbody>
            </table>
          </div>
        </section>
        <div class="inline-alert space-top">
          <app-icon name="info" /><span
            >本工作区覆盖运维接收、成交服务摘要、备件和移交遗留项；不代表客诉、巡检、库存或SLA计时已实现。</span
          >
        </div>
      }
    }
  `,
  styleUrls: ['./contract-workspace.scss', './contract-workspace-details.scss'],
  styles: `
    .contract-detail {
      padding: 24px;
    }
    .contract-grid {
      display: grid;
      grid-template-columns: repeat(3, minmax(0, 1fr));
      gap: 1px;
      background: var(--line);
      border: 1px solid var(--line);
      margin: 24px 0;
    }
    .contract-grid > div {
      display: flex;
      flex-direction: column;
      gap: 7px;
      background: white;
      padding: 17px;
      min-width: 0;
    }
    .contract-grid small,
    .muted {
      color: var(--muted);
      font-size: 11px;
    }
    .contract-grid strong {
      font-size: 13px;
      overflow-wrap: anywhere;
    }
    .contract-departments {
      margin: 22px 0;
      padding: 16px;
      border: 1px solid var(--line);
      border-radius: 8px;
      background: #f8fafc;
    }
    .contract-departments h3 {
      margin: 0 0 5px;
      font-size: 14px;
    }
    .contract-departments p {
      margin: 0;
      color: var(--muted);
      font-size: 12px;
    }
    .contract-department-grid {
      display: grid;
      grid-template-columns: repeat(5, minmax(0, 1fr));
      gap: 8px;
      margin-top: 14px;
    }
    .contract-department-grid article {
      display: flex;
      flex-direction: column;
      gap: 6px;
      padding: 10px;
      border: 1px solid var(--line);
      background: white;
      font-size: 11px;
    }
    .contract-department-grid span {
      color: var(--muted);
    }
    .row-actions {
      display: flex;
      align-items: center;
      flex-wrap: wrap;
      gap: 10px;
      margin: 20px 0;
    }
    .related-projects {
      border-top: 1px solid var(--line);
      padding: 18px 0;
      margin-bottom: 16px;
    }
    .related-projects h3 {
      margin: 0 0 12px;
    }
    .related-projects a {
      display: flex;
      justify-content: space-between;
      align-items: center;
      padding: 10px 0;
      color: var(--primary);
      border-bottom: 1px solid var(--line);
    }
    .compact-stats {
      margin-bottom: 18px;
    }
    .tracking-kind {
      font-weight: 500;
    }
    .tracking-kind-overdue {
      background: #fdeeee;
      color: #ce5555;
    }
    .tracking-kind-due-soon {
      background: #fdf3e1;
      color: #b1842c;
    }
    .tracking-kind-no-date {
      background: #eef1f6;
      color: #7b8ba0;
    }
    .tracking-kind-no-warning {
      background: #f2f4f8;
      color: #8d99ac;
      border: 1px dashed #c3ccd9;
      padding: 4px 7px;
    }
    .tracking-kind-done-late {
      background: #e9f6f0;
      color: #3d8a6c;
    }
    .tracking-kind-finance {
      background: #f1edfa;
      color: #8068b4;
    }
    .tracking-actions {
      display: flex;
      flex-direction: column;
      align-items: flex-start;
      gap: 6px;
    }
    .tracking-locate {
      display: inline-flex;
      align-items: center;
      gap: 4px;
      padding: 4px 10px;
      border: 1px solid #c7d3ee;
      border-radius: 999px;
      background: #fff;
      color: var(--primary);
      font-size: 12px;
      line-height: 1.2;
      white-space: nowrap;
      cursor: pointer;
      text-decoration: none;
    }
    .tracking-locate:hover {
      background: #edf2ff;
      border-color: var(--primary);
    }
    .tracking-locate app-icon {
      width: 13px;
      height: 13px;
    }
    .tracking-read {
      display: inline-flex;
      align-items: center;
      gap: 5px;
      font-size: 11px;
      line-height: 1.2;
      white-space: nowrap;
    }
    .tracking-read.read {
      display: inline-flex;
      align-items: center;
      gap: 4px;
      border-radius: 999px;
      background: #eaf7f0;
      color: #258564;
      padding: 3px 9px;
      cursor: default;
    }
    .tracking-read.read app-icon {
      width: 12px;
      height: 12px;
      color: #51a080;
    }
    .tracking-read.none {
      color: #a7b0bf;
      cursor: default;
    }
    .tracking-read.unread {
      border: 1px solid #d69b2d;
      border-radius: 999px;
      background: #d69b2d;
      color: #fff;
      padding: 3px 9px;
      cursor: pointer;
      font-weight: 500;
    }
    .tracking-read.unread:hover {
      background: #c18a1f;
      border-color: #c18a1f;
    }
    .tracking-read .unread-dot {
      width: 6px;
      height: 6px;
      border-radius: 50%;
      background: #fff;
    }
    .row-unread-dot {
      display: inline-block;
      width: 7px;
      height: 7px;
      border-radius: 50%;
      background: #d69b2d;
      margin-right: 6px;
      vertical-align: 1px;
    }
    .currency-summary {
      display: flex;
      flex-wrap: wrap;
      gap: 10px;
      margin: 0 0 16px;
    }
    .currency-summary span {
      padding: 12px 16px;
      border-left: 3px solid var(--primary);
      background: #f5f7fb;
      color: var(--muted);
      font-size: 11px;
    }
    .currency-summary strong {
      margin-left: 9px;
      color: var(--ink);
      font-size: 14px;
    }
    @media (max-width: 760px) {
      .contract-grid {
        grid-template-columns: repeat(2, minmax(0, 1fr));
      }
      .contract-department-grid {
        grid-template-columns: repeat(2, minmax(0, 1fr));
      }
    }
    @media (max-width: 480px) {
      .contract-grid {
        grid-template-columns: 1fr;
      }
      .contract-department-grid {
        grid-template-columns: 1fr;
      }
    }
  `,
})
export class BusinessWorkspaces {
  readonly store = inject(DemoStore);
  readonly ui = this.store.ui;
  readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);
  readonly page = toSignal(this.route.data.pipe(map((data) => data['page'] as Page)), {
    initialValue: 'plans' as Page,
  });
  readonly id = toSignal(this.route.paramMap.pipe(map((params) => params.get('id') || '')), {
    initialValue: '',
  });
  readonly projectId = toSignal(
    this.route.queryParamMap.pipe(
      map((params) => params.get('projectId') || params.get('project') || ''),
    ),
    {
      initialValue:
        this.route.snapshot.queryParamMap.get('projectId') ||
        this.route.snapshot.queryParamMap.get('project') ||
        '',
    },
  );
  readonly isDeliveryPage = computed(() => ['plans', 'logistics', 'service'].includes(this.page()));
  readonly query = signal('');
  readonly owner = signal('');
  readonly status = signal('');
  /** 08-03：追踪看板单独的项目/负责人筛选，不改变其他页面的 `owner` 语义。 */
  readonly trackingProject = signal('');
  readonly trackingOwner = signal('');
  readonly observationDate = computed(() => this.store.observationDate());
  readonly contractPresentation = contractDemoDetails;
  readonly contractTab = signal('合同信息');
  readonly contractTabs = ['合同信息', '商务与支付', '协作与关联'];
  readonly demoPaymentStages = [
    { name: '签约预付款', percent: 30, condition: '双方签约后支付' },
    { name: '发货款', percent: 60, condition: '设备发货前支付' },
    { name: '验收尾款', percent: 10, condition: '验收通过后支付' },
  ];
  readonly contractDepartments = ['销售', '方案', '法务', '财务', '订单'];
  private newRouteHandled = false;

  constructor() {
    effect(() => {
      if (!this.newRouteHandled && this.page() === 'contracts' && this.id() === 'new') {
        this.newRouteHandled = true;
        queueMicrotask(() => {
          this.router.navigate(['/contracts']);
          this.newContract();
        });
      }
    });
  }

  title = computed(
    () =>
      ({
        solutions: '方案设计',
        quotes: '报价议价',
        contracts: '合同管理',
        plans: '项目总览',
        tracking: '追踪看板',
        logistics: '物流现场',
        service: '运维售后',
      })[this.page()],
  );
  description = computed(
    () =>
      ({
        solutions: '按商机查找待制作方案、版本和交付状态，继续使用原方案记录。',
        quotes: '按报价系列处理草稿、审核、发出、反馈和最终锁定。',
        contracts: '维护合同草稿、签约登记与交付项目关联。',
        plans: '汇总项目进展、未完成任务和待处理节点，进入项目维护计划。',
        tracking: '集中查看跨项目任务、客户节点和应收逾期。',
        logistics: '汇总要货、发运、备件、验收和内部移交的现有记录。',
        service: '接续运维接收、成交时服务条件、备件和移交遗留项。',
      })[this.page()],
  );
  selectedContract = computed(() =>
    this.store.state().contracts.find((item) => item.id === this.id()),
  );
  owners = computed(() =>
    [
      ...new Set(
        this.isDeliveryPage()
          ? this.store.state().projects.map((project) => project.pm)
          : this.store
              .state()
              .sales.filter((sale) => sale.type === 'opportunity')
              .map((sale) => sale.owner),
      ),
    ].sort(),
  );
  statusOptions = computed(() =>
    this.page() === 'solutions'
      ? ['待制作', '已有方案', '已确认']
      : [
          ...new Set(
            (this.store.state().quoteSeries || []).flatMap((series) =>
              series.versions.map((version) => version.status),
            ),
          ),
        ],
  );
  solutions = computed(() =>
    this.store
      .opportunities()
      .filter(
        (sale) =>
          sale.stage !== '丢单' &&
          (!this.owner() || sale.owner === this.owner()) &&
          this.contains(
            `${sale.id} ${sale.projectName} ${this.store.customer(sale.customerId)?.name}`,
          ) &&
          (!this.status() || this.solutionFilter(sale.id) === this.status()),
      ),
  );
  quoteSeries = computed(() => this.store.state().quoteSeries || []);
  quoteCurrencyTotals = computed(() => {
    const totals = new Map<string, number>();
    for (const series of this.quoteSeries()) {
      if (!this.quoteMatches(series)) continue;
      const version = this.currentQuote(series);
      const amount = version ? this.store.quoteTotals(version).total : null;
      if (version && amount !== null)
        totals.set(version.currency, (totals.get(version.currency) || 0) + amount);
    }
    return [...totals].map(([currency, amount]) => ({
      currency,
      total: this.store.money(amount, currency),
    }));
  });
  contracts = computed(() =>
    this.store
      .state()
      .contracts.filter((contract) =>
        this.contains(
          `${contract.id} ${contract.title} ${contract.product} ${this.store.sale(contract.opportunityId)?.projectName} ${this.store.customer(contract.customerId)?.name}`,
        ),
      ),
  );
  plans = computed(() =>
    this.store
      .state()
      .projects.filter(
        (project) => (!this.owner() || project.pm === this.owner()) && this.projectMatches(project),
      ),
  );
  count = computed(() =>
    this.page() === 'solutions'
      ? this.solutions().length
      : this.page() === 'quotes'
        ? this.quoteSeries().filter((series) => this.quoteMatches(series)).length
        : this.page() === 'contracts'
          ? this.contracts().length
          : this.isDeliveryPage()
            ? this.plans().length
            : this.trackingRows().length,
  );

  private contains(value: string): boolean {
    return value.toLowerCase().includes(this.query().trim().toLowerCase());
  }
  private solutionFilter(id: string): string {
    const solution = this.store.solution(id);
    return !solution?.versions.length
      ? '待制作'
      : solution.versions.some((version) => version.id === solution.finalVersionId)
        ? '已确认'
        : '已有方案';
  }
  solutionOwner(id: string): string {
    return (
      this.store.solution(id)?.versions.at(-1)?.owner || this.store.sale(id)?.owner || '待分配'
    );
  }
  solutionLatest(id: string): string {
    const solution = this.store.solution(id);
    return solution?.versions.at(-1)?.number ? `V${solution.versions.at(-1)!.number}` : '待制作';
  }
  solutionFinal(id: string): string {
    const solution = this.store.solution(id);
    const final = solution?.versions.find((version) => version.id === solution.finalVersionId);
    return final ? `V${final.number}` : '未确认';
  }
  solutionStatus(id: string): string {
    return this.solutionFilter(id);
  }
  quoteMatches(series: any): boolean {
    const current = this.currentQuote(series);
    return (
      this.contains(
        `${series.number} ${series.opportunityId} ${this.store.sale(series.opportunityId)?.projectName} ${this.store.customer(current?.customerId || '')?.name}`,
      ) &&
      (!this.status() || current?.status === this.status())
    );
  }
  currentQuote(series: any): any {
    return series.versions.at(-1);
  }
  quoteAmount(version: any): string {
    if (!version) return '待补';
    const total = this.store.quoteTotals(version).total;
    return total === null ? '税费待确认' : this.store.money(total, version.currency);
  }
  lockedQuote(series: any): string {
    const final = series.versions.find(
      (version: any) => version.id === series.activeFinalVersionId && version.status === '最终锁定',
    );
    return final ? `V${final.number}` : '未锁定';
  }
  /** 与合同面板同源读取报价来源视图：显示号含已保存快照，来源无法确认时同样标注“待核”。 */
  quoteReference(contract: Contract): string {
    const view = this.store.contractQuoteReference(contract.id);
    return view.status === 'review' ? `${view.displayNumber}（待核）` : view.displayNumber;
  }
  contractProjects(id: string): Project[] {
    return this.store.state().projects.filter((project) => project.contractId === id);
  }
  unlinkedProjects(contract: Contract): Project[] {
    return this.store
      .state()
      .projects.filter(
        (project) =>
          !project.contractId &&
          project.opportunityId === contract.opportunityId &&
          project.customerId === contract.customerId,
      );
  }
  projectMatches(project: Project): boolean {
    return (
      (!this.projectId() || project.id === this.projectId()) &&
      this.contains(
        `${project.id} ${project.name} ${this.store.customer(project.customerId)?.name} ${project.pm}`,
      )
    );
  }
  progress(project: Project): number {
    return project.plans.length
      ? Math.round(
          (project.plans.filter((plan) => plan.status === '已完成').length / project.plans.length) *
            100,
        )
      : 0;
  }
  isOpen(plan: { status: string }): boolean {
    return plan.status !== '已完成';
  }
  openTasks(): number {
    return this.plans().reduce(
      (total, project) => total + project.plans.filter((plan) => plan.status !== '已完成').length,
      0,
    );
  }
  warningTasks(): any[] {
    const projectIds = new Set(this.plans().map((project) => project.id));
    return this.allTrackingRows().filter(
      (item) => projectIds.has(item.project.id) && item.kind !== '正常',
    );
  }
  /** 当前筛选下的有效预警（同一事项的呈现，与我的待办同源，不重复建任务）。 */
  trackingWarnings(): PlanWarningView[] {
    return planWarningViews(
      this.store.state(),
      this.trackingRows()
        .filter((item) => item.warningScope && item.warning)
        .map((item) => item.warning),
      planWarningPersonKey(this.store.person()),
    );
  }
  trackingStats() {
    return planWarningStats(this.trackingWarnings());
  }
  trackingProjectOptions(): { id: string; name: string }[] {
    return this.store
      .state()
      .projects.filter((project) => !this.projectId() || project.id === this.projectId())
      .map((project) => ({ id: project.id, name: project.name }));
  }
  trackingOwnerOptions(): string[] {
    return [
      ...new Set(
        this.allTrackingRows().flatMap((item) => [
          ...(item.recipients || []),
          ...(item.owner ? [item.owner] : []),
        ]),
      ),
    ].sort();
  }
  markWarningRead(warning: PlanWarningView): void {
    if (!warning.read) this.store.markPlanWarningRead(warning.id);
  }
  /** 看板 href 是「路径?查询」文本，交给 routerLink 前先拆成 path 与 queryParams。 */
  routeLink(href?: string) {
    return parseRouteHref(href);
  }
  /** 应收逾期行没有计划 href：定位到合同发票历史；其余沿用预警 href 的 Plan ID 定位。 */
  trackingHref(item: any) {
    if (item.href) return this.routeLink(item.href);
    if (item.kind === '财务' && item.project.contractId)
      return { path: `/contracts/${item.project.contractId}/invoices`, query: {} };
    return { path: `/projects/${item.project.id}`, query: {} };
  }
  /** 类别列固定配色，与上方图表图例同色系；不再依赖该行是否有预警级别。 */
  trackingKindBadgeClass(item: any): string {
    const slug =
      {
        延期: 'overdue',
        临近到期: 'due-soon',
        日期待补: 'no-date',
        预警待设置: 'no-warning',
        '已完成（逾期）': 'done-late',
        财务: 'finance',
      }[item.kind as string] || 'plain';
    return `badge tracking-kind tracking-kind-${slug}`;
  }
  /** 类别列文案与筛选器、图表图例保持同一套措辞。 */
  trackingKindLabel(item: any): string {
    return (
      {
        延期: '已逾期',
        临近到期: '临期',
        日期待补: '日期待补',
        预警待设置: '预警待设置',
        '已完成（逾期）': '已完成（逾期）',
        财务: '应收逾期',
      }[item.kind as string] ||
      item.label ||
      item.kind
    );
  }
  /** 点击定位即视为本人已知悉该预警；未读时顺手标记，不阻断跳转。 */
  locateWarning(item: any): void {
    if (item.warning && !this.isWarningRead(item.warning.id))
      this.store.markPlanWarningRead(item.warning.id);
  }
  isWarningRead(warningId: string): boolean {
    return isPlanWarningRead(
      this.store.state(),
      planWarningPersonKey(this.store.person()),
      warningId,
    );
  }
  trackingRows(): any[] {
    return this.allTrackingRows().filter(
      (item) =>
        (!this.status() || item.kind === this.status()) &&
        (!this.trackingProject() || item.project.id === this.trackingProject()) &&
        (!this.trackingOwner() ||
          (item.recipients || []).includes(this.trackingOwner()) ||
          item.owner === this.trackingOwner()) &&
        this.contains(
          `${item.project.id} ${item.project.name} ${item.name} ${item.owner} ${item.type}`,
        ),
    );
  }
  private allTrackingRows(): any[] {
    const rows: any[] = [];
    const projects = this.store
      .state()
      .projects.filter((project) => !this.projectId() || project.id === this.projectId());
    const projectsById = new Map(projects.map((project) => [project.id, project]));
    // 计划类别一律复用 08-01 纯规则：同一观察日、同一已提交快照、同一判断。
    for (const row of collectPlanRiskRows(this.store.state(), this.observationDate())) {
      const project = projectsById.get(row.projectId);
      if (!project || row.kind === '正常') continue;
      if (row.warning && !row.recipients.some((recipient) => recipient.personKey === planWarningPersonKey(this.store.person()))) continue;
      rows.push(this.trackingRow(project, row));
    }
    for (const project of projects)
      for (const item of this.receivableRows(project)) rows.push(item);
    return rows;
  }
  private trackingRow(project: Project, row: PlanRiskRow): any {
    return {
      key: `${project.id}-${row.planId}`,
      project,
      planId: row.planId,
      warningLeadDays: project.plans.find((plan) => plan.id === row.planId)?.warningLeadDays,
      warningLeadDaysSource: project.plans.find((plan) => plan.id === row.planId)?.warningLeadDaysSource,
      warningDate: planWarningDate(project.plans.find((plan) => plan.id === row.planId)!),
      type: row.planType,
      name: row.planName,
      owner: row.owner,
      ownerLabel: row.ownerLabel,
      pmLabel: row.pmLabel,
      due: row.expected,
      basisDate: row.basisDate,
      status: row.planStatus,
      kind: row.kind,
      label: row.label,
      riskLevel: row.riskLevel,
      recipients: row.recipients.map((recipient) => recipient.person),
      recipientKeys: row.recipients.map((recipient) => recipient.personKey),
      missing: row.missing,
      href: row.href + '&focus=' + encodeURIComponent(row.planId),
      warning: row.warning,
      warningScope: row.warningScope,
    };
  }
  private receivableRows(project: Project): any[] {
    const snapshots =
      this.store.state().financeSnapshots?.filter((item) => item.projectId === project.id) || [];
    return snapshots.flatMap((snapshot: any) =>
      (snapshot.invoices || [])
        .filter(
          (invoice: any) =>
            invoice.due && invoice.due < BASE_DATE && invoice.received < invoice.amount,
        )
        .map((invoice: any) => ({
          key: `${project.id}-ar-${invoice.id}`,
          project,
          type: '应收账款',
          name: invoice.number || '应收回款',
          owner: '财务',
          due: invoice.due,
          status: `已回 ${this.store.money(invoice.received, invoice.currency)}`,
          kind: '财务',
        })),
    );
  }
  planStatus(project: Project, type: string): string {
    const plan = project.plans.find((item) => item.type === type);
    return plan ? `${plan.status} · ${plan.expected || '日期待补'}` : '待安排';
  }
  spareSummary(project: Project): string {
    const spare = project.plans.find((item) => item.type === '调试备件');
    return spare ? `${spare.status} · ${spare.receiver || '接收人待补'}` : '备件需求待补';
  }
  issueOpen(issue: { owner: string; due: string }): boolean {
    return !!issue.owner || !!issue.due;
  }
  serviceFor(project: Project): any {
    return this.store.state().contracts.find((contract) => contract.id === project.contractId)
      ?.serviceSnapshot;
  }

  newQuote(): void {
    const candidates = this.store
      .opportunities()
      .filter(
        (sale) =>
          sale.stage !== '意向沟通' &&
          sale.stage !== '赢单' &&
          sale.stage !== '丢单' &&
          !this.store.quoteSeries(sale.id),
      );
    if (!candidates.length) {
      this.ui.notify('没有可创建报价的商机，请先推进到方案报价阶段', true);
      return;
    }
    const options: FieldOption[] = candidates.map((sale) => ({
      value: sale.id,
      label: `${sale.projectName} · ${this.store.customer(sale.customerId)?.shortName} · ${sale.id}`,
    }));
    this.ui.open({
      title: '选择报价来源商机',
      description: '报价草稿会关联现有商机并复用客户和联系人。',
      fields: [
        { key: 'opportunityId', label: '来源商机', type: 'select', required: true, options },
      ],
      onSave: (data) => {
        const id = this.store.createQuote(data['opportunityId']);
        if (id) this.router.navigate(['/sales/quotes', data['opportunityId']]);
        return !!id;
      },
    });
  }
  newContract(): void {
    const candidates = this.store
      .opportunities()
      .filter(
        (sale) =>
          sale.stage !== '丢单' &&
          !this.store.state().contracts.some((contract) => contract.opportunityId === sale.id),
      );
    if (!candidates.length) {
      this.ui.notify('没有可创建合同的商机；每个商机仅保留一个有效合同', true);
      return;
    }
    const options: FieldOption[] = candidates.map((sale) => ({
      value: sale.id,
      label: `${sale.projectName} · ${this.store.customer(sale.customerId)?.shortName} · ${sale.stage}`,
    }));
    this.ui.open({
      title: '创建合同草稿',
      description: '保存草稿不会推进商机、加载G3或创建交付项目。',
      fields: [
        { key: 'opportunityId', label: '来源商机', type: 'select', required: true, options },
      ],
      onSave: (data) => {
        const id = this.store.createContractDraft(data['opportunityId']);
        if (id) this.router.navigate(['/contracts', id]);
        return !!id;
      },
    });
  }
  editContract(contract: Contract): void {
    const expectedDataVersion = this.store.state().dataVersion || 1;
    const customerOptions: FieldOption[] = this.store
      .state()
      .customers.map((customer) => ({ value: customer.id, label: customer.name }));
    this.ui.open({
      title: '编辑合同草稿',
      description: '签约登记前可补充合同商务字段；登记后保留历史内容。',
      fields: [
        { key: 'title', label: '合同标题', required: true, value: contract.title || '' },
        {
          key: 'sellerEntity',
          label: '我方主体',
          required: true,
          value: contract.sellerEntity || '',
        },
        {
          key: 'customerId',
          label: '客户主体',
          type: 'select',
          required: true,
          options: customerOptions,
          value: contract.customerId,
        },
        {
          key: 'contactId',
          label: '客户联系人',
          type: 'select',
          dependsOn: 'customerId',
          options: this.store.state().customers.flatMap((customer) =>
            customer.contacts.map((contact) => ({
              value: contact.id,
              label: `${customer.name} · ${contact.name}`,
            })),
          ),
          optionsByValue: Object.fromEntries(
            this.store
              .state()
              .customers.map((customer) => [
                customer.id,
                customer.contacts.map((contact) => ({ value: contact.id, label: contact.name })),
              ]),
          ),
          value: contract.contactId || '',
        },
        { key: 'product', label: '产品', required: true, value: contract.product },
        {
          key: 'scope',
          label: '合同范围',
          type: 'textarea',
          required: true,
          value: contract.scope || '',
        },
        {
          key: 'amount',
          label: '合同金额',
          type: 'number',
          required: true,
          min: 0,
          value: contract.amount,
        },
        {
          key: 'currency',
          label: '币种',
          type: 'select',
          required: true,
          options: ['CNY', 'USD', 'EUR'],
          value: contract.currency,
        },
        {
          key: 'payment',
          label: '付款条件',
          type: 'textarea',
          required: true,
          value: contract.payment,
        },
        { key: 'penalty', label: '罚则', value: contract.penalty },
        { key: 'delivery', label: '交期', value: contract.delivery || '' },
        { key: 'warranty', label: '质保', value: contract.warranty || '' },
        { key: 'service', label: '服务约定', value: contract.service || '' },
        {
          key: 'plannedSignDate',
          label: '拟签约日期',
          type: 'date',
          value: contract.plannedSignDate || '',
        },
        { key: 'note', label: '备注', type: 'textarea', value: contract.note || '' },
      ],
      onSave: (data) =>
        this.store.updateContractDraft(
          contract.id,
          {
            ...data,
            amount: Number(data['amount']),
          } as Partial<Contract>,
          expectedDataVersion,
        ),
    });
  }
  chooseContractTerm(contract: Contract, paymentTermId: string): void {
    if (!paymentTermId) return;
    this.store.setContractPaymentSelection(contract.id, paymentTermId, []);
  }
  toggleContractPaymentMethod(contract: Contract, methodId: string, checked: boolean): void {
    const ids = new Set(contract.paymentMethodIds || []);
    if (checked) ids.add(methodId);
    else ids.delete(methodId);
    if (contract.paymentTermId)
      this.store.setContractPaymentSelection(contract.id, contract.paymentTermId, [...ids]);
  }
  newPaymentTerm(): void {
    this.editPaymentTerm();
  }
  editPaymentTerm(term?: import('../core/models').PaymentTermRecord): void {
    const expectedDataVersion = this.store.state().dataVersion || 1;
    this.ui.open({
      title: term ? '维护支付条款主记录' : '新增支付条款主记录',
      description:
        '财务维护本地版本化条款。代码及多语言说明按来源录入；未知状态或字典值不在此猜测。',
      fields: [
        { key: 'ownerName', label: '负责人', value: term?.ownerName || '' },
        { key: 'code', label: '条款代码', required: true, value: term?.code || '' },
        {
          key: 'descriptionZh',
          label: '中文说明',
          required: true,
          type: 'textarea',
          value: term?.descriptionZh || '',
        },
        {
          key: 'descriptionEn',
          label: '英文说明',
          type: 'textarea',
          value: term?.descriptionEn || '',
        },
        {
          key: 'descriptionDe',
          label: '德文说明',
          type: 'textarea',
          value: term?.descriptionDe || '',
        },
      ],
      onSave: (data) =>
        this.store.savePaymentTerm(
          {
            ...(term ? { id: term.id } : {}),
            ownerName: data['ownerName'] || '',
            code: data['code'],
            descriptionZh: data['descriptionZh'],
            descriptionEn: data['descriptionEn'] || '',
            descriptionDe: data['descriptionDe'] || '',
            status: term?.status || 'active',
            crmFields: term?.crmFields || {},
          },
          expectedDataVersion,
        ),
    });
  }
  newPaymentMethod(paymentTermId: string): void {
    if (!paymentTermId) return;
    this.editPaymentMethod(undefined, paymentTermId);
  }
  editPaymentMethod(
    method?: import('../core/models').PaymentMethodRecord,
    paymentTermId = method?.paymentTermId || '',
  ): void {
    if (!paymentTermId) return;
    const expectedDataVersion = this.store.state().dataVersion || 1;
    this.ui.open({
      title: method ? '维护付款方式' : '新增付款方式',
      description:
        '保留条件、方式原值、比例、天数、固定金额及全额跟随等字段；不将付款方式简化为现金/转账选项。',
      fields: [
        { key: 'ownerName', label: '负责人', value: method?.ownerName || '' },
        { key: 'name', label: '名称', required: true, value: method?.name || '' },
        { key: 'condition', label: '付款条件原值', required: true, value: method?.condition || '' },
        { key: 'method', label: '方式原值', required: true, value: method?.method || '' },
        {
          key: 'proportion',
          label: '比例（%）',
          type: 'number',
          min: 0,
          value: method?.proportion ?? '',
        },
        { key: 'days', label: '天数', type: 'number', min: 0, value: method?.days ?? '' },
        {
          key: 'fixedAmount',
          label: '固定金额',
          type: 'number',
          min: 0,
          value: method?.fixedAmount ?? '',
        },
        {
          key: 'followFixedAmount',
          label: '按固定金额',
          type: 'select',
          options: ['是', '否'],
          value: method?.followFixedAmount ? '是' : '否',
        },
        {
          key: 'deliveryInFullPayment',
          label: '款清发货',
          type: 'textarea',
          value: method?.deliveryInFullPayment || '',
        },
        { key: 'remarks', label: '备注', type: 'textarea', value: method?.remarks || '' },
      ],
      onSave: (data) =>
        this.store.savePaymentMethod(
          {
            ...(method
              ? { id: method.id, contractId: method.contractId, orderId: method.orderId }
              : {}),
            ownerName: data['ownerName'] || '',
            name: data['name'],
            paymentTermId,
            condition: data['condition'],
            method: data['method'],
            proportion: data['proportion'] === '' ? null : Number(data['proportion']),
            days: data['days'] === '' ? null : Number(data['days']),
            fixedAmount: data['fixedAmount'] === '' ? null : Number(data['fixedAmount']),
            followFixedAmount: data['followFixedAmount'] === '是',
            deliveryInFullPayment:
              data['deliveryInFullPayment'] || (method?.deliveryInFullPayment === null ? null : ''),
            remarks: data['remarks'] || '',
            active: method?.active ?? true,
            crmFields: method?.crmFields || {},
          },
          expectedDataVersion,
        ),
    });
  }
  registerContract(contract: Contract): void {
    const expectedDataVersion = this.store.state().dataVersion || 1;
    this.ui.open({
      title: '签约并创建首项目',
      description:
        '主管确认演示签约日期和凭据后，将在同次保存中记录赢单并创建待启动项目；不执行真实签章、G3/G4或交底确认。',
      fields: [
        {
          key: 'signedDate',
          label: '签约日期',
          type: 'date',
          required: true,
          value: contract.plannedSignDate || BASE_DATE,
        },
        { key: 'evidence', label: '签约凭据/记录编号', required: true, value: '' },
      ],
      onSave: (data) =>
        !!this.store.registerContractAndStartProject(
          contract.id,
          data['signedDate'],
          data['evidence'],
          expectedDataVersion,
        ),
    });
  }
  loadG3(contract: Contract): void {
    this.store.loadContractG3(contract.id);
  }
  createProject(contract: Contract): void {
    const sale = this.store.sale(contract.opportunityId);
    this.ui.open({
      title: '从合同创建项目',
      description: '同一合同可以关联多个独立项目。',
      fields: [
        { key: 'name', label: '项目名称', required: true, value: sale?.projectName || '' },
        personField('pm', '项目经理', '王项目', true, PROJECT_MANAGERS),
        { key: 'site', label: '项目现场', value: '' },
      ],
      onSave: (data) => {
        const id = this.store.createProjectForContract(
          contract.id,
          data['name'],
          data['pm'],
          data['site'],
        );
        if (id) this.router.navigate(['/projects', id]);
        return !!id;
      },
    });
  }
  associateProject(contract: Contract): void {
    const options: FieldOption[] = this.unlinkedProjects(contract).map((project) => ({
      value: project.id,
      label: `${project.name} · ${project.id}`,
    }));
    this.ui.open({
      title: '关联已有项目草稿',
      description: '仅允许来源商机和客户主体相同的未关联合同项目。',
      fields: [{ key: 'projectId', label: '项目草稿', type: 'select', required: true, options }],
      onSave: (data) => this.store.associateProjectToContract(data['projectId'], contract.id),
    });
  }
}
