import { OpportunityRoughPlanTemplate } from './models';

/** 从既有离线交期计算模板整理；日期不套用，负责人仅展示为原表参考。 */
export const ROUGH_PLAN_TEMPLATES: OpportunityRoughPlanTemplate[] = [
  {
    "id": "DEMO-RPT-STANDARD",
    "name": "项目交期计算模板（CIF）",
    "description": "基于原工作簿 CIF 页；日期需按当前项目重新确认。",
    "sourceFile": "项目交期计算模板.xlsx",
    "status": "启用",
    "tasks": [
      {
        "id": "DEMO-RPT-STANDARD-1-1",
        "wbsCode": "1.1",
        "name": "OA订单启动（创建成品料号） Order Launch (Create Part No.)",
        "referenceOwner": "贾芸菲+李冠锋",
        "durationDays": 3,
        "predecessor": "",
        "relationNote": "需求评审",
        "note": ""
      },
      {
        "id": "DEMO-RPT-STANDARD-1-2",
        "wbsCode": "1.2",
        "name": "◆ 内部订单邮件下达 Internal Order Email Received",
        "referenceOwner": "贾芸菲",
        "durationDays": 1,
        "predecessor": "1.1FS",
        "relationNote": "订单启动完成",
        "note": ""
      },
      {
        "id": "DEMO-RPT-STANDARD-1-3",
        "wbsCode": "1.3",
        "name": "OA内部订单评审 OA Internal Order Review",
        "referenceOwner": "朱思嘉",
        "durationDays": 4,
        "predecessor": "1.2",
        "relationNote": "内部订单下达",
        "note": "审批涉及PM、物流、采购、财务"
      },
      {
        "id": "DEMO-RPT-STANDARD-1-4",
        "wbsCode": "1.4",
        "name": "OA交付流程触发到采购 OA Process Triggered to Procurement",
        "referenceOwner": "朱思嘉",
        "durationDays": 2,
        "predecessor": "1.3",
        "relationNote": "内部订单评审",
        "note": ""
      },
      {
        "id": "DEMO-RPT-STANDARD-1-5",
        "wbsCode": "1.5",
        "name": "生产端启动会 Production Kick-off Meeting",
        "referenceOwner": "陈敏",
        "durationDays": 3,
        "predecessor": "1.3",
        "relationNote": "OA订单启动",
        "note": "需要拿到料号"
      },
      {
        "id": "DEMO-RPT-STANDARD-1-6",
        "wbsCode": "1.6",
        "name": "PLM BOM的搭建和发布 PLM BOM Build and Release",
        "referenceOwner": "张瑞超",
        "durationDays": 3,
        "predecessor": "1.5",
        "relationNote": "项目启动会",
        "note": ""
      },
      {
        "id": "DEMO-RPT-STANDARD-1-7",
        "wbsCode": "1.7",
        "name": "SAP开工单创建 SAP Work Order Creation",
        "referenceOwner": "朱文琦+吴建樱+*徐海",
        "durationDays": 3,
        "predecessor": "1.4&1.6",
        "relationNote": "交付流程和BOM",
        "note": ""
      },
      {
        "id": "DEMO-RPT-STANDARD-2-1",
        "wbsCode": "2.1",
        "name": "DC侧物料提采 DC-Side Material Procurement",
        "referenceOwner": "季杭丽",
        "durationDays": 2,
        "predecessor": "1.8",
        "relationNote": "开工单",
        "note": ""
      },
      {
        "id": "DEMO-RPT-STANDARD-2-2",
        "wbsCode": "2.2",
        "name": "DC侧物料交付 DC-Side Material Delivery",
        "referenceOwner": "季杭丽",
        "durationDays": 50,
        "predecessor": "2.1",
        "relationNote": "",
        "note": "集装箱到货同时要提供箱证"
      },
      {
        "id": "DEMO-RPT-STANDARD-2-3",
        "wbsCode": "2.3",
        "name": "交流侧物料提采 AC-Side Material Procurement",
        "referenceOwner": "陈勇午",
        "durationDays": 3,
        "predecessor": "",
        "relationNote": "",
        "note": ""
      },
      {
        "id": "DEMO-RPT-STANDARD-2-4",
        "wbsCode": "2.4",
        "name": "AC侧报价和交期锁定 AC-Side Order Confirmation",
        "referenceOwner": "张贺",
        "durationDays": 7,
        "predecessor": "1.5",
        "relationNote": "交付流程",
        "note": ""
      },
      {
        "id": "DEMO-RPT-STANDARD-2-5",
        "wbsCode": "2.5",
        "name": "AC侧交付 PCS Order-to-Delivery",
        "referenceOwner": "季杭丽",
        "durationDays": 104,
        "predecessor": "2.3",
        "relationNote": "",
        "note": "实际货期需要根据具体型号确认"
      },
      {
        "id": "DEMO-RPT-STANDARD-3-1",
        "wbsCode": "3.1",
        "name": "DC系统首套组装 DC System First-Unit Assembly",
        "referenceOwner": "徐赛男",
        "durationDays": 5,
        "predecessor": "2.2",
        "relationNote": "直流物料交付",
        "note": ""
      },
      {
        "id": "DEMO-RPT-STANDARD-3-2",
        "wbsCode": "3.2",
        "name": "DC系统批量组装 DC System Batch Assembly",
        "referenceOwner": "徐赛男",
        "durationDays": 7,
        "predecessor": "",
        "relationNote": "",
        "note": ""
      },
      {
        "id": "DEMO-RPT-STANDARD-3-3",
        "wbsCode": "3.3",
        "name": "加证供应商对接和开案 Certification Case Establishing",
        "referenceOwner": "程怡",
        "durationDays": 7,
        "predecessor": "3.3SS-5",
        "relationNote": "加证前1周开始",
        "note": ""
      },
      {
        "id": "DEMO-RPT-STANDARD-3-4",
        "wbsCode": "3.4",
        "name": "UN3536 加证 Certification Process",
        "referenceOwner": "程怡",
        "durationDays": 10,
        "predecessor": "3.1SS+3",
        "relationNote": "DC组装开始3天后",
        "note": "需要集装箱照片和箱证"
      },
      {
        "id": "DEMO-RPT-STANDARD-3-5",
        "wbsCode": "3.5",
        "name": "工厂验收测试 (FAT) Factory Acceptance Test",
        "referenceOwner": "袁圣杰",
        "durationDays": 3,
        "predecessor": "3.1",
        "relationNote": "",
        "note": "如果搭载交流侧需另行评估"
      },
      {
        "id": "DEMO-RPT-STANDARD-3-6",
        "wbsCode": "3.6",
        "name": "客户审厂 Customer FAT Inspection",
        "referenceOwner": "欧洲PM",
        "durationDays": 3,
        "predecessor": "",
        "relationNote": "",
        "note": ""
      },
      {
        "id": "DEMO-RPT-STANDARD-3-7",
        "wbsCode": "3.7",
        "name": "开口项整改 Open Item Rectification",
        "referenceOwner": "袁圣杰",
        "durationDays": 3,
        "predecessor": "3.5FS-1",
        "relationNote": "",
        "note": ""
      },
      {
        "id": "DEMO-RPT-STANDARD-3-8",
        "wbsCode": "3.8",
        "name": "打包入库 Packing and Warehouse Receiving",
        "referenceOwner": "袁圣杰",
        "durationDays": 3,
        "predecessor": "3.7FS-2",
        "relationNote": "",
        "note": ""
      },
      {
        "id": "DEMO-RPT-STANDARD-4-0",
        "wbsCode": "4.0",
        "name": "收货和清关信息确认 Consignee & Customs Info Confirmation",
        "referenceOwner": "周晓晓",
        "durationDays": 14,
        "predecessor": "4.1SS-5",
        "relationNote": "物流询价前完成",
        "note": ""
      },
      {
        "id": "DEMO-RPT-STANDARD-4-1",
        "wbsCode": "4.1",
        "name": "物流方案确定 Logistics Plan Finalization",
        "referenceOwner": "马添鑫",
        "durationDays": 14,
        "predecessor": "3.8SS-25",
        "relationNote": "货好5周前开始",
        "note": "交付发起，物流或战采执行"
      },
      {
        "id": "DEMO-RPT-STANDARD-4-2",
        "wbsCode": "4.2",
        "name": "海关备案和订船 Vessel Booking and Custom Registration",
        "referenceOwner": "缪宇飞",
        "durationDays": 21,
        "predecessor": "3.4",
        "relationNote": "",
        "note": ""
      },
      {
        "id": "DEMO-RPT-STANDARD-4-3",
        "wbsCode": "4.3",
        "name": "厂内提货至国内港口 Factory Pickup to Domestic Port",
        "referenceOwner": "缪宇飞",
        "durationDays": 3,
        "predecessor": "4.3SS-5",
        "relationNote": "入库和订舱",
        "note": "发船一周前提货"
      },
      {
        "id": "DEMO-RPT-STANDARD-4-4",
        "wbsCode": "4.4",
        "name": "船期 Vessel Schedule",
        "referenceOwner": "缪宇飞",
        "durationDays": 7,
        "predecessor": "",
        "relationNote": "",
        "note": ""
      },
      {
        "id": "DEMO-RPT-STANDARD-4-5",
        "wbsCode": "4.5",
        "name": "发船至目的港 Sea Freight to Destination Port",
        "referenceOwner": "缪宇飞",
        "durationDays": 70,
        "predecessor": "",
        "relationNote": "",
        "note": ""
      },
      {
        "id": "DEMO-RPT-STANDARD-4-6",
        "wbsCode": "4.6",
        "name": "欧洲大件运输证办理 European Oversized Transport Permit",
        "referenceOwner": "缪宇飞",
        "durationDays": 28,
        "predecessor": "4.5SS",
        "relationNote": "发船后至到港前",
        "note": ""
      },
      {
        "id": "DEMO-RPT-STANDARD-4-7",
        "wbsCode": "4.7",
        "name": "清关资料提交 Customs Clearance Documents Submission",
        "referenceOwner": "缪宇飞",
        "durationDays": 14,
        "predecessor": "4.5SS",
        "relationNote": "到港2周前完成",
        "note": ""
      },
      {
        "id": "DEMO-RPT-STANDARD-4-8",
        "wbsCode": "4.8",
        "name": "目的港清关 Destination Port Customs Clearance",
        "referenceOwner": "何彩云",
        "durationDays": 7,
        "predecessor": "4.5",
        "relationNote": "船到港后",
        "note": ""
      },
      {
        "id": "DEMO-RPT-STANDARD-4-9",
        "wbsCode": "4.9",
        "name": "首批设备陆运至现场 First Batch Delivery to Customer Site",
        "referenceOwner": "缪宇飞",
        "durationDays": 0,
        "predecessor": "4.9",
        "relationNote": "清关",
        "note": "发运前跟PM确认现场吊装条件"
      },
      {
        "id": "DEMO-RPT-STANDARD-4-10",
        "wbsCode": "4.10",
        "name": "◆ 全部设备送达现场 All Equipment Delivered to Site",
        "referenceOwner": "缪宇飞",
        "durationDays": 2,
        "predecessor": "",
        "relationNote": "",
        "note": ""
      },
      {
        "id": "DEMO-RPT-STANDARD-5-1",
        "wbsCode": "5.1",
        "name": "入场条件确认和调试预约 Pre-Entry Check and Scheduling",
        "referenceOwner": "PM&调试",
        "durationDays": 20,
        "predecessor": "4.5SS",
        "relationNote": "发船后至到港前",
        "note": "包括确认送货日吊装准备就绪"
      },
      {
        "id": "DEMO-RPT-STANDARD-5-2",
        "wbsCode": "5.2",
        "name": "客户现场装卸 On-Site Loading/Unloading by Customer",
        "referenceOwner": "客户",
        "durationDays": 2,
        "predecessor": "4.10FS-10",
        "relationNote": "",
        "note": ""
      },
      {
        "id": "DEMO-RPT-STANDARD-5-3",
        "wbsCode": "5.3",
        "name": "接线施工 Wiring",
        "referenceOwner": "客户",
        "predecessor": "",
        "relationNote": "",
        "note": ""
      },
      {
        "id": "DEMO-RPT-STANDARD-5-4",
        "wbsCode": "5.4",
        "name": "DC侧冷调 DC-Side Cold Commissioning",
        "referenceOwner": "调试",
        "durationDays": 5,
        "predecessor": "5.3",
        "relationNote": "",
        "note": ""
      },
      {
        "id": "DEMO-RPT-STANDARD-5-5",
        "wbsCode": "5.5",
        "name": "AC侧冷调 AC-Side Cold Commissioning",
        "referenceOwner": "调试",
        "durationDays": 5,
        "predecessor": "5.4SS",
        "relationNote": "",
        "note": ""
      },
      {
        "id": "DEMO-RPT-STANDARD-5-6",
        "wbsCode": "5.6",
        "name": "场站热调 Joint Hot Commissioning of the BESS",
        "referenceOwner": "调试",
        "durationDays": 5,
        "predecessor": "5.5",
        "relationNote": "",
        "note": ""
      },
      {
        "id": "DEMO-RPT-STANDARD-5-7",
        "wbsCode": "5.7",
        "name": "◆ 现场测试报告验收签字(SAT) Signature of Site Acceptance Test",
        "referenceOwner": "调试",
        "durationDays": 5,
        "predecessor": "5.6",
        "relationNote": "",
        "note": ""
      },
      {
        "id": "DEMO-RPT-STANDARD-5-8",
        "wbsCode": "5.8",
        "name": "移交日期 Date of Take over",
        "referenceOwner": "客户",
        "predecessor": "",
        "relationNote": "",
        "note": ""
      },
      {
        "id": "DEMO-RPT-STANDARD-5-9",
        "wbsCode": "5.9",
        "name": "COD 并网投运 Commercial Operation Date",
        "referenceOwner": "客户",
        "predecessor": "",
        "relationNote": "",
        "note": "此时间取决于客户的并网许可"
      }
    ]
  },
  {
    "id": "DEMO-RPT-TENDER",
    "name": "项目交期计算模板（DDP）",
    "description": "基于原工作簿 DDP 页；日期需按当前项目重新确认。",
    "sourceFile": "项目交期计算模板.xlsx",
    "status": "启用",
    "tasks": [
      {
        "id": "DEMO-RPT-TENDER-1-1",
        "wbsCode": "1.1",
        "name": "OA订单启动（创建成品料号） Order Launch (Create Part No.)",
        "referenceOwner": "贾芸菲+李冠锋",
        "durationDays": 3,
        "predecessor": "",
        "relationNote": "需求评审",
        "note": ""
      },
      {
        "id": "DEMO-RPT-TENDER-1-2",
        "wbsCode": "1.2",
        "name": "◆ 内部订单邮件下达 Internal Order Email Received",
        "referenceOwner": "贾芸菲",
        "durationDays": 1,
        "predecessor": "1.1FS",
        "relationNote": "订单启动完成",
        "note": ""
      },
      {
        "id": "DEMO-RPT-TENDER-1-3",
        "wbsCode": "1.3",
        "name": "OA内部订单评审 OA Internal Order Review",
        "referenceOwner": "朱思嘉",
        "durationDays": 4,
        "predecessor": "1.2",
        "relationNote": "内部订单下达",
        "note": "审批涉及PM、物流、采购、财务"
      },
      {
        "id": "DEMO-RPT-TENDER-1-4",
        "wbsCode": "1.4",
        "name": "OA交付流程触发到采购 OA Process Triggered to Procurement",
        "referenceOwner": "朱思嘉",
        "durationDays": 2,
        "predecessor": "1.3",
        "relationNote": "内部订单评审",
        "note": ""
      },
      {
        "id": "DEMO-RPT-TENDER-1-5",
        "wbsCode": "1.5",
        "name": "生产端启动会 Production Kick-off Meeting",
        "referenceOwner": "陈敏",
        "durationDays": 3,
        "predecessor": "1.3",
        "relationNote": "OA订单启动",
        "note": "需要拿到料号"
      },
      {
        "id": "DEMO-RPT-TENDER-1-6",
        "wbsCode": "1.6",
        "name": "PLM BOM的搭建和发布 PLM BOM Build and Release",
        "referenceOwner": "张瑞超",
        "durationDays": 3,
        "predecessor": "1.5",
        "relationNote": "项目启动会",
        "note": ""
      },
      {
        "id": "DEMO-RPT-TENDER-1-7",
        "wbsCode": "1.7",
        "name": "SAP开工单创建 SAP Work Order Creation",
        "referenceOwner": "朱文琦+吴建樱+*徐海",
        "durationDays": 3,
        "predecessor": "1.4&1.6",
        "relationNote": "交付流程和BOM",
        "note": ""
      },
      {
        "id": "DEMO-RPT-TENDER-2-1",
        "wbsCode": "2.1",
        "name": "DC侧物料提采 DC-Side Material Procurement",
        "referenceOwner": "季杭丽",
        "durationDays": 2,
        "predecessor": "1.8",
        "relationNote": "开工单",
        "note": ""
      },
      {
        "id": "DEMO-RPT-TENDER-2-2",
        "wbsCode": "2.2",
        "name": "DC侧物料交付 DC-Side Material Delivery",
        "referenceOwner": "季杭丽",
        "durationDays": 50,
        "predecessor": "2.1",
        "relationNote": "",
        "note": "集装箱到货同时要提供箱证"
      },
      {
        "id": "DEMO-RPT-TENDER-2-3",
        "wbsCode": "2.3",
        "name": "交流侧物料提采 AC-Side Material Procurement",
        "referenceOwner": "陈勇午",
        "durationDays": 3,
        "predecessor": "",
        "relationNote": "",
        "note": ""
      },
      {
        "id": "DEMO-RPT-TENDER-2-4",
        "wbsCode": "2.4",
        "name": "AC侧报价和交期锁定 AC-Side Order Confirmation",
        "referenceOwner": "张贺",
        "durationDays": 7,
        "predecessor": "1.5",
        "relationNote": "交付流程",
        "note": ""
      },
      {
        "id": "DEMO-RPT-TENDER-2-5",
        "wbsCode": "2.5",
        "name": "AC侧交付 PCS Order-to-Delivery",
        "referenceOwner": "季杭丽",
        "durationDays": 104,
        "predecessor": "2.3",
        "relationNote": "",
        "note": "实际货期需要根据具体型号确认"
      },
      {
        "id": "DEMO-RPT-TENDER-3-1",
        "wbsCode": "3.1",
        "name": "DC系统首套组装 DC System First-Unit Assembly",
        "referenceOwner": "徐赛男",
        "durationDays": 5,
        "predecessor": "2.2",
        "relationNote": "直流物料交付",
        "note": ""
      },
      {
        "id": "DEMO-RPT-TENDER-3-2",
        "wbsCode": "3.2",
        "name": "DC系统批量组装 DC System Batch Assembly",
        "referenceOwner": "徐赛男",
        "durationDays": 5,
        "predecessor": "",
        "relationNote": "",
        "note": ""
      },
      {
        "id": "DEMO-RPT-TENDER-3-3",
        "wbsCode": "3.3",
        "name": "加证供应商对接和开案 Certification Case Establishing",
        "referenceOwner": "程怡",
        "durationDays": 7,
        "predecessor": "3.3SS-5",
        "relationNote": "加证前1周开始",
        "note": ""
      },
      {
        "id": "DEMO-RPT-TENDER-3-4",
        "wbsCode": "3.4",
        "name": "UN3536 加证 Certification Process",
        "referenceOwner": "程怡",
        "durationDays": 10,
        "predecessor": "3.1SS+3",
        "relationNote": "DC组装开始3天后",
        "note": "需要集装箱照片和箱证"
      },
      {
        "id": "DEMO-RPT-TENDER-3-5",
        "wbsCode": "3.5",
        "name": "工厂验收测试 (FAT) Factory Acceptance Test",
        "referenceOwner": "袁圣杰",
        "durationDays": 3,
        "predecessor": "3.1",
        "relationNote": "",
        "note": "如果搭载交流侧需另行评估"
      },
      {
        "id": "DEMO-RPT-TENDER-3-6",
        "wbsCode": "3.6",
        "name": "客户审厂 Customer Factory Inspection",
        "referenceOwner": "欧洲PM",
        "durationDays": 2,
        "predecessor": "",
        "relationNote": "",
        "note": ""
      },
      {
        "id": "DEMO-RPT-TENDER-3-7",
        "wbsCode": "3.7",
        "name": "开口项整改 Open Item Rectification",
        "referenceOwner": "袁圣杰",
        "durationDays": 3,
        "predecessor": "3.5FS-1",
        "relationNote": "",
        "note": ""
      },
      {
        "id": "DEMO-RPT-TENDER-3-8",
        "wbsCode": "3.8",
        "name": "打包入库 Packing and Warehouse Receiving",
        "referenceOwner": "袁圣杰",
        "durationDays": 3,
        "predecessor": "3.7FS-2",
        "relationNote": "",
        "note": ""
      },
      {
        "id": "DEMO-RPT-TENDER-4-0",
        "wbsCode": "4.0",
        "name": "收货和清关信息确认 Consignee & Customs Info Confirmation",
        "referenceOwner": "周晓晓",
        "durationDays": 14,
        "predecessor": "4.1SS-5",
        "relationNote": "物流询价前完成",
        "note": ""
      },
      {
        "id": "DEMO-RPT-TENDER-4-1",
        "wbsCode": "4.1",
        "name": "物流方案确定 Logistics Plan Finalization",
        "referenceOwner": "马添鑫",
        "durationDays": 14,
        "predecessor": "3.8SS-25",
        "relationNote": "货好5周前开始",
        "note": "交付发起，物流或战采执行"
      },
      {
        "id": "DEMO-RPT-TENDER-4-2",
        "wbsCode": "4.2",
        "name": "海关备案和订船 Vessel Booking and Custom Registration",
        "referenceOwner": "缪宇飞",
        "durationDays": 21,
        "predecessor": "3.4",
        "relationNote": "",
        "note": ""
      },
      {
        "id": "DEMO-RPT-TENDER-4-3",
        "wbsCode": "4.3",
        "name": "船期 Vessel Schedule",
        "referenceOwner": "缪宇飞",
        "durationDays": 7,
        "predecessor": "",
        "relationNote": "",
        "note": ""
      },
      {
        "id": "DEMO-RPT-TENDER-4-4",
        "wbsCode": "4.4",
        "name": "厂内提货至国内港口 Factory Pickup to Domestic Port",
        "referenceOwner": "缪宇飞",
        "durationDays": 6,
        "predecessor": "4.3SS-5",
        "relationNote": "入库和订舱",
        "note": "发船一周前提货"
      },
      {
        "id": "DEMO-RPT-TENDER-4-5",
        "wbsCode": "4.5",
        "name": "发船至目的港 Sea Freight to Destination Port",
        "referenceOwner": "缪宇飞",
        "durationDays": 70,
        "predecessor": "",
        "relationNote": "",
        "note": ""
      },
      {
        "id": "DEMO-RPT-TENDER-4-6",
        "wbsCode": "4.6",
        "name": "欧洲大件运输证办理 European Oversized Transport Permit",
        "referenceOwner": "缪宇飞",
        "durationDays": 28,
        "predecessor": "4.5SS",
        "relationNote": "发船后至到港前",
        "note": ""
      },
      {
        "id": "DEMO-RPT-TENDER-4-7",
        "wbsCode": "4.7",
        "name": "清关资料提交 Customs Clearance Documents Submission",
        "referenceOwner": "缪宇飞",
        "durationDays": 14,
        "predecessor": "4.5SS",
        "relationNote": "到港2周前完成",
        "note": ""
      },
      {
        "id": "DEMO-RPT-TENDER-4-8",
        "wbsCode": "4.8",
        "name": "目的港清关 Destination Port Customs Clearance",
        "referenceOwner": "何彩云",
        "durationDays": 7,
        "predecessor": "4.5",
        "relationNote": "船到港后",
        "note": ""
      },
      {
        "id": "DEMO-RPT-TENDER-4-9",
        "wbsCode": "4.9",
        "name": "首批设备陆运至现场 First Batch Delivery to Customer Site",
        "referenceOwner": "缪宇飞",
        "durationDays": 0,
        "predecessor": "4.9",
        "relationNote": "清关",
        "note": "发运前跟PM确认现场吊装条件"
      },
      {
        "id": "DEMO-RPT-TENDER-4-10",
        "wbsCode": "4.10",
        "name": "◆ 全部设备送达现场 All Equipment Delivered to Site",
        "referenceOwner": "缪宇飞",
        "durationDays": 2,
        "predecessor": "",
        "relationNote": "",
        "note": ""
      },
      {
        "id": "DEMO-RPT-TENDER-5-1",
        "wbsCode": "5.1",
        "name": "入场条件确认和调试预约 Pre-Entry Check and Scheduling",
        "referenceOwner": "PM&调试",
        "durationDays": 20,
        "predecessor": "4.5SS",
        "relationNote": "发船后至到港前",
        "note": "包括确认送货日吊装准备就绪"
      },
      {
        "id": "DEMO-RPT-TENDER-5-2",
        "wbsCode": "5.2",
        "name": "客户现场装卸 On-Site Loading/Unloading by Customer",
        "referenceOwner": "客户",
        "durationDays": 2,
        "predecessor": "4.10FS-10",
        "relationNote": "",
        "note": ""
      },
      {
        "id": "DEMO-RPT-TENDER-5-3",
        "wbsCode": "5.3",
        "name": "接线施工 Wiring",
        "referenceOwner": "客户",
        "predecessor": "",
        "relationNote": "",
        "note": ""
      },
      {
        "id": "DEMO-RPT-TENDER-5-4",
        "wbsCode": "5.4",
        "name": "DC侧冷调 DC-Side Cold Commissioning",
        "referenceOwner": "调试",
        "durationDays": 5,
        "predecessor": "5.3",
        "relationNote": "",
        "note": ""
      },
      {
        "id": "DEMO-RPT-TENDER-5-5",
        "wbsCode": "5.5",
        "name": "AC侧冷调 AC-Side Cold Commissioning",
        "referenceOwner": "调试",
        "durationDays": 5,
        "predecessor": "5.4SS",
        "relationNote": "",
        "note": ""
      },
      {
        "id": "DEMO-RPT-TENDER-5-6",
        "wbsCode": "5.6",
        "name": "场站热调 Joint Hot Commissioning of the BESS",
        "referenceOwner": "调试",
        "durationDays": 5,
        "predecessor": "5.5",
        "relationNote": "",
        "note": ""
      },
      {
        "id": "DEMO-RPT-TENDER-5-7",
        "wbsCode": "5.7",
        "name": "◆ 现场测试报告验收签字(SAT) Signature of Site Acceptance Test",
        "referenceOwner": "调试",
        "durationDays": 5,
        "predecessor": "5.6",
        "relationNote": "",
        "note": ""
      },
      {
        "id": "DEMO-RPT-TENDER-5-8",
        "wbsCode": "5.8",
        "name": "移交日期 Date of Take over",
        "referenceOwner": "客户",
        "predecessor": "",
        "relationNote": "",
        "note": ""
      },
      {
        "id": "DEMO-RPT-TENDER-5-9",
        "wbsCode": "5.9",
        "name": "COD 并网投运 Commercial Operation Date",
        "referenceOwner": "客户",
        "predecessor": "",
        "relationNote": "",
        "note": "此时间取决于客户的并网许可"
      }
    ]
  }
];
