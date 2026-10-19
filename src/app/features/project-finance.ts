import { ChangeDetectionStrategy, Component, inject, input, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { DemoStore } from '../core/store';
import { personField } from '../core/personnel';
import { BASE_DATE } from '../core/models';
import { newId } from '../core/seed';
import { Documents } from '../shared/documents';
import { summarizeInvoicesByCurrency } from '../core/invoices';
@Component({
  selector: 'app-project-finance',
  imports: [FormsModule, Documents],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `@if (store.internal()) {
    <section class="panel padded">
      <div class="section-heading">
        <h2>费用与回款</h2>
        <button class="btn primary" (click)="store.loadFinance(projectId())">
          {{ store.finance(projectId()) ? '模拟刷新' : '加载演示财务数据' }}
        </button>
      </div>
      <p class="fine-print">
        模拟SAP／CRM快照，未连接实际系统。演示字段，真实供数待核对。演示基准日 {{ baseDate }}。
      </p>
      @if (store.finance(projectId()); as f) {
        <p>模拟SC关联 {{ f.sc || '未关联' }} · {{ f.scope }} · 实际刷新时间 {{ f.refreshedAt }}</p>
        <h3>CRM信用政策 · 只读样例</h3>
        @if (store.creditPolicy(projectId()); as policy) {
          @let credit = store.creditDateFacts(projectId());
          <article class="metric-card">
            <strong>{{ policy.terms }}</strong>
            <small>
              {{ policy.source }}模拟政策 {{ policy.policyId }} v{{ policy.revision }} · 客户
              {{ store.customer(policy.customerId)?.name || '无法判断客户' }} · 快照日期
              {{ policy.snapshotDate }}
            </small>
            <small>
              起算节点：{{ credit.milestone?.name || '无法判断：未找到唯一匹配节点' }}
              @if (credit.milestone) {
                （固定ID {{ credit.milestone.id }}）
              }
            </small>
            <small>
              节点状态 {{ credit.milestone?.status || '无法判断' }} · 实际起算日
              {{ credit.actualStart || '尚无有效完成日期' }} · 预计起算日
              {{ credit.expectedStart || '无法判断' }}
            </small>
            <small>
              实际推算到期日 {{ credit.actualDue || '无法判断' }} · 预计到期日
              {{ credit.expectedDue || '无法判断' }}
            </small>
            <small>已完成且实际日期有效才是实际起算；预计日期只用于预测，不判实际逾期。</small>
          </article>
        } @else {
          <p>CRM信用政策样例未加载；财务加载或刷新模拟数据后显示。</p>
        }
        <h3>延期节点黄灯</h3>
        @for (warning of nodeWarnings(); track warning.id) {
          <article class="metric-card warning-card">
            <strong>{{ planName(warning.sourcePlanId || '') || '项目节点延期' }}</strong>
            <small>PM处理 · 预计{{ warning.dueDate }} · 已延期{{ warning.offsetDays }}天</small>
          </article>
        } @empty {
          <p>当前没有已确认的延期节点；缺少有效预计日期时显示无法判断。</p>
        }
        @for (warning of receivableWarnings(); track warning.id) {
          <article class="metric-card warning-card">
            <strong>逾期应收 · {{ warning.invoiceId }}</strong>
            <small>销售跟进 · 到期日{{ warning.dueDate }} · 已逾期{{ warning.offsetDays }}天</small>
          </article>
        }
        <h3>财务指标 · 只读演示快照</h3>
        @if (f.indicators; as metrics) {
          <p class="fine-print">
            {{ metrics.source }}模拟数据 · 快照日期 {{ metrics.snapshotDate }} · 金额币种
            {{ metrics.currency }}
          </p>
          <div class="metric-grid">
            <article class="metric-card">
              <span>销售额</span>
              <strong>{{ store.money(metrics.salesAmount, metrics.currency) }}</strong>
              <small>交易规模示例，正式口径待核对；独立于开票金额</small>
            </article>
            <article class="metric-card">
              <span>毛利金额</span>
              <strong>{{ store.money(metrics.grossProfitAmount, metrics.currency) }}</strong>
              <small>预置来源值，不从销售额、费用或最终成本计算</small>
            </article>
            <article class="metric-card">
              <span>预付款比例</span>
              <strong>{{ metrics.prepaymentRatio }}%</strong>
              <small>不是已开票回款比例，不根据累计回款反算</small>
            </article>
          </div>
        } @else {
          <p>财务指标样例未加载；执行“模拟刷新”后读取演示快照。</p>
        }
        @if (f.cumulativeActualCost; as costSnapshot) {
          <article class="metric-card cumulative-cost-card">
            <span>累计实际成本</span>
            <strong>{{ store.money(costSnapshot.amount, costSnapshot.currency) }}</strong>
            <small>
              {{ costSnapshot.source }}模拟数据 · 截止 {{ costSnapshot.cutoff }} ·
              {{ costSnapshot.scope }}。不与费用或最终成本合计。
            </small>
          </article>
        } @else {
          <p>累计实际成本样例未加载；执行“模拟刷新”后读取演示快照。</p>
        }
        <h3>节点日期变更 · 已同步模拟记录</h3>
        @for (record of store.milestoneSyncHistory(projectId()); track record.id) {
          <article class="metric-card milestone-sync-card">
            <strong>
              @if (record.sourcePlanId === record.customerMilestoneId) {
                {{
                  customerMilestoneName(record.customerMilestoneId) || record.customerMilestoneName
                }}
                · 客户节点更新
              } @else {
                {{ planName(record.sourcePlanId) || record.sourcePlanName }} →
                {{
                  customerMilestoneName(record.customerMilestoneId) || record.customerMilestoneName
                }}
              }
            </strong>
            <small>
              已同步模拟变更 · 第{{ record.revision }}次 · {{ record.operator }} ·
              {{ record.createdAt }}
            </small>
            <small>
              客户约定日期：{{ record.oldCustomerAgreedDate || '—' }} →
              {{ record.customerAgreedDate || '无法判断' }}
            </small>
            <small>执行状态：{{ record.oldStatus || '—' }} → {{ record.newStatus }}</small>
            <small>
              预计日期：{{ record.oldExpectedDate || '—' }} → {{ record.newExpectedDate || '—' }} ·
              {{ dateDifference(record.newExpectedDate, record.customerAgreedDate) }}
            </small>
            <small>
              实际日期：{{ record.oldActualDate || '—' }} → {{ record.newActualDate || '—' }} ·
              {{ dateDifference(record.newActualDate, record.customerAgreedDate) }}
            </small>
          </article>
        } @empty {
          <p>暂无节点日期模拟变更记录；节点保存后会在此显示。</p>
        }
        <h3>费用 · 只读</h3>
        <div class="filters">
          <label
            >科目
            <select [ngModel]="category()" (ngModelChange)="category.set($event)">
              <option>全部</option>
              <option>差旅</option>
              <option>服务</option>
            </select></label
          ><label
            >币种
            <select [ngModel]="currency()" (ngModelChange)="currency.set($event)">
              <option>全部</option>
              <option>EUR</option>
              <option>CNY</option>
              <option>USD</option>
            </select></label
          >
        </div>
        <div class="table-scroll">
          <table>
            <thead>
              <tr>
                <th>科目／子类</th>
                <th>日期</th>
                <th>金额</th>
                <th>经办人</th>
                <th>来源</th>
              </tr>
            </thead>
            <tbody>
              @for (e of expenses(); track e.id) {
                <tr>
                  <td>{{ e.category }}／{{ e.subtype }}</td>
                  <td>{{ e.date }}</td>
                  <td>{{ store.money(e.amount, e.currency) }}</td>
                  <td>{{ e.person }}</td>
                  <td>{{ e.source }} · {{ e.sourceNumber }}</td>
                </tr>
              }
            </tbody>
          </table>
        </div>
        <p>
          筛选合计（币种分别统计）：
          @for (t of expenseTotals(); track t.currency) {
            <strong>{{ store.money(t.amount, t.currency) }} </strong>
          }
        </p>
        <h3>开票与回款 · 模拟事实</h3>
        <div class="table-scroll">
          <table>
            <thead>
              <tr>
                <th>发票</th>
                <th>金额／累计回款／余额</th>
                <th>开票／到期</th>
                <th>账龄</th>
                <th>状态</th>
                <th>余额来源</th>
              </tr>
            </thead>
            <tbody>
              @for (i of f.invoices; track i.id) {
                @let facts = store.invoiceFacts(projectId(), i);
                @let due = store.invoiceDue(projectId(), i);
                <tr>
                  <td>
                    {{ i.number }}<small>{{ i.id }}</small>
                  </td>
                  <td>
                    {{ store.money(i.amount, i.currency) }} /
                    {{ store.money(i.received, i.currency) }} /
                    {{ store.money(facts.balance, i.currency) }}
                  </td>
                  <td>
                    {{ i.issued || '未知' }} / {{ due.date || due.forecastDate || '未知' }}
                    <small>{{ due.source }}</small>
                  </td>
                  <td>{{ facts.age === null ? '未知' : facts.age + '天' }} · {{ facts.band }}</td>
                  <td>{{ facts.status }} {{ facts.overdue ? '· ' + facts.overdue + '天' : '' }}</td>
                  <td>
                    只读
                    <small>历史模拟回款与合同发票编辑已停用，余额沿用已提交记录</small>
                  </td>
                </tr>
              }
            </tbody>
          </table>
        </div>
        @for (t of receiptTotals(); track t.currency) {
          <p>
            {{ t.currency }} · 已开票{{ t.amount }} · 已回款{{ t.received }} · 余额{{
              t.balance
            }}
            · 已开票回款比例
            {{ t.amount > 0 ? ((t.received / t.amount) * 100).toFixed(1) + '%' : '不适用' }}
          </p>
        }
        <details>
          <summary>模拟回款事件</summary>
          @for (e of f.events; track $index) {
            <p>{{ e.invoiceId }} · 累计{{ e.received }} · {{ e.operator }} · {{ e.createdAt }}</p>
          }
        </details>
      } @else {
        <p>暂无快照，不代表项目无费用。财务可加载当前项目独立演示数据。</p>
      }
    </section>
    <section class="panel padded space-top">
      <div class="section-heading">
        <h2>最终实际成本</h2>
        <button class="btn primary" (click)="editCost()">
          {{ store.costs(projectId()).length ? '修订最终实际成本' : '填写最终实际成本' }}
        </button>
      </div>
      <p>财务保存即生效；费用、报价参考与BOM不自动计入最终成本。</p>
      @for (c of store.costs(projectId()); track c.id) {
        <div class="cost-record">
          <h3>
            修订{{ c.revision }} · {{ store.money(c.amount, c.currency) }} ·
            {{ $first ? '当前有效' : '历史只读' }}
          </h3>
          <p>范围 {{ c.scope }} · 成本截止{{ c.cutoff }} · 财务确认{{ c.confirmedDate }}</p>
          <p>
            提供／确认人 {{ c.provider }} · 操作人 {{ c.operator }} · 实际操作时间 {{ c.createdAt }}
          </p>
          <p>
            附件 {{ documentName(c.documentId) }} · 修订原因 {{ c.reason || '首次保存' }} ·
            零金额说明 {{ c.zeroReason || '—' }}
          </p>
          <button class="btn small" (click)="view(c.documentId)">查看模拟成本文件记录</button>
        </div>
      } @empty {
        <p>待提供：尚无最终实际成本记录。</p>
      }
      <app-documents
        [entityId]="projectId()"
        [kinds]="['最终成本资料']"
        title="模拟上传最终成本资料"
      />
    </section>
  }`,
  styles: `
    .section-heading,
    .filters {
      display: flex;
      justify-content: space-between;
      gap: 12px;
      flex-wrap: wrap;
    }
    .filters {
      justify-content: flex-start;
      margin: 12px 0;
    }
    .metric-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(190px, 1fr));
      gap: 12px;
      margin: 12px 0 22px;
    }
    .metric-card {
      display: grid;
      gap: 8px;
      align-content: start;
      min-width: 0;
      padding: 16px;
      border: 1px solid var(--line);
      border-radius: 8px;
      background: var(--surface, #fff);
    }
    .cumulative-cost-card {
      margin-bottom: 22px;
    }
    .milestone-sync-card {
      margin-bottom: 10px;
    }
    .warning-card {
      border-color: #e6bd6b;
      background: #fffaf0;
      margin-bottom: 10px;
    }
    .metric-card > span,
    .metric-card small {
      color: var(--muted, #7b8aa2);
      line-height: 1.6;
    }
    .metric-card strong {
      font-size: 20px;
      overflow-wrap: anywhere;
    }
    select {
      padding: 6px;
    }
    p {
      line-height: 1.8;
      overflow-wrap: anywhere;
    }
    small {
      display: block;
    }
    .cost-record {
      padding: 14px 0;
      border-top: 1px solid var(--line);
    }
    button {
      margin: 4px;
    }
  `,
})
export class ProjectFinance {
  store = inject(DemoStore);
  projectId = input.required<string>();
  baseDate = BASE_DATE;
  category = signal('全部');
  currency = signal('全部');
  planName(id: string): string {
    return this.store.project(this.projectId())?.plans.find((plan) => plan.id === id)?.name || '';
  }
  nodeWarnings() {
    return this.store
      .milestoneWarnings(this.projectId())
      .filter((warning) => warning.kind === '节点延期');
  }
  receivableWarnings() {
    return this.store
      .milestoneWarnings(this.projectId())
      .filter((warning) => warning.kind === '回款逾期');
  }
  customerMilestoneName(id: string): string {
    const milestone = this.store.customerMilestone(this.projectId(), id);
    return milestone ? `${milestone.name}（客户主节点）` : '';
  }
  dateDifference(value: string, agreed: string): string {
    if (
      !value ||
      !agreed ||
      !Number.isFinite(Date.parse(value)) ||
      !Number.isFinite(Date.parse(agreed))
    )
      return '偏差无法判断';
    const days = Math.round((Date.parse(value) - Date.parse(agreed)) / 86400000);
    return `相对客户约定日期${days > 0 ? '+' : ''}${days}天`;
  }
  expenses() {
    return (this.store.finance(this.projectId())?.expenses || []).filter(
      (e) =>
        (this.category() === '全部' || e.category === this.category()) &&
        (this.currency() === '全部' || e.currency === this.currency()),
    );
  }
  expenseTotals() {
    const map = new Map<string, number>();
    for (const e of this.expenses()) map.set(e.currency, (map.get(e.currency) || 0) + e.amount);
    return [...map].map(([currency, amount]) => ({ currency, amount }));
  }
  receiptTotals() {
    const state = this.store.state();
    return summarizeInvoicesByCurrency(
      this.store.invoicesForProject(this.projectId(), state),
      state.invoiceReceiptClaims || [],
      BASE_DATE,
    );
  }
  documentName(id: string) {
    return this.store.state().attachments.find((x) => x.id === id)?.name || '待补';
  }
  view(id: string) {
    const a = this.store.state().attachments.find((x) => x.id === id);
    if (a) void this.store.openFile(a);
  }
  editCost() {
    const c = this.store.costs(this.projectId())[0];
    const operationId = newId('OP');
    const files = this.store
      .attachments(this.projectId(), '最终成本资料')
      .filter((x) => x.mode === 'simulated');
    this.store.ui.open({
      title: c ? '修订最终实际成本' : '填写最终实际成本',
      description: '先在下方模拟上传成本资料，再选择记录。保存即生效，无审批。',
      fields: [
        {
          key: 'amount',
          label: '最终金额',
          type: 'number',
          min: 0,
          value: c?.amount ?? '',
          required: true,
        },
        {
          key: 'currency',
          label: '币种',
          type: 'select',
          options: ['EUR', 'CNY', 'USD'],
          value: c?.currency || 'EUR',
          required: true,
        },
        {
          key: 'scope',
          label: '成本范围',
          type: 'textarea',
          value: c?.scope || '',
          required: true,
        },
        {
          key: 'cutoff',
          label: '成本截止日',
          type: 'date',
          value: c?.cutoff || BASE_DATE,
          required: true,
        },
        {
          key: 'confirmedDate',
          label: '财务确认日',
          type: 'date',
          value: c?.confirmedDate || BASE_DATE,
          required: true,
        },
        personField('provider', '提供／确认人', c?.provider || this.store.person(), true),
        {
          key: 'document',
          label: '模拟成本文件',
          type: 'select',
          options: files.map((x) => `${x.id} · ${x.name}`),
          value: files.length ? `${files[0].id} · ${files[0].name}` : '',
          required: true,
        },
        { key: 'zeroReason', label: '0金额解释', type: 'textarea', value: c?.zeroReason || '' },
        { key: 'reason', label: '修订原因', type: 'textarea', required: !!c },
      ],
      onSave: (d) =>
        this.store.saveFinalCost(
          {
            projectId: this.projectId(),
            amount: Number(d['amount']),
            currency: d['currency'],
            scope: d['scope'],
            cutoff: d['cutoff'],
            confirmedDate: d['confirmedDate'],
            provider: d['provider'],
            documentId: d['document'].split(' · ')[0],
            zeroReason: d['zeroReason'],
            reason: d['reason'],
            operationId,
          },
          c?.revision || 0,
        ),
    });
  }
}
