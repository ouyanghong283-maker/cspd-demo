import { ChangeDetectionStrategy, Component, computed, inject, input } from '@angular/core';
import { RouterLink } from '@angular/router';
import { BankReceiptClaim, BankReceiptClaimLine } from '../core/remittances';
import { DemoStore } from '../core/store';

@Component({
  selector: 'app-contract-receipts',
  imports: [RouterLink],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="page-heading">
      <div>
        <h1>水单认领 · 只读历史</h1>
        <p>合同 {{ contractId() }} · 本地演示记录 · 本功能已停用新增与编辑</p>
      </div>
      <a class="btn" [routerLink]="['/contracts', contractId()]">返回合同</a>
    </div>
    <section class="panel padded">
      <p class="notice">
        水单管理及认领明细已停用新增与编辑。原水单编号、稳定ID、旧财务ID与源系统技术字段、认领明细、币种余额与订单／发票引用继续只读展示；
        历史记录不删除，也不改写发票余额。
      </p>
      <p class="fine-print">
        页面不创建银行流水号，也不按名称推断订单、发票或项目关联。不同币种不分摊，跨币种余额待核。
      </p>

      <div class="panel-head">
        <h2>已保存水单</h2>
        <span>{{ receipts().length }} 条</span>
      </div>
      @for (receipt of receipts(); track receipt.id) {
        <article class="receipt-row">
          <div>
            <strong>{{ receipt.number }}</strong>
            <small>{{ receipt.id }} · 合同 {{ receipt.contractId }} · {{ receipt.status }}</small>
            <small
              >本地模拟金额：{{ receipt.currency }} {{ receipt.amount.toFixed(2) }} · 到款日
              {{ receipt.receivedAt || '未记录' }}</small
            >
            <small
              >旧财务水单ID {{ receipt.sourceIds?.alp_claim_water_bill || '未记录' }}</small
            >
            @if (sourceFieldEntries(receipt).length) {
              <details class="source-details">
                <summary>源系统技术字段（只读）</summary>
                <dl>
                  @for (field of sourceFieldEntries(receipt); track field.key) {
                    <div>
                      <dt>{{ field.key }}</dt>
                      <dd>{{ field.value }}</dd>
                    </div>
                  }
                </dl>
              </details>
            }
          </div>
          <div class="line-list">
            @for (line of linesFor(receipt.id); track line.id) {
              <div>
                <span>
                  认领明细 {{ line.id }} · 订单 {{ line.orderId }} · {{ line.currency }}
                  {{ line.amount.toFixed(2) }}
                  @if (line.invoiceId) {
                    · 发票 {{ line.invoiceId }}
                  } @else {
                    · 未关联发票
                  }
                </span>
                <small
                  >旧财务认领明细ID
                  {{ line.sourceIds?.alp_water_bill_claim_details || '未记录' }}</small
                >
                @if (sourceFieldEntries(line).length) {
                  <details class="source-details">
                    <summary>源系统技术字段（只读）</summary>
                    <dl>
                      @for (field of sourceFieldEntries(line); track field.key) {
                        <div>
                          <dt>{{ field.key }}</dt>
                          <dd>{{ field.value }}</dd>
                        </div>
                      }
                    </dl>
                  </details>
                }
              </div>
            } @empty {
              <span>暂无认领明细。</span>
            }
          </div>
          <div class="summary-list">
            @for (summary of store.bankReceiptSummary(receipt.id); track summary.currency) {
              <div class="summary">
                {{ summary.currency }} 已认领 {{ summary.claimedAmount.toFixed(2) }} ·
                @if (summary.remainingAmount !== null) {
                  水单余额 {{ summary.remainingAmount.toFixed(2) }}
                } @else {
                  币种与水单头不同，余额待核
                }
              </div>
            } @empty {
              <div class="summary">水单已撤销或没有有效认领，余额不参与汇总。</div>
            }
          </div>
        </article>
      } @empty {
        <p class="padded">当前合同没有历史水单认领记录。</p>
      }
      <p class="fine-print">
        发票余额来源：<a [routerLink]="['/contracts', contractId(), 'invoices']">查看本合同发票与余额（只读）</a>
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
    .receipt-row {
      display: grid;
      grid-template-columns: minmax(180px, 1fr) minmax(260px, 2fr) minmax(180px, 1fr);
      gap: 18px;
      align-items: center;
      padding: 16px 0;
      border-bottom: 1px solid var(--line);
    }
    .receipt-row:last-of-type {
      border-bottom: 0;
    }
    small {
      display: block;
      color: var(--muted);
      margin-top: 5px;
      font-size: 10px;
    }
    .line-list {
      display: grid;
      gap: 5px;
      font-size: 11px;
    }
    .summary-list {
      display: grid;
      gap: 5px;
    }
    .summary {
      font-size: 11px;
      font-weight: 600;
    }
    .source-details {
      margin-top: 8px;
      border-top: 1px solid var(--line);
      padding-top: 8px;
    }
    .source-details summary {
      cursor: pointer;
      color: var(--muted);
      font-size: 10px;
    }
    .source-details dl {
      display: grid;
      gap: 5px;
      margin: 6px 0 0;
    }
    .source-details dl div {
      display: grid;
      grid-template-columns: minmax(120px, 1fr) 2fr;
      gap: 8px;
      font-size: 10px;
    }
    .source-details dd {
      margin: 0;
      overflow-wrap: anywhere;
    }
    @media (max-width: 720px) {
      .receipt-row {
        grid-template-columns: 1fr;
        gap: 10px;
      }
    }
  `,
})
export class ContractReceipts {
  readonly contractId = input.required<string>();
  readonly store = inject(DemoStore);
  readonly receipts = computed(() => this.store.bankReceiptClaims(this.contractId()));

  linesFor(receiptId: string) {
    return this.store.bankReceiptClaimLines(receiptId);
  }

  sourceFieldEntries(
    record: BankReceiptClaim | BankReceiptClaimLine,
  ): { key: string; value: string }[] {
    return Object.entries({
      ...(record.crmFields || {}),
      ...(record.sourceFields || {}),
    }).map(([key, value]) => ({
      key,
      value: typeof value === 'string' ? value : JSON.stringify(value),
    }));
  }
}
