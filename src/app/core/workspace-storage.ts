/** Minimal synchronous storage contract so browser storage failures can be injected. */
export interface WorkspaceStorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export interface ActivatedWorkspace {
  workspaceId: string;
  workspaceKey: string;
}

export interface MigratedWorkspace extends ActivatedWorkspace {
  backupKey: string;
}

interface WorkspaceEnvelope<T> {
  formatVersion: 1;
  workspaceId: string;
  snapshot: T;
}

export class WorkspaceStorageError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'WorkspaceStorageError';
  }
}

/**
 * Stages snapshots under immutable workspace keys and publishes them only by
 * updating the active pointer after a successful write and read-back check.
 * This adapter deliberately never deletes legacy data, backups, or orphaned
 * candidates.
 */
export class WorkspaceStorage<T> {
  readonly activePointerKey: string;
  readonly workspaceIndexKey: string;
  private readonly workspacePrefix: string;
  private readonly backupPrefix: string;

  constructor(
    private readonly storage: WorkspaceStorageLike,
    private readonly validateSnapshot: (value: unknown) => value is T,
    private readonly createId: () => string = () => crypto.randomUUID(),
    namespace = 'cspd-demo:v7',
  ) {
    this.activePointerKey = `${namespace}:active-workspace`;
    this.workspaceIndexKey = `${namespace}:workspace-index`;
    this.workspacePrefix = `${namespace}:workspace:`;
    this.backupPrefix = `${namespace}:legacy-backup:`;
  }

  workspaceKey(workspaceId: string): string {
    return `${this.workspacePrefix}${workspaceId}`;
  }

  backupKey(backupId: string): string {
    return `${this.backupPrefix}${backupId}`;
  }

  activeWorkspaceId(): string | null {
    const id = this.readItem(this.activePointerKey, '无法读取活动工作区指针');
    return id && id.length > 0 ? id : null;
  }

  readWorkspace(workspaceId: string): T | null {
    const raw = this.readItem(this.workspaceKey(workspaceId), '无法读取工作区快照');
    if (raw === null) return null;
    return this.parseSnapshot(raw, workspaceId);
  }

  readActive(): T | null {
    const workspaceId = this.activeWorkspaceId();
    return workspaceId === null ? null : this.readWorkspace(workspaceId);
  }

  workspaceIds(): string[] {
    const raw = this.readItem(this.workspaceIndexKey, '无法读取工作区索引');
    if (!raw) return [];
    try {
      const ids: unknown = JSON.parse(raw);
      return Array.isArray(ids) ? ids.filter((id): id is string => typeof id === 'string') : [];
    } catch {
      return [];
    }
  }

  activateWorkspace(workspaceId: string): void {
    this.activate(workspaceId);
  }

  /** Preserve the legacy bytes, stage and verify a candidate, then switch last. */
  migrateLegacy(rawLegacy: string, candidate: T): MigratedWorkspace {
    const backupId = this.uniqueId((id) => this.backupKey(id), '备份');
    const backupKey = this.backupKey(backupId);
    this.writeAndVerifyRaw(backupKey, rawLegacy, '旧数据备份失败');

    const staged = this.stageSnapshot(candidate);
    this.activate(staged.workspaceId);
    return { ...staged, backupKey };
  }

  /** 原字节备份、完整候选回读后原位升级；workspaceId不变，保留Blob归属。 */
  upgradeWorkspace(
    workspaceId: string,
    expectedRaw: string,
    candidate: T,
    canCommit: () => boolean,
  ): string {
    const workspaceKey = this.workspaceKey(workspaceId);
    const check = () => {
      if (!canCommit()) throw new WorkspaceStorageError('迁移期间修改资格已变化，旧快照保留');
      if (
        this.activeWorkspaceId() !== workspaceId ||
        this.readItem(workspaceKey, '无法核对迁移旧快照') !== expectedRaw
      )
        throw new WorkspaceStorageError('迁移期间工作区或数据版本已变化，旧快照保留');
    };
    check();
    if (!this.validateSnapshot(candidate))
      throw new WorkspaceStorageError('迁移候选快照未通过校验');
    const serialized = JSON.stringify({ formatVersion: 1, workspaceId, snapshot: candidate });
    const backupKey = this.backupKey(this.uniqueId((id) => this.backupKey(id), '迁移备份'));
    this.writeAndVerifyRaw(backupKey, expectedRaw, '迁移原文备份失败');
    check();
    const candidateKey = `${workspaceKey}:migration-candidate:${this.uniqueId((id) => `${workspaceKey}:migration-candidate:${id}`, '迁移候选')}`;
    const staged = this.writeAndVerifyRaw(candidateKey, serialized, '迁移候选写入失败');
    if (!this.parseSnapshot(staged, workspaceId))
      throw new WorkspaceStorageError('迁移候选回读校验失败');
    check();
    // localStorage单键setItem是同步原子替换；失败不会先发布schema或内存状态。
    try {
      this.storage.setItem(workspaceKey, serialized);
      if (this.storage.getItem(workspaceKey) !== serialized) throw new Error('迁移提交回读不一致');
    } catch {
      // 标准localStorage失败不更改单键；非标准适配器写后报错时尽力恢复本候选。
      // 若读到其他修订则保留它，绝不覆盖另一个已提交快照。
      try {
        if (this.storage.getItem(workspaceKey) === serialized)
          this.storage.setItem(workspaceKey, expectedRaw);
      } catch {
        /* 原字节备份仍保留；不发布成功。 */
      }
      throw new WorkspaceStorageError('迁移快照提交或回读失败，原文备份保留');
    }
    return backupKey;
  }

  /** Create an immutable round snapshot and make it active only after verification. */
  createAndActivateRound(snapshot: T): ActivatedWorkspace {
    const staged = this.stageSnapshot(snapshot);
    this.activate(staged.workspaceId);
    return staged;
  }

  private stageSnapshot(snapshot: T): ActivatedWorkspace {
    if (!this.validateSnapshot(snapshot))
      throw new WorkspaceStorageError('候选工作区未通过结构校验');

    const workspaceId = this.uniqueId((id) => this.workspaceKey(id), '工作区');
    const workspaceKey = this.workspaceKey(workspaceId);
    let serialized: string;
    try {
      serialized = JSON.stringify({ formatVersion: 1, workspaceId, snapshot });
    } catch {
      throw new WorkspaceStorageError('候选工作区无法序列化');
    }
    const persistedRaw = this.writeAndVerifyRaw(
      workspaceKey,
      serialized,
      '候选工作区写入失败',
    );
    const persisted = this.parseSnapshot(persistedRaw, workspaceId);
    if (!this.validateSnapshot(persisted))
      throw new WorkspaceStorageError('候选工作区回读校验失败');
    this.addToWorkspaceIndex(workspaceId);
    return { workspaceId, workspaceKey };
  }

  private addToWorkspaceIndex(workspaceId: string): void {
    const ids = this.workspaceIds();
    if (ids.includes(workspaceId)) return;
    this.writeAndVerifyRaw(
      this.workspaceIndexKey,
      JSON.stringify([...ids, workspaceId]),
      '工作区索引写入失败',
    );
  }

  private parseSnapshot(raw: string, expectedWorkspaceId: string): T | null {
    try {
      const envelope: unknown = JSON.parse(raw);
      if (
        typeof envelope !== 'object' ||
        envelope === null ||
        !('formatVersion' in envelope) ||
        envelope.formatVersion !== 1 ||
        !('workspaceId' in envelope) ||
        envelope.workspaceId !== expectedWorkspaceId ||
        !('snapshot' in envelope) ||
        !this.validateSnapshot(envelope.snapshot)
      )
        return null;
      return envelope.snapshot;
    } catch {
      return null;
    }
  }

  private activate(workspaceId: string): void {
    const previousPointer = this.readItem(
      this.activePointerKey,
      '切换前无法读取活动工作区指针',
    );
    const key = this.workspaceKey(workspaceId);
    const verified = this.readWorkspace(workspaceId);
    if (verified === null) throw new WorkspaceStorageError('候选工作区不存在或未通过校验');

    try {
      this.storage.setItem(this.activePointerKey, workspaceId);
      if (this.storage.getItem(this.activePointerKey) !== workspaceId)
        throw new Error('活动工作区指针回读不一致');
    } catch {
      this.restorePointer(previousPointer);
      throw new WorkspaceStorageError(`激活工作区失败；候选已保留：${key}`);
    }
  }

  private restorePointer(previousPointer: string | null): void {
    try {
      if (previousPointer === null) this.storage.removeItem(this.activePointerKey);
      else this.storage.setItem(this.activePointerKey, previousPointer);
    } catch {
      // Storage can fail persistently (for example, a full quota). The original
      // pointer is restored whenever the injected/browser storage accepts it.
    }
  }

  private writeAndVerifyRaw(key: string, raw: string, failureMessage: string): string {
    try {
      this.storage.setItem(key, raw);
      const persisted = this.storage.getItem(key);
      if (persisted !== raw) throw new Error('写入后回读不一致');
      return persisted;
    } catch {
      throw new WorkspaceStorageError(failureMessage);
    }
  }

  private readItem(key: string, failureMessage: string): string | null {
    try {
      return this.storage.getItem(key);
    } catch {
      throw new WorkspaceStorageError(failureMessage);
    }
  }

  private uniqueId(keyForId: (id: string) => string, label: string): string {
    for (let attempt = 0; attempt < 100; attempt++) {
      let id: string;
      try {
        id = this.createId();
      } catch {
        throw new WorkspaceStorageError(`无法生成${label}标识`);
      }
      if (!id || id.includes(':')) continue;
      if (this.readItem(keyForId(id), `无法检查${label}标识是否冲突`) === null) return id;
    }
    throw new WorkspaceStorageError(`${label}标识冲突次数过多`);
  }
}
