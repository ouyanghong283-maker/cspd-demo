import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  inject,
  input,
  signal,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { Contract } from '../core/models';
import { QuoteReferenceLookup } from '../core/quote-reference';
import { DemoStore } from '../core/store';

@Component({
  selector: 'app-contract-quote-reference',
  imports: [FormsModule, RouterLink],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="quote-reference" aria-label="合同报价来源">
      <div class="head">
        <div>
          <h3>报价版本来源</h3>
          <p>
            按报价号查询候选后显式选择版本；自由文本不产生引用，换选只补空白字段，不更改合同客户与商机。
          </p>
        </div>
      </div>
      <div aria-label="当前报价来源">
        <p>
          当前引用：<strong>{{ view().displayNumber }}</strong> · {{ view().lockedLabel }} · 保存人
          {{ view().savedBy || '未记录' }} · {{ view().savedAt || '未记录时间' }}
        </p>
        <p class="muted" aria-label="报价来源说明">{{ view().message }}</p>
        @if (view().source; as source) {
          <p>稳定ID：报价系列 {{ source.seriesId }} · 版本 {{ source.versionId }}</p>
          <p>
            客户 {{ source.customerName }}（{{ source.customerId }}）· 商机
            {{ source.opportunityName }}（{{ source.opportunityId }}）· 版本
            {{ source.versionLabel }} · 金额
            {{ amountText(source.amount, source.currency) }}
            ·
            {{ source.locked ? '最终锁定' : source.versionStatus }}
          </p>
          <a
            class="text-link"
            aria-label="打开报价来源"
            [routerLink]="['/sales/quotes', source.opportunityId]"
            [queryParams]="{ series: source.seriesId || null, version: source.versionId }"
            >打开报价来源工作区</a
          >
        }
      </div>
      @if (contract().adoptedQuoteSnapshot; as adopted) {
        <section aria-label="签约采用报价摘要">
          <h3>签约采用依据</h3>
          <p>{{ adopted.seriesNumber }} V{{ adopted.versionNumber }} · 签约时最终锁定</p>
          <p>稳定ID：{{ adopted.quoteSeriesId }} / {{ adopted.quoteVersionId }}</p>
          <p>客户 {{ adopted.customerId }} · 商机 {{ adopted.opportunityId }}</p>
          <p>采用人 {{ adopted.adoptedBy }} · {{ adopted.adoptedAt }}</p>
          <p>锁定人 {{ adopted.lockedBy || '未记录' }} · {{ adopted.lockedAt || '未记录' }}</p>
          <dl>
            <dt>来源报价金额</dt>
            <dd>{{ amountText(adopted.commercial.total, adopted.commercial.currency) }}</dd>
            <dt>来源商务条件</dt>
            <dd>
              {{ adopted.commercial.payment || '未记录' }} · {{ adopted.commercial.tradeTerm }}
              {{ adopted.commercial.tradeNote }}
            </dd>
            <dt>来源交期</dt>
            <dd>{{ adopted.commercial.delivery || '未记录' }}</dd>
            <dt>来源服务</dt>
            <dd>
              {{ adopted.service.warranty || '未记录' }} ·
              {{ adopted.service.service || '未记录' }} · {{ adopted.service.scope || '未记录' }}
            </dd>
            <dt>实际采用合同条款</dt>
            <dd>
              {{ amountText(adopted.adoptedTerms.amount, adopted.adoptedTerms.currency) }} ·
              {{ adopted.adoptedTerms.payment }} · {{ adopted.adoptedTerms.product }} ·
              {{ adopted.adoptedTerms.service || '未记录' }}
            </dd>
          </dl>
          <table aria-label="签约采用产品摘要">
            <thead>
              <tr>
                <th>产品</th>
                <th>型号</th>
                <th>数量</th>
                <th>单价</th>
              </tr>
            </thead>
            <tbody>
              @for (item of adopted.products; track item.id) {
                <tr>
                  <td>{{ item.name }}</td>
                  <td>{{ item.spec }}</td>
                  <td>{{ item.quantity }} {{ item.unit }}</td>
                  <td>{{ amountText(item.unitPrice, adopted.commercial.currency) }}</td>
                </tr>
              }
            </tbody>
          </table>
          <p class="muted">
            以上为签约时保存的依据，后续报价版本不改写本摘要；合同人工约定值单独保留。
          </p>
        </section>
      } @else if (contract().status !== '草稿') {
        <p aria-label="旧合同签约依据待核">
          旧合同未保存签约采用摘要，依据待核；不从当前报价补造签约历史。
        </p>
      }
      @if (contract().status === '草稿') {
        <div class="picker">
          <label
            >报价号<input
              aria-label="报价号"
              placeholder="例如 DEMO-Q-006"
              [(ngModel)]="quoteNumber"
              (ngModelChange)="result.set(null)"
          /></label>
          <button class="btn" [disabled]="!quoteNumber().trim()" (click)="lookup()">
            查询报价候选
          </button>
        </div>
        @if (result(); as lookup) {
          <p aria-label="候选说明">{{ lookup.message }}</p>
          <div class="table-wrap">
            <table aria-label="报价候选">
              <thead>
                <tr>
                  <th>报价号 / 版本</th>
                  <th>版本状态 / 锁定</th>
                  <th>客户</th>
                  <th>商机</th>
                  <th>金额 / 币种</th>
                  <th>说明</th>
                  <th>操作</th>
                </tr>
              </thead>
              <tbody>
                @for (candidate of lookup.candidates; track candidate.versionId) {
                  <tr>
                    <td>
                      {{ candidate.seriesNumber }} {{ candidate.versionLabel }}
                      <p class="muted">稳定ID {{ candidate.versionId }}</p>
                    </td>
                    <td>
                      {{ candidate.versionStatus }}
                      <p class="muted">
                        {{ candidate.finalLocked ? '最终锁定版本' : '非最终锁定' }} ·
                        {{ candidate.lockedBy || '锁定人未记录' }} {{ candidate.lockedAt || '' }}
                      </p>
                    </td>
                    <td>
                      {{ candidate.customerName }}
                      <p class="muted">{{ candidate.customerId }}</p>
                    </td>
                    <td>
                      {{ candidate.opportunityName }}
                      <p class="muted">{{ candidate.opportunityId }}</p>
                    </td>
                    <td>
                      {{ amountText(candidate.amount, candidate.currency) }}
                      <p class="muted">{{ candidate.currency }}</p>
                    </td>
                    <td class="muted">{{ candidate.message }}</td>
                    <td>
                      <button
                        class="btn"
                        [attr.aria-label]="
                          '选择报价版本 ' + candidate.seriesNumber + ' ' + candidate.versionLabel
                        "
                        [disabled]="!candidate.selectable"
                        (click)="select(candidate.seriesId, candidate.versionId)"
                      >
                        {{ candidate.selectable ? '选择该版本' : '不可选择' }}
                      </button>
                    </td>
                  </tr>
                } @empty {
                  <tr>
                    <td colspan="7" class="muted">没有候选；不按相似报价号或最新版本推断来源。</td>
                  </tr>
                }
              </tbody>
            </table>
          </div>
        }
      }
      @if (view().differences.length) {
        <h4>合同值与报价来源差异</h4>
        <div class="table-wrap">
          <table aria-label="报价来源差异">
            <thead>
              <tr>
                <th>字段</th>
                <th>合同当前值</th>
                <th>报价来源值</th>
                <th>状态</th>
              </tr>
            </thead>
            <tbody>
              @for (item of view().differences; track item.field) {
                <tr>
                  <td>{{ item.label }}</td>
                  <td>{{ item.contractValue }}</td>
                  <td>{{ item.sourceValue }}</td>
                  <td>{{ item.status }}</td>
                </tr>
              }
            </tbody>
          </table>
        </div>
        <p class="muted">
          换选只写入空白字段；标为“人工值保留”的字段保持合同现有值，需人工确认后再维护。
        </p>
      }
    </section>
  `,
  styles: [
    `
      :host {
        display: block;
        margin: 20px 0;
      }
      .quote-reference {
        border: 1px solid var(--line);
        padding: 20px;
        border-radius: 8px;
      }
      .head p,
      .muted,
      small {
        color: var(--muted);
        font-size: 12px;
        line-height: 1.7;
      }
      .picker {
        display: flex;
        gap: 8px;
        align-items: flex-end;
        margin-top: 16px;
      }
      .picker label {
        display: flex;
        flex-direction: column;
        gap: 6px;
        font-size: 13px;
        font-weight: 600;
      }
      input {
        padding: 9px;
        border: 1px solid var(--line);
        border-radius: 4px;
        background: var(--surface, #fff);
        color: var(--ink);
      }
      .table-wrap {
        overflow-x: auto;
      }
      table {
        width: 100%;
        border-collapse: collapse;
      }
      th,
      td {
        border-bottom: 1px solid var(--line);
        padding: 8px;
        text-align: left;
        vertical-align: top;
        font-size: 13px;
      }
      h4 {
        margin: 24px 0 12px;
      }
    `,
  ],
})
export class ContractQuoteReference {
  readonly store = inject(DemoStore);
  readonly contract = input.required<Contract>();
  readonly quoteNumber = signal('');
  readonly result = signal<QuoteReferenceLookup | null>(null);
  readonly view = computed(() => this.store.contractQuoteReference(this.contract().id));
  constructor() {
    effect(() => {
      this.contract().id;
      this.result.set(null);
      this.quoteNumber.set('');
    });
  }
  amountText(amount: number | null, currency: string): string {
    return amount === null ? '报价合计未明确' : this.store.money(amount, currency);
  }
  lookup(): void {
    this.result.set(this.store.quoteReferenceCandidates(this.contract().id, this.quoteNumber()));
  }
  select(seriesId: string, versionId: string): void {
    if (this.store.saveContractQuoteReference(this.contract().id, { seriesId, versionId }))
      this.result.set(this.store.quoteReferenceCandidates(this.contract().id, this.quoteNumber()));
  }
}
