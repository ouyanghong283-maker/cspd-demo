import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { DemoStore } from '../core/store';
import { BusinessForms } from '../core/forms';
import { Icon } from '../shared/icon';
import { Badge } from '../shared/badge';
@Component({
  imports: [FormsModule, RouterLink, Icon, Badge],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: ` <div class="page-heading">
      <div>
        <h1>客户与联系人</h1>
        <p>统一客户信息，让线索、商机与交付项目引用同一份资料。</p>
      </div>
      <button class="btn primary" [disabled]="!store.salesEditable()" (click)="forms.customer()">
        <app-icon name="plus" />新建客户
      </button>
    </div>
    <div class="filter-bar">
      <label class="search-box"
        ><app-icon name="search" /><input
          aria-label="搜索客户"
          placeholder="搜索客户名称、国家或联系人"
          [(ngModel)]="query" /></label
      ><select aria-label="国家筛选" [(ngModel)]="country">
        <option value="">全部国家</option>
        @for (c of countries(); track c) {
          <option>{{ c }}</option>
        }</select
      ><span class="grow"></span
      ><span class="count-label">{{ rows().length }}个客户 · 共用主数据</span>
    </div>
    <div class="grid-3">
      @for (c of rows(); track c.id) {
        <section class="panel customer-card">
          <div class="customer-top">
            <span class="customer-symbol"><app-icon name="building" /></span
            ><app-badge [text]="c.industry" />
          </div>
          <h2>{{ c.name }}</h2>
          <p class="country"><app-icon name="globe" />{{ c.country }} · {{ c.id }}</p>
          <div class="contacts">
            @for (contact of c.contacts; track contact.id) {
              <div class="contact-row">
                <span class="avatar">{{ contact.name.slice(0, 1) }}</span>
                <div>
                  <strong
                    >{{ contact.name }} <small>{{ contact.position }}</small></strong
                  >
                  <p>{{ contact.email || contact.phone }} · {{ contact.department }}</p>
                </div>
              </div>
            } @empty {
              <p>联系人待补充</p>
            }
          </div>
          <div class="customer-bottom">
            <a routerLink="/sales/opportunities" [queryParams]="{ customer: c.id }"
              >{{ opportunities(c.id) }}个关联商机</a
            >
            <div>
              <button
                class="icon-btn"
                [disabled]="!store.salesEditable()"
                [attr.aria-label]="'新增' + c.name + '联系人'"
                (click)="forms.addContact(c)"
              >
                <app-icon name="plus" /></button
              ><button
                class="icon-btn"
                [disabled]="!store.salesEditable()"
                [attr.aria-label]="'编辑' + c.name"
                (click)="forms.customer(c)"
              >
                <app-icon name="edit" />
              </button>
            </div>
          </div>
        </section>
      } @empty {
        <div class="empty">没有匹配客户，请调整筛选。</div>
      }
    </div>`,
  styles: `
    .customer-card {
      padding: 21px 23px;
    }
    .customer-top {
      display: flex;
      align-items: center;
      justify-content: space-between;
      margin-bottom: 18px;
    }
    .customer-symbol {
      padding: 10px;
      background: #f0f4fc;
      color: #6887c0;
      border-radius: 8px;
    }
    .customer-card h2 {
      font-size: 15px;
      margin: 0 0 10px;
    }
    .country {
      font-size: 10px;
      display: flex;
      gap: 6px;
      align-items: center;
    }
    .country app-icon {
      width: 12px;
      height: 12px;
    }
    .contacts {
      padding: 15px 0;
      margin-top: 15px;
      border-top: 1px solid var(--line);
      min-height: 82px;
    }
    .contact-row {
      display: flex;
      gap: 10px;
      align-items: center;
      margin-bottom: 9px;
    }
    .contact-row:last-child {
      margin: 0;
    }
    .contact-row strong {
      font-size: 11px;
      font-weight: 550;
    }
    .contact-row small {
      font-size: 9px;
      color: #99a3b3;
      font-weight: 400;
    }
    .contact-row p {
      font-size: 10px;
      margin: 3px 0 0;
      word-break: break-word;
    }
    .customer-bottom {
      display: flex;
      justify-content: space-between;
      align-items: center;
      padding-top: 12px;
      border-top: 1px solid var(--line);
      font-size: 10px;
      color: #7990b6;
    }
  `,
})
export class Customers {
  store = inject(DemoStore);
  forms = inject(BusinessForms);
  query = signal('');
  country = signal('');
  countries = computed(() => [...new Set(this.store.state().customers.map((c) => c.country))]);
  rows = computed(() =>
    this.store
      .state()
      .customers.filter(
        (c) =>
          (!this.country() || c.country === this.country()) &&
          `${c.name}${c.country}${c.contacts.map((x) => x.name).join('')}`
            .toLowerCase()
            .includes(this.query().toLowerCase()),
      ),
  );
  opportunities(id: string): number {
    return this.store.opportunities().filter((s) => s.customerId === id).length;
  }
}
