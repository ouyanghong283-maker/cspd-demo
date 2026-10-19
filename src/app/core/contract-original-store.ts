import { Injectable } from '@angular/core';

/** 规格冻结的专用库与对象仓库名；不复用通用 `cspd-demo-files-v2`，也不调用其全库清理。 */
export const CONTRACT_ORIGINAL_DATABASE = 'cspd-demo-contract-files-v1';
export const CONTRACT_ORIGINAL_STORE = 'contract-files';

/**
 * 专用库中的一条原件记录：不可变字节 + 明确归属 + 暂存/已引用状态。
 * 快照提交成功后暂存态才转正；恢复与定向回收以快照引用为事实，不单凭本字段删除。
 */
export interface ContractOriginalRecord {
  blob: Blob;
  blobId: string;
  contractId: string;
  workspaceId: string;
  roundId: string;
  operationId: string;
  state: 'staged' | 'referenced';
  stagedAt: string;
}

export interface ContractOriginalBlobStore {
  stage(record: ContractOriginalRecord): Promise<void>;
  read(blobId: string): Promise<ContractOriginalRecord | null>;
  promote(blobId: string): Promise<void>;
  discard(blobId: string, guard?: () => boolean): Promise<void>;
  keys(): Promise<string[]>;
}

/**
 * 合同真实原件专用 Blob 库（IndexedDB）。
 * 业务快照 JSON 只保存 ContractFileVersion 引用与元数据；真实字节只进本库。
 * 本库不提供清空入口：演示重置等入口不得先删除已被快照引用的文件。
 */
@Injectable({ providedIn: 'root' })
export class ContractOriginalStore implements ContractOriginalBlobStore {
  private database(): Promise<IDBDatabase> {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(CONTRACT_ORIGINAL_DATABASE, 1);
      request.onupgradeneeded = () => request.result.createObjectStore(CONTRACT_ORIGINAL_STORE);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(new Error('浏览器原件存储不可用，请检查存储权限'));
    });
  }
  private async run<T>(
    mode: IDBTransactionMode,
    action: (store: IDBObjectStore) => IDBRequest,
    failure: string,
    read?: (request: IDBRequest) => T,
  ): Promise<T> {
    const db = await this.database();
    try {
      return await new Promise<T>((resolve, reject) => {
        const transaction = db.transaction(CONTRACT_ORIGINAL_STORE, mode);
        const request = action(transaction.objectStore(CONTRACT_ORIGINAL_STORE));
        if (read) {
          request.onsuccess = () => resolve(read(request));
          request.onerror = () => reject(new Error(failure));
        }
        transaction.oncomplete = () => {
          if (!read) resolve(undefined as T);
        };
        transaction.onerror = () => reject(new Error(failure));
        transaction.onabort = () => reject(new Error(failure));
      });
    } finally {
      db.close();
    }
  }
  stage(record: ContractOriginalRecord): Promise<void> {
    return this.run(
      'readwrite',
      (store) => store.put(record, record.blobId),
      '原件暂存失败，未登记为有效版本',
    );
  }
  read(blobId: string): Promise<ContractOriginalRecord | null> {
    return this.run(
      'readonly',
      (store) => store.get(blobId),
      '无法读取原件内容',
      (request) => (request.result as ContractOriginalRecord | undefined) || null,
    );
  }
  async promote(blobId: string): Promise<void> {
    const record = await this.read(blobId);
    if (!record) throw new Error('暂存原件不存在，无法转正');
    await this.run(
      'readwrite',
      (store) => store.put({ ...record, state: 'referenced' }, blobId),
      '暂存原件转正失败，待清理标记按引用复核',
    );
  }
  discard(blobId: string, guard?: () => boolean): Promise<void> {
    return this.run(
      'readwrite',
      (store) => {
        if (guard && !guard()) throw new Error('原件清理条件已变化，已保留文件');
        return store.delete(blobId);
      },
      '暂存原件清理失败',
    );
  }
  keys(): Promise<string[]> {
    return this.run(
      'readonly',
      (store) => store.getAllKeys(),
      '无法列出原件存储',
      (request) => (request.result || []).map(String),
    );
  }
}
