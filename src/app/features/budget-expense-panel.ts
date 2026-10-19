import { DemoStore } from '../core/store';
import { initializeBudgetDemoSources } from '../core/budget-demo-expenses';
import { newId } from '../core/seed';
import { Component, input, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import type { BudgetComparisonView } from '../core/v9-contracts';
import type { selectBudgetIntegrity } from '../core/budget-comparison';
@Component({
  selector: 'app-budget-expense-panel',
  standalone: true,
  imports: [RouterLink],
  template: ` <section
    class="v9-reading v9-panel"
    data-v9-theme="light"
    aria-label="预算与模拟费用"
  >
    <h3>预算与模拟费用</h3>
    @if (
      !readonlyMode() && !store.state().budgetDemoExpenses && !store.state().budgetComparisonSources
    ) {
      <p class="v9-notice">当前显示固定模拟来源样例；启用并保存后可在本工作区持续核对。</p>
      <button class="btn" [disabled]="!store.editingWritable()" (click)="initialize()">
        启用固定模拟费用
      </button>
    }
    <p role="status">{{ feedback() }}</p>
    <p class="v9-notice">只读 · 实际支出为模拟数据，不代表真实财务同步</p>
    @if (integrity(); as b) {
      <h4>{{ b.complete ? '预算构成' : '已填部分预算' }}</h4>
      <ul>
        @for (row of b.rows; track row.planId) {
          <li>
            {{ row.name }} ·
            {{ row.amountMinor === null ? '预算待补' : (row.amountMinor! / 100).toFixed(2) }}
            {{ row.currency }} {{ row.reason }}
          </li>
        }
      </ul>
    }
    @for (v of views(); track v.currency) {
      <h4>{{ v.currency }} · {{ v.scope ?? '范围待核' }}</h4>
      <p>截止日：{{ v.cutoff ?? '待补' }} · {{ v.reason ?? '来源范围已核对' }}</p>
      <p>{{ v.budgetStatus }} · 阈值为演示展示口径</p>
      <p>预计预算：{{ money(v.budgetMinor) }} / 模拟支出：{{ money(v.expenseMinor) }}</p>
      <p>
        执行率：{{ percent(v.executionPercent) }} · 偏差：{{ money(v.varianceMinor) }} · 超支：{{
          money(v.overspendMinor ?? null)
        }}
      </p>
      @if (v.comparable && v.budgetMinor === 0 && v.expenseMinor !== null) {
        <p class="v9-notice">
          {{ v.expenseMinor === 0 ? '零预算无支出，执行率不适用' : '零预算有支出，状态异常' }}
        </p>
      }
      <div class="v9-table-wrap" role="region" aria-label="可横向滚动的明细表" tabindex="0">
        <table class="v9-table">
          <thead>
            <tr>
              <th>费用</th>
              <th>金额</th>
              <th>来源 / 批次</th>
              <th>日期 / 截止日</th>
            </tr>
          </thead>
          <tbody>
            @for (e of v.expenses; track e.expenseId) {
              <tr>
                <td>
                  {{ e.summary }} · {{ e.expenseId }} · {{ e.planId ?? e.scope }}
                  @if (e.planId) {
                    <a
                      class="text-link"
                      [routerLink]="['/projects', e.projectId]"
                      [queryParams]="{ tab: 'plans', plan: '内部WBS', focus: e.planId }"
                      >定位WBS</a
                    >
                  }
                </td>
                <td class="v9-number">{{ money(e.amountMinor) }} {{ e.currency }}</td>
                <td>{{ e.sourceRecordId }} / {{ e.batchId }} · 模拟</td>
                <td class="v9-date">{{ e.date }} / {{ e.cutoff }}</td>
              </tr>
            }
          </tbody>
        </table>
      </div>
    } @empty {
      <p class="v9-empty">暂无已选模拟费用来源，预算比较待补</p>
    }
  </section>`,
  styleUrl: './budget-expense-panel.scss',
})
export class BudgetExpensePanel {
  readonly readonlyMode = input(false);
  readonly store = inject(DemoStore);
  readonly feedback = signal('');
  initialize() {
    const t = this.store.v9CommandTarget();
    if (!t) return;
    this.feedback.set(
      initializeBudgetDemoSources(this.store, { ...t, operationId: newId('BUDGET') }).message,
    );
  }

  readonly views = input<BudgetComparisonView[]>([]);
  readonly integrity = input<ReturnType<typeof selectBudgetIntegrity> | null>(null);
  money(n: number | null) {
    return n === null ? '待补' : (n / 100).toFixed(2);
  }
  percent(n: number | null) {
    return n === null ? '—' : n.toFixed(1) + '%';
  }
}
