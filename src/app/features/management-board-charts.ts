import { formatBudgetAmount } from '../core/budget';
import { Component, computed, input, output, signal } from '@angular/core';
import type {
  FirstFinalization,
  CompleteWorkItemView,
  BudgetComparisonView,
  BudgetCurrency,
} from '../core/v9-contracts';
import type { selectManagementStatistics } from '../core/management-statistics';
@Component({
  selector: 'app-management-board-charts',
  standalone: true,
  template: ` <section class="statistics" aria-label="部门事项与首次定稿统计">
    <div class="v9-panel">
      <h3>四部门完整事项</h3>
      <p>负责事项含已完成与未完成；逾期仅统计未完成事项。无法核实主责的记录单列。</p>
      <div class="v9-table-wrap" role="region" aria-label="部门事项统计，可横向滚动" tabindex="0">
        <table class="v9-table">
          <caption>
            责任部门与事项数
          </caption>
          <thead>
            <tr>
              <th>部门</th>
              <th>负责事项</th>
              <th>已完成</th>
              <th>未完成逾期</th>
              <th>明细</th>
            </tr>
          </thead>
          <tbody>
            @for (group of summary().departments; track group.department) {
              <tr>
                <th>{{ labels[group.department] }}</th>
                <td class="v9-number">{{ group.total }}</td>
                <td class="v9-number">{{ group.completed }}</td>
                <td class="v9-number">{{ group.overdueOpen }}</td>
                <td>
                  <button
                    class="v9-button"
                    type="button"
                    (click)="
                      department.set(department() === group.department ? null : group.department)
                    "
                    [attr.aria-expanded]="department() === group.department"
                  >
                    查看事项
                  </button>
                  <button
                    class="v9-button"
                    type="button"
                    (click)="departmentChange.emit(group.department)"
                  >
                    筛选部门
                  </button>
                </td>
              </tr>
            }
          </tbody>
        </table>
      </div>
      @if (department(); as selected) {
        <ul aria-label="部门事项明细">
          @for (item of summary().items; track item.id) {
            @if (item.department === selected) {
              <li>
                <button
                  class="v9-button"
                  type="button"
                  data-board-source
                  (click)="sourceOpen.emit(item.sourceHref)"
                >
                  {{ item.sourceRecordId }}
                </button>
                · {{ item.owner?.name || '负责人待核' }} ·
                {{ item.status === 'completed' ? '已完成' : '未完成' }} ·
                {{ item.dueDate || '日期待补' }}
              </li>
            }
          }
        </ul>
      }
    </div>
    <div class="v9-panel">
      <h3>首次定稿成绩</h3>
      <p>
        分母：{{ summary().firstResultDenominator }} 条已首次定稿业务。历史未评分
        {{ summary().historicalUnscored }}；未定稿 {{ summary().notFinalized }}。
      </p>
      <div class="results">
        @for (result of summary().firstResults; track result.result) {
          <button
            class="v9-button"
            type="button"
            (click)="choose(result.result)"
            [attr.aria-pressed]="selectedResult() === result.result"
          >
            <span>{{ resultLabels[result.result] }}</span
            ><strong>{{ result.count }}</strong>
          </button>
        }
      </div>
      @if (selectedResult()) {
        <p role="status">
          当前筛选：首次{{ resultLabels[selectedResult()!] }}
          <button class="v9-button" type="button" (click)="choose(null)">清除成绩筛选</button>
        </p>
      }
      @if (!summary().firstResultDenominator) {
        <p>暂无 V9 首次定稿成绩；旧最终标记不计入分母。</p>
      }
    </div>
    <div class="v9-panel">
      <h3>阶段分布</h3>
      <p>按当前筛选的业务主线计数；可用下列按钮选择或清除阶段。</p>
      @for (stage of stages(); track stage.id) {
        <button
          type="button"
          class="v9-button"
          [attr.aria-pressed]="selectedStages().includes(stage.id)"
          (click)="stageChange.emit(stage.id)"
        >
          {{ stage.id }}：{{ stage.count }} 条
        </button>
        <meter
          min="0"
          [max]="stage.total || 1"
          [value]="stage.count"
          [attr.aria-label]="stage.id + '，' + stage.count + '条，共' + stage.total + '条'"
        ></meter>
      } @empty {
        <p class="v9-empty">当前范围无业务阶段记录。</p>
      }
    </div>
    <div class="v9-panel">
      <h3>预算比较 · {{ currency() }}</h3>
      <p>实际支出为模拟数据；按项目、币种、适用范围分别展示，不跨币种合计。</p>
      <p>
        当前范围 {{ projectCount() }} 个项目 · 可比 {{ budgetCounts().comparable }} · 待补 / 不可比
        {{ budgetCounts().pending }}
      </p>
      <div class="v9-table-wrap" role="region" aria-label="预算比较数值，可横向滚动" tabindex="0">
        <table class="v9-table">
          <caption>
            当前币种预算与支出
          </caption>
          <thead>
            <tr>
              <th>项目 / 范围 / 截止日</th>
              <th>预算</th>
              <th>模拟支出</th>
              <th>执行率 / 状态</th>
            </tr>
          </thead>
          <tbody>
            @for (budget of budgets(); track budget.projectId + ':' + budget.currency) {
              <tr>
                <th>
                  {{ budget.projectId }}<br />{{ budget.scope || '范围待核' }} /
                  {{ budget.cutoff || '截止日待补' }}
                  <details>
                    <summary>费用只读明细 · {{ budget.expenses.length }} 项</summary>
                    @for (expense of budget.expenses; track expense.expenseId) {
                      <p>
                        {{ expense.expenseId }} · {{ expense.summary }} · {{ expense.date }} ·
                        {{ amount(expense.amountMinor, expense.currency) }} · {{ expense.scope }}
                      </p>
                    } @empty {
                      <p>
                        {{
                          budget.expenseMinor === null
                            ? '费用来源待补，不能判断零支出'
                            : '当前有效截止范围无费用记录'
                        }}
                      </p>
                    }
                  </details>
                </th>
                <td class="v9-number">{{ budget.budgetText }}</td>
                <td class="v9-number">{{ budget.expenseText }}</td>
                <td>
                  @if (budget.comparable && budget.executionPercent !== null) {
                    <span>{{ budget.executionPercent }}%</span
                    ><meter
                      min="0"
                      max="200"
                      [value]="budget.executionPercent"
                      [attr.aria-label]="
                        budget.projectId + '预算执行率' + budget.executionPercent + '%'
                      "
                    ></meter>
                  } @else {
                    <span>{{
                      budget.reason ||
                        (budget.budgetMinor === 0 ? '零预算，执行率不适用' : '不可比较')
                    }}</span>
                  }
                </td>
              </tr>
            } @empty {
              <tr>
                <td colspan="4">所选币种无预算比较来源，待补；不视为零支出。</td>
              </tr>
            }
          </tbody>
        </table>
      </div>
    </div>
  </section>`,
  styleUrl: './management-board-charts.scss',
})
export class ManagementBoardChartsComponent {
  summary = input.required<ReturnType<typeof selectManagementStatistics>>();
  stages = input<{ id: string; count: number; total: number }[]>([]);
  selectedStages = input<string[]>([]);
  budgets = input<(BudgetComparisonView & { budgetText: string; expenseText: string })[]>([]);
  projectCount = input(0);
  readonly amount = formatBudgetAmount;
  readonly budgetCounts = computed(() => {
    const comparable = new Set(
      this.budgets()
        .filter((b) => b.comparable)
        .map((b) => b.projectId),
    ).size;
    return { comparable, pending: this.projectCount() - comparable };
  });
  currency = input<BudgetCurrency>('CNY');
  sourceOpen = output<string>();
  stageChange = output<string>();
  departmentChange = output<CompleteWorkItemView['department']>();
  firstResultChange = output<FirstFinalization['result'] | null>();
  selectedResult = input<FirstFinalization['result'] | null>(null);
  department = signal<string | null>(null);
  labels: Record<string, string> = {
    sales: '销售',
    solution: '解决方案',
    'pm-pmo': 'PM / PMO',
    service: '运维售后',
    unknown: '部门待核',
  };
  resultLabels = { early: '提前', 'on-time': '按时', late: '逾期' };
  choose(result: FirstFinalization['result'] | null) {
    this.firstResultChange.emit(this.selectedResult() === result ? null : result);
  }
}
