import { Contract } from './models';

/** Local display fixture for the legacy demonstration contract. Stored values always win.
 * Does not invent signatures, approvals, attachment files, or business events.
 */
export function contractDemoDetails(contract: Contract): Contract {
  if (contract.id !== 'DEMO-CON001') return contract;
  const sample: Partial<Contract> = {
    title: '青山储能一期设备采购合同',
    sellerEntity: '沃太能源股份有限公司',
    customerAdoptedName: '远景工业园',
    scope:
      '工商业储能柜、能量管理系统（EMS）、配电及通信附件；含现场安装指导、系统联调与操作培训。最终配置以技术协议为准。',
    delivery:
      '计划于 2026-11-20 前送达江苏苏州项目现场；交货前 7 个工作日确认收货窗口，包装及运输保险由供方负责。',
    warranty: '设备验收后 60 个月质保；电池性能保障及更换条件以双方确认的技术协议为准。',
    service:
      '工作日 09:00–18:00 提供远程支持；故障报修 4 小时内响应，必要时 48 小时内安排现场服务。',
    plannedSignDate: '2026-10-20',
    note: '设备清单、接入条件及验收标准随合同技术协议确认；客户在发货前完成现场基础及接线准备。',
  };
  const fields = {
    alp_contractcode: 'CSPD-CN-2026-001',
    alp_contracttype: 30,
    alp_bdmanager: { id: 'demo-person-sales-zhao', name: '赵销售', entityType: 'systemuser' },
    alp_recipient_po: 'PO-YJ-202610-018',
    alp_homeregion: { id: 'DEMO-REGION-EAST', name: '中国 · 华东大区', entityType: 'businessunit' },
    alp_salesbranch: {
      id: 'DEMO-SALES-CN',
      name: '中国区工商业储能事业部',
      entityType: 'alp_sales_organization',
    },
    alp_quotation_type: 10,
    alp_trade_terms: 749010002,
    alp_isexclusiveagency: 0,
    alp_customermail: 'procurement@yuanjing.example.com',
    alp_customerphone: '0512-6800-2618',
    alp_country: { id: 'DEMO-COUNTRY-CN', name: '中国', entityType: 'alp_country' },
    alp_address: '江苏省苏州市高新区青山路 168 号 · 远景工业园一期',
    alp_signatory: {
      id: 'DEMO-SIGNATORY-01',
      name: '陈明 · 授权代表（拟）',
      entityType: 'systemuser',
    },
    alp_startdate: '2026-10-20',
    alp_enddate: '2027-10-19',
    alp_renewalreminderdate: '2027-09-19',
    alp_version: 1,
    alp_contractsource_type: 20,
    alp_changereason: '首版合同，暂无变更',
  };
  const next = { ...contract };
  for (const [key, value] of Object.entries(sample)) {
    if (next[key as keyof Contract] === undefined || next[key as keyof Contract] === '')
      Object.assign(next, { [key]: value });
  }
  if (next.penalty === '延期条款按演示合同约定，非正式合规规则')
    next.penalty =
      '供方原因导致延期交付的，每延迟一周按延期部分货款的 0.5% 支付违约金，累计不超过延期部分货款的 5%；不可抗力按双方约定处理。';
  next.crmFields = { ...fields, ...contract.crmFields };
  return next;
}
