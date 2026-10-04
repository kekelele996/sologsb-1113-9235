import { create } from 'zustand';
import { deleteTarget, persistTarget, targetDb } from '../db/targetDb';
import { uid } from '../utils/id';
import { useSessionStore } from './sessionStore';
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

interface TargetState {
  targets: ObsTarget[];
  hydrated: boolean;
  hydrate: () => Promise<void>;
  addTarget: (input: TargetInput) => Promise<ObsTarget>;
  updateTarget: (id: string, patch: Partial<TargetInput>) => Promise<number>;
  removeTarget: (id: string) => Promise<void>;
}

/** 观测目标库（目标协调员侧）：仅写入 target-db，改不到排程员的观测夜 / 排程段 / 望远镜占用 */
export const useTargetStore = create<TargetState>()((set, get) => ({
  targets: [],
  hydrated: false,

  hydrate: async () => {
    const targets = await targetDb.targets.orderBy('name').toArray();
    set({ targets, hydrated: true });
  },

  addTarget: async (input) => {
    const target: ObsTarget = {
      id: uid('target'),
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
    // 仅写目标库（独立事务，失败只回滚目标侧）
    await targetDb.transaction('rw', targetDb.targets, async () => {
      await persistTarget(target);
    });
    set({ targets: [...get().targets, target].sort((a, b) => a.name.localeCompare(b.name)) });
    return target;
  },

  updateTarget: async (id, patch) => {
    const current = get().targets.find((target) => target.id === id);
    if (!current) return 0;
    const next: ObsTarget = { ...current, ...patch };
    // 仅写目标库（独立事务，失败只回滚目标侧）
    await targetDb.transaction('rw', targetDb.targets, async () => {
      await persistTarget(next);
    });
    set({ targets: get().targets.map((target) => (target.id === id ? next : target)) });

    // 高度阈值一改动，引用它的排程段就失效：交给排程员侧的 store 把待执行段置为「待重排」。
    // 目标协调员不直接写编排库，只调排程员侧的 action；已完成 / 进行中的段留住。
    if (patch.minAltitude !== undefined && patch.minAltitude !== current.minAltitude) {
      return useSessionStore.getState().invalidateByTarget(id);
    }
    return 0;
  },

  removeTarget: async (id) => {
    await targetDb.transaction('rw', targetDb.targets, async () => {
      await deleteTarget(id);
    });
    set({ targets: get().targets.filter((target) => target.id !== id) });
  },
}));
