import { Component, input } from '@angular/core';
import type { LifecycleProgressView } from '../v9-contracts';
import { PROGRESS_NODES } from './index';
@Component({
  selector: 'app-lifecycle-progress-panel',
  standalone: true,
  template: ` <section
    class="v9-reading v9-panel"
    data-v9-theme="light"
    aria-label="全流程业务进度"
  >
    <h3>全流程业务进度</h3>
    @if (view(); as v) {
      <p>
        已核实 {{ v.displayPercent }}%
        @if (!v.complete) {
          · 数据待补
        }
      </p>
      <p>固定 21 节点 / 100 分 · v9.1</p>
      <div class="v9-table-wrap" role="region" aria-label="可横向滚动的明细表" tabindex="0">
        <table class="v9-table">
          <thead>
            <tr>
              <th>节点</th>
              <th>满分</th>
              <th>得分</th>
              <th>依据状态</th>
              <th>证据</th>
            </tr>
          </thead>
          <tbody>
            @for (n of v.nodes; track n.nodeId) {
              <tr>
                <td>{{ label(n.nodeId) }}</td>
                <td class="v9-number">{{ n.weight }}</td>
                <td class="v9-number">
                  @if (n.score) {
                    {{ n.score.numerator }}/{{ n.score.denominator }}
                  } @else {
                    —
                  }
                </td>
                <td>
                  <span class="v9-status" [attr.data-v9-status]="n.status">{{
                    status(n.status)
                  }}</span>
                  {{ n.reason }}
                </td>
                <td>
                  @if (n.sourceHref) {
                    <a [href]="n.sourceHref">查看来源</a>
                  }
                  {{ n.sourceIds.join('、') }}
                </td>
              </tr>
            }
          </tbody>
        </table>
      </div>
    } @else {
      <p class="v9-empty">暂无可核实进度</p>
    }
  </section>`,
  styleUrl: './progress-panel.scss',
})
export class LifecycleProgressPanel {
  readonly view = input<LifecycleProgressView | null>(null);
  label(id: string) {
    return PROGRESS_NODES.find((n) => n.id === id)?.label ?? id;
  }
  status(s: string) {
    return (
      (
        {
          verified: '已核实',
          partial: '部分完成',
          incomplete: '未完成',
          missing: '数据待补',
          invalidated: '依据失效',
          'not-required': '无需执行',
        } as Record<string, string>
      )[s] ?? s
    );
  }
}
