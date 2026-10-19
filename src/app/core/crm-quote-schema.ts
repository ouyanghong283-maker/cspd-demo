// Generated from the specified standard Dynamics CRM forms; no network access at runtime.
export type CrmValue = string | number | boolean | null;
export type CrmValues = Record<string, CrmValue>;
export interface CrmField {
  name: string; label: string; group: string; type: string;
  required: boolean; visible: boolean; readonly: boolean;
  precision: number | null; min: number | null; max: number | null;
  maxLength: number | null; targets: string[];
  options: {label: string; value: number}[];
}
export const CRM_QUOTE_SOURCE = 'doc/字段资料/V7_CRM只读取证/';
export const CRM_SUMMARY_FIELDS: readonly CrmField[] = [
  {
    "name": "quotenumber",
    "label": "报价单 ID",
    "group": "基础信息",
    "type": "string",
    "required": true,
    "visible": true,
    "readonly": true,
    "precision": null,
    "min": null,
    "max": null,
    "maxLength": 100,
    "targets": [],
    "options": []
  },
  {
    "name": "revisionnumber",
    "label": "报价单版本",
    "group": "基础信息",
    "type": "integer",
    "required": true,
    "visible": true,
    "readonly": true,
    "precision": 0,
    "min": 1,
    "max": 2147483647,
    "maxLength": null,
    "targets": [],
    "options": []
  },
  {
    "name": "opportunityid",
    "label": "关联商机",
    "group": "基础信息",
    "type": "lookup",
    "required": true,
    "visible": true,
    "readonly": true,
    "precision": null,
    "min": null,
    "max": null,
    "maxLength": null,
    "targets": [
      "opportunity"
    ],
    "options": []
  },
  {
    "name": "alp_exports",
    "label": "是否贸易出口",
    "group": "基础信息",
    "type": "boolean",
    "required": false,
    "visible": true,
    "readonly": true,
    "precision": null,
    "min": null,
    "max": null,
    "maxLength": null,
    "targets": [],
    "options": [
      {
        "label": "No",
        "value": 0
      },
      {
        "label": "Yes",
        "value": 1
      }
    ]
  },
  {
    "name": "transactioncurrencyid",
    "label": "币种",
    "group": "基础信息",
    "type": "lookup",
    "required": true,
    "visible": true,
    "readonly": false,
    "precision": null,
    "min": null,
    "max": null,
    "maxLength": null,
    "targets": [
      "transactioncurrency"
    ],
    "options": []
  },
  {
    "name": "alp_price_list",
    "label": "关联价目表",
    "group": "基础信息",
    "type": "lookup",
    "required": true,
    "visible": true,
    "readonly": false,
    "precision": null,
    "min": null,
    "max": null,
    "maxLength": null,
    "targets": [
      "alp_pricelevel"
    ],
    "options": []
  },
  {
    "name": "alp_sku_pricelevelid",
    "label": "SKU定价",
    "group": "基础信息",
    "type": "lookup",
    "required": false,
    "visible": true,
    "readonly": true,
    "precision": null,
    "min": null,
    "max": null,
    "maxLength": null,
    "targets": [
      "alp_sku_pricelevel"
    ],
    "options": []
  },
  {
    "name": "msdyn_ordertype",
    "label": "类型",
    "group": "基础信息",
    "type": "optionset",
    "required": false,
    "visible": false,
    "readonly": false,
    "precision": null,
    "min": null,
    "max": null,
    "maxLength": null,
    "targets": [],
    "options": [
      {
        "label": "基于项目",
        "value": 192350000
      },
      {
        "label": "基于维护服务",
        "value": 690970002
      }
    ]
  },
  {
    "name": "alp_quotation_type",
    "label": "报价类型",
    "group": "基础信息",
    "type": "optionset",
    "required": true,
    "visible": true,
    "readonly": false,
    "precision": null,
    "min": null,
    "max": null,
    "maxLength": null,
    "targets": [],
    "options": [
      {
        "label": "单次报价",
        "value": 10
      },
      {
        "label": "批量报价",
        "value": 20
      }
    ]
  },
  {
    "name": "alp_trade_terms",
    "label": "贸易条款",
    "group": "基础信息",
    "type": "optionset",
    "required": true,
    "visible": true,
    "readonly": false,
    "precision": null,
    "min": null,
    "max": null,
    "maxLength": null,
    "targets": [],
    "options": [
      {
        "label": "CFR",
        "value": 749010000
      },
      {
        "label": "CIF",
        "value": 749010001
      },
      {
        "label": "DAP",
        "value": 749010002
      },
      {
        "label": "NX",
        "value": 749010003
      },
      {
        "label": "CIP",
        "value": 749010004
      },
      {
        "label": "CPT",
        "value": 749010005
      },
      {
        "label": "DAF",
        "value": 749010006
      },
      {
        "label": "DDP",
        "value": 749010007
      },
      {
        "label": "DDU",
        "value": 749010008
      },
      {
        "label": "DEQ",
        "value": 749010009
      },
      {
        "label": "DES",
        "value": 749010010
      },
      {
        "label": "EXW",
        "value": 749010011
      },
      {
        "label": "FAS",
        "value": 749010012
      },
      {
        "label": "FCA",
        "value": 749010013
      },
      {
        "label": "FH",
        "value": 749010014
      },
      {
        "label": "FOB",
        "value": 749010015
      },
      {
        "label": "UN",
        "value": 749010016
      }
    ]
  },
  {
    "name": "alp_paymenttermsid",
    "label": "支付条款",
    "group": "基础信息",
    "type": "lookup",
    "required": true,
    "visible": true,
    "readonly": false,
    "precision": null,
    "min": null,
    "max": null,
    "maxLength": null,
    "targets": [
      "alp_paymentterms"
    ],
    "options": []
  },
  {
    "name": "alp_paymentitem",
    "label": "付款方式",
    "group": "基础信息",
    "type": "string",
    "required": false,
    "visible": true,
    "readonly": false,
    "precision": null,
    "min": null,
    "max": null,
    "maxLength": 100,
    "targets": [],
    "options": []
  },
  {
    "name": "alp_port",
    "label": "港口",
    "group": "基础信息",
    "type": "string",
    "required": false,
    "visible": true,
    "readonly": false,
    "precision": null,
    "min": null,
    "max": null,
    "maxLength": 100,
    "targets": [],
    "options": []
  },
  {
    "name": "alp_isintax",
    "label": "是否含税",
    "group": "基础信息",
    "type": "optionset",
    "required": true,
    "visible": true,
    "readonly": false,
    "precision": null,
    "min": null,
    "max": null,
    "maxLength": null,
    "targets": [],
    "options": [
      {
        "label": "含税",
        "value": 10
      },
      {
        "label": "未税",
        "value": 20
      }
    ]
  },
  {
    "name": "alp_tax_rate",
    "label": "税率（%）",
    "group": "基础信息",
    "type": "decimal",
    "required": true,
    "visible": true,
    "readonly": false,
    "precision": 2,
    "min": -100000000000,
    "max": 100000000000,
    "maxLength": null,
    "targets": [],
    "options": []
  },
  {
    "name": "alp_quototalpriceofftax",
    "label": "报价总金额（未税）",
    "group": "基础信息",
    "type": "decimal",
    "required": false,
    "visible": true,
    "readonly": true,
    "precision": 2,
    "min": -100000000000,
    "max": 100000000000,
    "maxLength": null,
    "targets": [],
    "options": []
  },
  {
    "name": "alp_quototalpriceintax",
    "label": "报价总金额（含税）",
    "group": "基础信息",
    "type": "decimal",
    "required": false,
    "visible": true,
    "readonly": true,
    "precision": 2,
    "min": -100000000000,
    "max": 100000000000,
    "maxLength": null,
    "targets": [],
    "options": []
  },
  {
    "name": "alp_total_shipping_cost",
    "label": "运费总价",
    "group": "基础信息",
    "type": "decimal",
    "required": false,
    "visible": true,
    "readonly": true,
    "precision": 2,
    "min": -100000000000,
    "max": 100000000000,
    "maxLength": null,
    "targets": [],
    "options": []
  },
  {
    "name": "alp_quotetotalamount",
    "label": "报价单总金额(含税含运费)",
    "group": "基础信息",
    "type": "decimal",
    "required": false,
    "visible": false,
    "readonly": true,
    "precision": 2,
    "min": -100000000000,
    "max": 100000000000,
    "maxLength": null,
    "targets": [],
    "options": []
  },
  {
    "name": "alp_taxfee",
    "label": "税费",
    "group": "基础信息",
    "type": "decimal",
    "required": false,
    "visible": true,
    "readonly": true,
    "precision": 2,
    "min": -100000000000,
    "max": 100000000000,
    "maxLength": null,
    "targets": [],
    "options": []
  },
  {
    "name": "alp_totalgrossprofit",
    "label": "整单毛利(%)",
    "group": "基础信息",
    "type": "decimal",
    "required": false,
    "visible": true,
    "readonly": true,
    "precision": 2,
    "min": -100000000000,
    "max": 100000000000,
    "maxLength": null,
    "targets": [],
    "options": []
  },
  {
    "name": "effectivefrom",
    "label": "生效日期",
    "group": "基础信息",
    "type": "datetime",
    "required": false,
    "visible": true,
    "readonly": true,
    "precision": null,
    "min": null,
    "max": null,
    "maxLength": null,
    "targets": [],
    "options": []
  },
  {
    "name": "closedon",
    "label": "失效日期",
    "group": "基础信息",
    "type": "datetime",
    "required": false,
    "visible": true,
    "readonly": false,
    "precision": null,
    "min": null,
    "max": null,
    "maxLength": null,
    "targets": [],
    "options": []
  },
  {
    "name": "alp_reason",
    "label": "低于指导价原因",
    "group": "基础信息",
    "type": "memo",
    "required": false,
    "visible": true,
    "readonly": false,
    "precision": null,
    "min": null,
    "max": null,
    "maxLength": 2000,
    "targets": [],
    "options": []
  },
  {
    "name": "customerid",
    "label": "客户姓名",
    "group": "客户信息",
    "type": "lookup",
    "required": true,
    "visible": true,
    "readonly": false,
    "precision": null,
    "min": null,
    "max": null,
    "maxLength": null,
    "targets": [
      "account",
      "contact"
    ],
    "options": []
  },
  {
    "name": "alp_bdmanager",
    "label": "客户经理",
    "group": "客户信息",
    "type": "lookup",
    "required": false,
    "visible": true,
    "readonly": false,
    "precision": null,
    "min": null,
    "max": null,
    "maxLength": null,
    "targets": [
      "systemuser"
    ],
    "options": []
  },
  {
    "name": "alp_salesbranch",
    "label": "销售组织",
    "group": "客户信息",
    "type": "lookup",
    "required": false,
    "visible": true,
    "readonly": false,
    "precision": null,
    "min": null,
    "max": null,
    "maxLength": null,
    "targets": [
      "alp_sales_organization"
    ],
    "options": []
  },
  {
    "name": "alp_deliverydate",
    "label": "期望交期",
    "group": "客户信息",
    "type": "datetime",
    "required": false,
    "visible": true,
    "readonly": false,
    "precision": null,
    "min": null,
    "max": null,
    "maxLength": null,
    "targets": [],
    "options": []
  },
  {
    "name": "alp_customerphonenum",
    "label": "客户电话",
    "group": "客户信息",
    "type": "string",
    "required": false,
    "visible": true,
    "readonly": false,
    "precision": null,
    "min": null,
    "max": null,
    "maxLength": 100,
    "targets": [],
    "options": []
  },
  {
    "name": "alp_customeremail",
    "label": "客户邮箱",
    "group": "客户信息",
    "type": "string",
    "required": false,
    "visible": true,
    "readonly": false,
    "precision": null,
    "min": null,
    "max": null,
    "maxLength": 100,
    "targets": [],
    "options": []
  },
  {
    "name": "shipto_line1",
    "label": "送至街道 1",
    "group": "送货地址",
    "type": "string",
    "required": false,
    "visible": true,
    "readonly": false,
    "precision": null,
    "min": null,
    "max": null,
    "maxLength": 250,
    "targets": [],
    "options": []
  },
  {
    "name": "shipto_line2",
    "label": "送至街道 2",
    "group": "送货地址",
    "type": "string",
    "required": false,
    "visible": true,
    "readonly": false,
    "precision": null,
    "min": null,
    "max": null,
    "maxLength": 250,
    "targets": [],
    "options": []
  },
  {
    "name": "shipto_line3",
    "label": "送至街道 3",
    "group": "送货地址",
    "type": "string",
    "required": false,
    "visible": true,
    "readonly": false,
    "precision": null,
    "min": null,
    "max": null,
    "maxLength": 250,
    "targets": [],
    "options": []
  },
  {
    "name": "shipto_city",
    "label": "送至市/县",
    "group": "送货地址",
    "type": "string",
    "required": false,
    "visible": true,
    "readonly": false,
    "precision": null,
    "min": null,
    "max": null,
    "maxLength": 80,
    "targets": [],
    "options": []
  },
  {
    "name": "shipto_stateorprovince",
    "label": "送至省/市/自治区",
    "group": "送货地址",
    "type": "string",
    "required": false,
    "visible": true,
    "readonly": false,
    "precision": null,
    "min": null,
    "max": null,
    "maxLength": 50,
    "targets": [],
    "options": []
  },
  {
    "name": "shipto_postalcode",
    "label": "送货地的邮政编码",
    "group": "送货地址",
    "type": "string",
    "required": false,
    "visible": true,
    "readonly": false,
    "precision": null,
    "min": null,
    "max": null,
    "maxLength": 20,
    "targets": [],
    "options": []
  },
  {
    "name": "shipto_country",
    "label": "送至国家/地区",
    "group": "送货地址",
    "type": "string",
    "required": false,
    "visible": true,
    "readonly": false,
    "precision": null,
    "min": null,
    "max": null,
    "maxLength": 80,
    "targets": [],
    "options": []
  },
  {
    "name": "alp_approvedad",
    "label": "审批意见",
    "group": "客户需求信息",
    "type": "memo",
    "required": false,
    "visible": true,
    "readonly": false,
    "precision": null,
    "min": null,
    "max": null,
    "maxLength": 2000,
    "targets": [],
    "options": []
  },
  {
    "name": "description",
    "label": "说明",
    "group": "客户需求信息",
    "type": "memo",
    "required": false,
    "visible": true,
    "readonly": false,
    "precision": null,
    "min": null,
    "max": null,
    "maxLength": 2000,
    "targets": [],
    "options": []
  }
];
export const CRM_DETAIL_FIELDS: readonly CrmField[] = [
  {
    "name": "alp_skuid",
    "label": "SKU",
    "group": "报价单详细信息",
    "type": "lookup",
    "required": false,
    "visible": true,
    "readonly": false,
    "precision": null,
    "min": null,
    "max": null,
    "maxLength": null,
    "targets": [
      "alp_product_model"
    ],
    "options": []
  },
  {
    "name": "alp_quotedetailnumber",
    "label": "报价单明细ID",
    "group": "报价单详细信息",
    "type": "string",
    "required": false,
    "visible": true,
    "readonly": true,
    "precision": null,
    "min": null,
    "max": null,
    "maxLength": 100,
    "targets": [],
    "options": []
  },
  {
    "name": "alp_productcode",
    "label": "产品名称",
    "group": "报价单详细信息",
    "type": "lookup",
    "required": true,
    "visible": true,
    "readonly": false,
    "precision": null,
    "min": null,
    "max": null,
    "maxLength": null,
    "targets": [
      "product"
    ],
    "options": []
  },
  {
    "name": "quoteid",
    "label": "报价单",
    "group": "报价单详细信息",
    "type": "lookup",
    "required": true,
    "visible": true,
    "readonly": true,
    "precision": null,
    "min": null,
    "max": null,
    "maxLength": null,
    "targets": [
      "quote"
    ],
    "options": []
  },
  {
    "name": "transactioncurrencyid",
    "label": "币种",
    "group": "报价单详细信息",
    "type": "lookup",
    "required": false,
    "visible": true,
    "readonly": true,
    "precision": null,
    "min": null,
    "max": null,
    "maxLength": null,
    "targets": [
      "transactioncurrency"
    ],
    "options": []
  },
  {
    "name": "productname",
    "label": "产品名称",
    "group": "报价单详细信息",
    "type": "string",
    "required": false,
    "visible": false,
    "readonly": false,
    "precision": null,
    "min": null,
    "max": null,
    "maxLength": 500,
    "targets": [],
    "options": []
  },
  {
    "name": "alp_salesguidanceprice",
    "label": "销售指导价",
    "group": "报价单详细信息",
    "type": "decimal",
    "required": false,
    "visible": true,
    "readonly": true,
    "precision": 2,
    "min": -100000000000,
    "max": 100000000000,
    "maxLength": null,
    "targets": [],
    "options": []
  },
  {
    "name": "alp_product_description",
    "label": "产品描述",
    "group": "报价单详细信息",
    "type": "memo",
    "required": false,
    "visible": true,
    "readonly": false,
    "precision": null,
    "min": null,
    "max": null,
    "maxLength": 2000,
    "targets": [],
    "options": []
  },
  {
    "name": "alp_guidancetotalprice",
    "label": "销售指导总价",
    "group": "报价单详细信息",
    "type": "decimal",
    "required": false,
    "visible": true,
    "readonly": true,
    "precision": 2,
    "min": -100000000000,
    "max": 100000000000,
    "maxLength": null,
    "targets": [],
    "options": []
  },
  {
    "name": "alp_isintax",
    "label": "是否含税",
    "group": "报价单详细信息",
    "type": "optionset",
    "required": true,
    "visible": true,
    "readonly": false,
    "precision": null,
    "min": null,
    "max": null,
    "maxLength": null,
    "targets": [],
    "options": [
      {
        "label": "含税",
        "value": 10
      },
      {
        "label": "未税",
        "value": 20
      }
    ]
  },
  {
    "name": "alp_minimumgpup",
    "label": "最低毛利单价",
    "group": "报价单详细信息",
    "type": "decimal",
    "required": false,
    "visible": true,
    "readonly": true,
    "precision": 2,
    "min": -100000000000,
    "max": 100000000000,
    "maxLength": null,
    "targets": [],
    "options": []
  },
  {
    "name": "alp_taxpercentage",
    "label": "税率（%）",
    "group": "报价单详细信息",
    "type": "decimal",
    "required": true,
    "visible": true,
    "readonly": false,
    "precision": 2,
    "min": -100000000000,
    "max": 100000000000,
    "maxLength": null,
    "targets": [],
    "options": []
  },
  {
    "name": "alp_minimumgptp",
    "label": "最低毛利总价",
    "group": "报价单详细信息",
    "type": "decimal",
    "required": false,
    "visible": true,
    "readonly": true,
    "precision": 2,
    "min": -100000000000,
    "max": 100000000000,
    "maxLength": null,
    "targets": [],
    "options": []
  },
  {
    "name": "quantity",
    "label": "数量",
    "group": "报价单详细信息",
    "type": "decimal",
    "required": true,
    "visible": true,
    "readonly": false,
    "precision": 0,
    "min": -100000000000,
    "max": 100000000000,
    "maxLength": null,
    "targets": [],
    "options": []
  },
  {
    "name": "alp_refercostup",
    "label": "参考成本单价",
    "group": "报价单详细信息",
    "type": "decimal",
    "required": false,
    "visible": true,
    "readonly": true,
    "precision": 2,
    "min": -100000000000,
    "max": 100000000000,
    "maxLength": null,
    "targets": [],
    "options": []
  },
  {
    "name": "alp_freightfee",
    "label": "运费",
    "group": "报价单详细信息",
    "type": "decimal",
    "required": false,
    "visible": true,
    "readonly": false,
    "precision": 2,
    "min": 0,
    "max": 100000000000,
    "maxLength": null,
    "targets": [],
    "options": []
  },
  {
    "name": "alp_refertotalcost",
    "label": "参考成本总价",
    "group": "报价单详细信息",
    "type": "decimal",
    "required": false,
    "visible": true,
    "readonly": true,
    "precision": 2,
    "min": -100000000000,
    "max": 100000000000,
    "maxLength": null,
    "targets": [],
    "options": []
  },
  {
    "name": "alp_refercost_noamortize",
    "label": "成本单价(不含摊销)",
    "group": "报价单详细信息",
    "type": "decimal",
    "required": false,
    "visible": true,
    "readonly": true,
    "precision": 2,
    "min": -100000000000,
    "max": 100000000000,
    "maxLength": null,
    "targets": [],
    "options": []
  },
  {
    "name": "alp_refertotalcost_noamortize",
    "label": "成本总价(不含摊销)",
    "group": "报价单详细信息",
    "type": "decimal",
    "required": false,
    "visible": true,
    "readonly": true,
    "precision": 2,
    "min": -100000000000,
    "max": 100000000000,
    "maxLength": null,
    "targets": [],
    "options": []
  },
  {
    "name": "alp_priceperunit",
    "label": "折前单价（未税）",
    "group": "定价",
    "type": "decimal",
    "required": false,
    "visible": true,
    "readonly": false,
    "precision": 2,
    "min": -100000000000,
    "max": 100000000000,
    "maxLength": null,
    "targets": [],
    "options": []
  },
  {
    "name": "alp_afterdiscountamount",
    "label": "折后单价（未税）",
    "group": "定价",
    "type": "decimal",
    "required": false,
    "visible": true,
    "readonly": true,
    "precision": 2,
    "min": -100000000000,
    "max": 100000000000,
    "maxLength": null,
    "targets": [],
    "options": []
  },
  {
    "name": "alp_beforedispriceintax",
    "label": "折前单价（含税）",
    "group": "定价",
    "type": "decimal",
    "required": false,
    "visible": true,
    "readonly": false,
    "precision": 2,
    "min": -100000000000,
    "max": 100000000000,
    "maxLength": null,
    "targets": [],
    "options": []
  },
  {
    "name": "alp_afterdispriceintax",
    "label": "折后单价（含税）",
    "group": "定价",
    "type": "decimal",
    "required": false,
    "visible": true,
    "readonly": true,
    "precision": 2,
    "min": -100000000000,
    "max": 100000000000,
    "maxLength": null,
    "targets": [],
    "options": []
  },
  {
    "name": "alp_one_way_discount",
    "label": "单行折扣（%）",
    "group": "定价",
    "type": "decimal",
    "required": false,
    "visible": false,
    "readonly": false,
    "precision": 2,
    "min": -100000000000,
    "max": 100000000000,
    "maxLength": null,
    "targets": [],
    "options": []
  },
  {
    "name": "msdyn_linetype",
    "label": "行类型",
    "group": "定价",
    "type": "optionset",
    "required": false,
    "visible": false,
    "readonly": false,
    "precision": null,
    "min": null,
    "max": null,
    "maxLength": null,
    "targets": [],
    "options": [
      {
        "label": "Project Service 明细",
        "value": 690970000
      },
      {
        "label": "Field Service 明细",
        "value": 690970001
      }
    ]
  },
  {
    "name": "alp_customer_discount",
    "label": "客户折扣（%）",
    "group": "定价",
    "type": "decimal",
    "required": false,
    "visible": false,
    "readonly": false,
    "precision": 2,
    "min": -100000000000,
    "max": 100000000000,
    "maxLength": null,
    "targets": [],
    "options": []
  },
  {
    "name": "alp_beforedistotal",
    "label": "折前总价（未税）",
    "group": "定价",
    "type": "decimal",
    "required": false,
    "visible": true,
    "readonly": true,
    "precision": 2,
    "min": -100000000000,
    "max": 100000000000,
    "maxLength": null,
    "targets": [],
    "options": []
  },
  {
    "name": "alp_customer_or_material_discount",
    "label": "客户/物料折扣",
    "group": "定价",
    "type": "decimal",
    "required": false,
    "visible": false,
    "readonly": false,
    "precision": 2,
    "min": -100000000000,
    "max": 100000000000,
    "maxLength": null,
    "targets": [],
    "options": []
  },
  {
    "name": "alp_beforedistotalintax",
    "label": "折前总价（含税）",
    "group": "定价",
    "type": "decimal",
    "required": false,
    "visible": true,
    "readonly": true,
    "precision": 2,
    "min": -100000000000,
    "max": 100000000000,
    "maxLength": null,
    "targets": [],
    "options": []
  },
  {
    "name": "alp_discount_materials",
    "label": "物料折扣",
    "group": "定价",
    "type": "decimal",
    "required": false,
    "visible": false,
    "readonly": false,
    "precision": 2,
    "min": -100000000000,
    "max": 100000000000,
    "maxLength": null,
    "targets": [],
    "options": []
  },
  {
    "name": "alp_afterdistotal",
    "label": "折后总价（未税）",
    "group": "定价",
    "type": "decimal",
    "required": false,
    "visible": true,
    "readonly": true,
    "precision": 2,
    "min": -100000000000,
    "max": 100000000000,
    "maxLength": null,
    "targets": [],
    "options": []
  },
  {
    "name": "alp_special_discounts",
    "label": "特殊折扣",
    "group": "定价",
    "type": "decimal",
    "required": false,
    "visible": false,
    "readonly": false,
    "precision": 2,
    "min": -100000000000,
    "max": 100000000000,
    "maxLength": null,
    "targets": [],
    "options": []
  },
  {
    "name": "alp_afterdistotalintax",
    "label": "折后总价（含税）",
    "group": "定价",
    "type": "decimal",
    "required": false,
    "visible": true,
    "readonly": true,
    "precision": 2,
    "min": -100000000000,
    "max": 100000000000,
    "maxLength": null,
    "targets": [],
    "options": []
  },
  {
    "name": "alp_rebate",
    "label": "单行返利",
    "group": "定价",
    "type": "decimal",
    "required": false,
    "visible": false,
    "readonly": false,
    "precision": 2,
    "min": -100000000000,
    "max": 100000000000,
    "maxLength": null,
    "targets": [],
    "options": []
  },
  {
    "name": "alp_totaldiscountprice",
    "label": "总折扣金额（未税）",
    "group": "定价",
    "type": "decimal",
    "required": false,
    "visible": true,
    "readonly": true,
    "precision": 2,
    "min": -100000000000,
    "max": 100000000000,
    "maxLength": null,
    "targets": [],
    "options": []
  },
  {
    "name": "alp_totaldiscountpriceintax",
    "label": "总折扣金额（含税）",
    "group": "定价",
    "type": "decimal",
    "required": false,
    "visible": true,
    "readonly": true,
    "precision": 2,
    "min": -100000000000,
    "max": 100000000000,
    "maxLength": null,
    "targets": [],
    "options": []
  },
  {
    "name": "propertyconfigurationstatus",
    "label": "属性配置",
    "group": "产品属性",
    "type": "optionset",
    "required": true,
    "visible": true,
    "readonly": false,
    "precision": null,
    "min": null,
    "max": null,
    "maxLength": null,
    "targets": [],
    "options": [
      {
        "label": "编辑",
        "value": 0
      },
      {
        "label": "修订",
        "value": 1
      },
      {
        "label": "未配置",
        "value": 2
      }
    ]
  }
];
