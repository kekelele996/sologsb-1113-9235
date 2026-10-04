import { create } from 'zustand';
import { deleteRow, persistRow, scheduleDb, SCHEMA_VERSION } from '../db/scheduleDb';
import { uid } from '../utils/id';
import { durationMinutes } from '../utils/astro';
import { nextNight, nightCapacityMinutes, telescopeLoadMinutes } from '../utils/schedule';
import { useNightStore } from './nightStore';
import type { ObsSession, SessionStatus } from '../types';

export interface SessionInput {
  nightId: string;
  targetId: string;
  startTime: string;
  endTime: string;
  telescopeId: string;
  instrumentId: string;
  filterSlot: string;
  plannedFrames: number;
  status: SessionStatus;
  rescheduleReason?: string;
  backupNightId?: string;
}

interface SessionState {
  sessions: ObsSession[];
  hydrated: boolean;
  hydrate: () => Promise<void>;
  addSession: (input: SessionInput) => Promise<ObsSession>;
  updateSession: (id: string, patch: Partial<SessionInput>) => Promise<void>;
  removeSession: (id: string) => Promise<void>;
  /** 批量改期到备用观测夜并填写改期原因 */
  rescheduleToBackup: (ids: string[], backupNightId: string, reason: string) => Promise<number>;
  updateStatus: (id: string, status: SessionStatus) => Promise<void>;
  /** 目标高度阈值改动后，把引用该目标的待执行排程段置为「待重排」（已完成/进行中的留住），返回失效段数 */
  invalidateByTarget: (targetId: string) => Promise<number>;
}

/** 排程段与冲突检测所需数据（排程员侧）：仅写入 schedule-db，改不到协调员的目标库 */
export const useSessionStore = create<SessionState>()((set, get) => ({
  sessions: [],
  hydrated: false,

  hydrate: async () => {
    const sessions = await scheduleDb.sessions.orderBy('startTime').toArray();
    set({ sessions, hydrated: true });
  },

  addSession: async (input) => {
    // 容量排队：同一台望远镜在同一夜已确认的段加起来超出该夜容量，
    // 新增段就排到下一夜（置为「待重排」等排程员确认），不挤掉已确认的段。
    const nights = useNightStore.getState().nights;
    const targetNight = nights.find((night) => night.id === input.nightId);
    const duration = durationMinutes(input.startTime, input.endTime);
    const load = telescopeLoadMinutes(get().sessions, input.nightId, input.telescopeId);
    let nightId = input.nightId;
    let status: SessionStatus = input.status;
    if (load + duration > nightCapacityMinutes(targetNight)) {
      const following = nextNight(nights, input.nightId);
      if (following) {
        nightId = following.id;
      }
      status = '待重排';
    }

    const session: ObsSession = {
      id: uid('s'),
      nightId,
      targetId: input.targetId,
      startTime: input.startTime,
      endTime: input.endTime,
      telescopeId: input.telescopeId,
      instrumentId: input.instrumentId,
      filterSlot: input.filterSlot,
      plannedFrames: Number(input.plannedFrames) || 0,
      status,
      rescheduleReason: input.rescheduleReason?.trim() || undefined,
      backupNightId: input.backupNightId,
      schemaVersion: SCHEMA_VERSION,
    };
    // 仅写编排库（独立事务，失败只回滚编排侧）
    await scheduleDb.transaction('rw', scheduleDb.sessions, async () => {
      await persistRow('sessions', session);
    });
    set({ sessions: [...get().sessions, session] });
    return session;
  },

  updateSession: async (id, patch) => {
    const current = get().sessions.find((session) => session.id === id);
    if (!current) return;
    const next: ObsSession = { ...current, ...patch, schemaVersion: SCHEMA_VERSION };
    await scheduleDb.transaction('rw', scheduleDb.sessions, async () => {
      await persistRow('sessions', next);
    });
    set({ sessions: get().sessions.map((session) => (session.id === id ? next : session)) });
  },

  removeSession: async (id) => {
    await scheduleDb.transaction('rw', scheduleDb.sessions, async () => {
      await deleteRow('sessions', id);
    });
    set({ sessions: get().sessions.filter((session) => session.id !== id) });
  },

  rescheduleToBackup: async (ids, backupNightId, reason) => {
    const targets = get().sessions.filter((session) => ids.includes(session.id));
    const updated = targets.map((session) => ({
      ...session,
      backupNightId,
      status: '因云取消' as SessionStatus,
      rescheduleReason: reason.trim() || '改期至备用观测夜',
      schemaVersion: SCHEMA_VERSION,
    }));
    // 批量写包在同一个事务里：任一失败整批回滚，只影响编排侧
    await scheduleDb.transaction('rw', scheduleDb.sessions, async () => {
      for (const session of updated) {
        await persistRow('sessions', session);
      }
    });
    set({ sessions: get().sessions.map((session) => updated.find((item) => item.id === session.id) ?? session) });
    return updated.length;
  },

  updateStatus: async (id, status) => {
    await get().updateSession(id, { status });
  },

  invalidateByTarget: async (targetId) => {
    // 只把引用该目标、仍待执行的段置为「待重排」；已完成 / 进行中的段留住不动
    const affected = get().sessions.filter(
      (session) => session.targetId === targetId && session.status === '待执行',
    );
    if (affected.length === 0) return 0;
    const reason = '目标高度阈值调整，待重排';
    const updated = affected.map((session) => ({
      ...session,
      status: '待重排' as SessionStatus,
      rescheduleReason: session.rescheduleReason ?? reason,
      schemaVersion: SCHEMA_VERSION,
    }));
    await scheduleDb.transaction('rw', scheduleDb.sessions, async () => {
      for (const session of updated) {
        await persistRow('sessions', session);
      }
    });
    set({ sessions: get().sessions.map((session) => updated.find((item) => item.id === session.id) ?? session) });
    return updated.length;
  },
}));
