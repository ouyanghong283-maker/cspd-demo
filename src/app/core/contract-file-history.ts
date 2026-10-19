import { ContractFileVersion } from './models';

/** 合同版本按登记顺序倒序；排序不改写任何版本。 */
export function contractFileHistory(
  versions: readonly ContractFileVersion[],
  contractId: string,
): ContractFileVersion[] {
  return versions
    .filter((version) => version.contractId === contractId)
    .sort((a, b) => b.version - a.version);
}

/** 同合同一次只暂存一个请求；同操作共用结果，失败后允许原操作再次尝试。 */
export class ContractFileOperations {
  private readonly pending = new Map<string, { operationId: string; result: Promise<boolean> }>();
  hasPending(): boolean {
    return this.pending.size > 0;
  }
  run(
    contractId: string,
    operationId: string,
    perform: () => Promise<boolean>,
    busy: () => boolean,
  ): Promise<boolean> {
    const active = this.pending.get(contractId);
    if (active)
      return active.operationId === operationId ? active.result : Promise.resolve().then(busy);
    const result = Promise.resolve()
      .then(perform)
      .finally(() => {
        if (this.pending.get(contractId)?.result === result) this.pending.delete(contractId);
      });
    this.pending.set(contractId, { operationId, result });
    return result;
  }
}
