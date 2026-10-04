import Dexie from 'dexie';
import type { Instrument, ObsNight, ObsSession, ObsTarget, Telescope } from '../types';
import { scheduleDb } from './scheduleDb';
import { seedIfEmpty } from './seed';
import { targetDb } from './targetDb';

/** 升级前的旧库：目标库与编排表混在一个 IndexedDB 里 */
const LEGACY_DB_NAME = 'gbobsplan-db';
/** 回填标记：老数据按现有内容回填到两个新库后写入，只回填一次 */
const BACKFILL_FLAG = 'legacyBackfilled';

/** 以只读方式打开旧库（表结构与 v2 声明一致），用于升级回填 */
async function openLegacyDb(): Promise<Dexie> {
  const legacy = new Dexie(LEGACY_DB_NAME);
  legacy.version(2).stores({
    targets: 'id, name, catalog, type, priority, magnitude',
    sessions: 'id, nightId, targetId, telescopeId, instrumentId, startTime, status, backupNightId',
    telescopes: 'id, code, status',
    instruments: 'id, model, telescopeCode, terminalType',
    nights: 'id, date, siteName, primary, backup',
    meta: 'key',
  });
  await legacy.open();
  return legacy;
}

/**
 * 升级前没有归属的老数据：按现有内容回填到两个新库（目标归目标库，排程/观测夜/设备归编排库），
 * 回填在各自库的独立事务中进行，回填完成后写 meta 标记再启用。
 */
async function backfillLegacyIfNeeded(): Promise<void> {
  const flag = await scheduleDb.meta.get(BACKFILL_FLAG);
  if (flag) return;

  const legacy = await openLegacyDb();
  try {
    const [legacyTargets, legacySessions, legacyTelescopes, legacyInstruments, legacyNights] = await Promise.all([
      legacy.table('targets').toArray() as Promise<ObsTarget[]>,
      legacy.table('sessions').toArray() as Promise<ObsSession[]>,
      legacy.table('telescopes').toArray() as Promise<Telescope[]>,
      legacy.table('instruments').toArray() as Promise<Instrument[]>,
      legacy.table('nights').toArray() as Promise<ObsNight[]>,
    ]);

    // 目标侧回填（独立事务，失败只回滚目标侧）
    if (legacyTargets.length) {
      await targetDb.transaction('rw', targetDb.targets, async () => {
        await targetDb.targets.bulkPut(legacyTargets);
      });
    }

    // 编排侧回填（独立事务，失败只回滚编排侧）
    if (legacySessions.length || legacyNights.length || legacyTelescopes.length || legacyInstruments.length) {
      await scheduleDb.transaction(
        'rw',
        scheduleDb.sessions,
        scheduleDb.nights,
        scheduleDb.telescopes,
        scheduleDb.instruments,
        async () => {
          if (legacySessions.length) await scheduleDb.sessions.bulkPut(legacySessions);
          if (legacyNights.length) await scheduleDb.nights.bulkPut(legacyNights);
          if (legacyTelescopes.length) await scheduleDb.telescopes.bulkPut(legacyTelescopes);
          if (legacyInstruments.length) await scheduleDb.instruments.bulkPut(legacyInstruments);
        },
      );
    }
  } finally {
    legacy.close();
  }

  await scheduleDb.meta.put({ key: BACKFILL_FLAG, value: new Date().toISOString() });
}

/**
 * 启动编排：打开两个物理隔离的库 → 回填升级前老数据 → 空库写入示例数据。
 * 两侧写入各自独立事务，互不牵连。
 */
export async function bootstrapDatabases(): Promise<void> {
  await targetDb.open();
  await scheduleDb.open();
  await backfillLegacyIfNeeded();
  await seedIfEmpty();
}
