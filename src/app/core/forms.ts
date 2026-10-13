import { inject, Injectable } from '@angular/core';
import { Router } from '@angular/router';
import {
  Activity,
  BASE_DATE,
  Customer,
  Field,
  Project,
  ROLES,
  SalesRecord,
  TeamMember,
} from './models';
import { blankSales, newId, makeTeam } from './seed';
import { DemoStore } from './store';
import { UiService } from './ui.service';
@Injectable({ providedIn: 'root' })
export class BusinessForms {
  store = inject(DemoStore);
  ui = inject(UiService);
  router = inject(Router);
  newLead(): void {
    this.ui.open({
      title: '新建项目线索',
      description: '草稿只需要客户名称。联系方式与需求资料可以逐步补充。',
      submitLabel: '保存线索草稿',
      fields: [
        {
          key: 'customer',
          label: '客户名称',
          required: true,
          hint: '选择现有客户名称，或输入新客户名称',
        },
        { key: 'country', label: '国家 / 地区', value: '中国' },
        { key: 'project', label: '项目名称', hint: '例如：青山储能一期' },
        {
          key: 'owner',
          label: '实际销售负责人',
          type: 'select',
          options: ['张销售', '赵销售', '孙销售'],
          value: '张销售',
        },
        { key: 'contact', label: '联系人姓名' },
        { key: 'email', label: '联系邮箱', type: 'email' },
        {
          key: 'source',
          label: '线索来源',
          type: 'select',
          options: ['业务手动登记', '客户推荐', '展会交流', '官网咨询'],
          value: '业务手动登记',
        },
        { key: 'description', label: '需求简述', type: 'textarea' },
      ],
      sample: {
        customer: '演示能源科技',
        country: '中国',
        project: '青山储能新增项目',
        owner: '张销售',
        contact: '陈客户',
        email: 'demo@example.com',
        source: '业务手动登记',
        description: '客户计划建设10MWh储能系统，需求表稍后补充。',
      },
      onSave: (d) => {
        if (d['contact'] && !d['email']) return this.ui.fail('新增联系人请填写邮箱；也可留空联系人稍后补充');
        let c = this.store.state().customers.find((c) => c.name === d['customer']);
        if (!c) {
          c = {
            id: newId('C'),
            name: d['customer'],
            shortName: d['customer'].slice(0, 4),
            country: d['country'] || '中国',
            industry: 'Owner',
            address: '',
            contacts:
              d['contact'] && d['email']
                ? [
                    {
                      id: newId('CT'),
                      name: d['contact'],
                      email: d['email'],
                      phone: '',
                      title: '',
                      department: '',
                      position: '',
                    },
                  ]
                : [],
          };
          if (!this.store.saveCustomer(c)) return false;
        }
        let selectedContact = c.contacts.find((contact) => contact.name === d['contact']);
        if (d['contact'] && d['email'] && !selectedContact) {
          selectedContact = { id: newId('CT'), name: d['contact'], email: d['email'], phone: '', title: '', department: '', position: '' };
          c.contacts = [...c.contacts, selectedContact];
          if (!this.store.saveCustomer(c)) return false;
        }
        const lead = blankSales(newId('L'), c.id);
        Object.assign(lead, {
          projectName: d['project'],
          owner: d['owner'] || '张销售',
          operator: this.store.person(),
          description: d['description'],
          source: d['source'] || '业务手动登记',
          contactId: selectedContact?.id || '',
        });
        if (!this.store.saveSales(lead)) return false;
        this.router.navigate(['/sales/detail', lead.id]);
        return true;
      },
    });
  }
  editSales(record: SalesRecord): void {
    const customer = this.store.customer(record.customerId)!;
    const fields: Field[] = [
      {
        key: 'customer',
        label: '客户名称',
        type: 'select',
        required: true,
        options: this.store.state().customers.map((c) => c.name),
        value: customer.name,
      },
      {
        key: 'contact',
        label: '主要联系人',
        type: 'select',
        options: customer.contacts.map((c) => c.name),
        value: this.store.contact(record)?.name || '',
      },
      { key: 'project', label: '项目名称', value: record.projectName },
      {
        key: 'owner',
        label: '实际销售负责人',
        type: 'select',
        options: ['张销售', '赵销售', '孙销售'],
        value: record.owner,
      },
      { key: 'capacity', label: '预计容量', type: 'number', min: 0, value: record.capacity },
      {
        key: 'unit',
        label: '容量单位',
        type: 'select',
        options: ['MWh', 'MW', 'kWh'],
        value: record.unit,
      },
      { key: 'amount', label: '预计金额（元）', type: 'number', min: 0, value: record.amount },
      {
        key: 'currency',
        label: '币种',
        type: 'select',
        options: ['CNY', 'EUR', 'USD'],
        value: record.currency,
      },
      { key: 'expectedDate', label: '预计签单日期', type: 'date', value: record.expectedDate },
      {
        key: 'grade',
        label: '人工项目等级',
        type: 'select',
        options: ['S', 'A', 'B1', 'B2'],
        value: record.grade,
      },
      {
        key: 'tender',
        label: '是否投标',
        type: 'select',
        options: ['是', '否'],
        value: record.tender,
      },
      {
        key: 'tradeTerm',
        label: '贸易条款',
        type: 'select',
        options: ['FOB', 'CIF', '其他'],
        value: record.tradeTerm,
      },
      { key: 'competitor', label: '竞争对手（可选）', value: record.competitor },
      { key: 'description', label: '客户及项目背景', type: 'textarea', value: record.description },
    ];
    this.ui.open({
      title: record.type === 'lead' ? '完善线索信息' : '编辑商机信息',
      fields,
      sample: {
        project: '青山储能一期',
        capacity: 10,
        unit: 'MWh',
        amount: 1000000,
        currency: 'CNY',
        expectedDate: '2026-11-15',
        grade: 'A',
        tender: '否',
        description: '客户建设工商业储能，需兼顾削峰填谷和应急备电。',
      },
      onSave: (d) => {
        const c = this.store.state().customers.find((c) => c.name === d['customer'])!;
        return this.store.saveSales({
          ...structuredClone(record),
          customerId: c.id,
          contactId: c.contacts.find((c) => c.name === d['contact'])?.id || c.contacts[0]?.id || '',
          projectName: d['project'],
          owner: d['owner'],
          capacity: Number(d['capacity'] || 0),
          unit: d['unit'],
          amount: Number(d['amount'] || 0),
          currency: d['currency'],
          expectedDate: d['expectedDate'],
          grade: d['grade'],
          tender: d['tender'],
          tradeTerm: d['tradeTerm'],
          competitor: d['competitor'],
          description: d['description'],
        });
      },
    });
  }
  customer(customer?: Customer): void {
    const c = customer
      ? structuredClone(customer)
      : {
          id: newId('C'),
          name: '',
          shortName: '',
          country: '中国',
          industry: 'Owner',
          address: '',
          contacts: [],
        };
    const contact = c.contacts[0];
    this.ui.open({
      title: customer ? '编辑客户与主要联系人' : '新建客户',
      description: '共用客户资料，关联线索、商机和项目将同步引用。',
      fields: [
        { key: 'name', label: '客户名称', required: true, value: c.name },
        { key: 'shortName', label: '客户简称', value: c.shortName },
        { key: 'country', label: '国家 / 地区', required: true, value: c.country },
        {
          key: 'industry',
          label: '行业角色',
          type: 'select',
          options: ['EPC', 'Developer', 'Investor', 'Owner', 'Integrator'],
          value: c.industry,
        },
        { key: 'contact', label: '主要联系人姓名', value: contact?.name || '' },
        { key: 'title', label: '称谓', value: contact?.title || '' },
        { key: 'department', label: '部门', value: contact?.department || '' },
        { key: 'position', label: '岗位', value: contact?.position || '' },
        { key: 'phone', label: '联系电话', value: contact?.phone || '' },
        { key: 'email', label: '电子邮箱', type: 'email', value: contact?.email || '' },
        { key: 'address', label: '客户地址', type: 'textarea', value: c.address },
      ],
      sample: {
        name: '青山能源科技',
        shortName: '青山能源',
        country: '中国',
        industry: 'Owner',
        contact: '陈客户',
        department: '采购部',
        position: '项目经理',
        phone: '13900001234',
        email: 'customer@example.com',
      },
      onSave: (d) => {
        const contacts = [...c.contacts];
        if (d['contact']) {
          const first = {
            id: contact?.id || newId('CT'),
            name: d['contact'],
            title: d['title'],
            department: d['department'],
            position: d['position'],
            phone: d['phone'],
            email: d['email'],
          };
          if (contacts.length) contacts[0] = first;
          else contacts.push(first);
        }
        return this.store.saveCustomer({
          ...c,
          name: d['name'],
          shortName: d['shortName'] || d['name'].slice(0, 4),
          country: d['country'],
          industry: d['industry'],
          address: d['address'],
          contacts,
        });
      },
    });
  }
  addContact(customer: Customer): void {
    this.ui.open({
      title: '新增联系人',
      fields: [
        { key: 'name', label: '联系人姓名', required: true },
        { key: 'title', label: '称谓' },
        { key: 'department', label: '部门' },
        { key: 'position', label: '岗位' },
        { key: 'phone', label: '手机号' },
        { key: 'email', label: '邮箱', type: 'email' },
      ],
      sample: {
        name: '李采购',
        department: '采购部',
        position: '采购负责人',
        email: 'purchase@example.com',
      },
      onSave: (d) =>
        this.store.saveCustomer({
          ...structuredClone(customer),
          contacts: [
            ...customer.contacts,
            {
              id: newId('CT'),
              name: d['name'],
              title: d['title'],
              department: d['department'],
              position: d['position'],
              phone: d['phone'],
              email: d['email'],
            },
          ],
        }),
    });
  }
  activity(id: string): void {
    this.ui.open({
      title: '记录客户沟通',
      description: '电话、邮件、会议或普通纪要均可。未来日期不能解除冷却提醒。',
      fields: [
        { key: 'date', label: '沟通日期', type: 'date', required: true, value: BASE_DATE },
        {
          key: 'type',
          label: '沟通类型',
          type: 'select',
          required: true,
          options: ['电话', '邮件', '拜访', '会议', '方案交流', '内部备注'],
          value: '电话',
        },
        { key: 'people', label: '参与人', value: this.store.person() },
        { key: 'summary', label: '沟通结论 / 摘要', type: 'textarea', required: true },
        { key: 'next', label: '下一步（可选）', type: 'textarea' },
      ],
      sample: {
        date: BASE_DATE,
        type: '电话',
        people: this.store.person(),
        summary: '客户确认本轮沟通结果，下一步完善方案及交付计划。',
        next: '下周继续确认商务条款',
      },
      onSave: (d) =>
        this.store.addActivity(id, {
          date: d['date'],
          type: d['type'],
          summary: d['summary'],
          people: d['people'],
          next: d['next'],
        }),
    });
  }
  assignTeam(id: string): void {
    const object = this.store.sale(id) || this.store.project(id)!;
    const team = object.team.length ? structuredClone(object.team) : makeTeam();
    this.ui.open({
      title: '部门负责人指定项目团队',
      description: '指定人员后，需要成员确认参与；交付项目由PM确认成员。',
      fields: team.flatMap((t, i) => [
        {
          key: `person${i}`,
          label: ROLES.find((r) => r.id === t.role)?.name || t.department,
          type: 'select' as const,
          options: [t.person, ROLES.find((r) => r.id === t.role)?.person || t.person].filter(
            (x, i, a) => a.indexOf(x) === i,
          ),
          value: t.person,
          required: true,
        },
        { key: `window${i}`, label: '参与窗口 / 责任备注', value: t.window },
      ]),
      onSave: (d) =>
        this.store.assignTeam(
          id,
          team.map((t, i) => ({
            ...t,
            person: d[`person${i}`],
            window: d[`window${i}`],
            confirmed: false,
            confirmedBy: '',
          })),
        ),
    });
  }
  close(id: string, result: '赢单' | '丢单'): void {
    this.ui.open({
      title: `记录${result}`,
      description: '关闭原因用于主管分析。赢单不是合同审批或收入确认。',
      submitLabel: `确认${result}`,
      fields: [
        { key: 'reason', label: '关闭原因', type: 'textarea', required: true },
        {
          key: 'date',
          label: '成交 / 关闭日期',
          type: 'date',
          required: result === '赢单',
          value: BASE_DATE,
        },
        { key: 'income', label: '确认收入日期（可选）', type: 'date' },
      ],
      sample: {
        reason: result === '赢单' ? '方案与交期满足客户需求' : '客户预算延期，暂未推进',
        date: BASE_DATE,
      },
      onSave: (d) => this.store.closeSale(id, result, d['reason'], d['date'], d['income']),
    });
  }
  project(project: Project): void {
    this.ui.open({
      title: '补充项目现场与交底信息',
      fields: [
        { key: 'site', label: '现场地址', required: true, value: project.site },
        {
          key: 'siteConditions',
          label: '现场条件',
          type: 'textarea',
          value: project.siteConditions,
        },
        { key: 'start', label: '计划启动日期', type: 'date', value: project.start },
        {
          key: 'acceptance',
          label: '验收标准',
          type: 'textarea',
          value: project.briefing.acceptance,
        },
        { key: 'production', label: '订单生产周期', value: project.briefing.production },
        { key: 'shipping', label: '发货周期', value: project.briefing.shipping },
        {
          key: 'commissioning',
          label: '调试交期',
          type: 'date',
          value: project.briefing.commissioning,
        },
      ],
      sample: {
        site: '江苏省苏州市工业园区，演示现场',
        siteConditions: '具备卸货及进场条件',
        start: '2026-10-12',
        acceptance: '按配置清单逐项核对，现场测试合格并取得客户签字凭据',
        production: '45个工作日（演示）',
        shipping: '15个工作日（演示）',
        commissioning: '2026-11-20',
      },
      onSave: (d) =>
        this.store.saveProject({
          ...structuredClone(project),
          site: d['site'],
          siteConditions: d['siteConditions'],
          start: d['start'],
          briefing: {
            ...project.briefing,
            acceptance: d['acceptance'],
            production: d['production'],
            shipping: d['shipping'],
            commissioning: d['commissioning'],
          },
        }),
    });
  }
}
