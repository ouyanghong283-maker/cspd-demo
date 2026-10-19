import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { toSignal } from '@angular/core/rxjs-interop';
import { DemoStore } from '../core/store';
import { BusinessForms } from '../core/forms';
import { Icon } from '../shared/icon';
import { Badge } from '../shared/badge';
import { CUSTOMER_COUNTRIES } from '../core/customer-dictionaries';

@Component({
  imports: [RouterLink, Icon, Badge],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (customer(); as c) {
      <div class="page-heading">
        <div>
          <a class="text-link" routerLink="/sales/customers">客户管理 / 返回列表</a>
          <h1>{{ c.name }}</h1>
          <p>{{ c.id }} · {{ c.country || '待补国家' }} · {{ c.region || '地区待补' }}</p>
        </div>
        <button class="btn primary" (click)="forms.customer(c)">
          <app-icon name="edit" />编辑客户
        </button>
      </div>
      @if (!validCountry(c.country)) {
        <div class="inline-alert warning">
          客户国家为空或不是当前可选国家。编辑客户档案，从下拉选项中选择后才能转商机。
        </div>
      }
      <div class="detail-grid">
        <section class="panel info-panel">
          <div class="panel-head">
            <h2>客户资料</h2>
            <app-badge [text]="c.status || '潜在客户'" />
          </div>
          <dl>
            <div>
              <dt>客户ID</dt>
              <dd>{{ c.id }}</dd>
            </div>
            <div>
              <dt>客户名称</dt>
              <dd>{{ c.name }}</dd>
            </div>
            <div>
              <dt>客户国家</dt>
              <dd>{{ c.country || '待补' }}</dd>
            </div>
            <div>
              <dt>客户地区</dt>
              <dd>{{ c.region || '待补' }}</dd>
            </div>
            <div>
              <dt>行业角色</dt>
              <dd>{{ c.industry || '待补' }}</dd>
            </div>
            <div>
              <dt>人员规模</dt>
              <dd>{{ c.employeeSize || '待补' }}</dd>
            </div>
            <div>
              <dt>销售负责人</dt>
              <dd>{{ c.owner || '待分配' }}</dd>
            </div>
            <div>
              <dt>客户邮箱</dt>
              <dd>{{ c.email || '待补' }}</dd>
            </div>
            <div>
              <dt>客户地址</dt>
              <dd>{{ c.address || '待补' }}</dd>
            </div>
            <div>
              <dt>创建信息</dt>
              <dd>{{ c.createdAt || '历史记录' }} · {{ c.createdBy || '历史记录' }}</dd>
            </div>
            <div class="wide">
              <dt>客户基本信息</dt>
              <dd>{{ c.basicInfo || '待补' }}</dd>
            </div>
          </dl>
        </section>
        <section class="panel info-panel">
          <div class="panel-head">
            <h2>关联联系人</h2>
            <a
              class="text-link"
              [routerLink]="['/sales/contacts']"
              [queryParams]="{ customer: c.id }"
              >打开联系人管理</a
            >
          </div>
          @for (contact of c.contacts; track contact.id) {
            <article class="contact-row">
              <span class="avatar">{{ contact.name.slice(0, 1) || '联' }}</span>
              <div>
                <strong>{{ contact.name }}</strong>
                <p>
                  {{ contact.position || '岗位待补' }} ·
                  {{ contact.phone || contact.email || '联系方式待补' }}
                </p>
              </div>
              <button
                class="icon-btn"
                [attr.aria-label]="'编辑' + contact.name"
                (click)="forms.addContact(c, contact)"
              >
                <app-icon name="edit" />
              </button>
            </article>
          } @empty {
            <div class="empty-state">暂无联系人。到联系人管理新增并关联客户。</div>
          }
        </section>
        <section class="panel info-panel related">
          <h2>关联线索与商机</h2>
          <div class="related-links">
            <a routerLink="/sales/leads" [queryParams]="{ customer: c.id }"
              >{{ leads().length }} 条线索</a
            >
            <a routerLink="/sales/opportunities" [queryParams]="{ customer: c.id }"
              >{{ opportunities().length }} 个商机</a
            >
          </div>
          @for (item of opportunities(); track item.id) {
            <a class="record-row" [routerLink]="['/sales/detail', item.id]">
              <span>{{ item.projectName || '未命名商机' }}</span
              ><small>{{ item.id }} · {{ item.status }}</small>
            </a>
          }
        </section>
      </div>
    } @else {
      <div class="empty-state">
        找不到这条客户档案。<a routerLink="/sales/customers">返回客户管理</a>
      </div>
    }
  `,
  styles: `
    .detail-grid {
      display: grid;
      grid-template-columns: repeat(2, minmax(0, 1fr));
      gap: 16px;
    }
    .info-panel {
      padding: 20px;
    }
    .panel-head {
      display: flex;
      justify-content: space-between;
      align-items: center;
      gap: 12px;
    }
    .panel-head h2,
    .related h2 {
      margin: 0;
      font-size: 15px;
    }
    dl {
      display: grid;
      grid-template-columns: repeat(2, minmax(0, 1fr));
      gap: 17px 20px;
      margin: 22px 0 0;
    }
    dl div {
      min-width: 0;
    }
    dl .wide {
      grid-column: 1 / -1;
    }
    dt {
      color: #77849a;
      font-size: 10px;
    }
    dd {
      margin: 5px 0 0;
      font-size: 12px;
      overflow-wrap: anywhere;
    }
    .contact-row,
    .record-row {
      display: flex;
      gap: 12px;
      align-items: center;
      padding: 13px 0;
      border-bottom: 1px solid var(--line);
    }
    .contact-row:last-child,
    .record-row:last-child {
      border-bottom: 0;
    }
    .contact-row > div {
      flex: 1;
      min-width: 0;
    }
    .contact-row strong,
    .record-row span {
      font-size: 12px;
    }
    .contact-row p,
    .record-row small {
      display: block;
      margin: 5px 0 0;
      color: #77849a;
      font-size: 10px;
    }
    .related {
      grid-column: 1 / -1;
    }
    .related-links {
      display: flex;
      gap: 20px;
      margin: 15px 0;
      font-size: 12px;
    }
    .record-row {
      justify-content: space-between;
      text-decoration: none;
    }
    .empty-state {
      padding: 24px;
      color: #77849a;
      font-size: 12px;
    }
    @media (max-width: 760px) {
      .detail-grid {
        grid-template-columns: 1fr;
      }
      .related {
        grid-column: auto;
      }
    }
  `,
})
export class CustomerDetail {
  store = inject(DemoStore);
  forms = inject(BusinessForms);
  route = inject(ActivatedRoute);
  params = toSignal(this.route.paramMap, { initialValue: this.route.snapshot.paramMap });
  customer = computed(() => this.store.customer(this.params().get('id') || ''));
  leads = computed(() => this.store.leadsForCustomer(this.customer()?.id || ''));
  opportunities = computed(() =>
    this.store.opportunities().filter((item) => item.customerId === this.customer()?.id),
  );
  validCountries = CUSTOMER_COUNTRIES;
  validCountry(country: string): boolean {
    return CUSTOMER_COUNTRIES.includes(country as (typeof CUSTOMER_COUNTRIES)[number]);
  }
}
