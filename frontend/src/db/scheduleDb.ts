import Dexie, { type Table } from 'dexie';
import type { Instrument, ObsNight, ObsSession, Telescope } from '../types';

/**
 * 值班排程员侧数据库：存观测夜、排程段、望远镜与终端占用。
 * 与目标协调员侧的 target-db 物理分离，sessionStore / nightStore / equipmentStore 是唯一写入者，
 * 改不到协调员名下的观测目标、曝光参数与高度阈值。
 */
export const SCHEDULE_DB_NAME = 'gbobsplan-schedule-db';

/** 排程段记录结构版本（新增「待重排」状态，记录版本 +1） */
export const SCHEMA_VERSION = 3;

class ScheduleDB extends Dexie {
  sessions!: Table<ObsSession, string>;
  nights!: Table<ObsNight, string>;
  telescopes!: Table<Telescope, string>;
  instruments!: Table<Instrument, string>;
  meta!: Table<{ key: string; value: string }, string>;

  constructor() {
    super(SCHEDULE_DB_NAME);
    // 新库首次建表即含全量索引（含 backupNightId）
    this.version(1).stores({
      sessions: 'id, nightId, targetId, telescopeId, instrumentId, startTime, status, backupNightId',
      nights: 'id, date, siteName, primary, backup',
      telescopes: 'id, code, status',
      instruments: 'id, model, telescopeCode, terminalType',
      meta: 'key',
    });
  }
}

export const scheduleDb = new ScheduleDB();

export type ScheduleTableName = 'sessions' | 'nights' | 'telescopes' | 'instruments';

/** 写入单条编排侧记录（仅编排库） */
export async function persistRow(table: ScheduleTableName, row: unknown): Promise<void> {
  await scheduleDb.table(table).put(row as never);
}

/** 批量写入编排侧记录（仅编排库） */
export async function persistRows(table: ScheduleTableName, rows: unknown[]): Promise<void> {
  await scheduleDb.table(table).bulkPut(rows as never[]);
}

/** 删除编排侧记录（仅编排库） */
export async function deleteRow(table: ScheduleTableName, id: string): Promise<void> {
  await scheduleDb.table(table).delete(id);
}
