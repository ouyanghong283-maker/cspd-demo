import type { DemoState } from './models';

/** Local demo sales order. Standard CRM source data is retained separately and never written back. */
export interface SalesOrder {
  id: string;
  contractId: string;
  projectId?: string;
  orderNumber: string;
  currency: string;
  amount: number;
  deliveryDate?: string;
  status: string;
  revision: number;
  createdAt: string;
  updatedAt: string;
  owner: string;
  crmFields?: Record<string, unknown>;
  sourceFields?: Record<string, unknown>;
}

/** A stable order line; logistics date, batch, material description and SAP number are distinct. */
export interface SalesOrderLine {
  id: string;
  orderId: string;
  productDescription: string;
  sapMaterialNumber: string;
  quantity: number;
  unit: string;
  batchNumber?: string;
  requestedDeliveryDate?: string;
  sourceFields?: Record<string, unknown>;
}

/** Additive, repeatable migration for local order aggregates. */
export function migrateSalesOrders(state: DemoState): void {
  const candidate = state as DemoState & {
    orders?: SalesOrder[];
    orderLines?: SalesOrderLine[];
  };
  if (candidate.orders === undefined) candidate.orders = [];
  if (!Array.isArray(candidate.orders)) throw new Error('销售订单迁移失败：orders 必须是数组');
  if (candidate.orderLines === undefined) candidate.orderLines = [];
  if (!Array.isArray(candidate.orderLines))
    throw new Error('销售订单迁移失败：orderLines 必须是数组');

  for (const order of candidate.orders) {
    if (
      !order ||
      typeof order !== 'object' ||
      typeof order.id !== 'string' ||
      !order.id ||
      typeof order.contractId !== 'string'
    )
      throw new Error('销售订单迁移失败：发现缺少稳定 ID 或合同 ID 的订单记录');
  }
  for (const line of candidate.orderLines) {
    if (
      !line ||
      typeof line !== 'object' ||
      typeof line.id !== 'string' ||
      !line.id ||
      typeof line.orderId !== 'string'
    )
      throw new Error('销售订单迁移失败：发现缺少稳定 ID 或所属订单 ID 的明细记录');
  }

  const review = (entityId: string, relation: string, reason: string) => {
    state.migrationReviewItems ||= [];
    const id = `MIGRATION-REVIEW-order-${entityId}-${relation}`;
    if (!state.migrationReviewItems.some((item) => item.id === id))
      state.migrationReviewItems.push({ id, entityType: 'salesOrder', entityId, relation, reason });
  };
  const orderIds = new Set<string>();
  for (const order of candidate.orders) {
    if (orderIds.has(order.id)) throw new Error(`销售订单迁移失败：订单ID重复${order.id}`);
    orderIds.add(order.id);
    if (!state.contracts.some((contract) => contract.id === order.contractId))
      review(order.id, 'contractId', `订单关联合同无法确认：${order.contractId}`);
    if (
      order.projectId &&
      state.projects.find((project) => project.id === order.projectId)?.contractId !== order.contractId
    )
      review(order.id, 'projectId', `订单关联项目与合同不一致或项目不存在：${order.projectId}`);
  }
  const lineIds = new Set<string>();
  for (const line of candidate.orderLines) {
    if (lineIds.has(line.id)) throw new Error(`销售订单迁移失败：明细ID重复${line.id}`);
    lineIds.add(line.id);
    if (!orderIds.has(line.orderId))
      review(line.id, 'orderId', `订单明细所属订单无法确认：${line.orderId}`);
  }
}
