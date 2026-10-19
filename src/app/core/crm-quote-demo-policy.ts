import { CrmValues } from './crm-quote-schema';

/** User-approved fallback for unverified CRM persistence/history behavior, not CRM evidence. */
export const CRM_QUOTE_DEMO_POLICY = {
  id: 'demo-fixed-v1' as const,
  label: '固定演示口径 V1',
  notice: '未取得证据的舍入行为采用固定演示口径；历史报价金额保留原值。',
};

/** Existing local policy, explicitly separated from the independently obtained source formula. */
export function roundCrmDemoValue(value: number, precision: number): number {
  const scale = 10 ** precision;
  return Math.round(value * scale) / scale;
}

/** Synthetic inputs and fixed expected outputs. No CRM record IDs or historical corrections. */
export const CRM_QUOTE_DEMO_CASES: readonly {
  id: string;
  label: string;
  currency: string;
  unit: string;
  description: string;
  input: CrmValues;
  expected: CrmValues;
}[] = [
  {
    id: 'DEMO-CALC-01',
    label: '折扣与中间精度',
    currency: 'EUR',
    unit: '件（演示）',
    description:
      '8件，未税单价100，整行特殊折扣135，税率13%；保存后折后未税单价83.13，总未税665.00，含税751.45。',
    input: {
      quantity: 8,
      alp_priceperunit: 100,
      alp_beforedispriceintax: 113,
      alp_isintax: 10,
      alp_taxpercentage: 13,
      alp_special_discounts: 135,
      alp_refercostup: 50,
    },
    expected: {
      alp_afterdiscountamount: 83.13,
      alp_afterdispriceintax: 93.93,
      alp_afterdistotal: 665,
      alp_afterdistotalintax: 751.45,
      alp_refertotalcost: 400,
    },
  },
  {
    id: 'DEMO-CALC-02',
    label: '小额金额汇总',
    currency: 'CNY',
    unit: '件（演示）',
    description: '3件，未税单价0.10，含税单价0.11，税率10%；总未税0.30，含税0.33，税额0.03。',
    input: {
      quantity: 3,
      alp_priceperunit: 0.1,
      alp_beforedispriceintax: 0.11,
      alp_isintax: 10,
      alp_taxpercentage: 10,
      alp_refercostup: 0.05,
    },
    expected: {
      alp_afterdiscountamount: 0.1,
      alp_afterdispriceintax: 0.11,
      alp_afterdistotal: 0.3,
      alp_afterdistotalintax: 0.33,
      alp_refertotalcost: 0.15,
    },
  },
];
