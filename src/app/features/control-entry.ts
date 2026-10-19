import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { NgComponentOutlet } from '@angular/common';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { toSignal } from '@angular/core/rxjs-interop';
import { Control } from './control';

@Component({
  imports: [NgComponentOutlet, RouterLink],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (params().get('action') === 'continue') {
      <section class="inline-alert" aria-label="继续本轮">
        <strong>继续本轮</strong>
        <p>本轮数据已保留。下方可选择当前主线并打开板块，也可返回待办继续处理。</p>
        <a class="btn primary" routerLink="/">返回我的待办继续本轮</a>
      </section>
    }
    @if (params().get('action') === 'restart') {
      <section class="inline-alert warning" aria-label="重新开始演示">
        <strong>重新开始演示</strong>
        <p>确认后创建新的独立演示轮，保留旧工作区。请使用下方“重置演示数据”按钮选择新轮起点。</p>
      </section>
    }
    <ng-container *ngComponentOutlet="control" />
  `,
})
export class ControlEntry {
  private readonly route = inject(ActivatedRoute);
  readonly params = toSignal(this.route.queryParamMap, {
    initialValue: this.route.snapshot.queryParamMap,
  });
  readonly control = Control;
}
