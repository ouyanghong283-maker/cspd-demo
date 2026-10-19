export interface EditingLeaseRecord {
  ownerId: string;
  expiresAt: number;
}

export interface LeaseStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

const LEASE_KEY = 'cspd-demo-v2:editing-lease';

/** Coordinates one writable tab per local demo workspace. */
export class EditingLease {
  constructor(
    private readonly storage: LeaseStorage,
    private readonly ownerId: string,
    private readonly now: () => number = Date.now,
    private readonly durationMs = 15000,
  ) {}

  acquire(takeOver = false): boolean {
    const current = this.read();
    if (!takeOver && current && current.expiresAt > this.now() && current.ownerId !== this.ownerId)
      return false;
    return this.write();
  }

  takeOver(): boolean {
    return this.acquire(true);
  }

  renew(): boolean {
    const current = this.read();
    if (!current || current.ownerId !== this.ownerId || current.expiresAt <= this.now()) return false;
    return this.write();
  }

  owns(): boolean {
    const current = this.read();
    return !!current && current.ownerId === this.ownerId && current.expiresAt > this.now();
  }

  release(): void {
    const current = this.read();
    if (current?.ownerId === this.ownerId) this.storage.removeItem(LEASE_KEY);
  }

  private write(): boolean {
    try {
      this.storage.setItem(
        LEASE_KEY,
        JSON.stringify({ ownerId: this.ownerId, expiresAt: this.now() + this.durationMs }),
      );
      return this.owns();
    } catch {
      return false;
    }
  }

  private read(): EditingLeaseRecord | undefined {
    try {
      const raw = this.storage.getItem(LEASE_KEY);
      if (!raw) return undefined;
      const value: unknown = JSON.parse(raw);
      if (
        typeof value !== 'object' ||
        value === null ||
        !('ownerId' in value) ||
        typeof value.ownerId !== 'string' ||
        !('expiresAt' in value) ||
        typeof value.expiresAt !== 'number' ||
        !Number.isFinite(value.expiresAt)
      )
        return undefined;
      return value as EditingLeaseRecord;
    } catch {
      return undefined;
    }
  }
}
