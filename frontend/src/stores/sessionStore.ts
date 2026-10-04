import { create } from 'zustand';
import { db, deleteSideRow, persistSideRow, persistSideRows, runSideTransaction, SCHEMA_VERSION } from '../hooks/usePersistentStore';
import { uid } from '../utils/id';
import { durationMinutes } from '../utils/astro';
import { INVALIDATABLE_STATUSES, nightCapacityMinutes, occupiedMinutes, QUEUE_CHECK_STATUSES } from '../utils/capacity';
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
  updateSession: (id: string, patch: Partial<SessionInput>) => Promise<ObsSession | undefined>;
  removeSession: (id: string) => Promise<void>;
  /** 批量改期到备用观测夜并填写改期原因 */
  rescheduleToBackup: (ids: string[], backupNightId: string, reason: string) => Promise<number>;
  updateStatus: (id: string, status: SessionStatus) => Promise<void>;
  /** 目标参数变更后，把引用该目标且未开拍的排程段挑入待重排（已拍完的照旧保留） */
  invalidateByTarget: (targetId: string, reason: string) => Promise<number>;
}

/**
 * 容量检查：同夜同望远镜已确认排程段合计超出当夜容量时，本段转入待重排排队等下一夜，
 * 已确认的段保持不动；容量足够时清除失效原因。
 */
async function applyCapacityQueue(session: ObsSession, all: ObsSession[]): Promise<ObsSession> {
  if (!QUEUE_CHECK_STATUSES.includes(session.status)) return session;
  const [{ useNightStore }, { useEquipmentStore }] = await Promise.all([import('./nightStore'), import('./equipmentStore')]);
  const night = useNightStore.getState().nights.find((item) => item.id === session.nightId);
  const capacity = nightCapacityMinutes(night);
  const used = occupiedMinutes(all, session.nightId, session.telescopeId, session.id);
  const duration = durationMinutes(session.startTime, session.endTime);
  if (used + duration <= capacity) {
    return { ...session, invalidReason: undefined };
  }
  const code = useEquipmentStore.getState().telescopes.find((item) => item.id === session.telescopeId)?.code ?? session.telescopeId;
  return {
    ...session,
    status: '待重排',
    invalidReason: `${code} 当夜容量 ${capacity} 分钟，已确认占用 ${used} 分钟，本段 ${duration} 分钟超出，排队等下一夜`,
  };
}

/** 排程段与冲突检测所需数据（归属值班排程员：只写排程侧的表，改不到目标库） */
export const useSessionStore = create<SessionState>()((set, get) => ({
  sessions: [],
  hydrated: false,

  hydrate: async () => {
    const sessions = await db.sessions.orderBy('startTime').toArray();
    set({ sessions, hydrated: true });
  },

  addSession: async (input) => {
    const draft: ObsSession = {
      id: uid('s'),
      owner: 'scheduler',
      nightId: input.nightId,
      targetId: input.targetId,
      startTime: input.startTime,
      endTime: input.endTime,
      telescopeId: input.telescopeId,
      instrumentId: input.instrumentId,
      filterSlot: input.filterSlot,
      plannedFrames: Number(input.plannedFrames) || 0,
      status: input.status,
      rescheduleReason: input.rescheduleReason?.trim() || undefined,
      backupNightId: input.backupNightId,
      schemaVersion: SCHEMA_VERSION,
    };
    const session = await applyCapacityQueue(draft, get().sessions);
    await runSideTransaction('scheduler', () => persistSideRow('scheduler', 'sessions', session));
    set({ sessions: [...get().sessions, session] });
    return session;
  },

  updateSession: async (id, patch) => {
    const current = get().sessions.find((session) => session.id === id);
    if (!current) return undefined;
    const draft: ObsSession = { ...current, ...patch, schemaVersion: SCHEMA_VERSION };
    const next = await applyCapacityQueue(draft, get().sessions);
    await runSideTransaction('scheduler', () => persistSideRow('scheduler', 'sessions', next));
    set({ sessions: get().sessions.map((session) => (session.id === id ? next : session)) });
    return next;
  },

  removeSession: async (id) => {
    await deleteSideRow('scheduler', 'sessions', id);
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
    // 排程侧单事务批量写入，失败只回滚本侧
    await runSideTransaction('scheduler', () => persistSideRows('scheduler', 'sessions', updated));
    set({ sessions: get().sessions.map((session) => updated.find((item) => item.id === session.id) ?? session) });
    return updated.length;
  },

  updateStatus: async (id, status) => {
    await get().updateSession(id, { status });
  },

  invalidateByTarget: async (targetId, reason) => {
    const affected = get().sessions.filter((session) => session.targetId === targetId && INVALIDATABLE_STATUSES.includes(session.status));
    if (affected.length === 0) return 0;
    const updated = affected.map((session) => ({
      ...session,
      status: '待重排' as SessionStatus,
      invalidReason: reason,
      schemaVersion: SCHEMA_VERSION,
    }));
    // 排程侧独立事务：与目标侧的写入分开，任一侧失败只回滚本侧
    await runSideTransaction('scheduler', () => persistSideRows('scheduler', 'sessions', updated));
    set({ sessions: get().sessions.map((session) => updated.find((item) => item.id === session.id) ?? session) });
    return updated.length;
  },
}));
