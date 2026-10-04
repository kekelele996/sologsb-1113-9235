import Dexie, { type Table } from 'dexie';
import type { ObsTarget } from '../types';

/**
 * 目标协调员侧数据库：只存观测目标（星表、曝光参数、高度阈值）。
 * 与排程员侧的 schedule-db 物理分离，targetStore 是唯一写入者，
 * 改不到排程员名下的观测夜 / 排程段 / 望远镜占用。
 */
export const TARGET_DB_NAME = 'gbobsplan-target-db';

class TargetDB extends Dexie {
  targets!: Table<ObsTarget, string>;

  constructor() {
    super(TARGET_DB_NAME);
    this.version(1).stores({
      targets: 'id, name, catalog, type, priority, magnitude',
    });
  }
}

export const targetDb = new TargetDB();

/** 写入单条目标（仅目标库） */
export async function persistTarget(row: ObsTarget): Promise<void> {
  await targetDb.targets.put(row);
}

/** 删除单条目标（仅目标库） */
export async function deleteTarget(id: string): Promise<void> {
  await targetDb.targets.delete(id);
}
