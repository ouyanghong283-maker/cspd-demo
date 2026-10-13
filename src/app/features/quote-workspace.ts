import { ChangeDetectionStrategy, Component, computed, inject, input, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { DemoStore } from '../core/store';
import { QuoteFeedback, QuoteItem, QuoteVersion } from '../core/models';
import { newId } from '../core/seed';
import { Icon } from '../shared/icon';
import { Badge } from '../shared/badge';
import { Documents } from '../shared/documents';

@Component({
  selector: 'app-quote-workspace',
  imports: [FormsModule, Icon, Badge, Documents],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (store.role() === 'outsider') {
      <div class="panel padded"><p>当前演示角色无权查看报价及内部成本信息。</p></div>
    } @else if (sale(); as opportunity) {
      <div class="page-heading">
        <div><h2>报价工作区</h2><p>预计商机金额 {{ store.money(opportunity.amount, opportunity.currency) }} 与报价金额分开记录。</p></div>
        @if (!series()) { <button class="btn primary" [disabled]="!canSell()" (click)="create()">创建报价草稿</button> }
      </div>
      @if (opportunity.quoteFlowMode !== 'v2') {
        <div class="inline-alert"><app-icon name="info"/><span>该对象是旧演示样例。创建报价将为此商机启用V2报价门槛；之前的阶段和合同数据保留。</span></div>
      }
      @if (series(); as s) {
        <div class="quote-layout">
          <section class="panel quote-main">
            <div class="panel-head"><div><h3>{{ s.number }} · {{ current()?.title }}</h3><p>客户：{{ store.customer(current()?.customerId || '')?.name }} · {{ store.contact(opportunity)?.name || '待补联系人' }} · 负责人：{{ current()?.owner }}</p></div><app-badge [text]="current()?.status || '无版本'"/></div>
            <div class="quote-version-tabs">@for (v of s.versions; track v.id) { <button [class.active]="selectedId() === v.id" (click)="selectedId.set(v.id)">V{{ v.number }} <app-badge [text]="v.status"/></button> }</div>
            @if (current(); as v) {
              <div class="quote-actions">
                @if (editable(v)) {
                  <button class="btn" (click)="editHeader(v)">编辑报价条件</button>
                  <button class="btn" (click)="taxCase(v,'本地交易案例')">本地税费案例</button><button class="btn" (click)="taxCase(v,'跨境交易案例')">跨境税费案例</button>
                  <button class="btn" (click)="addItem(v)">新增报价明细</button>
                  <button class="btn" (click)="editCosts(v)">成本参考</button>
                  <button class="btn" (click)="linkSource(v)">引用需求 / 方案资料</button>
                  <button class="btn" (click)="store.saveQuote(v)">保存草稿并同步资料</button><button class="btn primary" (click)="store.submitQuote(v.id)">提交模拟审核</button>
                }
                @if (['pm','solution'].includes(store.role()) && ['草稿','退回补充'].includes(v.status)) { <button class="btn" (click)="editCosts(v)">更新成本参考</button> }
                @if (store.role() === 'solution' && ['草稿','退回补充'].includes(v.status)) { <button class="btn" (click)="editSolution(v)">维护方案摘要</button> }
                @if (v.status === '待模拟审核' && store.role() === 'manager') { <button class="btn primary" (click)="review(v)">应用模拟审核</button> }
                @if (v.status === '模拟审核通过' && canSell()) { <button class="btn primary" (click)="recordSent(v)">记录报价已发出</button> }
                @if (v.status === '已记录发出' && canSell()) { <button class="btn" (click)="addFeedback(v)">记录客户反馈</button><button class="btn" (click)="newVersion(v)">基于此版本创建新版</button>@if (v.acceptedBy && !v.lockRequestedBy) { <button class="btn primary" (click)="requestLock(v)">申请最终锁定</button> } }
                @if (v.status === '已记录发出' && v.lockRequestedBy && store.role() === 'manager') { <button class="btn primary" (click)="lock(v)">主管审核并锁定</button> }
                @if (v.lockRequestedBy && v.status === '已记录发出') { <p class="inline-alert">锁定申请：{{ v.lockRequestedBy }} · {{ v.lockRequestedDate }}@if (store.role() !== 'manager') { · 等待主管处理 }</p> }
                @if (v.status === '最终锁定' && store.role() === 'manager' && !v.invalidationReason) { <button class="btn" (click)="reopen(v)">批准重新报价</button> }
                @if (['草稿','退回补充'].includes(v.status) && store.role() === 'finance') { <button class="btn" (click)="confirmTax(v, '样例已确认')">确认税费样例</button><button class="btn" (click)="confirmTax(v, '待财务确认')">记录待确认</button> }
                @if (v.status === '最终锁定') { <button class="btn" (click)="store.syncQuoteAmount(v.id)">同步商机预计金额</button> }
              </div>
              @if (v.status === '附条件通过') { @for (c of v.conditions; track c.id) { <div class="inline-alert warning"><span>{{ c.text }} · 负责人 {{ c.owner }} · 截止 {{ c.due }}</span>@if (!c.closed && store.role() === 'manager') { <button class="text-link" (click)="closeCondition(v,c.id)">关闭条件</button> }</div> } }
              @if (v.invalidationReason) { <div class="inline-alert warning">{{ v.invalidationReason }}</div> }
              <section class="quote-section"><div class="section-heading"><h3>报价明细</h3><span>{{ v.currency }}</span></div>
                <div class="table-wrap"><table><thead><tr><th>类别 / 名称</th><th>规格</th><th>单位</th><th class="numeric">数量</th><th class="numeric">未税单价</th><th class="numeric">行金额</th><th>来源说明</th><th></th></tr></thead><tbody>
                  @for (item of v.items; track item.id) { <tr><td>{{ item.category }} · {{ item.name }}</td><td>{{ item.spec || '—' }}</td><td>{{ item.unit }}</td><td class="numeric">{{ item.quantity }}</td><td class="numeric">{{ amount(item.unitPrice,v.currency) }}</td><td class="numeric">{{ amount(item.quantity * item.unitPrice,v.currency) }}</td><td>{{ item.source || '人工录入' }}</td><td>@if (editable(v)) { <button class="text-link" (click)="editItem(v,item)">编辑</button><button class="text-link" (click)="removeItem(v,item.id)">删除</button> }</td></tr> }
                  @empty { <tr><td colspan="8" class="empty">暂无明细；草稿可先保存，再补充行项目。</td></tr> }
                </tbody></table></div>
              </section>
              <section class="quote-section quote-summary"><h3>客户报价口径</h3><div class="summary-row"><span>明细小计</span><strong>{{ amount(totals(v).lines,v.currency) }}</strong></div><div class="summary-row"><span>另收运费 / 关税 / 其他</span><strong>{{ amount(totals(v).added,v.currency) }}</strong></div><div class="summary-row"><span>整单优惠</span><strong>− {{ amount(v.discount,v.currency) }}</strong></div><div class="summary-row total"><span>未税报价合计</span><strong>{{ amount(totals(v).net,v.currency) }}</strong></div><div class="summary-row"><span>增值税 · {{ v.taxMode }}</span><strong>{{ v.taxMode === '含税待确认' ? '待财务确认' : amount(v.vatAmount,v.currency) }}</strong></div><div class="summary-row total"><span>客户报价总额</span><strong>{{ totals(v).total === null ? '待财务确认' : amount(totals(v).total || 0,v.currency) }}</strong></div><p class="muted">费用是否另收、税费承担方和币种均按本版本记录；这是演示金额，不由系统计算真实税率。</p></section>
              <section class="quote-section"><h3>商务条件与方案摘要</h3><div class="details-grid"><div>交易主体：{{ v.sellerEntity || '待补' }}</div><div>国家 / 币种：{{ v.country }} · {{ v.currency }}</div><div>贸易条款：{{ v.tradeTerm }} {{ v.tradeNote }}</div><div>有效期：{{ v.plannedSendDate }} 至 {{ v.validUntil || '待填写' }}</div><div>交付范围：{{ v.scope || '待补' }}</div><div>交期：{{ v.delivery || '待补' }}</div><div>付款：{{ v.payment || '待补' }}</div><div>质保 / 服务：{{ v.warranty || '待补' }} · {{ v.service || '待补' }}</div><div class="full">方案摘要：{{ v.solutionSummary || '待补' }}</div><div class="full">方案边界：{{ v.boundaries || '待补' }}</div><div class="full">税务说明：{{ v.taxNote || '无' }} · 财务状态：{{ v.taxReview }} {{ v.taxReviewBy }}</div></div></section>
              <section class="quote-section"><h3>内部成本参考（不计入客户报价）</h3><p>货物 {{ cost(v.costs.goods,v.currency) }} · 物流 {{ cost(v.costs.logistics,v.currency) }} · 交付 {{ cost(v.costs.delivery,v.currency) }} · 服务 {{ cost(v.costs.service,v.currency) }}</p><p>{{ v.costs.source || '成本来源未提供；不计算毛利。' }}</p></section>
              <section class="quote-section"><h3>引用资料</h3><p class="muted">保存草稿会关联当前商机及来源线索的需求表、方案附件；方案摘要是文字说明，不能代替来源文件。</p>@for (file of sourceFiles(v); track file.id) { <p>{{ file.kind }} · {{ file.name }} · {{ file.date }}</p> } @empty { <p class="muted">尚未引用资料。请先在下方上传需求表或方案文件，再保存报价草稿或点击“引用需求 / 方案资料”。</p> }</section>
              <section class="quote-section"><h3>审核与发出记录</h3><p>审核：{{ v.reviewBy || '待审核' }} · {{ v.reviewDate || '—' }} · {{ v.reviewNote || '—' }}</p><p>发出：{{ v.sentDate || '—' }} · {{ v.sentMethod || '—' }} · {{ v.sentTo || '—' }} · {{ v.sentEvidence || '—' }}</p><p>客户确认：{{ v.acceptedBy || '待确认' }} · {{ v.acceptedDate || '—' }} · {{ v.acceptedEvidence || '—' }}</p></section>
              <section class="quote-section"><div class="section-heading"><h3>客户反馈时间线</h3>@if (['已记录发出','最终锁定'].includes(v.status) && canSell()) { <button class="text-link" (click)="addFeedback(v)">新增反馈</button> }</div>@for (f of v.feedback; track f.id) { <p>{{ f.date }} · {{ f.kind }} · {{ f.summary }} · {{ f.person }}</p> } @empty { <p class="muted">尚无反馈；无反馈不会解除冷却提醒。</p> }</section>
              <app-documents [entityId]="opportunity.id" [kinds]="['方案报价样例','需求导入表']" title="需求与方案来源资料"/>
              <details class="quote-section"><summary>操作历史</summary>@for (h of v.audit; track h.id) { <p>{{ h.date }} · {{ h.person }} · {{ h.action }} · {{ h.note }}</p> }</details>
            }
          </section>
          <aside class="panel quote-side"><h3>版本</h3>@for (v of s.versions; track v.id) { <button class="quote-version" (click)="selectedId.set(v.id)"><strong>V{{ v.number }} · {{ v.status }}</strong><small>{{ amount(totals(v).net,v.currency) }} · {{ v.currency }}</small>@if (v.id === s.activeFinalVersionId) { <app-badge text="当前最终版"/> }</button> }</aside>
        </div>
        @if (store.role() === 'manager' && s.versions.some(v => v.status === '待模拟审核')) { <p class="inline-alert">报价审核待办来自本地演示通知；应用结果后旧待办自动处理。</p> }
      } @else { <div class="panel padded"><p>尚未创建报价版本。报价系列编号和版本号会在创建时生成。</p></div> }
    }
  `,
  styles: `
    .quote-layout{display:grid;grid-template-columns:minmax(0,1fr) 220px;gap:18px}.quote-main,.quote-side{padding:20px}.quote-side{height:max-content}.quote-version-tabs,.quote-actions{display:flex;gap:8px;flex-wrap:wrap;padding:12px 0}.quote-version-tabs button,.quote-version{border:1px solid var(--line);background:white;border-radius:8px;padding:8px 12px}.quote-version-tabs button.active{border-color:var(--primary)}.quote-version{display:flex;flex-direction:column;gap:6px;width:100%;text-align:left;margin:7px 0}.quote-version small,.muted{color:#8d9ab1}.quote-section{border-top:1px solid var(--line);padding:17px 0}.quote-section h3{font-size:13px}.quote-summary{max-width:520px;margin-left:auto}.summary-row{display:flex;justify-content:space-between;padding:7px 0}.summary-row.total{border-top:1px solid var(--line);font-size:14px}.details-grid{display:grid;grid-template-columns:1fr 1fr;gap:12px;font-size:12px}.full{grid-column:1/-1}.section-heading{display:flex;justify-content:space-between;align-items:center}@media(max-width:900px){.quote-layout{grid-template-columns:1fr}.quote-side{order:-1}.quote-version{width:auto;display:inline-flex}.details-grid{grid-template-columns:1fr}}
  `,
})
export class QuoteWorkspace {
  readonly opportunityId = input.required<string>();
  readonly store = inject(DemoStore);
  readonly selectedId = signal('');
  readonly sale = computed(() => this.store.sale(this.opportunityId()));
  readonly series = computed(() => this.store.quoteSeries(this.opportunityId()));
  readonly current = computed(() => {
    const versions = this.series()?.versions || [];
    return versions.find((v) => v.id === this.selectedId()) || versions.find((v) => v.status === '草稿' || v.status === '退回补充' || v.status === '待模拟审核') || versions.at(-1);
  });
  canSell = () => ['sales', 'assistant', 'manager'].includes(this.store.role());
  editable = (v: QuoteVersion) => ['草稿', '退回补充'].includes(v.status) && this.canSell();
  amount(value: number, currency: string): string { return new Intl.NumberFormat('zh-CN', { style: 'currency', currency, minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(value || 0); }
  cost(value: number | null, currency: string): string { return value === null ? '未提供' : this.amount(value, currency); }
  totals(v: QuoteVersion) { return this.store.quoteTotals(v); }
  sourceFiles(v: QuoteVersion) { return this.store.quoteSourceFiles(v.id); }
  linkSource(v: QuoteVersion): void { const choices = this.store.quoteSourceCandidates(this.opportunityId()); if (!choices.length) { this.store.ui.fail('当前商机没有可引用资料，请先上传需求表或方案报价样例'); return; } this.store.ui.open({title:'引用来源资料',fields:[{key:'file',label:'需求表 / 方案报价资料',type:'select',options:choices.map((file)=>`${file.id} · ${file.name}`),required:true}],onSave:(d)=>this.store.attachQuoteSource(v.id,String(d['file']).split(' · ')[0])}); }
  taxCase(v: QuoteVersion, kind: '本地交易案例'|'跨境交易案例'): void { const local = kind === '本地交易案例'; const next = {...structuredClone(v), taxMode:'含税待确认', taxReview:'需重新确认', taxReviewBy:'', taxReviewDate:'', taxNote:local ? '本地交易样例：核实销售主体与客户是否处于同一税务区域；税率及含税金额由财务确认。' : '跨境交易样例：核实出口主体、目的国、贸易条款、运费及关税承担；进口VAT单独展示，不自动计入我方报价。'}; this.store.saveQuote(next); }
  editSolution(v: QuoteVersion): void { this.store.ui.open({title:'方案摘要及边界',fields:[{key:'summary',label:'方案摘要',type:'textarea',value:v.solutionSummary,required:true},{key:'boundaries',label:'方案范围边界',type:'textarea',value:v.boundaries,required:true}],onSave:(d)=>this.store.saveQuoteSolution(v.id,d['summary'],d['boundaries'])}); }
  create(): void { const id = this.store.createQuote(this.opportunityId()); if (id) this.selectedId.set(id); }
  private edit(v: QuoteVersion, title: string, fields: any[], sample: Record<string,string|number> = {}): void {
    this.store.ui.open({ title, fields, sample, submitLabel: '保存草稿', onSave: (data) => this.store.saveQuote({ ...structuredClone(v), ...data }) });
  }
  editHeader(v: QuoteVersion): void {
    this.edit(v,'报价条件',[{key:'title',label:'报价标题',required:true,value:v.title},{key:'sellerEntity',label:'交易主体',required:true,value:v.sellerEntity},{key:'country',label:'客户国家',required:true,value:v.country},{key:'currency',label:'币种',type:'select',options:['CNY','EUR','USD'],value:v.currency,required:true},{key:'tradeTerm',label:'贸易条款',type:'select',options:['FOB','CIF','DAP','DDP','其他'],value:v.tradeTerm,required:true},{key:'tradeNote',label:'贸易及税费承担说明',type:'textarea',value:v.tradeNote},{key:'plannedSendDate',label:'计划发出日期',type:'date',value:v.plannedSendDate},{key:'validUntil',label:'有效期截止日',type:'date',value:v.validUntil,required:true},{key:'scope',label:'交付范围',type:'textarea',value:v.scope,required:true},{key:'delivery',label:'交期说明',value:v.delivery,required:true},{key:'payment',label:'付款条件',value:v.payment,required:true},{key:'warranty',label:'质保说明',value:v.warranty,required:true},{key:'service',label:'服务说明',value:v.service},{key:'solutionSummary',label:'方案摘要',type:'textarea',value:v.solutionSummary,required:true},{key:'boundaries',label:'方案边界',type:'textarea',value:v.boundaries,required:true},{key:'taxMode',label:'税费模式',type:'select',options:['不含税报价','含税样例','含税待确认'],value:v.taxMode},{key:'vatAmount',label:'增值税金额（样例）',type:'number',min:0,value:v.vatAmount},{key:'taxNote',label:'税费问题/承担说明',type:'textarea',value:v.taxNote},{key:'freightAmount',label:'运费金额',type:'number',min:0,value:v.freightAmount},{key:'freightTreatment',label:'运费处理',type:'select',options:['已含在明细','另收','我方承担'],value:v.freightTreatment},{key:'dutyAmount',label:'关税金额',type:'number',min:0,value:v.dutyAmount},{key:'dutyTreatment',label:'关税处理',type:'select',options:['已含在明细','另收','我方承担','进口方承担'],value:v.dutyTreatment},{key:'otherFee',label:'其他费用',type:'number',min:0,value:v.otherFee},{key:'otherFeeTreatment',label:'其他费用处理',type:'select',options:['已含在明细','另收','我方承担'],value:v.otherFeeTreatment},{key:'discount',label:'整单优惠金额',type:'number',min:0,value:v.discount},{key:'notes',label:'备注',type:'textarea',value:v.notes}],{scope:'储能系统供货及约定服务',delivery:'交期以计划排产确认，属于演示说明',payment:'签约30% / 发货60% / 验收10%（样例）',warranty:'质保期限以正式合同为准（样例）',solutionSummary:'引用需求及方案报价样例，型号配置待核对。',boundaries:'不含未列明的土建及现场改造工作。'});
  }
  addItem(v: QuoteVersion): void {
    this.store.ui.open({ title:'新增报价明细', fields:[{key:'category',label:'类别',type:'select',options:['货物','服务','备件','其他'],value:'货物',required:true},{key:'name',label:'名称 / 型号',required:true},{key:'spec',label:'规格说明'},{key:'unit',label:'单位',required:true},{key:'quantity',label:'数量',type:'number',min:0.01,value:1,required:true},{key:'unitPrice',label:'未税销售单价',type:'number',min:0,value:0,required:true},{key:'source',label:'来源说明',hint:'零金额项目必须说明赠送或已包含理由'}],sample:{name:'储能系统',unit:'套',quantity:1,unitPrice:this.store.sale(this.opportunityId())?.amount || 1000000,source:'方案配置样例，演示金额'},onSave:(d)=>this.store.addQuoteItem(v.id,{category:d['category'],name:d['name'],spec:d['spec'],unit:d['unit'],quantity:Number(d['quantity']),unitPrice:Number(d['unitPrice']),source:d['source']}) });
  }
  editItem(v: QuoteVersion,item:QuoteItem):void { this.store.ui.open({title:'编辑报价明细',fields:[{key:'category',label:'类别',type:'select',options:['货物','服务','备件','其他'],value:item.category,required:true},{key:'name',label:'名称 / 型号',value:item.name,required:true},{key:'spec',label:'规格说明',value:item.spec},{key:'unit',label:'单位',value:item.unit,required:true},{key:'quantity',label:'数量',type:'number',min:0.01,value:item.quantity,required:true},{key:'unitPrice',label:'未税销售单价',type:'number',min:0,value:item.unitPrice,required:true},{key:'source',label:'来源说明',value:item.source}],onSave:(d)=>this.store.saveQuote({...structuredClone(v),items:v.items.map((row)=>row.id===item.id?{...row,category:d['category'],name:d['name'],spec:d['spec'],unit:d['unit'],quantity:Number(d['quantity']),unitPrice:Number(d['unitPrice']),source:d['source']}:row)})}); }
  removeItem(v:QuoteVersion,id:string):void { this.store.ui.open({title:'删除报价明细',description:'删除仅作用于当前草稿版本。',submitLabel:'确认删除',fields:[{key:'confirm',label:'输入“删除”确认',required:true}],onSave:(d)=>d['confirm']==='删除' ? this.store.removeQuoteItem(v.id,id) : this.store.ui.fail('请输入“删除”确认')}); }
  editCosts(v:QuoteVersion):void { this.store.ui.open({title:'成本参考',description:'金额仅作内部参考，不会计入客户报价或自动计算毛利。',fields:[{key:'goods',label:'货物成本（空白代表未提供）',type:'number',min:0,value:v.costs.goods ?? ''},{key:'logistics',label:'物流成本',type:'number',min:0,value:v.costs.logistics ?? ''},{key:'delivery',label:'交付工时成本',type:'number',min:0,value:v.costs.delivery ?? ''},{key:'service',label:'服务成本',type:'number',min:0,value:v.costs.service ?? ''},{key:'source',label:'成本来源说明',type:'textarea',value:v.costs.source}],onSave:(d)=>this.store.saveQuoteCosts(v.id,{goods:d['goods']===''?null:Number(d['goods']),logistics:d['logistics']===''?null:Number(d['logistics']),delivery:d['delivery']===''?null:Number(d['delivery']),service:d['service']===''?null:Number(d['service']),source:d['source']}) }); }
  review(v:QuoteVersion):void { this.store.ui.open({title:'销售主管模拟审核',fields:[{key:'result',label:'审核结果',type:'select',options:['模拟审核通过','附条件通过','退回补充'],value:'模拟审核通过',required:true},{key:'note',label:'审核意见',type:'textarea',required:true},{key:'condition',label:'附条件（仅附条件通过时填写）',type:'textarea'}],sample:{note:'价格与范围为演示信息，请按项目情况复核。'},onSave:(d)=>this.store.reviewQuote(v.id,d['result'] as any,d['note'],d['condition'])}); }
  confirmTax(v:QuoteVersion,result:'样例已确认'|'待财务确认'):void { this.store.ui.open({title:result==='样例已确认'?'财务确认税费样例':'记录财务待确认事项',description:'不代表真实税务计算或正式财务审批。',fields:[{key:'note',label:'财务意见 / 待确认问题',type:'textarea',required:true}],sample:{note:'贸易链或物流条件变化后需重新确认。'},onSave:(d)=>this.store.confirmQuoteTax(v.id,result,d['note'])}); }
  closeCondition(v:QuoteVersion,id:string):void { this.store.ui.open({title:'关闭报价审核条件',fields:[{key:'evidence',label:'关闭凭据说明',type:'textarea',required:true}],sample:{evidence:'已按审核意见补充文件并复核。'},onSave:(d)=>this.store.closeQuoteCondition(v.id,id,d['evidence'])}); }
  recordSent(v:QuoteVersion):void { this.store.ui.open({title:'记录报价已发出',description:'DEMO只记录业务动作，不会发送邮件。',fields:[{key:'date',label:'实际发出日期',type:'date',value:v.plannedSendDate,required:true},{key:'method',label:'发出方式',type:'select',options:['邮件（手工发送）','会议交付','其他'],required:true},{key:'recipient',label:'接收联系人',value:this.store.contact(this.sale()!)?.name || '',required:true},{key:'evidence',label:'报价文件/凭据说明',type:'textarea',required:true}],sample:{evidence:'报价单V1.pdf，手动发送记录'},onSave:(d)=>this.store.recordQuoteSent(v.id,d['date'],d['method'],d['recipient'],d['evidence'])}); }
  addFeedback(v:QuoteVersion):void { this.store.ui.open({title:'记录客户报价反馈',fields:[{key:'date',label:'反馈日期',type:'date',value:'2026-10-10',required:true},{key:'kind',label:'反馈类型',type:'select',options:['价格','技术','交期','条款','客户确认接受','无反馈'],required:true},{key:'summary',label:'反馈摘要',type:'textarea',required:true},{key:'person',label:'客户确认人 / 联系人'},{key:'evidence',label:'确认凭据说明',type:'textarea'}],sample:{summary:'客户接受当前版本，等待合同条款核对。',person:this.store.contact(this.sale()!)?.name || '陈客户',evidence:'客户邮件确认（演示记录）'},onSave:(d)=>this.store.addQuoteFeedback(v.id,{date:d['date'],kind:d['kind'],summary:d['summary'],person:d['person'],evidence:d['evidence']})}); }
  newVersion(v:QuoteVersion):void { this.store.ui.open({title:'创建报价新版',description:'复制本版本内容为新草稿，旧版本保留只读。',fields:[{key:'reason',label:'修改原因',type:'textarea',required:true}],sample:{reason:'客户要求调整价格或交期'},onSave:(d)=>{const id=this.store.createQuoteVersion(v.id,d['reason']);if(id)this.selectedId.set(id);return !!id;}}); }
  requestLock(v:QuoteVersion):void { this.store.ui.open({title:'申请最终报价锁定',description:'提交后由销售主管核对报价条件、审核条件及财务口径。',fields:[{key:'confirm',label:'输入“申请锁定”继续',required:true}],onSave:(d)=>d['confirm']==='申请锁定'?this.store.requestQuoteLock(v.id):this.store.ui.fail('请输入“申请锁定”确认')}); }
  lock(v:QuoteVersion):void { this.store.ui.open({title:'主管审核并锁定最终报价',description:'系统将检查客户接受凭据、财务口径、审核条件和其他未完成版本。',fields:[{key:'confirm',label:'输入“确认锁定”继续',required:true}],onSave:(d)=>d['confirm']==='确认锁定'?this.store.lockQuote(v.id):this.store.ui.fail('请输入“确认锁定”确认')}); }
  reopen(v:QuoteVersion):void { this.store.ui.open({title:'主管批准重新报价',description:'合同模拟来源引用后不能在本补丁中重新报价。',fields:[{key:'reason',label:'重新报价原因',type:'textarea',required:true}],onSave:(d)=>{const id=this.store.reopenLockedQuote(v.id,d['reason']);if(id)this.selectedId.set(id);return !!id;}}); }
}
