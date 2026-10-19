import { SolutionInputPanel } from './solution-input-panel';
import { ChangeDetectionStrategy, Component, computed, inject, input } from '@angular/core';
import { Router } from '@angular/router';
import { DemoStore } from '../core/store';
import { newId } from '../core/seed';
import { Documents } from '../shared/documents';
import { Field, FiveCanKey, SolutionDocumentKind } from '../core/models';
import { personField } from '../core/personnel';
@Component({
  selector: 'app-solution-service',
  imports: [Documents, SolutionInputPanel],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (section() === '方案') {
      <app-solution-input-panel [opportunityId]="opportunityId()" />
      <section class="panel padded space-top" aria-label="输入资料与核价五可">
        <h3>TIC 输入与补充资料</h3>
        <p>TIC是输入资料，沿用模拟附件记录；不替代四类输出，也不生成首次定稿。</p>
        <button
          class="btn"
          [disabled]="!store.editingWritable()"
          (click)="uploadSolutionDocument('TIC')"
        >
          补充TIC模拟记录
        </button>
        @for (v of store.solutionDocuments(opportunityId())?.versions || []; track v.id) {
          @if (v.kind === 'TIC') {
            <p>
              {{ documentName(v.documentId) }} · V{{ v.number }} · {{ v.owner }} · {{ v.createdAt }}
            </p>
          }
        }
        <details>
          <summary>旧资料确认记录与原业务入口</summary>
          <p>原模拟四类含TIC，确认仅为原核价与五可使用，不等于V9四输出定稿。</p>
          @if ((store.state().storageSchemaVersion ?? 0) < 3) {
            @for (kind of documentKinds; track kind) {
              <button class="btn" (click)="uploadSolutionDocument(kind)">
                补充旧{{ kind }}模拟记录
              </button>
            }
            <button class="btn" (click)="confirmCurrentSolution()">记录旧资料确认</button>
          }
          @for (c of store.solutionDocuments(opportunityId())?.confirmations || []; track c.id) {
            <p>{{ c.id }} · {{ c.owner }} · {{ c.createdAt }} · 修订{{ c.productNeedRevision }}</p>
          }
        </details>
        <hr />
        <h3>模拟核价</h3>
        <p>
          只读模拟系数由系统预置；成本、币种、单位、税费口径和来源必须明确，缺值不会作为零价处理。
        </p>
        <button class="btn" (click)="startCosting()">录入产品行模拟成本并核价</button>
        @for (
          costing of store.solutionDocuments(opportunityId())?.costings || [];
          track costing.id
        ) {
          <div class="record">
            <strong>{{ costing.id }} · 模拟核价 · {{ costing.createdAt }}</strong>
            <p>{{ costing.coefficientSource }}</p>
            @for (row of costing.rows; track row.productNeedId) {
              <p>
                {{ row.model }}{{ row.name ? '（' + row.name + '）' : '' }} {{ row.quantity }}
                {{ row.unit }} · 成本 {{ row.cost ?? '待核' }} {{ row.currency }} · 系数
                {{ row.coefficient }} · 指导价 {{ row.guidePrice ?? '待核' }} / {{ row.unit }} ·
                税费口径 {{ row.taxBasis }} ·
                {{ row.source }}
              </p>
            }
          </div>
        }
        <hr />
        <h3>五可模拟会签</h3>
        <button class="btn" (click)="startFiveCan()">记录五项结果、依据和条件</button>
        @for (
          review of store.solutionDocuments(opportunityId())?.fiveCanReviews || [];
          track review.id
        ) {
          <div class="record">
            <strong
              >{{ review.id }} · 模拟会签 · {{ review.createdAt }} · 依据
              {{ review.source }}</strong
            >
            @for (key of fiveCanKeys; track key) {
              <p>
                {{ key }}：{{ review.items[key].result }} · 负责人 {{ review.items[key].owner }} ·
                {{ review.items[key].opinion }}
              </p>
            }
            @for (condition of review.conditions; track condition.id) {
              <p>
                {{ condition.key }}条件：{{ condition.text }} · 责任 {{ condition.owner }} · 截止
                {{ condition.due }} ·
                {{
                  condition.closed
                    ? '已关闭：' + condition.evidence
                    : condition.due < '2026-10-10'
                      ? '逾期未关闭（继续阻断适用业务检查）'
                      : '未关闭（继续阻断适用业务检查）'
                }}
                @if (!condition.closed) {
                  <button class="btn small" (click)="closeCondition(review.id, condition.id)">
                    录入关闭依据
                  </button>
                }
              </p>
            }
          </div>
        }
      </section>
    } @else {
      @let t = store.terms(opportunityId()); @let a = store.agreement(opportunityId());
      <section class="panel padded" id="v4-service">
        <div class="section-heading">
          <h2>质保与SLA · 修订{{ t.revision }}</h2>
          <button class="btn" [disabled]="!store.salesEditable()" (click)="editTerms()">
            填写／修改服务条件
          </button>
        </div>
        <p>
          {{ t.kind }} · 质保{{ t.years || '待填' }}年 · 范围 {{ t.scope || '待填' }} · SLA
          {{ t.sla || '待填' }}
        </p>
        <p>特殊说明：{{ t.special || '无' }} · 普通备注：{{ t.note || '无' }}</p>
        <p>
          销售确认：{{
            t.salesConfirmation?.revision === t.revision ? t.salesConfirmation.person : '待重新确认'
          }}
          · 业务负责人 {{ store.sale(opportunityId())?.owner }}
        </p>
        <button
          class="btn primary"
          [disabled]="!store.salesEditable()"
          (click)="store.confirmServiceTerms(opportunityId(), t.revision)"
        >
          {{ t.kind === '特殊' ? '销售确认并提交运维' : '销售确认常规条件' }}
        </button>
        @if (t.kind === '特殊') {
          <button
            class="btn"
            [disabled]="t.submittedRevision !== t.revision || reviewed()"
            (click)="review()"
          >
            运维复核当前修订
          </button>
        }
        @for (r of t.reviews; track $index) {
          <p>
            修订{{ r.revision }} · {{ r.result }} · {{ r.opinion }} · {{ r.person }} ·
            {{ r.createdAt }} {{ r.revision === t.revision ? '（当前修订）' : '（历史意见）' }}
          </p>
        }
      </section>
      <section class="panel padded space-top" id="v4-agreement">
        <div class="section-heading">
          <h2>服务协议 · 修订{{ a.revision }} · {{ a.applicability }}</h2>
          <button class="btn" [disabled]="!store.salesEditable()" (click)="editAgreement()">
            填写／修改协议
          </button>
        </div>
        <p>不购买原因 {{ a.reason || '—' }} · 核心条款 {{ a.summary || '—' }}</p>
        <p>
          模拟文件 {{ documentName(a.documentId) }} ·
          {{ a.confirmation?.revision === a.revision ? '当前条款已确认' : '待确认' }}
        </p>
        <button
          class="btn primary"
          [disabled]="!store.salesEditable()"
          (click)="store.confirmAgreement(opportunityId(), a.revision)"
        >
          {{ a.applicability === '不购买' ? '销售确认不购买' : '确认条款已敲定' }}
        </button>
        <p class="fine-print">条款已敲定不代表真实签署。不购买服务协议仍须确认产品质保。</p>
        <app-documents [entityId]="opportunityId()" [kinds]="['服务协议']" title="协议模拟资料" />
      </section>
    }
  `,
  styles: `
    .record {
      padding: 16px 0;
      border-top: 1px solid var(--line);
      overflow-wrap: anywhere;
    }
    .record p {
      margin: 8px 0;
    }
    .section-heading {
      display: flex;
      justify-content: space-between;
      gap: 12px;
      flex-wrap: wrap;
    }
    p {
      line-height: 1.8;
      overflow-wrap: anywhere;
    }
    button {
      margin: 4px 4px 4px 0;
    }
    .next-step {
      border-top: 1px solid var(--line);
      margin-top: 16px;
      padding-top: 12px;
    }
  `,
})
export class SolutionService {
  store = inject(DemoStore);
  private router = inject(Router);
  opportunityId = input.required<string>();
  documentKinds: SolutionDocumentKind[] = ['技术方案', 'TIC', '设计BOM', 'SLD'];
  fiveCanKeys: FiveCanKey[] = ['可承诺', '可交付', '可运维', '可验收', '可续约'];
  section = input('方案');
  nextStep = computed(() => this.store.solutionNextStep(this.opportunityId()));
  canContinue = computed(() => {
    const sale = this.store.sale(this.opportunityId());
    return sale?.type === 'opportunity' && !['赢单', '丢单'].includes(sale.stage);
  });
  continueAfterSolution(): void {
    if (!this.canContinue() || !this.store.solution(this.opportunityId())?.latestVersionId) return;
    const next = this.nextStep();
    this.store.setRole(next.role);
    if (this.store.role() !== next.role) return;
    if (next.tab === '报价') this.router.navigate(['/sales/quotes', this.opportunityId()]);
    else
      this.router.navigate(['/sales/detail', this.opportunityId()], {
        queryParams: { tab: next.tab },
      });
  }
  documentName(id: string) {
    return this.store.state().attachments.find((x) => x.id === id)?.name || '待补';
  }
  versionName(id: string) {
    const v = this.store.solution(this.opportunityId())?.versions.find((x) => x.id === id);
    return v ? `V${v.number}` : '未指定';
  }
  view(id: string) {
    const a = this.store.state().attachments.find((x) => x.id === id);
    if (a) void this.store.openFile(a);
  }
  uploadSolutionDocument(kind: SolutionDocumentKind): void {
    const owner =
      this.store.solutionDocuments(this.opportunityId())?.owner ||
      this.store.sale(this.opportunityId())?.owner ||
      '';
    this.store.ui.open({
      title: `新增${kind}模拟资料`,
      description: '只记录元数据，不读取或上传文件内容。负责人变化会留痕。',
      fields: [
        { key: 'name', label: '模拟文件名', required: true },
        personField('owner', '当前方案负责人', owner, true),
        { key: 'note', label: '版本说明', type: 'textarea' },
      ],
      sample: { name: `${kind}_V1.pdf`, note: '用于方案演示的模拟资料记录' },
      onSave: (d) =>
        this.store.addSolutionDocument(
          this.opportunityId(),
          kind,
          d['name'],
          d['owner'],
          d['note'],
        ),
    });
  }
  confirmCurrentSolution(): void {
    const owner =
      this.store.solutionDocuments(this.opportunityId())?.owner ||
      this.store.sale(this.opportunityId())?.owner ||
      '';
    this.store.ui.open({
      title: '确认当前方案资料',
      description: '将记录四类资料版本ID、商机产品配置修订、负责人和确认时间。',
      fields: [personField('owner', '方案负责人', owner, true)],
      onSave: (d) => this.store.confirmSolutionDocuments(this.opportunityId(), d['owner']),
    });
  }
  startCosting(): void {
    const needs = this.store.sale(this.opportunityId())?.productNeeds || [];
    if (!needs.length) return void this.store.ui.fail('请先在商机维护产品行和单位');
    const fields: Field[] = needs.map((need) => ({
      key: `cost-${need.id}`,
      label: `${need.model}${need.name ? ' · ' + need.name : ''} · 预计成本 / ${need.unit}`,
      type: 'number',
      min: 0,
      required: true,
    }));
    fields.push({
      key: 'currency',
      label: '币种',
      type: 'select',
      options: ['EUR', 'USD', 'CNY'],
      required: true,
    });
    fields.push({
      key: 'taxBasis',
      label: '税费口径',
      type: 'select',
      options: ['不含税报价', '含税样例'],
      required: true,
    });
    fields.push({ key: 'source', label: '成本来源说明', type: 'textarea', required: true });
    const sample: Record<string, string | number> = {
      currency: 'EUR',
      taxBasis: '不含税报价',
      source: 'DEMO模拟成本，仅用于演示价格比较',
    };
    for (const need of needs) sample[`cost-${need.id}`] = 10000;
    this.store.ui.open({
      title: '录入模拟核价',
      description: '示例系数1.20只读预置；所有产品行都需有明确成本、币种及税费口径。',
      fields,
      sample,
      onSave: (d) => {
        const costs = Object.fromEntries(
          needs.map((need) => [need.id, Number(d[`cost-${need.id}`])]),
        );
        return this.store.recordSolutionCosting(
          this.opportunityId(),
          costs,
          d['currency'],
          d['taxBasis'],
          d['source'],
        );
      },
    });
  }
  startFiveCan(): void {
    const fields: Field[] = this.fiveCanKeys.flatMap((key) => [
      {
        key: `${key}-result`,
        label: `${key}结果`,
        type: 'select' as const,
        options: ['满足', '附条件', '不满足', '待评估'],
        required: true,
      },
      personField(`${key}-owner`, `${key}责任人`, '', true),
      {
        key: `${key}-opinion`,
        label: `${key}意见 / 依据`,
        type: 'textarea' as const,
        required: true,
      },
    ]);
    fields.push({ key: 'source', label: '会签依据资料', required: true });
    for (const key of this.fiveCanKeys) {
      fields.push({
        key: `${key}-condition`,
        label: `${key}附加条件（结果为附条件时必填）`,
        type: 'textarea',
        required: false,
      });
      fields.push(personField(`${key}-conditionOwner`, `${key}条件责任人`));
      fields.push({
        key: `${key}-conditionDue`,
        label: `${key}条件截止日`,
        type: 'date',
        required: false,
      });
    }
    const sample: Record<string, string> = { source: '当前四类方案资料及模拟配置' };
    for (const key of this.fiveCanKeys) {
      sample[`${key}-result`] = '满足';
      sample[`${key}-owner`] = this.store.person();
      sample[`${key}-opinion`] = '模拟评估，需按项目实际复核';
    }
    this.store.ui.open({
      title: '五可模拟会签',
      description: '每项单独记录结果、责任人、意见及对应条件；不会自动标记为正式G3通过。',
      fields,
      sample,
      onSave: (d) => {
        const items = Object.fromEntries(
          this.fiveCanKeys.map((key) => [
            key,
            {
              result: d[`${key}-result`] as '满足' | '附条件' | '不满足' | '待评估',
              owner: d[`${key}-owner`],
              opinion: d[`${key}-opinion`],
            },
          ]),
        ) as Record<
          FiveCanKey,
          { result: '满足' | '附条件' | '不满足' | '待评估'; owner: string; opinion: string }
        >;
        const conditions = this.fiveCanKeys.flatMap((key) =>
          d[`${key}-condition`]
            ? [
                {
                  key,
                  text: d[`${key}-condition`],
                  owner: d[`${key}-conditionOwner`],
                  due: d[`${key}-conditionDue`],
                },
              ]
            : [],
        );
        return this.store.recordFiveCan(this.opportunityId(), d['source'], items, conditions);
      },
    });
  }
  closeCondition(reviewId: string, conditionId: string): void {
    this.store.ui.open({
      title: '记录条件关闭依据',
      fields: [{ key: 'evidence', label: '线下关闭依据', type: 'textarea', required: true }],
      sample: { evidence: '已完成事项并由责任人复核' },
      onSave: (d) =>
        this.store.closeFiveCanCondition(
          this.opportunityId(),
          reviewId,
          conditionId,
          d['evidence'],
        ),
    });
  }
  reviewed() {
    const t = this.store.terms(this.opportunityId());
    return t.reviews.some((x) => x.revision === t.revision);
  }
  upload() {
    const op = newId('OP');
    const latest = this.store.solution(this.opportunityId())?.latestVersionId || '';
    this.store.ui.open({
      title: '模拟上传核心技术方案',
      description: '仅模拟文件记录，不保存原文件。',
      fields: [
        { key: 'name', label: '示例文件名', value: '技术方案.pdf', required: true },
        personField('owner', '业务责任人', '周方案', true),
        { key: 'note', label: '版本说明', type: 'textarea' },
      ],
      onSave: (d) =>
        this.store.uploadSolution(
          this.opportunityId(),
          d['name'],
          d['owner'],
          d['note'],
          op,
          latest,
        ),
    });
  }
  editTerms() {
    const t = structuredClone(this.store.terms(this.opportunityId()));
    this.store.ui.open({
      title: '质保与服务条件',
      fields: [
        {
          key: 'kind',
          label: '服务类型',
          type: 'select',
          options: ['常规', '特殊'],
          value: t.kind,
        },
        { key: 'years', label: '质保年限', type: 'number', min: 0, value: t.years, required: true },
        { key: 'scope', label: '质保范围', type: 'textarea', value: t.scope },
        { key: 'sla', label: 'SLA响应摘要', type: 'textarea', value: t.sla },
        { key: 'special', label: '特殊需求说明', type: 'textarea', value: t.special },
        { key: 'note', label: '普通备注（不触发重审）', type: 'textarea', value: t.note },
      ],
      sample: { years: 2, scope: '约定设备及产品质量', sla: '演示：工作日24小时内响应' },
      onSave: (d) =>
        this.store.saveServiceTerms(
          {
            ...t,
            kind: d['kind'] as '常规' | '特殊',
            years: Number(d['years']),
            scope: d['scope'],
            sla: d['sla'],
            special: d['special'],
            note: d['note'],
          },
          t.revision,
        ),
    });
  }
  review() {
    const t = this.store.terms(this.opportunityId());
    this.store.ui.open({
      title: `运维复核服务修订${t.revision}`,
      fields: [
        {
          key: 'result',
          label: '复核结果',
          type: 'select',
          options: ['可接受', '需调整'],
          value: '可接受',
          required: true,
        },
        { key: 'opinion', label: '复核意见', type: 'textarea', required: true },
      ],
      onSave: (d) =>
        this.store.reviewServiceTerms(
          this.opportunityId(),
          t.revision,
          d['result'] as '可接受' | '需调整',
          d['opinion'],
        ),
    });
  }
  editAgreement() {
    const a = structuredClone(this.store.agreement(this.opportunityId()));
    const files = this.store
      .attachments(this.opportunityId(), '服务协议')
      .filter((x) => x.mode === 'simulated');
    this.store.ui.open({
      title: '服务协议适用性与条款',
      description: '适用时先在下方模拟上传协议，再选择该记录。',
      fields: [
        {
          key: 'applicability',
          label: '适用性',
          type: 'select',
          options: ['待确认', '适用', '不购买'],
          value: a.applicability,
        },
        { key: 'reason', label: '不购买原因', type: 'textarea', value: a.reason },
        { key: 'summary', label: '服务范围／核心条款摘要', type: 'textarea', value: a.summary },
        {
          key: 'document',
          label: '模拟协议记录',
          type: 'select',
          options: ['未选择', ...files.map((x) => `${x.id} · ${x.name}`)],
          value: files.find((x) => x.id === a.documentId)
            ? `${a.documentId} · ${this.documentName(a.documentId)}`
            : '未选择',
        },
      ],
      onSave: (d) =>
        this.store.saveAgreement(
          {
            ...a,
            applicability: d['applicability'] as typeof a.applicability,
            reason: d['reason'],
            summary: d['summary'],
            documentId: d['document'] === '未选择' ? '' : d['document'].split(' · ')[0],
          },
          a.revision,
        ),
    });
  }
}
