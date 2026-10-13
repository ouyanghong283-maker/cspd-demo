import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { toSignal } from '@angular/core/rxjs-interop';
import { map } from 'rxjs';
import { DemoStore } from '../core/store';
import { BusinessForms } from '../core/forms';
import { STAGES } from '../core/models';
import { Icon } from '../shared/icon';
import { Badge } from '../shared/badge';
@Component({
  imports: [FormsModule, RouterLink, Icon, Badge],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: ` <div class="page-heading">
      <div>
        <h1>{{ kind() === 'lead' ? '线索管理' : '商机管理' }}</h1>
        <p>
          {{
            kind() === 'lead'
              ? '用少量信息登记客户需求，上传现用需求表后转为商机。'
              : '同一份客户资料，持续跟进每一个销售阶段。'
          }}
        </p>
      </div>
      <button class="btn primary" [disabled]="!store.salesEditable()" (click)="forms.newLead()">
        <app-icon name="plus" />新建线索
      </button>
    </div>
    <div class="filter-bar">
      <label class="search-box"
        ><app-icon name="search" /><input
          aria-label="搜索线索或商机"
          placeholder="搜索客户、项目或编号"
          [(ngModel)]="query" /></label
      ><select aria-label="销售负责人筛选" [(ngModel)]="owner">
        <option value="">全部负责人</option>
        <option>张销售</option>
        <option>赵销售</option>
        <option>孙销售</option></select
      ><select aria-label="阶段或状态筛选" [(ngModel)]="stage">
        <option value="">全部{{ kind() === 'lead' ? '状态' : '阶段' }}</option>
        @for (s of options(); track s) {
          <option>{{ s }}</option>
        }</select
      ><span class="grow"></span><span class="count-label">共{{ rows().length }}条记录</span>
    </div>
    <section class="panel">
      <div class="table-wrap">
        <table>
          <thead>
            <tr>
              <th>{{ kind() === 'lead' ? '线索 / 项目' : '商机 / 项目' }}</th>
              <th>客户 / 国家</th>
              <th>负责人 / 录入人</th>
              <th>阶段 / 状态</th>
              <th>容量</th>
              <th class="numeric">预计金额</th>
              <th>预计签单</th>
              <th>最近跟进</th>
              <th>操作</th>
            </tr>
          </thead>
          <tbody>
            @for (s of rows(); track s.id) {
              <tr>
                <td>
                  <a class="main-link" [routerLink]="['/sales/detail', s.id]">{{
                    s.projectName || '待补项目名称'
                  }}</a>
                  <p>
                    {{ s.id }}
                    @if (s.type === 'lead') {
                      · {{ s.source }}
                    }
                  </p>
                  @if (s.type === 'lead' && s.description) {
                    <p>{{ s.description }}</p>
                  }
                  @if (s.type === 'lead' && s.convertedDate) {
                    <p>转化于 {{ s.convertedDate }}</p>
                  }
                </td>
                <td>
                  <strong>{{ store.customer(s.customerId)?.shortName }}</strong>
                  <p>
                    {{ store.customer(s.customerId)?.country }} ·
                    {{ store.contact(s)?.name || '待补联系人' }}
                  </p>
                </td>
                <td>
                  <div class="person-row">
                    <span class="avatar">{{ s.owner.slice(0, 1) }}</span>
                    <div>
                      {{ s.owner }}
                      <p>{{ s.operator }}录入</p>
                    </div>
                  </div>
                </td>
                <td>
                  <app-badge [text]="s.type === 'lead' ? s.status : s.stage" />
                  @if (s.needsReview) {
                    <p style="color:var(--red)">资料需复核</p>
                  }
                </td>
                <td>{{ s.capacity || '待确认' }} {{ s.unit }}</td>
                <td class="numeric">
                  {{ s.amount ? store.money(s.amount, s.currency) : '待确认' }}
                </td>
                <td class="nowrap">{{ s.expectedDate || '待确认' }}</td>
                <td>
                  <span [style.color]="store.days(s) >= 30 ? 'var(--amber)' : ''">{{
                    store.days(s) > 0 ? store.days(s) + '天前' : '近期更新'
                  }}</span>
                </td>
                <td><a class="text-link" [routerLink]="['/sales/detail', s.id]">查看详情</a></td>
              </tr>
            } @empty {
              <tr>
                <td colspan="9" class="empty">没有匹配记录，调整筛选或新建线索。</td>
              </tr>
            }
          </tbody>
        </table>
      </div>
    </section>
    <div class="inline-alert space-top">
      <app-icon name="info" /><span
        >业务记录与看板同源。客户信息只填一次，转换后仍可查看历史沟通及需求附件。</span
      >
    </div>`,
})
export class SalesList {
  store = inject(DemoStore);
  forms = inject(BusinessForms);
  route = inject(ActivatedRoute);
  kind = toSignal(this.route.data.pipe(map((d) => d['kind'] as 'lead' | 'opportunity')), {
    initialValue: 'lead' as 'lead' | 'opportunity',
  });
  query = signal(this.route.snapshot.queryParamMap.get('q') || '');
  owner = signal(this.route.snapshot.queryParamMap.get('owner') || '');
  stage = signal(this.route.snapshot.queryParamMap.get('stage') || '');
  country = this.route.snapshot.queryParamMap.get('country') || '';
  grade = this.route.snapshot.queryParamMap.get('grade') || '';
  currency = this.route.snapshot.queryParamMap.get('currency') || '';
  liveOnly = this.route.snapshot.queryParamMap.get('live') === 'true';
  closedOnly = this.route.snapshot.queryParamMap.get('closed') === 'true';
  options = computed(() =>
    this.kind() === 'lead' ? ['草稿', '待跟进', '暂缓跟进', '已归档', '已转商机'] : [...STAGES],
  );
  rows = computed(() =>
    this.store
      .state()
      .sales.filter(
        (s) =>
          s.type === this.kind() &&
          (!this.country || this.store.customer(s.customerId)?.country === this.country) &&
          (!this.grade || s.grade === this.grade) &&
          (!this.currency || s.currency === this.currency) &&
          (!this.liveOnly || !['赢单', '丢单'].includes(s.stage)) &&
          (!this.closedOnly || ['赢单', '丢单'].includes(s.stage)) &&
          (!this.route.snapshot.queryParamMap.get('customer') ||
            s.customerId === this.route.snapshot.queryParamMap.get('customer')) &&
          (!this.owner() || s.owner === this.owner()) &&
          (!this.stage() || (s.type === 'lead' ? s.status : s.stage) === this.stage()) &&
          `${s.projectName}${s.id}${this.store.customer(s.customerId)?.name}`
            .toLowerCase()
            .includes(this.query().toLowerCase()),
      ),
  );
}
