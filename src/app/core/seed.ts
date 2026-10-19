import { initializeFinanceSources } from './management-v10/finance-sources';
import { seedV4 } from './v4';
import {
  AcceptanceItem,
  BASE_DATE,
  CELL_DEMAND_OPTIONS,
  Customer,
  CustomerDeliveryMapping,
  Contract,
  DemoState,
  HANDOVER_TYPES,
  Plan,
  PlanType,
  ProductNeed,
  Project,
  PROJECT_REGION_OPTIONS,
  QuoteSeries,
  QuoteVersion,
  ROLES,
  SalesRecord,
  Stage,
  STAGES,
  TeamMember,
} from './models';
import { identityForLegacyPlatformName, identityForRole } from './identity';
import { PRODUCT_CATALOG } from './product-catalog';
import { completionKind } from './project-review';
import { PLAN_RISK_DEMO_CASES, planRiskDemoDates } from './plan-risk-demo';
export function newId(prefix: string): string {
  return `DEMO-${prefix}-${crypto.randomUUID().slice(0, 8)}`;
}
export function makeTeam(): TeamMember[] {
  return ['solution', 'pm', 'receiver'].map((role, i) => ({
    id: newId('TM'),
    personId: `demo-person:${ROLES.find((person) => person.id === role)!.person}`,
    role: role as TeamMember['role'],
    person: ROLES.find((r) => r.id === role)?.person || '',
    department: ['解决方案', '项目管理', '运维服务'][i],
    window: '2026-10-12 至 2026-11-15',
    confirmed: false,
    confirmedBy: '',
  }));
}
export function blankSales(
  id: string,
  customerId: string,
  type: 'lead' | 'opportunity' = 'lead',
): SalesRecord {
  return {
    id,
    type,
    customerId,
    contactId: '',
    projectName: '',
    owner: '张销售',
    ownerPersonId: identityForLegacyPlatformName('张销售')?.personId,
    operator: '张销售',
    operatorPersonId: identityForRole('sales')?.personId,
    source: '业务手动登记',
    description: '',
    capacity: 0,
    unit: 'MWh',
    power: 0,
    cellDemand: '',
    projectRegion: '',
    amount: 0,
    currency: 'CNY',
    expectedDate: '',
    createdDate: BASE_DATE,
    convertedDate: type === 'opportunity' ? BASE_DATE : '',
    stage: '意向沟通',
    status: '草稿',
    grade: '',
    tender: '否',
    tradeTerm: '',
    competitor: '',
    reason: '',
    closedDate: '',
    incomeDate: '',
    convertedTo: '',
    leadId: '',
    team: [],
    customerRoles: [],
    g1: '未提交',
    deliveryOpinion: '',
    resourceWindow: '',
    taxCase: '',
    taxNote: '',
    taxConfirmed: false,
    needsReview: false,
    quoteFlowMode: 'legacy',
  };
}

export function makePlans(prefix: string, regional = false): Plan[] {
  const names = [
    '项目启动交底',
    '设计输入确认',
    '设备生产排期',
    '首批发运安排',
    '到货确认',
    '现场安装',
    '调试测试',
    '客户验收',
    '资料整理',
    '内部移交',
  ];
  return names.map((name, i): Plan => {
    const scenario = i >= 2 && i <= 4 ? planRiskDemoDates(PLAN_RISK_DEMO_CASES[i - 2]) : undefined;
    const end = scenario?.end || `2026-${i < 3 ? '10' : '11'}-${String(16 + (i % 3) * 5).padStart(2, '0')}`;
    return {
      id: `${prefix}-W${i + 1}`,
      type: '内部WBS',
      name: regional && i === 3 ? '区域物流及当地清关' : name,
      owner: i === 5 || i === 6 ? '刘工程师' : '王项目',
      start: scenario?.start || `2026-${i < 3 ? '10' : '11'}-${String(12 + (i % 3) * 5).padStart(2, '0')}`,
      end,
      expected: end,
      actual: i < 2 ? `2026-10-${String(16 + (i % 3) * 5).padStart(2, '0')}` : '',
      status: i < 2 ? '已完成' : i === 2 ? '进行中' : '未开始',
      product: '储能系统',
      quantity: 1,
      batch: '',
      linked: '',
      amount: 0,
      currency: 'CNY',
      result: '待执行',
      receiver: '',
      note: '',
      wbsCode: `WBS-${String(i + 1).padStart(2, '0')}`,
      durationDays: 5,
      predecessor: i ? `WBS-${String(i).padStart(2, '0')}` : '',
      relationNote: i ? '演示依赖关系，需项目团队核对' : '',
      weekWindow: '演示窗口：2026年第42周',
      sourceReference: '演示计划样例；模板来源待核',
      sourceStatus: '模拟',
      // 首节点在基准日次日到期，使用当天预警，保证正常档仍为蓝色。
      warningLeadDays: i === 0 ? 0 : 3,
      ...sampleBudget(i, regional),
      ...(completionKind({ type: '内部WBS', name })
        ? { completionKind: completionKind({ type: '内部WBS', name }) }
        : {}),
    };
  });
}
/**
 * 演示样例预算：需要展示分币种汇总的内部WBS带模拟预算，明确标“模拟”而不是业务原值。
 * 内部移交刻意留空，用于演示“预算待补”和“已填部分合计”不会被读成完整项目预算。
 */
function sampleBudget(
  index: number,
  regional: boolean,
): { budgetAmount: number; budgetCurrency: string; budgetSource: '模拟' } | Record<string, never> {
  const samples: ReadonlyArray<{ amount: number; currency: string }> = [
    { amount: 12000, currency: 'CNY' },
    { amount: 35000, currency: 'CNY' },
    { amount: 1800000, currency: 'CNY' },
    { amount: 260000, currency: 'CNY' },
    { amount: 18000, currency: 'CNY' },
    { amount: 62000, currency: 'USD' },
    { amount: 48000, currency: 'EUR' },
    { amount: 60000, currency: 'CNY' },
    { amount: 15000, currency: 'CNY' },
  ];
  const sample = samples[index];
  if (!sample) return {};
  const currency = index === 3 && regional ? 'EUR' : sample.currency;
  const amount = index === 3 && regional ? 42000 : sample.amount;
  return { budgetAmount: amount, budgetCurrency: currency, budgetSource: '模拟' };
}
export function blankPlan(type: PlanType): Plan {
  return {
    id: newId('PL'),
    type,
    name: '',
    owner: '王项目',
    start: '2026-10-12',
    end: '2026-10-20',
    expected: '2026-10-20',
    actual: '',
    status: '未开始',
    product: '储能系统',
    quantity: 1,
    batch: '第一批',
    linked: '',
    amount: 0,
    currency: 'CNY',
    result: '待执行',
    receiver: '',
    note: '',
    wbsCode: '',
    predecessor: '',
    relationNote: '',
    weekWindow: '',
    sourceReference: '',
    sourceStatus: '待核',
  };
}
export function blankProject(
  id: string,
  customerId: string,
  oppId: string,
  contractId: string,
): Project {
  const checks = ['产品数量与型号', '设备安装及接线', '现场测试结果', '资料交付', '客户培训记录'];
  return {
    id,
    name: '青山储能一期',
    customerId,
    opportunityId: oppId,
    contractId,
    pm: '王项目',
    site: '江苏省苏州市工业园区',
    siteConditions: '具备进场条件，客户提供卸货区',
    capacity: 10,
    unit: 'MWh',
    start: '2026-10-12',
    status: '待启动',
    accepted: false,
    team: makeTeam(),
    plans: [],
    riskRecords: [],
    communicationRecords: [],
    equipmentSerialRecords: [],
    briefing: {
      acceptance: '',
      production: '45个工作日（样例）',
      shipping: '15个工作日（样例）',
      commissioning: '2026-11-20',
      review: '待提交',
      opinion: '',
      returns: 0,
    },
    conditions: [],
    productionApplicable: true,
    productionReason: '',
    sat: { date: '', result: '待执行', complete: false },
    acceptance: checks.map((name, i): AcceptanceItem => ({
      id: `${id}-A${i}`,
      name,
      result: '待检查',
      signer: '',
      date: '',
      note: '',
    })),
    acceptanceComplete: false,
    handover: {
      receiver: '吴运维',
      status: '草稿',
      opinion: '',
      categories: HANDOVER_TYPES.map((name) => ({ name, status: '待补', note: '' })),
      issues: [],
    },
    needsReview: false,
  };
}
export function createSeed(): DemoState {
  const names = [
    '演示能源科技',
    '海岳储能有限公司',
    'Nordlicht Energy',
    '华辰新能源',
    '远景工业园',
    'EuroGrid Systems',
    '晨光电力',
    '南湾能源',
    '星洲开发集团',
    '青峰制造',
    'Rhein Solar',
    '启明投资',
  ];
  const countries = [
    '中国',
    '中国',
    'Germany',
    '中国',
    '中国',
    'Netherlands',
    '中国',
    '中国',
    '新加坡',
    '中国',
    'Germany',
    '中国',
  ];
  const customers: Customer[] = names.map((name, i) => ({
    id: `DEMO-C${String(i + 1).padStart(3, '0')}`,
    name,
    shortName: name.slice(0, 4),
    country: countries[i],
    email: `customer${i + 1}@example.com`,
    region: countries[i] === 'Germany' ? 'DACH' : countries[i] === 'Netherlands' ? 'Western Europe' : '',
    status: ['潜在客户', '正式客户', '忠诚客户'][i % 3],
    owner: ['张销售', '赵销售', '孙销售'][i % 3],
    employeeSize: ['100-500', '500-1000', '1000-5000'][i % 3],
    basicInfo: '客户主体档案（DEMO样例）',
    createdAt: BASE_DATE,
    createdBy: 'DEMO样例初始化',
    industry: ['Owner', 'Developer', 'EPC', 'Integrator'][i % 4],
    address: `${countries[i]}，演示项目所在地`,
    contacts: [
      {
        id: `DEMO-CT${i + 1}`,
        name: i === 0 ? '陈客户' : ['李先生', '王女士', 'Anna Müller', '赵经理'][i % 4],
        title: i % 2 ? '女士' : '先生',
        department: '项目采购部',
        position: '项目对接人',
        phone: `1390000${String(i).padStart(4, '0')}`,
        email: `contact${i + 1}@example.com`,
      },
    ],
  }));
  const leads: SalesRecord[] = Array.from({ length: 12 }, (_, i) => ({
    ...blankSales(`DEMO-L${String(i + 1).padStart(3, '0')}`, customers[i].id),
    contactId: customers[i].contacts[0].id,
    projectName: ['青山储能一期', '工业园备电', '沿海储能站', '海外示范项目'][i % 4],
    description: '客户已沟通项目建设方向，需求导入表待补充。',
    status: i === 1 ? '暂缓跟进' : i === 2 ? '已归档' : '待跟进',
    owner: ['张销售', '赵销售', '孙销售'][i % 3],
    ownerPersonId: identityForLegacyPlatformName(['张销售', '赵销售', '孙销售'][i % 3])?.personId,
    crmStatus: i % 3 === 0 ? ('已分配' as const) : ('未分配' as const),
    followUpStatus:
      i === 1 ? ('暂缓跟进' as const) : i === 2 ? ('已归档' as const) : ('跟进中' as const),
    operatorPersonId: identityForRole('sales')?.personId,
    createdDate: '2026-09-20',
    capacity: 10 + i * 5,
    amount: (100 + i * 45) * 10000,
    currency: customers[i].country === '中国' ? 'CNY' : 'EUR',
    expectedDate: '2026-11-15',
  }));
  leads[0].sourceOwner = {
    source: 'CRM模拟样例',
    id: 'CRM-DEMO-PERSON-001',
    name: '张销售',
  };
  leads[0].sourceCreator = {
    source: 'CRM模拟样例',
    id: 'CRM-DEMO-CREATOR-001',
    name: 'CRM样例录入人员',
  };
  leads[0].crmSource = '市场活动';
  leads[0].crmSnapshot = {
    source: '非标CRM（飞书多维表格·JP站点）',
    snapshotDate: BASE_DATE,
    dateExamples: [
      {
        field: '本条创建日（纯日期）',
        sourceValue: '2026/09/20',
        displayValue: '2026-09-20',
        note: '保留日历日，不按时区换算。',
      },
      {
        field: 'CSV无时区日期时间格式示例（非本条源值）',
        sourceValue: '2026/09/20 09:35',
        displayValue: '原文保留',
        note: '来源时区待核对，不推断为UTC。',
      },
      {
        field: '明确UTC换日演示假设（非CRM原值）',
        sourceValue: '2026-09-20T23:30:00Z',
        displayValue: '2026-09-21 07:30（北京时间）',
        note: '仅演示已知时区时的转换，不作为业务日期来源。',
      },
    ],
  };
  leads[3].owner = '';
  leads[3].ownerPersonId = undefined;
  leads[3].crmStatus = '无效线索';
  leads[4].owner = '';
  leads[4].ownerPersonId = undefined;
  leads[4].crmStatus = '退回公海';
  leads[5].crmStatus = '已转商机';
  leads[5].followUpStatus = '跟进中';
  leads[5].convertedTo = 'DEMO-O006';
  leads[5].convertedDate = '2026-08-01';
  leads[5].status = '已转商机';
  leads[6].crmQualityNotes = [
    '来源国家字段出现大区名“Balkan”；保留原值，实际国家待业务确认，演示不自动转换。',
  ];
  const sales: SalesRecord[] = [...leads];
  for (let i = 0; i < 24; i++) {
    const c = customers[i % 12];
    const stage = STAGES[i % 6];
    sales.push({
      ...blankSales(`DEMO-O${String(i + 1).padStart(3, '0')}`, c.id, 'opportunity'),
      contactId: c.contacts[0].id,
      projectName: ['青山储能一期', '海岳100MW储能站', '欧洲工商业储能', '城市微电网'][i % 4],
      owner: ['张销售', '赵销售', '孙销售'][i % 3],
      ownerPersonId: identityForLegacyPlatformName(['张销售', '赵销售', '孙销售'][i % 3])?.personId,
      description: '客户拟建设储能项目，已完成需求沟通，容量及交付时间待持续确认。',
      capacity: 10 + i * 3,
      power: Math.round(((10 + i * 3) / 2) * 100) / 100,
      cellDemand: CELL_DEMAND_OPTIONS[i % CELL_DEMAND_OPTIONS.length],
      projectRegion: PROJECT_REGION_OPTIONS[i % PROJECT_REGION_OPTIONS.length],
      amount: (120 + i * 32) * 10000,
      currency: c.country === '中国' ? 'CNY' : 'EUR',
      grade: ['A', 'S', 'B1', 'B2'][i % 4],
      tender: i === 1 ? '是' : '否',
      expectedDate: `2026-${10 + (i % 3)}-${String(12 + (i % 15)).padStart(2, '0')}`,
      stage,
      status: stage === '赢单' || stage === '丢单' ? '已关闭' : '跟进中',
      createdDate: '2026-07-01',
      convertedDate: i < 3 ? '2026-08-01' : '2026-09-25',
      tradeTerm: i % 2 ? 'FOB' : 'CIF',
      reason: stage === '赢单' ? '方案与客户目标匹配' : stage === '丢单' ? '客户预算延期' : '',
      closedDate: stage === '赢单' || stage === '丢单' ? '2026-10-05' : '',
      team: i === 1 ? makeTeam() : [],
      g1: '未提交',
    });
  }
  // 稳定普通与投标起点，供教程和回归测试定位。
  const normal = sales.find((x) => x.id === 'DEMO-O001')!;
  normal.grade = 'A';
  normal.amount = 1000000;
  normal.expectedDate = '2026-11-15';
  sales.find((x) => x.id === 'DEMO-O006')!.leadId = leads[5].id;
  // 演示产品需求行来自模拟产品目录，编码选择后带出名称；单位为行级字段，按行手工填写。
  const catalogNeed = (id: string, code: string, quantity: number, unit: string): ProductNeed => {
    const item = PRODUCT_CATALOG.find((entry) => entry.code === code)!;
    return { id, model: item.code, name: item.name, quantity, unit };
  };
  const demoNeedsTarget = sales.find((x) => x.id === 'DEMO-O003')!;
  demoNeedsTarget.productNeeds = [
    catalogNeed('NEED-O003-1', 'ALPHA-BC-5015', 4, '台'),
    catalogNeed('NEED-O003-2', 'ALPHA-PCS-2500', 2, '台'),
    catalogNeed('NEED-O003-3', 'ALPHA-EMS-1000', 1, '套'),
  ];
  demoNeedsTarget.productNeedRevision = 1;
  const convertedDemo = sales.find((x) => x.id === 'DEMO-O006')!;
  convertedDemo.productNeeds = [
    catalogNeed('NEED-O006-1', 'ALPHA-CB-215', 6, '台'),
    catalogNeed('NEED-O006-2', 'ALPHA-BMS-200', 6, '套'),
  ];
  convertedDemo.productNeedRevision = 1;
  const tender = sales.find((x) => x.id === 'DEMO-O002')!;
  tender.stage = '意向沟通';
  tender.grade = 'S';
  tender.tender = '是';
  const signedIndices = [4, 10, 15, 18, 20, 23];
  for (const i of signedIndices) {
    const opp = sales.find((x) => x.id === `DEMO-O${String(i + 1).padStart(3, '0')}`)!;
    opp.stage = '赢单';
    opp.status = '已关闭';
    opp.reason = '方案及交期符合客户目标（样例）';
    opp.closedDate = '2026-10-05';
  }
  const contracts: Contract[] = signedIndices.map((index, i) => {
    const opp = sales.find((x) => x.id === `DEMO-O${String(index + 1).padStart(3, '0')}`)!;
    return {
      id: `DEMO-CON${String(i + 1).padStart(3, '0')}`,
      opportunityId: opp.id,
      customerId: opp.customerId,
      amount: opp.amount,
      currency: opp.currency,
      payment: '签约30% / 发货60% / 验收10%（样例）',
      penalty: '延期条款按演示合同约定，非正式合规规则',
      product: '储能柜及配套系统',
      g3: '已通过（模拟来源）',
    };
  });
  const projects = Array.from({ length: 8 }, (_, i) => {
    const contract = contracts[i === 1 ? 0 : i % 6];
    const p = blankProject(
      `DEMO-P${String(i + 1).padStart(3, '0')}`,
      contract.customerId,
      contract.opportunityId,
      contract.id,
    );
    p.name = [
      '青山储能一期',
      '青山储能二期',
      '北区工业园项目',
      '欧洲工商业储能',
      '海岳储能站',
      '南湾储能示范',
      '海外微电网',
      '城市储能交付',
    ][i];
    p.status = [
      '启动交底',
      '待启动',
      '设计生产',
      '物流交付',
      '现场调试',
      '客户验收',
      '内部移交',
      '已移交',
    ][i];
    p.accepted = i !== 1;
    p.plans = makePlans(p.id).map((row) =>
      i === 1 ? { ...row, status: '未开始', actual: '' } : row,
    );
    p.briefing.acceptance = '按合同配置与客户签字清单逐项确认';
    p.briefing.review = i === 0 ? '附条件通过' : i === 1 ? '待提交' : '通过';
    p.team = p.team.map((t) => ({ ...t, confirmed: i !== 1, confirmedBy: '王项目' }));
    if (i === 0)
      p.conditions = [
        {
          id: 'DEMO-CD001',
          text: '补齐客户现场接线图',
          owner: '周方案',
          due: '2026-10-18',
          evidence: '',
          closed: false,
        },
      ];
    for (const type of [
      '客户主节点',
      '产研来源',
      '要货发货',
      '调试备件',
      'FAT测试',
      '开票回款',
    ] as PlanType[]) {
      const row = blankPlan(type);
      row.id = `${p.id}-${type}`;
      row.name = (
        {
          客户主节点: '客户要求首批到货',
          产研来源: 'OTC生产排期（样例）',
          要货发货: '第一批储能柜',
          调试备件: '现场调试备件需求',
          FAT测试: '第一批出厂验收',
          开票回款: '发货里程碑款',
        } as Record<PlanType, string>
      )[type];
      row.owner = type === '要货发货' ? '陈物控' : type === 'FAT测试' ? '夏质量' : '王项目';
      row.sourceReference =
        type === '产研来源'
          ? 'OTC排期样例；原始导出字段待核'
          : type === '要货发货'
            ? 'SAP / 线下要货资料待补'
            : type === 'FAT测试'
              ? 'FAT计划 / 报告待补'
              : '项目离线来源待补';
      row.sourceStatus = '待核';
      if (type === '产研来源') row.sourceUpdatedAt = '2026-10-09';
      row.amount = type === '开票回款' ? 600000 : 0;
      row.quantity = 10;
      row.note =
        type === '产研来源'
          ? 'OTC导出样例 · 更新时间2026-10-09 · 来源字段待核 · 非实时数据'
          : type === '开票回款'
            ? 'S4样例：已开票400,000，已回款300,000；不执行真实指令'
            : '';
      row.warningLeadDays = 3;
      p.plans.push(row);
    }
    if (i >= 6) {
      p.sat = { date: '2026-10-08', result: '合格', complete: true };
      p.handover.categories = p.handover.categories.map((c) => ({
        ...c,
        status: '已有资料',
        note: '引用已有项目资料',
      }));
      p.handover.status = i === 7 ? '已接收' : '待接收';
    }
    return p;
  });
  const activities = [
    {
      id: 'CRM-DEMO-ACT-001',
      entityId: leads[0].id,
      customerId: leads[0].customerId,
      contactId: leads[0].contactId,
      date: '2026-10-08',
      type: 'CRM跟进记录样例',
      summary: '客户确认项目方向，需求资料待补充。',
      people: '张销售、陈客户',
      next: '补齐需求导入表',
      operator: 'CRM样例录入人员',
      operatorPersonId: 'crm-demo-creator-001',
      stage: '线索跟进',
    },
    ...sales
      .filter((x) => x.type === 'opportunity')
      .flatMap((x, i) =>
        i < 2
          ? []
          : [
              {
                id: `DEMO-ACT${i}`,
                entityId: x.id,
                customerId: x.customerId,
                contactId: x.contactId,
                date: i === 2 ? '2026-09-01' : '2026-10-08',
                type: '电话',
                summary: [
                  '已确认客户项目建设意向，下一步完善需求表',
                  '客户确认初版方案，等待报价沟通',
                  '客户反馈首批交付节点需同步物控',
                ][i % 3],
                people: x.owner,
                next: '按预计签单计划持续跟进',
                operator: x.owner,
                operatorPersonId: x.operatorPersonId,
                stage: x.stage,
              },
            ],
      ),
  ];
  for (const sale of sales) {
    const entityIds = [sale.id, sale.type === 'opportunity' ? sale.leadId : ''];
    const followUps = activities
      .filter((activity) => entityIds.includes(activity.entityId) && activity.type !== '内部备注')
      .sort((a, b) => b.date.localeCompare(a.date));
    const followUpDate = followUps[0]?.date || '';
    sale.crmFollowUpSnapshot = {
      source: 'CRM模拟样例',
      snapshotDate: BASE_DATE,
      followUpDate,
      followUpCount: followUps.length,
      daysSinceLastFollowUp: followUpDate
        ? Math.max(
            0,
            Math.floor(
              (Date.parse(`${BASE_DATE}T00:00:00`) - Date.parse(`${followUpDate}T00:00:00`)) /
                86400000,
            ),
          )
        : 0,
    };
  }
  const attachments = sales
    .filter((x) => x.type === 'opportunity')
    .map((x, i) => ({
      id: `DEMO-ATT${i}`,
      entityId: x.id,
      kind: '需求导入表',
      name: '演示_需求导入表.pdf',
      size: 1800,
      date: '2026-10-09',
      operator: x.owner,
      sample: true,
      url: '/samples/需求导入表.pdf',
    }));
  for (const p of projects.filter((_, i) => i !== 1))
    for (const kind of ['启动纪要', '启动文件'])
      attachments.push({
        id: newId('ATT'),
        entityId: p.id,
        kind,
        name: `演示_${kind}.pdf`,
        size: 1800,
        date: '2026-10-09',
        operator: '王项目',
        sample: true,
        url: `/samples/${kind}.pdf`,
      });
  for (const p of projects.filter((_, i) => i >= 6))
    attachments.push({
      id: newId('ATT'),
      entityId: p.id,
      kind: 'SAT报告',
      name: '演示_SAT报告.pdf',
      size: 1800,
      date: '2026-10-08',
      operator: '王项目',
      sample: true,
      url: '/samples/SAT报告.pdf',
    });
  const quoteExamples: {
    opportunityId: string;
    status: QuoteVersion['status'];
    taxMode?: string;
    withV2?: boolean;
    condition?: boolean;
    locked?: boolean;
  }[] = [
    { opportunityId: 'DEMO-O008', status: '草稿' },
    { opportunityId: 'DEMO-O014', status: '模拟审核通过' },
    { opportunityId: 'DEMO-O003', status: '草稿', taxMode: '含税待确认' },
    { opportunityId: 'DEMO-O009', status: '已记录发出', withV2: true },
    { opportunityId: 'DEMO-O010', status: '附条件通过', condition: true },
    { opportunityId: 'DEMO-O005', status: '最终锁定', locked: true },
  ];
  const quoteSeries: QuoteSeries[] = quoteExamples.map((example, index) => {
    const opportunity = sales.find((item) => item.id === example.opportunityId)!;
    opportunity.quoteFlowMode = 'v2';
    const makeVersion = (number: number, status: QuoteVersion['status']): QuoteVersion => {
      const id = `DEMO-QV-${String(index + 1).padStart(3, '0')}-${number}`;
      const accepted = status === '最终锁定';
      return {
        id,
        seriesId: `DEMO-Q-${String(index + 1).padStart(3, '0')}`,
        number,
        sourceVersionId: number > 1 ? `DEMO-QV-${String(index + 1).padStart(3, '0')}-1` : '',
        status,
        title: opportunity.projectName,
        sellerEntity: '演示储能科技有限公司',
        customerId: opportunity.customerId,
        contactId: opportunity.contactId,
        owner: opportunity.owner,
        country:
          customers.find((customer) => customer.id === opportunity.customerId)?.country || '中国',
        currency: opportunity.currency,
        tradeTerm: opportunity.tradeTerm || 'FOB',
        tradeNote: '',
        plannedSendDate: '2026-10-08',
        validUntil: '2026-10-30',
        scope: '储能系统设备供货及约定服务（样例）',
        delivery: '预计12周，正式交期以排产确认（样例）',
        payment: '签约30% / 发货60% / 验收10%（样例）',
        warranty: '质保期以正式合同为准（样例）',
        service: '远程指导及现场服务范围待确认',
        solutionSummary: '引用需求及方案资料，配置为演示示例。',
        boundaries: '不包含未列明的土建和现场改造。',
        notes: '',
        items:
          status === '草稿' && example.opportunityId === 'DEMO-O008'
            ? []
            : [
                {
                  id: `${id}-I1`,
                  category: '货物',
                  name: '储能系统',
                  spec: '配置见方案摘要',
                  unit: '套',
                  quantity: 1,
                  unitPrice: opportunity.amount || 1200000,
                  source: '演示报价样例',
                },
              ],
        freightAmount: 0,
        freightTreatment: '已含在明细',
        dutyAmount: 0,
        dutyTreatment: '进口方承担',
        otherFee: 0,
        otherFeeTreatment: '已含在明细',
        discount: 0,
        sourceAttachmentIds: [`DEMO-ATT${Number(opportunity.id.slice(-3)) - 1}`],
        taxMode: example.taxMode || '不含税报价',
        vatAmount: 0,
        taxNote: example.taxMode
          ? '交易主体和贸易链税务口径需财务确认。'
          : '不含税金额，税务承担按交易条件另行确认。',
        taxReview: example.taxMode ? '待财务确认' : '样例已确认',
        taxReviewBy: example.taxMode ? '' : '黄财务',
        taxReviewDate: example.taxMode ? '' : '2026-10-08',
        costs: {
          goods: null,
          logistics: null,
          delivery: null,
          service: null,
          source: '样例成本未提供；不计算毛利。',
        },
        reviewBy: status === '草稿' ? '' : '赵主管',
        reviewDate: status === '草稿' ? '' : '2026-10-08',
        reviewNote: status === '附条件通过' ? '请补充交期承诺依据。' : '方案及范围符合演示假设。',
        conditions: example.condition
          ? [
              {
                id: `${id}-C1`,
                text: '补充交期承诺依据',
                owner: '张销售',
                due: '2026-10-20',
                closed: false,
                closedBy: '',
              },
            ]
          : [],
        lockRequestedBy: '',
        lockRequestedDate: '',
        sentDate: ['已记录发出', '最终锁定'].includes(status) ? '2026-10-08' : '',
        sentMethod: ['已记录发出', '最终锁定'].includes(status) ? '邮件（手工发送）' : '',
        sentTo: ['已记录发出', '最终锁定'].includes(status) ? '客户联系人' : '',
        sentEvidence: ['已记录发出', '最终锁定'].includes(status) ? '演示文件报价单.pdf' : '',
        acceptedBy: accepted ? '客户联系人' : '',
        acceptedDate: accepted ? '2026-10-09' : '',
        acceptedEvidence: accepted ? '客户邮件确认（演示记录）' : '',
        lockedBy: accepted ? '赵主管' : '',
        lockedDate: accepted ? '2026-10-09' : '',
        invalidationReason: '',
        feedback:
          status === '已记录发出'
            ? [
                {
                  id: `${id}-F1`,
                  date: '2026-10-09',
                  kind: '价格',
                  summary: '客户希望调整折扣并保持交期。',
                  person: '客户联系人',
                  evidence: '',
                },
              ]
            : accepted
              ? [
                  {
                    id: `${id}-F1`,
                    date: '2026-10-09',
                    kind: '客户确认接受',
                    summary: '确认接受该报价版本。',
                    person: '客户联系人',
                    evidence: '客户邮件确认（演示记录）',
                  },
                ]
              : [],
        audit: [
          {
            id: `${id}-H1`,
            action: '预置演示报价状态',
            person: 'DEMO样例',
            date: '2026-10-08',
            note: '预置数据，不代表真实审批或客户交易',
          },
        ],
      };
    };
    const first = makeVersion(1, example.status);
    const versions = [first];
    if (example.withV2) versions.push(makeVersion(2, '草稿'));
    const final = example.locked ? first.id : '';
    const series: QuoteSeries = {
      id: first.seriesId,
      number: `DEMO-Q-${String(index + 1).padStart(3, '0')}`,
      opportunityId: opportunity.id,
      versions,
      activeFinalVersionId: final,
      createdBy: 'DEMO样例',
      createdDate: '2026-10-08',
    };
    if (example.locked) {
      const contract = contracts.find((item) => item.opportunityId === opportunity.id);
      if (contract) {
        contract.quoteVersionId = first.id;
        contract.quoteSeriesId = series.id;
      }
    }
    return series;
  });
  // V10新轮演示固定来源：明确的样例ID，绝不按名称或普通到货节点猜测。
  const customerDeliveryMappings: CustomerDeliveryMapping[] = [];
  projects.forEach((project, index) => {
    // 第三个项目刻意保留缺项，用于展示待核；不把旧到货主节点当作发货承诺。
    if (index === 2) return;
    for (const category of ['shipment', 'customerAcceptance'] as const) {
      const sourceId = category === 'shipment' ? `${project.id}-要货发货` : `${project.id}-W8`;
      const source = project.plans.find((plan) => plan.id === sourceId)!;
      const milestone = blankPlan('客户主节点');
      milestone.id = `${project.id}-V10-${category}`;
      milestone.name = category === 'shipment' ? '客户约定首批发货（模拟）' : '客户约定验收（模拟）';
      milestone.start = '2026-10-01';
      milestone.end = category === 'customerAcceptance' ? '2026-12-20' : '2026-11-20';
      milestone.expected = milestone.end;
      milestone.warningLeadDays = 5;
      milestone.sourceStatus = '模拟';
      milestone.sourceReference = 'V10固定客户承诺演示样例；非外围系统数据';
      source.customerMilestoneId = milestone.id;
      project.plans.push(milestone);
      customerDeliveryMappings.push({ id: `${project.id}-delivery-${category}`, projectId: project.id,
        planId: source.id, customerMilestoneId: milestone.id, category,
        source: 'V10新轮预置模拟关联', revision: 1 });
    }
  });
  const state = seedV4({
    customerDeliveryMappings,
    version: 2,
    quoteSchemaVersion: 1,
    dateMode: 'normal',
    planWarningReads: [],
    roughPlanTemplates: [
      { id: 'DEMO-RPT-STANDARD', name: '项目交期计算模板（CIF）', description: 'CIF 交付场景任务清单。', sourceFile: '项目交期计算模板.xlsx', status: '启用', tasks: [] },
      { id: 'DEMO-RPT-TENDER', name: '项目交期计算模板（DDP）', description: 'DDP 交付场景任务清单。', sourceFile: '项目交期计算模板.xlsx', status: '启用', tasks: [] },
    ],
    quoteSeries,
    role: 'sales',
    customers,
    sales,
    projects,
    contracts,
    activities,
    attachments,
    notices: [
      {
        id: 'DEMO-N001',
        key: 'initial-briefing',
        entityId: 'DEMO-P001',
        role: 'solution',
        title: '请补充现场接线图',
        text: '青山储能一期交底附条件通过，请在10月18日前补齐凭据。',
        read: false,
        resolved: false,
        date: BASE_DATE,
      },
      {
        id: 'DEMO-N002',
        key: 'initial-handover',
        entityId: 'DEMO-P007',
        role: 'receiver',
        title: '项目内部移交待接收',
        text: '请检查八类资料与遗留事项，确认收到或退回补充。',
        read: false,
        resolved: false,
        date: BASE_DATE,
      },
    ],
    history: [
      {
        id: 'DEMO-H001',
        entityId: 'DEMO-P001',
        operator: '李负责人',
        action: '应用OA模拟结果：附条件通过',
        date: '2026-10-09 10:20',
      },
    ],
  });
  initializeFinanceSources(state);
  return state;
}
