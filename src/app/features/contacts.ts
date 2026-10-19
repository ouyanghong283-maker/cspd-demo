import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { DemoStore } from '../core/store';
import { BusinessForms } from '../core/forms';
import { Icon } from '../shared/icon';

@Component({
  imports: [FormsModule, RouterLink, Icon],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="page-heading">
      <div>
        <h1>联系人管理</h1>
        <p>独立维护客户联系人，通过客户编号关联客户档案。</p>
      </div>
      <button class="btn primary" (click)="forms.addContact()">
        <app-icon name="plus" />新增联系人
      </button>
    </div>

    <div class="filter-bar">
      <label class="search-box">
        <app-icon name="search" />
        <input
          aria-label="搜索联系人"
          placeholder="搜索姓名、岗位、电话或邮箱"
          [(ngModel)]="query"
        />
      </label>
      <select aria-label="按客户筛选联系人" [(ngModel)]="customerId">
        <option value="">全部客户</option>
        @for (customer of store.state().customers; track customer.id) {
          <option [value]="customer.id">{{ customer.name }}</option>
        }
      </select>
      <span class="grow"></span>
      <span class="count-label">{{ rows().length }} 位联系人</span>
    </div>

    <div class="contact-list">
      @for (row of rows(); track row.contact.id) {
        <article class="panel contact-card">
          <span class="avatar">{{ row.contact.name.slice(0, 1) || '联' }}</span>
          <div class="person">
            <h2>{{ row.contact.name }}</h2>
            <p>
              {{ row.contact.position || '岗位待补' }} · {{ row.contact.department || '部门待补' }}
            </p>
            @if (row.contact.purchasingRole) {
              <span class="role">采购作用：{{ row.contact.purchasingRole }}</span>
            } @else {
              <span class="role muted">采购作用待确认</span>
            }
          </div>
          <div class="channels">
            <span>{{ row.contact.phone || '电话待补' }}</span>
            <span>{{ row.contact.email || '邮箱待补' }}</span>
          </div>
          <div class="company">
            <a [routerLink]="['/sales/customers', row.customer.id]">
              {{ row.customer.name }}
            </a>
            <small>{{ row.customer.country || '待补国家' }} · {{ row.customer.id }}</small>
          </div>
          <button
            class="icon-btn"
            [attr.aria-label]="'编辑' + row.contact.name"
            (click)="forms.addContact(row.customer, row.contact)"
          >
            <app-icon name="edit" />
          </button>
        </article>
      } @empty {
        <div class="empty-state">
          <strong>没有找到联系人</strong>
          <p>调整筛选条件，或新增一位联系人并选择所属客户。</p>
          <button class="btn primary" (click)="forms.addContact()">
            <app-icon name="plus" />新增联系人
          </button>
        </div>
      }
    </div>
  `,
  styles: `
    .contact-list {
      display: grid;
      gap: 10px;
    }
    .contact-card {
      display: grid;
      grid-template-columns: auto minmax(170px, 1.2fr) minmax(160px, 1fr) minmax(180px, 1fr) auto;
      gap: 16px;
      align-items: center;
      padding: 16px 18px;
    }
    .person h2 {
      margin: 0 0 5px;
      font-size: 14px;
    }
    .person p,
    .channels span,
    .company small {
      margin: 0;
      color: #77849a;
      font-size: 11px;
    }
    .role {
      display: inline-block;
      margin-top: 7px;
      color: #456fae;
      font-size: 10px;
    }
    .muted {
      color: #8994a5;
    }
    .channels,
    .company {
      display: grid;
      gap: 5px;
      min-width: 0;
      overflow-wrap: anywhere;
    }
    .company a {
      font-size: 12px;
      font-weight: 600;
    }
    .empty-state {
      padding: 48px 24px;
      text-align: center;
    }
    .empty-state strong {
      display: block;
      margin-bottom: 6px;
    }
    .empty-state p {
      color: #77849a;
      font-size: 12px;
    }
    @media (max-width: 760px) {
      .contact-card {
        grid-template-columns: auto 1fr auto;
        gap: 10px 12px;
      }
      .channels,
      .company {
        grid-column: 2 / 3;
      }
      .contact-card > button {
        grid-column: 3;
        grid-row: 1;
      }
    }
  `,
})
export class Contacts {
  store = inject(DemoStore);
  forms = inject(BusinessForms);
  route = inject(ActivatedRoute);
  query = signal('');
  customerId = signal(this.route.snapshot.queryParamMap.get('customer') || '');
  rows = computed(() => {
    const filter = this.customerId().trim();
    const query = this.query().trim().toLocaleLowerCase();
    return this.store.state().customers.flatMap((customer) =>
      customer.contacts
        .filter((contact) => !filter || customer.id === filter)
        .filter((contact) =>
          `${contact.name}${contact.position}${contact.department}${contact.phone}${contact.email}${contact.purchasingRole}`
            .toLocaleLowerCase()
            .includes(query),
        )
        .map((contact) => ({ customer, contact })),
    );
  });
}
