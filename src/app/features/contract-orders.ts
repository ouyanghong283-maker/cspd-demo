import { ChangeDetectionStrategy, Component, computed, inject, input } from '@angular/core';
import { RouterLink } from '@angular/router';
import { DemoStore } from '../core/store';
import { SalesOrder, SalesOrderLine } from '../core/orders';

@Component({
  selector: 'app-contract-orders',
  imports: [RouterLink],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="page-heading">
      <div>
        <h1>销售订单与明细 · 只读历史</h1>
        <p>合同 {{ contractId() }} · 本功能已停用新增与编辑</p>
      </div>
      <a class="btn" [routerLink]="['/contracts', contractId()]">返回合同</a>
    </div>
    <section class="panel padded">
      <p class="notice">
        合同订单与明细已停用新增与编辑。原订单、明细、稳定ID、金额与项目引用继续只读展示，历史记录不删除；
        项目视图仍引用同一批稳定ID。
      </p>
      @if (orders().length) {
        @for (order of orders(); track order.id) {
          <article class="order-record">
            <div class="order-head">
              <strong>{{ order.orderNumber || '未编号订单' }}</strong>
              <small
                >订单ID {{ order.id }} · 合同 {{ order.contractId }} · 修订 {{ order.revision }}</small
              >
              <small>
                项目引用
                {{ order.projectId ? projectLabel(order.projectId) : '未关联项目' }} · 交期
                {{ order.deliveryDate || '未记录' }} · 负责人 {{ order.owner || '未记录' }}
              </small>
              <small>
                状态 {{ order.status || '状态待补' }} · 金额
                {{ store.money(order.amount, order.currency) }} · 更新
                {{ order.updatedAt || '未记录' }}
              </small>
            </div>
            @if (linesFor(order.id).length) {
              <div class="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>明细</th>
                      <th>物料描述</th>
                      <th>SAP 物料号</th>
                      <th>数量</th>
                      <th>批次号</th>
                      <th>需求交期</th>
                    </tr>
                  </thead>
                  <tbody>
                    @for (line of linesFor(order.id); track line.id) {
                      <tr>
                        <td>{{ line.id }}</td>
                        <td>{{ line.productDescription || '未记录' }}</td>
                        <td>{{ line.sapMaterialNumber || '未记录' }}</td>
                        <td>{{ line.quantity }} {{ line.unit }}</td>
                        <td>{{ line.batchNumber || '未记录' }}</td>
                        <td>{{ line.requestedDeliveryDate || '未记录' }}</td>
                      </tr>
                    }
                  </tbody>
                </table>
              </div>
            } @else {
              <p class="fine-print">该订单没有历史明细行。</p>
            }
            @if (sourceFieldEntries(order).length) {
              <details class="source-details">
                <summary>源系统技术字段（只读）</summary>
                <dl>
                  @for (field of sourceFieldEntries(order); track field.key) {
                    <div>
                      <dt>{{ field.key }}</dt>
                      <dd>{{ field.value }}</dd>
                    </div>
                  }
                </dl>
              </details>
            }
          </article>
        }
      } @else {
        <p class="fine-print">此合同没有历史销售订单记录。</p>
      }
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
    .order-record {
      padding: 16px 0;
      border-top: 1px solid var(--line);
    }
    .order-record:first-of-type {
      border-top: 0;
    }
    .order-head {
      display: grid;
      gap: 5px;
    }
    .order-head small,
    .source-details dt {
      color: var(--muted);
      font-size: 11px;
    }
    .source-details {
      margin-top: 12px;
      border-top: 1px solid var(--line);
      padding-top: 12px;
    }
    .source-details summary {
      cursor: pointer;
      color: var(--muted);
      font-size: 12px;
    }
    .source-details dl {
      display: grid;
      gap: 7px;
    }
    .source-details dl div {
      display: grid;
      grid-template-columns: minmax(150px, 1fr) 2fr;
      gap: 12px;
      font-size: 11px;
    }
    .source-details dd {
      margin: 0;
      overflow-wrap: anywhere;
    }
  `,
})
export class ContractOrders {
  readonly contractId = input.required<string>();
  readonly store = inject(DemoStore);
  readonly orders = computed(() => this.store.ordersForContract(this.contractId()));

  linesFor(orderId: string): SalesOrderLine[] {
    return this.store.orderLines(orderId);
  }

  projectLabel(projectId: string): string {
    const project = this.store.project(projectId);
    return project ? `${project.name} · ${project.id}` : `${projectId} · 项目待核`;
  }

  sourceFieldEntries(order: SalesOrder): { key: string; value: string }[] {
    return Object.entries({
      ...(order.crmFields || {}),
      ...(order.sourceFields || {}),
    }).map(([key, value]) => ({
      key,
      value: typeof value === 'string' ? value : JSON.stringify(value),
    }));
  }
}
