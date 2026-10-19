import { Injectable } from '@angular/core';
import type { V9Target, FileAvailability, SolutionOutputVersion } from '../v9-contracts';
export interface SolutionBlobRecord extends V9Target {
  opportunityId: string;
  kind: string;
  operationId: string;
  versionId: string;
  digest: string;
  blob: Blob;
}
export interface SolutionFiles {
  removeOwned?(id: string, expected: Omit<SolutionBlobRecord, 'blob'>): Promise<void>;
  put(id: string, record: SolutionBlobRecord): Promise<void>;
  get(id: string): Promise<SolutionBlobRecord | null>;
}
/** 方案独立所有权；不暴露清库，也不访问合同文件库。 */
@Injectable({ providedIn: 'root' })
export class SolutionFilesService implements SolutionFiles {
  private database(): Promise<IDBDatabase> {
    return new Promise((resolve, reject) => {
      const r = indexedDB.open('cspd-solution-files-v9', 1);
      r.onupgradeneeded = () => r.result.createObjectStore('files');
      r.onsuccess = () => resolve(r.result);
      r.onerror = () => reject(r.error);
      r.onblocked = () => reject(new Error('方案文件库被占用'));
    });
  }
  async put(id: string, record: SolutionBlobRecord): Promise<void> {
    const db = await this.database();
    try {
      await new Promise<void>((resolve, reject) => {
        const tx = db.transaction('files', 'readwrite');
        const table = tx.objectStore('files');
        const read = table.get(id);
        read.onsuccess = () => {
          const old: SolutionBlobRecord | undefined = read.result;
          if (
            old &&
            (old.versionId !== record.versionId ||
              old.digest !== record.digest ||
              old.workspaceId !== record.workspaceId ||
              old.roundId !== record.roundId ||
              old.opportunityId !== record.opportunityId ||
              old.kind !== record.kind ||
              old.operationId !== record.operationId)
          ) {
            tx.abort();
            return;
          }
          if (!old) table.add(record, id);
        };
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error ?? new Error('方案文件保存失败'));
        tx.onabort = () => reject(tx.error ?? new Error('方案文件归属或内容冲突'));
      });
    } finally {
      db.close();
    }
  }
  async removeOwned(id: string, expected: Omit<SolutionBlobRecord, 'blob'>): Promise<void> {
    const db = await this.database();
    try {
      await new Promise<void>((resolve, reject) => {
        const tx = db.transaction('files', 'readwrite');
        const table = tx.objectStore('files');
        const r = table.get(id);
        r.onsuccess = () => {
          const row: SolutionBlobRecord | undefined = r.result;
          if (!row) return;
          if (
            [
              'workspaceId',
              'roundId',
              'opportunityId',
              'kind',
              'versionId',
              'operationId',
              'digest',
            ].every(
              (k) => row[k as keyof SolutionBlobRecord] === expected[k as keyof typeof expected],
            )
          )
            table.delete(id);
          else tx.abort();
        };
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
        tx.onabort = () => reject(tx.error ?? new Error('文件归属变化，未清理'));
      });
    } finally {
      db.close();
    }
  }
  async get(id: string): Promise<SolutionBlobRecord | null> {
    const db = await this.database();
    try {
      return await new Promise((resolve, reject) => {
        const tx = db.transaction('files');
        const r = tx.objectStore('files').get(id);
        let row: SolutionBlobRecord | null = null;
        r.onsuccess = () => {
          row = r.result ?? null;
        };
        tx.oncomplete = () => resolve(row);
        tx.onerror = () => reject(tx.error);
        tx.onabort = () => reject(tx.error);
      });
    } finally {
      db.close();
    }
  }
}
export async function checkSolutionFile(
  files: SolutionFiles,
  version: SolutionOutputVersion,
): Promise<FileAvailability> {
  if (!version.file) return 'missing';
  try {
    const r = await files.get(version.file.blobId);
    if (!r) return 'missing';
    return version.file.versionId === version.id &&
      r.workspaceId === version.file.workspaceId &&
      r.roundId === version.file.roundId &&
      r.opportunityId === version.opportunityId &&
      r.kind === version.kind &&
      r.versionId === version.id &&
      r.blob.size === version.size
      ? (await r.blob.slice(0, 1).arrayBuffer(), 'present')
      : 'unavailable';
  } catch {
    return 'unavailable';
  }
}
