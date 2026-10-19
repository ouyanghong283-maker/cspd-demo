import { ChangeDetectionStrategy, Component, computed, inject, input } from '@angular/core';
import { RouterLink } from '@angular/router';
import { BASE_DATE } from '../core/models';
import {
  calculateInvoiceBalance,
  ContractInvoice,
  InvoiceReceiptClaim,
  summarizeInvoicesByCurrency,
} from '../core/invoices';
import { DemoStore } from '../core/store';

@Component({
  selector: 'app-contract-invoices',
  imports: [RouterLink],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="page-heading">
      <div>
        <h1>合同发票与余额 · 只读历史</h1>
        <p>合同 {{ contractId() }} · 演示基准日 {{ baseDate }} · 本功能已停用新增与编辑</p>
      </div>
      <a class="btn" [routerLink]="['/contracts', contractId()]">返回合同</a>
    </div>
    <section class="panel padded">
      <p class="notice">
        合同发票已停用新增与编辑。原发票号、稳定ID、金额、余额来源、币种与项目引用继续只读展示；历史记录和项目引用不删除。
      </p>
      <p class="fine-print">
        项目财务与水单认领历史引用同一批发票ID。未连接标准CRM系统、银行或SAP。金额按两位小数展示，不同币种分开汇总。
      </p>

      <h3>发票与余额</h3>
      @if (invoices().length) {
        <div class="table-wrap">
          <table>
            <thead>
              <tr>
                <th>发票</th>
                <th>金额／已回／余额</th>
                <th>到期日</th>
                <th>项目引用</th>
                <th>来源与状态</th>
              </tr>
            </thead>
            <tbody>
              @for (invoice of invoices(); track invoice.id) {
                @let facts = factsFor(invoice);
                <tr>
                  <td>
                    {{ invoice.number }}
                    <small>{{ invoice.id }} · 修订{{ invoice.revision }}</small>
                  </td>
                  <td>
                    {{ money(facts.amount, invoice.currency) }} /
                    {{ money(facts.received, invoice.currency) }} /
                    {{ money(facts.balance, invoice.currency) }}
                  </td>
                  <td>
                    {{ facts.due.effectiveDate || facts.due.forecastDate || '无法判断' }}
                    <small>{{ facts.due.source }}</small>
                    @if (facts.due.milestoneId) {
                      <small
                        >节点 {{ invoice.dueMilestoneName || facts.due.milestoneId }} · 账期
                        {{ facts.due.paymentTermDays ?? '未知' }} 天</small
                      >
                      <small>{{
                        invoice.dueMilestoneSourceReference || invoice.dueMilestoneStatus || '节点来源待核'
                      }}</small>
                    }
                  </td>
                  <td>
                    @for (projectId of invoice.projectIds; track projectId) {
                      <small>{{ projectLabel(projectId) }}</small>
                    } @empty {
                      <small>未关联项目</small>
                    }
                  </td>
                  <td>
                    {{ facts.balanceSource }} · {{ facts.status
                    }}{{ facts.due.overdueDays ? ' · 实际逾期' + facts.due.overdueDays + '天' : '' }}
                  </td>
                </tr>
              }
            </tbody>
          </table>
        </div>
        <p>
          按币种汇总：
          @for (total of totals(); track total.currency) {
            <strong
              >{{ total.currency }} 已开 {{ money(total.amount, total.currency) }} · 已回
              {{ money(total.received, total.currency) }} · 余额
              {{ money(total.balance, total.currency) }}（{{ total.invoiceCount }} 张）</strong
            >
          }
        </p>
        <p class="fine-print">
          同一发票ID被多个项目引用时按记录ID去重统计，不同币种不混加。实际负余额会明确标为数据异常；预计节点只显示预测日期，不计为实际逾期。
        </p>
      } @else {
        <p class="fine-print">当前合同尚无历史发票记录。</p>
      }
      <p class="fine-print">
        水单认领历史：<a [routerLink]="['/contracts', contractId(), 'receipts']">查看本合同水单与认领明细（只读）</a>
      </p>
    </section>
  `,
  styles: `
    .notice {
      padding: 12px;
      background: #fff8e8;
      border: 1px solid #f0d79f;
      border-radius: 6px;
      line-height: 1.7;
    }
    table small {
      display: block;
      color: var(--muted);
      font-size: 10px;
      margin-top: 4px;
    }
    td {
      vertical-align: top;
    }
  `,
})
export class ContractInvoices {
  readonly contractId = input.required<string>();
  readonly baseDate = BASE_DATE;
  private readonly store = inject(DemoStore);
  readonly invoices = computed(() => this.store.invoicesForContract(this.contractId()));
  readonly totals = computed(() => summarizeInvoicesByCurrency(this.invoices(), this.claimFacts(), this.baseDate));

  factsFor(invoice: ContractInvoice) {
    const source = this.store.invoiceReceiptClaims(invoice.id);
    const normalized: ContractInvoice = { ...invoice, cumulativeSource: source.source, received: source.received };
    const claims = source.source === 'claims' && source.claimReceived !== 0
      ? [{ id: source.claimIds.join(','), invoiceId: invoice.id, amount: source.claimReceived, currency: invoice.currency, status: '有效' } satisfies InvoiceReceiptClaim]
      : [];
    return calculateInvoiceBalance(normalized, claims, this.baseDate);
  }

  money(value: number, currency: string): string {
    return `${currency} ${value.toFixed(2)}`;
  }

  projectLabel(projectId: string): string {
    const project = this.store.project(projectId);
    return project ? `${project.name} · ${project.id}` : `${projectId} · 项目待核`;
  }

  private claimFacts(): InvoiceReceiptClaim[] {
    return this.invoices().flatMap((invoice) => {
      const source = this.store.invoiceReceiptClaims(invoice.id);
      return source.source === 'claims' && source.claimReceived !== 0
        ? [{ id: source.claimIds.join(','), invoiceId: invoice.id, amount: source.claimReceived, currency: invoice.currency, status: '有效' as const }]
        : [];
    });
  }
}
