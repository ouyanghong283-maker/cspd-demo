import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { toSignal } from '@angular/core/rxjs-interop';
import { DemoStore } from '../core/store';
import { BusinessForms } from '../core/forms';
import { Icon } from '../shared/icon';
import { Badge } from '../shared/badge';
import { CUSTOMER_COUNTRIES } from '../core/customer-dictionaries';
@Component({
  imports: [FormsModule, RouterLink, Icon, Badge],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: ` <div class="page-heading">
      <div>
        <h1>客户管理</h1>
        <p>维护 CRM 客户档案；联系人在独立板块管理，并通过客户编号关联。</p>
      </div>
      <button class="btn primary" (click)="forms.customer()">
        <app-icon name="plus" />新建客户
      </button>
    </div>
    <div class="filter-bar">
      <label class="search-box"
        ><app-icon name="search" /><input
          aria-label="搜索客户"
          placeholder="搜索客户名称、国家或编号"
          [(ngModel)]="query" /></label
      ><select aria-label="国家筛选" [(ngModel)]="country">
        <option value="">全部国家</option>
        @for (c of countries(); track c) {
          <option>{{ c }}</option>
        }</select
      ><span class="grow"></span
      ><span class="count-label">{{ rows().length }}个客户 · 共用主数据</span>
    </div>
    @if (returnLead(); as lead) {
      <div class="inline-alert">
        <span>正在查看线索 {{ lead.id }} 关联的客户、联系人和跟进记录。</span>
        <a class="text-link" [routerLink]="['/sales/detail', lead.id]">返回来源线索</a>
      </div>
    }
    <div class="grid-3">
      @for (c of rows(); track c.id) {
        <section class="panel customer-card">
          <div class="customer-top">
            <span class="customer-symbol"><app-icon name="building" /></span>
            <div class="badges">
              <app-badge [text]="c.status || '潜在客户'" /><app-badge [text]="c.industry" />
            </div>
          </div>
          <h2>
            <a [routerLink]="['/sales/customers', c.id]">{{ c.name }}</a>
          </h2>
          @if (c.email) {
            <p class="customer-email">{{ c.email }}</p>
          }
          <p class="country"><app-icon name="globe" />{{ c.country || '待补国家' }} · {{ c.id }}</p>
          @if (!validCountry(c.country)) {
            <div class="inline-alert warning">
              当前国家是旧值，转商机前请编辑客户并从国家下拉选项中选择。
            </div>
          }
          @if (possibleDuplicates(c.id).length) {
            <div class="inline-alert warning">
              <span>发现同名或名称相近客户，仅供人工核对；系统不会自动匹配或合并：</span>
              <ul>
                @for (candidate of possibleDuplicates(c.id); track candidate) {
                  <li>{{ duplicateLabel(candidate) }}</li>
                }
              </ul>
            </div>
          }
          <div class="customer-facts">
            <span
              >地区 <strong>{{ c.region || '待补' }}</strong></span
            >
            <span
              >人员规模 <strong>{{ c.employeeSize || '待补' }}</strong></span
            >
            <span
              >行业角色 <strong>{{ c.industry || '待补' }}</strong></span
            >
            <span
              >状态 <strong>{{ c.status || '潜在客户' }}</strong></span
            >
            <span
              >销售负责人 <strong>{{ c.owner || '待分配' }}</strong></span
            >
            <span
              >联系人 <strong>{{ c.contacts.length }}</strong></span
            >
            <span
              >创建时间 <strong>{{ c.createdAt || '历史记录' }}</strong></span
            >
            <span
              >创建人 <strong>{{ c.createdBy || '历史记录' }}</strong></span
            >
            <span
              >跟进记录 <strong>{{ followUpCount(c.id) }}</strong></span
            >
            <span
              >最近跟进 <strong>{{ latestFollowUp(c.id) || '暂无记录' }}</strong></span
            >
          </div>
          <div class="customer-bottom">
            <span>
              <a [routerLink]="['/sales/contacts']" [queryParams]="{ customer: c.id }"
                >{{ c.contacts.length }}位联系人</a
              >
              ·
              <a routerLink="/sales/leads" [queryParams]="{ customer: c.id }"
                >{{ leads(c.id) }}条关联线索</a
              >
              ·
              <a routerLink="/sales/opportunities" [queryParams]="{ customer: c.id }"
                >{{ opportunities(c.id) }}个关联商机</a
              >
            </span>
            <div>
              <button
                class="icon-btn"
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
    .badges {
      display: flex;
      gap: 6px;
      align-items: center;
    }
    .customer-email {
      margin: -5px 0 8px;
      color: #66758c;
      font-size: 10px;
      overflow-wrap: anywhere;
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
    .customer-facts {
      display: grid;
      grid-template-columns: repeat(2, minmax(0, 1fr));
      gap: 9px 16px;
      padding: 15px 0;
      margin-top: 15px;
      border-top: 1px solid var(--line);
      min-height: 82px;
      color: #77849a;
      font-size: 10px;
    }
    .customer-facts strong {
      display: block;
      margin-top: 3px;
      color: #27364e;
      font-weight: 550;
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
  route = inject(ActivatedRoute);
  params = toSignal(this.route.queryParamMap, { initialValue: this.route.snapshot.queryParamMap });
  query = signal('');
  country = signal('');
  selectedCustomer = computed(() => this.params().get('customer') || '');
  returnLead = computed(() => {
    const id = this.params().get('fromLead') || '';
    const lead = this.store.sale(id);
    return lead?.type === 'lead' && lead.customerId === this.selectedCustomer() ? lead : undefined;
  });
  countries = computed(() => [
    ...new Set(
      this.store
        .state()
        .customers.map((c) => c.country)
        .filter(Boolean),
    ),
  ]);
  rows = computed(() =>
    this.store
      .state()
      .customers.filter(
        (c) =>
          (!this.selectedCustomer() || c.id === this.selectedCustomer()) &&
          (!this.country() || c.country === this.country()) &&
          `${c.id}${c.name}${c.country}${c.email || ''}${c.owner || ''}${c.contacts.map((x) => x.name).join('')}`
            .toLowerCase()
            .includes(this.query().toLowerCase()),
      ),
  );
  opportunities(id: string): number {
    return this.store.opportunities().filter((s) => s.customerId === id).length;
  }
  validCountry(country: string): boolean {
    return CUSTOMER_COUNTRIES.includes(country as (typeof CUSTOMER_COUNTRIES)[number]);
  }
  leads(id: string): number {
    return this.store.leadsForCustomer(id).length;
  }
  followUpCount(id: string): number {
    return this.relatedSales(id).reduce(
      (count, sale) =>
        count + this.store.activities(sale.id).filter((item) => item.type !== '内部备注').length,
      0,
    );
  }
  latestFollowUp(id: string): string {
    return (
      this.relatedSales(id)
        .flatMap((sale) => this.store.activities(sale.id))
        .filter((item) => item.type !== '内部备注')
        .sort((a, b) => b.date.localeCompare(a.date))[0]?.date || ''
    );
  }
  private relatedSales(id: string) {
    return this.store.state().sales.filter((sale) => sale.customerId === id);
  }
  possibleDuplicates(id: string): string[] {
    const customer = this.store.customer(id);
    if (!customer) return [];
    const key = this.normalizedName(customer.name);
    return this.store
      .state()
      .customers.filter((candidate) => {
        if (candidate.id === id) return false;
        const candidateKey = this.normalizedName(candidate.name);
        return (
          candidateKey === key ||
          (Math.min(candidateKey.length, key.length) >= 3 &&
            (candidateKey.includes(key) || key.includes(candidateKey)))
        );
      })
      .map((candidate) => candidate.id);
  }
  duplicateLabel(id: string): string {
    const customer = this.store.customer(id);
    return customer ? `${customer.name} · ${customer.country} · ${customer.id}` : id;
  }
  private normalizedName(name: string): string {
    return name
      .trim()
      .toLocaleLowerCase()
      .replace(/[\s\p{P}\p{S}]/gu, '');
  }
}
