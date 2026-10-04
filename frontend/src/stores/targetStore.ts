import { create } from 'zustand';
import { db, deleteSideRow, persistSideRow, runSideTransaction } from '../hooks/usePersistentStore';
import { uid } from '../utils/id';
import type { FilterName, ObsTarget, Priority, TargetType } from '../types';

export interface TargetInput {
  name: string;
  catalog: string;
  raHours: number;
  decDeg: number;
  magnitude: number;
  type: TargetType;
  filter: FilterName;
  exposureSec: number;
  totalMinutes: number;
  priority: Priority;
  minAltitude: number;
  remark?: string;
}

export interface TargetUpdateResult {
  /** 被挑入待重排的排程段数量 */
  invalidated: number;
  /** 排程侧失效标记写入失败时的错误信息（目标侧已提交，不回滚） */
  cascadeError?: string;
}

interface TargetState {
  targets: ObsTarget[];
  hydrated: boolean;
  hydrate: () => Promise<void>;
  addTarget: (input: TargetInput) => Promise<ObsTarget>;
  updateTarget: (id: string, patch: Partial<TargetInput>) => Promise<TargetUpdateResult>;
  removeTarget: (id: string) => Promise<void>;
}

/** 高度阈值或曝光参数变更时生成失效原因；未变更返回 null */
function planChangeReason(prev: ObsTarget, next: ObsTarget): string | null {
  const parts: string[] = [];
  if (prev.minAltitude !== next.minAltitude) parts.push(`高度阈值 ${prev.minAltitude}°→${next.minAltitude}°`);
  if (prev.exposureSec !== next.exposureSec) parts.push(`单帧曝光 ${prev.exposureSec}s→${next.exposureSec}s`);
  if (prev.totalMinutes !== next.totalMinutes) parts.push(`建议累计 ${prev.totalMinutes}min→${next.totalMinutes}min`);
  if (prev.filter !== next.filter) parts.push(`推荐滤镜 ${prev.filter}→${next.filter}`);
  return parts.length > 0 ? `目标 ${next.name} 参数变更（${parts.join('，')}），原有时段失效，待排程员重排` : null;
}

/** 观测目标库（归属目标协调员：只写 targets 表，改不到排程侧） */
export const useTargetStore = create<TargetState>()((set, get) => ({
  targets: [],
  hydrated: false,

  hydrate: async () => {
    const targets = await db.targets.orderBy('name').toArray();
    set({ targets, hydrated: true });
  },

  addTarget: async (input) => {
    const target: ObsTarget = {
      id: uid('target'),
      owner: 'coordinator',
      name: input.name.trim(),
      catalog: input.catalog.trim(),
      raHours: Number(input.raHours) || 0,
      decDeg: Number(input.decDeg) || 0,
      magnitude: Number(input.magnitude) || 0,
      type: input.type,
      filter: input.filter,
      exposureSec: Number(input.exposureSec) || 0,
      totalMinutes: Number(input.totalMinutes) || 0,
      priority: input.priority,
      minAltitude: Number(input.minAltitude) || 0,
      remark: input.remark?.trim() || undefined,
    };
    await runSideTransaction('coordinator', () => persistSideRow('coordinator', 'targets', target));
    set({ targets: [...get().targets, target].sort((a, b) => a.name.localeCompare(b.name)) });
    return target;
  },

  updateTarget: async (id, patch) => {
    const current = get().targets.find((target) => target.id === id);
    if (!current) return { invalidated: 0 };
    const next: ObsTarget = { ...current, ...patch, owner: 'coordinator' };
    // 协调员单侧事务：只写 targets 表，失败只回滚本侧
    await runSideTransaction('coordinator', () => persistSideRow('coordinator', 'targets', next));
    set({ targets: get().targets.map((target) => (target.id === id ? next : target)) });
    // 高度阈值或曝光参数变更 → 通知排程侧把引用该目标且未开拍的排程段挑入待重排；
    // 级联是排程侧的独立事务，其失败只回滚排程侧，不影响已提交的目标改动
    const reason = planChangeReason(current, next);
    if (!reason) return { invalidated: 0 };
    try {
      const { useSessionStore } = await import('./sessionStore');
      const invalidated = await useSessionStore.getState().invalidateByTarget(id, reason);
      return { invalidated };
    } catch (error) {
      return { invalidated: 0, cascadeError: (error as Error).message };
    }
  },

  removeTarget: async (id) => {
    await deleteSideRow('coordinator', 'targets', id);
    set({ targets: get().targets.filter((target) => target.id !== id) });
  },
}));
