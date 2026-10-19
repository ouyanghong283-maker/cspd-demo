import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';

@Component({
  imports: [RouterLink],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="panel padded">
      @if (route.snapshot.data['planned']) {
        <h1>入口已登记，功能待接入</h1>
        <p>{{ route.snapshot.data['message'] || '该导航目标尚未连接到业务记录。' }}</p>
      } @else {
        <h1>没有找到这个入口</h1>
        <p>路径 {{ router.url }} 未登记，原地址未改写。</p>
      }
      <a class="text-link" routerLink="/">返回我的工作</a>
    </section>
  `,
  styles: `
    .panel {
      margin: 24px;
    }
    .text-link {
      color: #315dde;
    }
  `,
})
export class NavigationNotFound {
  readonly route = inject(ActivatedRoute);
  readonly router = inject(Router);
}
