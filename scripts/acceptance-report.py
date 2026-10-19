"""Build an evidence-indexed acceptance report; statuses are reviewed judgements, not test-count inference."""
from pathlib import Path
import csv
import json
import re
import hashlib
from collections import Counter

root = Path(__file__).resolve().parents[1]
workspace = root.parent
artifacts = root / 'artifacts'
runtime = json.loads((artifacts / 'acceptance-v6-results.json').read_text())
regressions = json.loads((artifacts / 'acceptance-regressions.json').read_text())
P, T, F, V = '规则通过', '部分通过', '失败', '待核验'
# One entry per primary checkbox, in the original ticket order. UI conclusions stay partial without a browser run.
primary = {
1: [(T,'CHAIN-01 / REQ-01-AFTERCUSTOMER','已有需求资料的转换通过；只转客户后补需求资料被拒绝'),(P,'REQ-01-PURCHASING / contact-chain.test.ts','稳定联系人ID和采购作用保留'),(T,'customers.ts / sales-detail.ts','重复提示和人工选择代码存在；真实页面未运行'),(P,'CHAIN-01 / REQ-11-SAVEFAIL / contact-chain.test.ts','重复转换及失败原子性通过'),(F,'REQ-11-ROLES / store.canDocument','线索与资料操作仍受角色/已转换标记限制；标准只核对本地快照')],
2: [(P,'lead-opportunity-v6.test.ts','需求行ID与修订快照通过'),(P,'lead-opportunity-v6.test.ts','满足、不满足、关闭后新机会和历史通过'),(P,'CHAIN-02 / lead-opportunity-v6.test.ts','缺初判/证据阻断；有效提交幂等'),(P,'CHAIN-02 / business-rules.test.ts','销售人工等级未由跟进或金额改写'),(T,'insights.html / 字段资料03','模拟说明存在；在线CRM字段未重新核验，浏览器未运行'),(T,'store.saveProductNeed / lead-opportunity-v6.test.ts','需求变更过期和历史通过；资料入口的全角色可用性未满足')],
3: [(P,'CHAIN-02 / CHAIN-03 / business-rules.test.ts','PMO待办唯一，普通/投标共用指派方法'),(T,'CHAIN-03 / sales-detail.ts','模拟名单和窗口、手工选择可用；页面未运行'),(P,'CHAIN-03','参与确认不完成部门任务；完成后才可推进'),(T,'CHAIN-03 / sales-detail.html','缺项规则和红框模板存在；页面/指南一致性仍有缺口'),(T,'字段资料02 / sales-detail.html','未新增降级/挂起；旧模拟G3展示仍需走查'),(F,'REQ-11-GUIDE / sales-detail.html','指南固定对象；全局角色门槛仍在')],
4: [(P,'CHAIN-04 / v6-solution-quotes.test.ts','四类独立版本、确认引用和负责人历史存在'),(P,'v6-solution-quotes.test.ts','缺类/未确认不能核价；单类变更使确认失效'),(P,'CHAIN-04 / v6-solution-quotes.test.ts','币种/税费/来源必填，空成本不写零，模拟系数1.2'),(F,'REQ-04-FIVEITEMS','空五可对象可被保存；旧条件留存测试通过'),(T,'solution-service.ts / CHAIN-04','文件元数据和模拟标识存在；实际页面未验证'),(F,'solution-service.ts: outsider分支','非成员角色仍隐藏方案操作；特殊服务仍有限制')],
5: [(P,'CHAIN-05 / quote-sources.test.ts','报价行稳定产品来源及资料/核价引用通过'),(P,'CHAIN-05 / v6-solution-quotes.test.ts / v4.test.ts','13000减10%=11700；两台总额23400；来源变化留差异'),(P,'store.guideComparison / v6-solution-quotes.test.ts','币种/单位/数量/税费不一致不可比较，缺核价不写零'),(P,'CHAIN-05 / store.recordQuoteSent','普通审核和低价特批分别记录'),(F,'quote-workspace.ts: outsider/manager分支','Store报价方法放开角色，但UI仍隐藏或限定审核入口')],
6: [(P,'CHAIN-05 / store.recordQuoteSent','发出前检查普通审核及特批有效性'),(P,'CHAIN-05 / v6-solution-quotes.test.ts','退回重提，一次成功永久留存'),(P,'v6-solution-quotes.test.ts','内容锁定，新版不继承成功次数'),(P,'v4.test.ts / quote-sources.test.ts','已发/锁定快照不被新方案改写'),(F,'quote-workspace.ts','发出和唯一成交正常；UI仍有角色限制')],
7: [(F,'REQ-07-DRAFT','缺成交报价仍建草稿并回退商机金额'),(T,'store.registerContract / v5-contracts.test.ts','必填字符串和日期有校验；签约凭据未校验真实附件引用'),(F,'REQ-07-REGISTER','要求先赢单；登记只更新合同，不同次建首项目；重登记返回失败'),(P,'v5-contracts.test.ts / CHAIN-07-DIAGNOSTIC','同商机复用合同，同合同多独立项目可创建'),(F,'store.bridge / REQ-11-ROLES','旧bridge可生成登记合同/G3样例，角色限制尚在')],
8: [(T,'CHAIN-08 / store.briefingMissing','四项启动缺项阻断通过；基本信息、团队和适用交底未全面校验'),(P,'project-execution-records.test.ts / CHAIN-08','粗计划源ID保留，项目侧独立修改'),(T,'models.Plan / project-detail.ts','WBS/天数/前置/关系/周窗口存在；进度以状态表达，模板百分比尚未确认'),(T,'project-detail.html / 字段资料06','明确非实时；运输/缺料/来源完整性不足'),(F,'REQ-15-ACTUAL / v4.test.ts','财务稳定绑定及有效到期规则通过；客户验收节点实际日期被基准日改写'),(F,'REQ-11-ROLES / store.canEditPlan','角色限制仍在；不适用标识存在')],
9: [(T,'CHAIN-10 / global-review.test.ts','SAT与逐项验收分开，失败有历史；SAT独立说明和责任/版本引用不足'),(F,'REQ-09-CUSTOMER','客户验收未完成仍允许申请移交'),(F,'REQ-09-EIGHTH','待办说明为空仍可移交；仅验证类别数量与状态'),(F,'REQ-09-CUSTOMER','未提供降级/挂起，但移交可绕过未完成客户验收'),(P,'CHAIN-11','申请待接收和接收事实独立；未执行收款清零'),(F,'store.submitHandover / store.receive / project-detail.html','PM/接收方及页面角色限制仍在')],
10: [(T,'CHAIN-11 / store.history','接收由明确操作产生，历史有操作者/时间；汇总前置未实现'),(F,'REQ-10-SUMMARY / models.DemoState','181–185来源记录模型和项目汇总不存在'),(F,'REQ-10-SUMMARY','无同源更新、失败保留和同步时间操作'),(T,'business-workspaces.ts service页','未自动清账/评分；有效POD及服务汇总待实现'),(F,'REQ-11-ROLES / store.receive','角色限制和缺失汇总均未满足')],
11: [(F,'REQ-11-GUIDE','固定DEMO-L001，只有5步，终点仍为交底'),(F,'REQ-11-ROLES / quote-workspace.ts','13角色仅PM可编辑普通WBS；多处UI/API限制'),(T,'CHAIN-01 / CHAIN-02 / REQ-11-SAVEFAIL / REQ-07-REGISTER','转换、有效提交和保存失败通过；登记/服务同步未达要求'),(T,'v4.test.ts / global-review.test.ts / REQ-15-ACTUAL','迁移和历史规则多项通过；实际日期自动兜底仍有问题'),(F,'REQ-11-GUIDE / acceptance-tap.log','新对象页面/指南上下文不一致；既有3项用例失败'),(F,'REQ-11-EXCLUDED','63项映射齐全，但22号竞争对手字段仍出现在编辑表单'),(F,'REQ-07-REGISTER / REQ-10-SUMMARY','按目标顺序无法从新客户到181–185汇总'),(T,'本报告AC矩阵 / acceptance-ticket-matrix.csv','已生成逐项证据；浏览器/在线核验仍阻塞或待核'),(T,'forms.ts / business-workspaces.ts','保留现行关闭原因；模拟G3非正式标签；范围需继续收口'),(T,'v4.test.ts / global-review.test.ts','引用、确认失效及财务规则多项通过；整体未收口')],
12: [(F,'customers.ts / models.CustomerRole','客户页无权力地图；商机关系按联系人名称保存，无稳定联系人关系和来源核验'),(T,'REQ-01-PURCHASING / REQ-12-RELATION','采购作用不自动变更；关系地图重命名仍显示旧名称'),(T,'customers.ts / store.addActivity / 字段资料01','互动和活动可展示，来源/类型映射及参与人字段仍不完整'),(F,'store.saveCustomerRole / models.CustomerRole','缺决策链采用快照和用户确认后更新流程'),(T,'customers.ts / models.Activity','空活动提示存在；来源及录入/更新时间不足，只有业务日期和操作者')],
13: [(T,'insights.html / 字段资料03','等级/阶段/金额/预计日期和待核关注度可见，页面未运行'),(P,'insights.ts counts / REQ-13-FORECAST','阶段金额/容量未加权，币种分开'),(T,'insights.html / store.cooling','CRM模拟快照字段可见；实际冷却用本地活动推算，并非CRM提醒快照'),(T,'REQ-13-FORECAST / business-rules.test.ts','未加权预测通过；未单独建未赢单商机的预计确收日期字段'),(T,'insights.html','未造评分；没有对66中延期/停留/Gate/高风险承诺逐项待核展示'),(T,'insights.ts / insights.html','筛选与角色切换的代码入口存在；浏览器未取证')],
14: [(T,'models.Plan / project-detail.ts / 字段资料06','多数离线模板列已加，百分比进度及实际周视图待核'),(T,'project-detail.html / 字段资料06','部分交期/批次/现场信息及待核引用；报关/运输资料展示不完整'),(F,'src/app源代码检索缺料 / 字段资料06','没有缺料清单入口；部分来源更新时间仅可手填且为空'),(T,'CHAIN-08 / project-detail.html','不适用标签和模拟窗口有；不适用后仍保留来源行'),(P,'CHAIN-07-DIAGNOSTIC / CHAIN-08 / v4.test.ts','源节点ID、独立计划、财务稳定ID通过'),(T,'Plan.sourceReference / 字段资料06','来源追溯是自由文本；旧字段并非逐项映射，实际日期来源可待核保存')],
15: [(T,'CHAIN-09 / store.savePlan','手工状态/实际日期和关键节点阻断存在；数值进度未有字段'),(P,'CHAIN-09 / project-execution-records.test.ts','类别自由录入且来源待核；无风险记录不声明无风险'),(T,'CHAIN-09 / project-detail.html','五类沟通记录与来源/历史可用；选项核验仍待核'),(P,'CHAIN-09 / project-execution-records.test.ts','设备/项目/合同稳定ID，未录实际日期保持空，来源待核明确'),(F,'REQ-15-ACTUAL / project-review.ts','重复验收使用BASE_DATE替换明确签认日期，迁移也存在日期兜底'),(P,'CHAIN-09 / REQ-11-SAVEFAIL','执行记录追加历史；未核记录不阻断其他操作')],
}
supplement_status = {
1:[T,F,T,T],2:[P,P,P,P],3:[T,P,T,T],4:[P,P,F],5:[P,P,P],6:[P,P,P,F],7:[F,T,F],8:[T,T,F,T],9:[T,F,F],10:[F,T,F]
}
ticket_files = sorted((workspace / '.scratch/cspd-v6-demo-tickets/issues').glob('[0-9][0-9]-*.md'))
criteria = []
ticket_summaries = []
for file in ticket_files:
    number = int(file.name[:2])
    text = file.read_text()
    title = text.splitlines()[0].lstrip('# ')
    items = [line[6:] for line in text.splitlines() if line.startswith('- [ ] ')]
    assert len(items) == len(primary[number]), (number, len(items))
    for index, (item, review) in enumerate(zip(items, primary[number]), 1):
        status, evidence, note = review
        criteria.append(dict(id=f'T{number:02}-{index:02}',ticket=number,type='主验收条件',requirement=item,result=status,evidence=evidence,note=note))
    supplement = text.split('## 补充验收条件', 1)[1] if '## 补充验收条件' in text else ''
    items = [line[2:] for line in supplement.splitlines() if line.startswith('- ')]
    assert len(items) == len(supplement_status.get(number, [])), number
    for index, (item, status) in enumerate(zip(items, supplement_status.get(number, [])), 1):
        related = [row for row in criteria if row['ticket'] == number and row['type'] == '主验收条件']
        criteria.append(dict(id=f'T{number:02}-S{index:02}',ticket=number,type='补充验收条件',requirement=item,result=status,evidence='；'.join(row['evidence'] for row in related),note='对应主验收行提供细分证据；规则通过不等于浏览器或在线标准通过'))
    rows = [row for row in criteria if row['ticket'] == number]
    ticket_summaries.append(dict(ticket=number,title=title,result='未通过' if any(row['result']==F for row in rows) else '部分通过，未完成整体验收',counts=dict(Counter(row['result'] for row in rows))))

ac_status=[T,P,T,T,T,P,P,T,T,P,P,P,P,F,P,P,P,P,P,P,F,T,T,F,F,F,P,F,T,F,T,F,T,V]
ac_evidence=['contact-chain.test.ts / CHAIN-01','REQ-01-PURCHASING','lead-opportunity-v6.test.ts / 字段资料01','CHAIN-01 / REQ-01-AFTERCUSTOMER','quote-sources.test.ts / 字段资料01','CHAIN-05 / lead-opportunity-v6.test.ts','CHAIN-02','CHAIN-03 / business-rules.test.ts','CHAIN-03 / 浏览器阻塞','lead-opportunity-v6.test.ts / CHAIN-08','CHAIN-04 / v6-solution-quotes.test.ts','v4.test.ts / v6-solution-quotes.test.ts','CHAIN-04','REQ-04-FIVEITEMS','CHAIN-05','CHAIN-05 / v6-solution-quotes.test.ts','CHAIN-05 / store.recordQuoteSent','CHAIN-05 / v6-solution-quotes.test.ts','v6-solution-quotes.test.ts','v4.test.ts','REQ-07-REGISTER / REQ-07-DRAFT','CHAIN-08 / REQ-07-REGISTER','CHAIN-08 / store.briefingMissing','v4.test.ts / REQ-15-ACTUAL','REQ-09-CUSTOMER','REQ-09-EIGHTH','CHAIN-11','REQ-10-SUMMARY','REQ-10-SUMMARY / 字段资料08','REQ-11-ROLES','CHAIN-01 / REQ-11-SAVEFAIL / REQ-07-REGISTER','REQ-11-GUIDE','v4.test.ts / global-review.test.ts','2026-10-14本地字段快照；本次未重新读取在线标准']
ac_text=(workspace/'doc/PRD/V6PRD/10_验收矩阵与演示脚本.md').read_text()
acs=[]
for line in ac_text.splitlines():
    if re.match(r'\| AC\d{2} \|',line):
        columns=[part.strip() for part in line.strip('|').split('|')]
        index=int(columns[0][2:])-1
        acs.append(dict(id=columns[0],requirements=columns[1],scenario=columns[2],expected=columns[3],result=ac_status[index],evidence=ac_evidence[index],objects=runtime['objects']))
assert len(acs)==34

trace=(workspace/'.scratch/cspd-v6-demo-tickets/issues/traceability.md').read_text().split('## PRD需求与 AC 分配')[0]
mapping=[]
specific={7:(P,'稳定客户/联系人ID'),8:(F,'客户页权力地图缺失；REQ-12-RELATION'),17:(P,'CHAIN-02 初判/需求前置'),18:(P,'CHAIN-01/05/12 稳定ID'),20:(P,'销售人工评级'),22:(F,'REQ-11-EXCLUDED 竞争对手字段仍显示'),29:('按约定不做','未建外部消息台账'),31:(P,'business-rules.test.ts 冷却提示不自动关闭'),37:(V,'仍有售前交付初判入口；排除边界需复核'),41:(P,'CHAIN-03 PMO统一手工指派'),53:(T,'未加权预测通过；预计确收字段承载不足'),56:(T,'逐项业务缺项存在；浏览器红框未取证'),57:('按约定不做','未新增降级/挂起'),59:(F,'客户主数据ID复用，但决策链采用/确认过程缺失'),60:('沿现行口径','关闭原因维持既有必填；未新增门禁'),70:('按约定不做','未发现佣金/提成页面或计算'),75:(P,'人工评级'),76:(P,'投标标记与评级独立'),83:(P,'CHAIN-04 四类独立版本'),99:(P,'CHAIN-05 稳定报价来源'),100:(P,'CHAIN-05 特批/锁定/版本'),109:(P,'动态独立项目ID'),112:(P,'v5-contracts.test.ts 同合同多项目'),113:(P,'CHAIN-08 启动附件元数据引用'),130:(P,'v4.test.ts 财务口径'),132:(P,'v4.test.ts 逾期依据实际日期'),133:(F,'REQ-11-ROLES 角色门槛仍在'),145:(F,'REQ-15-ACTUAL 实际日期被改写'),148:(F,'缺料清单展示缺失'),157:(P,'CHAIN-09 风险记录与来源待核'),159:(T,'CHAIN-09 轻量沟通可用；选项待核'),167:(P,'CHAIN-09 SN稳定设备/项目/合同关联，来源待核'),172:(F,'REQ-09-CUSTOMER 未验收可移交'),174:(F,'REQ-09-EIGHTH 待办为空仍可移交')}
for line in trace.splitlines():
    if re.match(r'\|\s*\d+\s*\|',line):
        c=[part.strip() for part in line.strip('|').split('|')]
        number=int(c[0]);status,note=specific.get(number,(T,'参考主责票据验收行；未取得完整浏览器/在线证据'))
        mapping.append(dict(number=number,decision=c[1],tickets=c[2],ac=c[3],result=status,note=note))
assert len(mapping)==63 and len({row['number'] for row in mapping})==63

def csv_file(name, rows):
    with (artifacts/name).open('w',newline='',encoding='utf-8-sig') as out:
        writer=csv.DictWriter(out,fieldnames=list(rows[0]));writer.writeheader();writer.writerows(rows)
csv_file('acceptance-ticket-matrix.csv',criteria)
csv_file('acceptance-ac-matrix.csv',[{key:value for key,value in row.items() if key!='objects'} for row in acs])
csv_file('acceptance-63-matrix.csv',mapping)
data=dict(runAt=runtime['runAt'],tickets=ticket_summaries,criteria=criteria,acs=acs,mapping=mapping,objects=runtime['objects'],browser='环境阻塞：监听端口EPERM；Chrome setsockopt/shutdown被禁止')
(artifacts/'acceptance-matrix.json').write_text(json.dumps(data,ensure_ascii=False,indent=2))
snapshot = {str(file.relative_to(workspace)):hashlib.sha256(file.read_bytes()).hexdigest()
            for directory in [root/'src',root/'tests',workspace/'.scratch/cspd-v6-demo-tickets/issues']
            for file in directory.rglob('*') if file.is_file() and file.suffix in ['.ts','.html','.scss','.md']}
(artifacts/'acceptance-source-snapshot.json').write_text(json.dumps({'runAt':runtime['runAt'],'algorithm':'SHA256','files':snapshot},ensure_ascii=False,indent=2))

lines=['# V6十五张票据完整验收记录（2026-10-15）','',
'**结论：十五张票据已逐项审阅，但整体验收未通过。** 目标主线在合同登记顺序处失败；诊断续跑可到明确运维接收，181–185服务汇总缺失。真实浏览器验收被当前执行环境阻塞，不能宣称完整页面演示通过。','',
f"- 生产构建通过，详见 [构建日志](../artifacts/acceptance-build.log)。",
f"- 原有回归：{regressions['summary']['tests']}项，{regressions['summary']['pass']}通过、{regressions['summary']['fail']}失败；无跳过。详见 [原始TAP日志](../artifacts/acceptance-tap.log)。",
f"- 新增验收探针：{len(runtime['results'])}项，{sum(r['result']=='通过' for r in runtime['results'])}通过、{sum(r['result']=='失败' for r in runtime['results'])}失败；每项实际调用公开业务方法，使用真实DemoStore初始化与内存localStorage。详见 [运行日志](../artifacts/acceptance-v6.log) 和 [结构化结果](../artifacts/acceptance-v6-results.json)。",
f"- 对照15张票据的88条主验收条件及35条补充条件，共{len(criteria)}条；另完成AC01–AC34与63项标准映射的证据索引。**规则通过仅指该条已取得业务规则证据，不能代替浏览器或在线标准验收。**",
'- 本次只新增验收脚本和证据，没有修改产品业务实现、旧测试预期、原票据状态或线上Issue。所有新业务记录在隔离内存保存，未重置日常浏览器数据。',
'- CSPD/CRM标准采用2026-10-14本地只读字段资料快照；未重新取得在线最新版，AC34保持待核验。',
'- 本轮源码/票据SHA256快照见 [验收版本指纹](../artifacts/acceptance-source-snapshot.json)，可识别后续修改后的证据是否仍对应当前版本。','',
'## 真实缺口与复现','',
'| 探针 | 对应票据 | 实际结果 |','|---|---|---|']
for row in runtime['results']:
    if row['result']=='失败': lines.append(f"| {row['id']} | {','.join(map(str,row['tickets']))} | {row.get('error','').replace(chr(10),'<br>').replace('|','/')} |")
lines += ['', '失败探针表达的是需求预期，因此保留红色结果；没有把“允许绕过”修改为通过预期。源码定位：',
'- `store.registerContract`：先要求商机已赢单，只更新合同；`createContractDraft`没有唯一成交报价也会回退商机金额。',
'- `store.handoverReady` / `submitHandover`：没有客户验收完成判断，第八类待办仅看状态不看内容。',
'- `store.completeAcceptance`：把BASE_DATE传给客户验收WBS节点；`project-review.ts`还存在缺日期时的BASE_DATE兜底。',
'- `store.recordFiveCan`：只校验传入对象的值，不检查五个项目必须齐全，空对象可保存。',
'- `mainline-guide.ts`：固定起点DEMO-L001，五步终点是启动交底。',
'- `CustomerRole.contact`及客户角色表：关系保存显示名称，改联系人名后显示旧名；客户页没有五类关系地图及决策链采用确认流程。',
'- `BusinessForms.editSales`：仍提供竞争对手字段；项目和报价页面仍有角色限制。','',
'## 原有测试失败的归因','',
'原有3项失败分别在global-review.test.ts的连续主线和mainline-guide.test.ts的两个推进场景。前两类报错为“确认适用协作部门”，另一个预期“进入方案报价”却得到“处理门禁缺项”。新增动态链条通过公开assignTeam确认适用范围、确认参与、单独完成部门任务后可以正常推进，因此这些原有失败主要反映测试准备没有补上新门禁，不能仅凭它们判定该门禁有错。',
'原有65项通过也不能证明15张新票据完成：例如v5-contracts.test.ts明确保护“先赢单、登记、另行建项目”的旧顺序，部分权限测试仍期望拒绝非对应角色；这些预期与票据07/11存在差异。新验收探针按票据要求独立取证。','',
'## 本轮完整逻辑链','',
'目标顺序：新客户/联系人 → 新线索 → 商机 → 当前需求技术初判 → 有效提交 → PMO/团队门禁 → 四类方案/核价/五可 → 低价特批退回重提及普通审核 → 发出/客户接受/唯一成交 → 合同登记同次赢单与首项目 → 项目启动/计划/财务 → 风险/沟通/SN → SAT与客户验收 → 八类移交 → 明确接收 → 181–185服务汇总。','',
'实际执行：前半段通过；合同登记要求先赢单，目标链失败。为了覆盖后段，单独记录诊断续跑，显式按旧顺序赢单、登记和创建项目；随后启动、计划独立修改、财务加载、执行记录、SAT失败后通过、逐项客户验收、移交和明确接收通过。服务汇总没有模型/接口，终点仍不可达到。',
'', '对象ID：', '']
for key,value in runtime['objects'].items(): lines.append(f'- {key}：`{value}`')
lines += ['', '[隔离链最终状态快照](../artifacts/acceptance-chain-state.json)保留了全部关联和本轮低价报价采用值。','',
'## 浏览器限制与未覆盖项','',
'本地Angular服务监听127.0.0.1:4205失败：listen EPERM。Chrome常规管道启动失败：setsockopt Operation not permitted；关闭崩溃报告并尝试单进程后，shutdown仍被环境禁止。浏览器库依赖存在且Chrome版本命令能运行，障碍是执行环境能力。没有通过浏览器页面，也没有生成验收截图。',
'实际点击、所有路由可达、按钮状态、红框呈现、窄屏布局、控制台/网络错误以及页面刷新后的视觉一致性均保留为环境阻塞。业务Store重载测试不等同浏览器刷新测试。原始错误见 [服务监听日志](../artifacts/acceptance-server.log) 和 [浏览器启动日志](../artifacts/acceptance-browser-block.log)。','',
'## 15张票据逐项结果','', '| 票据 | 总体判断 | 分项计数 |','|---|---|---|']
for row in ticket_summaries: lines.append(f"| {row['title']} | {row['result']} | {'；'.join(f'{k}{v}' for k,v in row['counts'].items())} |")
lines += ['', '[123条验收CSV](../artifacts/acceptance-ticket-matrix.csv)包含原条件全文、结果、证据与不足；以下按票据逐条列出。','']
for ticket in ticket_summaries:
    lines += [f"### {ticket['title']}",'','| 条件ID | 原验收条件 | 结果 | 证据/观察 |','|---|---|---|---|']
    for row in [x for x in criteria if x['ticket']==ticket['ticket']]: lines.append(f"| {row['id']} | {row['requirement'].replace('|','/')} | {row['result']} | {row['evidence']}：{row['note']} |")
    lines.append('')
lines += ['## AC01–AC34证据矩阵','','| AC | 需求 | 结果 | 证据 |','|---|---|---|---|']
for row in acs: lines.append(f"| {row['id']} | {row['requirements']} | {row['result']} | {row['evidence']} |")
lines += ['','[AC明细CSV](../artifacts/acceptance-ac-matrix.csv)同时保留操作场景和原通过结果。','',
'## 63项标准逐项追踪','','63个序号唯一且均有主责票据引用。下表区分业务通过、部分、失败、待核和按约定不做；映射存在不代表实现通过。','','| CSPD序号 | 票据 | 对应AC/需求 | 本次判断 | 观察 |','|---|---|---|---|---|']
for row in mapping: lines.append(f"| {row['number']} | {row['tickets']} | {row['ac']} | {row['result']} | {row['note']} |")
lines += ['','[63项CSV](../artifacts/acceptance-63-matrix.csv)可单独检查。','',
'## 复跑方式','',
'在my demo目录运行以下命令；新验收脚本存在失败时会返回非零状态：','',
'```bash','npm run build','node --import tsx --test --test-isolation=none --test-reporter=tap tests/*.test.ts','node --import tsx scripts/acceptance-v6.ts','python scripts/acceptance-report.py','```','',
'验收脚本只使用隔离内存localStorage，不会访问外部业务系统。不得在尚未修复缺口或补齐浏览器/在线标准证据时把整体验收改为通过。','']
output=root/'docs/V6_15票据完整验收_2026-10-15.md'
output.write_text('\n'.join(lines))
print(json.dumps({'report':str(output),'criteria':len(criteria),'tickets':len(ticket_summaries),'acs':len(acs),'mapping':len(mapping),'counts':dict(Counter(row['result'] for row in criteria))},ensure_ascii=False))
