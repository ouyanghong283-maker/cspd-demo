import { Injectable } from '@angular/core';
@Injectable({ providedIn: 'root' })
export class FilesService {
  private async database(): Promise<IDBDatabase> {
    return new Promise((resolve, reject) => {
      const r = indexedDB.open('cspd-demo-files-v2', 1);
      r.onupgradeneeded = () => r.result.createObjectStore('files');
      r.onsuccess = () => resolve(r.result);
      r.onerror = () => reject(new Error('浏览器文件存储不可用，请检查存储权限'));
    });
  }
  async put(id: string, file: File): Promise<void> {
    const db = await this.database();
    try {
      await new Promise<void>((resolve, reject) => {
        const t = db.transaction('files', 'readwrite');
        t.objectStore('files').put(file, id);
        t.oncomplete = () => resolve();
        t.onerror = () => reject(new Error('文件保存失败，未登记为资料齐备'));
        t.onabort = () => reject(new Error('文件保存被取消'));
      });
    } finally {
      db.close();
    }
  }
  async get(id: string): Promise<Blob | null> {
    const db = await this.database();
    try {
      return await new Promise((resolve, reject) => {
        const r = db.transaction('files').objectStore('files').get(id);
        r.onsuccess = () => resolve(r.result || null);
        r.onerror = () => reject(new Error('无法读取文件'));
      });
    } finally {
      db.close();
    }
  }
  async delete(id: string): Promise<void> {
    const db = await this.database();
    try {
      await new Promise<void>((resolve, reject) => {
        const t = db.transaction('files', 'readwrite');
        t.objectStore('files').delete(id);
        t.oncomplete = () => resolve();
        t.onerror = () => reject(new Error('删除文件失败'));
      });
    } finally {
      db.close();
    }
  }
  async clear(): Promise<void> {
    const db = await this.database();
    try {
      await new Promise<void>((resolve, reject) => {
        const t = db.transaction('files', 'readwrite');
        t.objectStore('files').clear();
        t.oncomplete = () => resolve();
        t.onerror = () => reject(new Error('清除文件失败'));
      });
    } finally {
      db.close();
    }
  }
}
