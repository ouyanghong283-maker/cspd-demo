import { inject, Injectable } from '@angular/core';
import { Router } from '@angular/router';
import {
  Activity,
  BASE_DATE,
  CELL_DEMAND_OPTIONS,
  Contact,
  Customer,
  Field,
  Project,
  PROJECT_REGION_OPTIONS,
  ROLES,
  SalesRecord,
  TeamMember,
} from './models';
import { blankSales, newId, makeTeam } from './seed';
import { DemoStore } from './store';
import { UiService } from './ui.service';
import { DEMO_IDENTITY_BINDINGS, identityForRole } from './identity';
import { INTERNAL_PEOPLE, peopleField, personField, PROJECT_MANAGERS } from './personnel';
import { needsTenderTeam } from './rules';
import {
  CUSTOMER_COUNTRIES,
  CUSTOMER_EMPLOYEE_SIZES,
  CUSTOMER_INDUSTRY_ROLES,
  CUSTOMER_REGIONS,
  CUSTOMER_STATUSES,
} from './customer-dictionaries';
const FOLLOW_LINKED_COUNTRY = '__follow_linked_country__';
@Injectable({ providedIn: 'root' })
export class BusinessForms {
  store = inject(DemoStore);
  ui = inject(UiService);
  router = inject(Router);
  newLead(): void {
    const role = this.store.role();
    const sampleCustomer = this.store.state().customers.find(
      (customer) => customer.name === '演示能源科技',
    );
    const customerOptions = this.store.state().customers.map((customer) => ({
      value: customer.id,
      label: `${customer.name} · ${customer.country} · ${customer.id}`,
    }));
    this.ui.open({
      title: '新建项目线索',
      description:
        '可创建线索草稿并手动选择负责人；客户和联系人以稳定ID关联，线索转换不会自动成为有效商机。',
      submitLabel: '保存线索草稿',
      fields: [
        {
          key: 'customer',
          label: '客户名称',
          required: true,
          hint: '输入客户名称后，请在下方明确选择已有客户或“新建独立客户”；名称相同或相近时先人工核对。',
        },
        {
          key: 'existingCustomerId',
          label: '客户关联（必须人工选择）',
          type: 'select',
          required: true,
          hint: '列表仅供核对，不会按名称自动关联或合并；确认新建时请选择“新建独立客户”。',
          options: [
            ...customerOptions,
            { value: '__new__', label: '新建独立客户（已核对名称相近项）' },
          ],
        },
        {
          key: 'country',
          label: '客户国家（新建客户时）',
          type: 'select',
          required: true,
          enabledWhen: { field: 'existingCustomerId', equals: '__new__' },
          disabledValue: FOLLOW_LINKED_COUNTRY,
          options: [
            {
              value: FOLLOW_LINKED_COUNTRY,
              label: '跟随关联（自动匹配关联客户档案中的国家）',
            },
            ...CUSTOMER_COUNTRIES,
          ],
          value: FOLLOW_LINKED_COUNTRY,
          hint: '关联已有客户时本项锁定并自动使用客户档案中的国家；仅“新建独立客户”时可选择具体国家。',
        },
        { key: 'project', label: '项目名称', hint: '例如：青山储能一期' },
        {
          key: 'owner',
          label: '实际销售负责人（可暂不分配）',
          type: 'select',
          options: [
            '',
            ...DEMO_IDENTITY_BINDINGS.filter((binding) => binding.role === 'sales').map(
              (binding) => binding.displayName,
            ),
          ],
          value: role === 'sales' ? identityForRole('sales')?.displayName || '' : '',
        },
        { key: 'contact', label: '联系人姓名' },
        { key: 'email', label: '联系邮箱', type: 'email' },
        {
          key: 'source',
          label: '线索来源',
          type: 'select',
          options: ['市场活动', '官网咨询', '客户推荐', '中间人', '自有开发'],
          value: '自有开发',
        },
        { key: 'description', label: '需求简述', type: 'textarea' },
      ],
      sample: {
        customer: '演示能源科技',
        existingCustomerId: sampleCustomer?.id || '__new__',
        country: sampleCustomer ? FOLLOW_LINKED_COUNTRY : '中国',
        project: '青山储能新增项目',
        owner: identityForRole('sales')?.displayName || '',
        contact: '陈客户',
        email: 'demo@example.com',
        source: '自有开发',
        description: '客户计划建设10MWh储能系统，需求表稍后补充。',
      },
      onSave: (d) => {
        if (d['contact'] && !d['email'])
          return this.ui.fail('新增联系人请填写邮箱；也可留空联系人稍后补充');
        const selectedCustomerId = d['existingCustomerId'];
        if (!selectedCustomerId)
          return this.ui.fail('请明确选择要关联的客户，或选择“新建独立客户”');
        // Selecting __new__ is the user's explicit choice to keep a separate customer record.
        const existingCustomer =
          selectedCustomerId === '__new__' ? undefined : this.store.customer(selectedCustomerId);
        if (selectedCustomerId !== '__new__' && !existingCustomer)
          return this.ui.fail('所选客户不存在，请重新选择或选择新建独立客户');
        if (d['country'] === FOLLOW_LINKED_COUNTRY && !existingCustomer)
          return this.ui.fail('选择“跟随关联”时需关联已有客户；新建独立客户请选择具体国家');
        if (
          existingCustomer &&
          !CUSTOMER_COUNTRIES.includes(
            existingCustomer.country as (typeof CUSTOMER_COUNTRIES)[number],
          )
        )
          return this.ui.fail(
            `关联客户的国家“${existingCustomer.country || '空'}”不在 CRM 可选范围，请先到客户管理更新该客户国家`,
          );
        let c = existingCustomer ? structuredClone(existingCustomer) : undefined;
        if (!c) {
          c = {
            id: newId('C'),
            name: d['customer'],
            shortName: d['customer'].slice(0, 4),
            country: d['country'],
            region: '',
            status: '潜在客户',
            owner: d['owner'] || this.store.person(),
            employeeSize: '',
            basicInfo: '',
            createdAt: BASE_DATE,
            createdBy: this.store.person(),
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
        }
        let selectedContact = c.contacts.find(
          (contact) => contact.name === d['contact'] && contact.email === d['email'],
        );
        if (d['contact'] && d['email'] && !selectedContact) {
          selectedContact = {
            id: newId('CT'),
            name: d['contact'],
            email: d['email'],
            phone: '',
            title: '',
            department: '',
            position: '',
          };
          c.contacts = [...c.contacts, selectedContact];
        }
        const lead = blankSales(newId('L'), c.id);
        Object.assign(lead, {
          projectName: d['project'],
          owner: d['owner'] || '',
          ownerPersonId: DEMO_IDENTITY_BINDINGS.find(
            (binding) => binding.role === 'sales' && binding.displayName === d['owner'],
          )?.personId,
          operator: this.store.person(),
          description: d['description'],
          source: d['source'] || '业务手动登记',
          crmSource: d['source'] || '自有开发',
          contactId: selectedContact?.id || '',
        });
        if (!this.store.saveSales(lead, c)) return false;
        this.router.navigate(['/sales/detail', lead.id]);
        return true;
      },
    });
  }
  editSales(record: SalesRecord): void {
    const customer = this.store.customer(record.customerId);
    const fields: Field[] = [
      {
        key: 'customer',
        label: '客户名称',
        type: 'select',
        required: true,
        options: this.store
          .state()
          .customers.map((c) => ({ value: c.id, label: `${c.name} · ${c.country} · ${c.id}` })),
        value: record.customerId,
      },
      {
        key: 'contact',
        label: '主要联系人',
        type: 'select',
        dependsOn: 'customer',
        optionsByValue: Object.fromEntries(
          this.store.state().customers.map((c) => [
            c.id,
            c.contacts.map((contact) => ({
              value: contact.id,
              label: `${contact.name} · ${contact.email || contact.phone || '联系方式待补'} · ${contact.id}`,
            })),
          ]),
        ),
        options: (customer?.contacts || []).map((contact) => ({
          value: contact.id,
          label: contact.name,
        })),
        value: this.store.contact(record)?.id || '',
      },
      { key: 'project', label: '项目名称', value: record.projectName },
      { key: 'capacity', label: '预计容量', type: 'number', min: 0, value: record.capacity },
      {
        key: 'unit',
        label: '容量单位',
        type: 'select',
        options: ['MWh', 'MW', 'kWh'],
        value: record.unit,
      },
      ...(record.type === 'opportunity'
        ? [
            {
              key: 'power',
              label: '功率 (MW)',
              type: 'number' as const,
              min: 0,
              value: record.power,
            },
            {
              key: 'cellDemand',
              label: '电芯需求',
              type: 'select' as const,
              options: [...CELL_DEMAND_OPTIONS],
              value: record.cellDemand || '',
            },
            {
              key: 'projectRegion',
              label: '所在区域（项目地区）',
              type: 'select' as const,
              options: [...PROJECT_REGION_OPTIONS],
              value: record.projectRegion || '',
            },
          ]
        : []),
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
        label: '人工判定等级',
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
      { key: 'description', label: '客户及项目背景', type: 'textarea', value: record.description },
    ];
    this.ui.open({
      title: record.type === 'lead' ? '完善线索信息' : '编辑商机信息',
      fields,
      sample: {
        project: '青山储能一期',
        capacity: 10,
        unit: 'MWh',
        ...(record.type === 'opportunity'
          ? { power: 5, cellDemand: '314B', projectRegion: 'DACH' }
          : {}),
        amount: 1000000,
        currency: 'CNY',
        expectedDate: '2026-11-15',
        grade: 'A',
        tender: '否',
        description: '客户建设工商业储能，需兼顾削峰填谷和应急备电。',
      },
      onSave: (d) => {
        const c = this.store.customer(d['customer']);
        if (!c) return this.ui.fail('请选择有效客户');
        return this.store.saveSales({
          ...structuredClone(record),
          customerId: c.id,
          contactId: d['contact'] || '',
          projectName: d['project'],
          owner: record.owner,
          capacity: Number(d['capacity'] || 0),
          unit: d['unit'],
          ...(record.type === 'opportunity'
            ? {
                power: Number(d['power'] || 0),
                cellDemand: d['cellDemand'] || '',
                projectRegion: d['projectRegion'] || '',
              }
            : {}),
          amount: Number(d['amount'] || 0),
          currency: d['currency'],
          expectedDate: d['expectedDate'],
          grade: d['grade'],
          tender: d['tender'],
          tradeTerm: d['tradeTerm'],
          description: d['description'],
        }, undefined, record.type === 'opportunity' ? '商机基本信息' : '线索基本信息');
      },
    });
  }
  assignLead(record: SalesRecord): void {
    if (record.type !== 'lead') return;
    const salesBindings = DEMO_IDENTITY_BINDINGS.filter((binding) => binding.role === 'sales');
    this.ui.open({
      title: '主管分配线索',
      description: '负责人使用演示身份ID保存；姓名仅用于显示。分配记录会写入操作日志。',
      fields: [
        {
          key: 'person',
          label: '销售负责人',
          type: 'select',
          options: salesBindings.map((binding) => binding.displayName),
          value: record.owner,
          required: true,
        },
        { key: 'reason', label: '分配原因', required: true, type: 'textarea' },
      ],
      onSave: (data) => {
        const target = salesBindings.find((binding) => binding.displayName === data['person']);
        return target ? this.store.assignLead(record.id, target.personId, data['reason']) : false;
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
          country: '',
          region: '',
          status: '潜在客户',
          owner: this.store.person(),
          employeeSize: '',
          basicInfo: '',
          createdAt: BASE_DATE,
          createdBy: this.store.person(),
          industry: 'Owner',
          address: '',
          contacts: [],
        };
    this.ui.open({
      title: customer ? '编辑客户资料' : '新建客户',
      description: customer
        ? '客户资料通过稳定客户编号关联线索和商机。联系人请到独立的联系人管理中维护。'
        : `当前客户列表有 ${this.store.state().customers.length} 条记录。保存前请核对名称相同或相近的客户；系统不会自动匹配或合并。`,
      fields: [
        {
          key: 'name',
          label: '客户名称',
          required: true,
          value: c.name,
          hint: customer ? '' : '请先人工核对客户列表中的同名或相近名称，再决定是否新建。',
        },
        { key: 'shortName', label: '客户简称', value: c.shortName },
        { key: 'email', label: '客户邮箱', type: 'email', value: c.email || '' },
        {
          key: 'country',
          label: '客户国家',
          type: 'select',
          required: true,
          options: [...CUSTOMER_COUNTRIES],
          value: CUSTOMER_COUNTRIES.includes(c.country as (typeof CUSTOMER_COUNTRIES)[number])
            ? c.country
            : '',
          hint: '使用客户国家下拉选项；历史值不在选项中时，请选择当前正确值。',
        },
        {
          key: 'region',
          label: '客户地区',
          type: 'select',
          options: [...CUSTOMER_REGIONS],
          value: c.region || '',
        },
        {
          key: 'industry',
          label: '行业角色',
          type: 'select',
          required: true,
          options: [...CUSTOMER_INDUSTRY_ROLES],
          value: c.industry,
        },
        {
          key: 'employeeSize',
          label: '客户人员规模',
          type: 'select',
          options: [...CUSTOMER_EMPLOYEE_SIZES],
          value: c.employeeSize || '',
        },
        {
          key: 'status',
          label: '客户状态',
          type: 'select',
          required: true,
          options: [...CUSTOMER_STATUSES],
          value: c.status || '潜在客户',
        },
        personField('owner', '销售负责人', c.owner || this.store.person(), true),
        { key: 'address', label: '客户地址', type: 'textarea', value: c.address },
        { key: 'basicInfo', label: '客户基本信息', type: 'textarea', value: c.basicInfo || '' },
      ],
      sample: {
        name: '青山能源科技',
        shortName: '青山能源',
        country: 'Germany',
        region: 'DACH',
        industry: 'Owner',
        employeeSize: '100-500',
        status: '潜在客户',
        owner: this.store.person(),
        address: 'Berlin, Germany',
        basicInfo: '客户主体背景和经营信息（演示）',
      },
      onSave: (d) => {
        return this.store.saveCustomer({
          ...c,
          name: d['name'],
          shortName: d['shortName'] || d['name'].slice(0, 4),
          email: d['email'],
          country: d['country'],
          region: d['region'],
          employeeSize: d['employeeSize'],
          status: d['status'],
          owner: d['owner'],
          industry: d['industry'],
          address: d['address'],
          basicInfo: d['basicInfo'],
          createdAt: c.createdAt || BASE_DATE,
          createdBy: c.createdBy || this.store.person(),
        });
      },
    });
  }
  addContact(customer?: Customer, contact?: Contact): void {
    const customerOptions = this.store.state().customers.map((item) => ({
      value: item.id,
      label: `${item.name} · ${item.country} · ${item.id}`,
    }));
    const selectedCustomer =
      customer ||
      (contact &&
        this.store
          .state()
          .customers.find((item) =>
            item.contacts.some((candidate) => candidate.id === contact.id),
          ));
    if (contact && !selectedCustomer) return void this.ui.fail('找不到联系人的关联客户');
    const initial = contact || {
      id: newId('CT'),
      name: '',
      title: '',
      department: '',
      position: '',
      phone: '',
      email: '',
      purchasingRole: '',
    };
    this.ui.open({
      title: contact ? '编辑联系人' : '新增联系人',
      description: selectedCustomer
        ? `此联系人关联客户：${selectedCustomer.name}。客户与联系人分别维护。`
        : '请选择所属客户。联系人会以独立编号保存在联系人管理中。',
      fields: [
        ...(!selectedCustomer
          ? [
              {
                key: 'customerId',
                label: '所属客户',
                type: 'select' as const,
                required: true,
                options: customerOptions,
              },
            ]
          : []),
        { key: 'name', label: '联系人姓名', required: true, value: initial.name },
        { key: 'title', label: '称谓', value: initial.title },
        { key: 'department', label: '部门', value: initial.department },
        { key: 'position', label: '岗位', value: initial.position },
        {
          key: 'purchasingRole',
          label: '采购作用（销售明确记录）',
          value: initial.purchasingRole || '',
          hint: '由销售手工填写；不根据称谓、部门或岗位推断。',
        },
        { key: 'phone', label: '手机号', value: initial.phone },
        { key: 'email', label: '邮箱', type: 'email', value: initial.email },
      ],
      ...(!contact
        ? {
            sample: {
              customerId: selectedCustomer?.id || customerOptions[0]?.value || '',
              name: '李采购',
              department: '采购部',
              position: '采购负责人',
              purchasingRole: '采购决策参与人（演示）',
              email: 'purchase@example.com',
            },
          }
        : {}),
      onSave: (d) => {
        const target = selectedCustomer || this.store.customer(d['customerId']);
        if (!target) return this.ui.fail('请先选择有效客户');
        return this.store.saveContact(target.id, {
          ...initial,
          name: d['name'],
          title: d['title'],
          department: d['department'],
          position: d['position'],
          purchasingRole: d['purchasingRole'],
          phone: d['phone'],
          email: d['email'],
        });
      },
    });
  }
  activity(id: string): void {
    const entity = this.store.sale(id) || this.store.project(id);
    const contacts = entity ? this.store.customer(entity.customerId)?.contacts || [] : [];
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
        peopleField('people', '参与人', this.store.person(), [
          ...INTERNAL_PEOPLE,
          ...contacts.map((contact) => contact.name),
        ]),
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
    const opportunity = this.store.sale(id);
    const requiredTenderTeam = opportunity?.type === 'opportunity' && needsTenderTeam(opportunity);
    this.ui.open({
      title: '手动选择协作人员与适用部门',
      description: requiredTenderTeam
        ? '该商机满足投标且A/S条件，三类协作角色都需确认参与；部门任务完成另行记录。人员和窗口仅为模拟。'
        : '手动选择适用部门和人员；参与确认与部门任务完成分别留痕，模拟窗口不锁定真实资源。',
      fields: team.flatMap((t, i) => [
        ...(!requiredTenderTeam
          ? [
              {
                key: `applicable${i}`,
                label: `${t.department}是否适用`,
                type: 'select' as const,
                options: ['适用', '不适用'],
                value: '适用',
                required: true,
              },
            ]
          : []),
        personField(
          `person${i}`,
          ROLES.find((r) => r.id === t.role)?.name || t.department,
          t.person,
          true,
          t.role === 'pm'
            ? PROJECT_MANAGERS
            : ROLES.filter((r) => r.id === t.role && r.id !== 'outsider').map((r) => r.person),
        ),
        { key: `window${i}`, label: '参与窗口 / 责任备注', value: t.window },
      ]),
      onSave: (d) =>
        this.store.assignTeam(
          id,
          team.flatMap((t, i) =>
            !requiredTenderTeam && d[`applicable${i}`] === '不适用'
              ? []
              : [
                  {
                    ...t,
                    person: d[`person${i}`],
                    window: d[`window${i}`],
                    confirmed: false,
                    confirmedBy: '',
                  },
                ],
          ),
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
        ...(result === '赢单'
          ? [{ key: 'income', label: '确认收入日期（可选）', type: 'date' as const }]
          : []),
      ],
      sample: {
        reason: result === '赢单' ? '方案与交期满足客户需求' : '客户预算延期，暂未推进',
        date: BASE_DATE,
      },
      onSave: (d) => this.store.closeSale(id, result, d['reason'], d['date'], d['income'] || ''),
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
