import { create } from 'zustand';
import { deleteRow, persistRow, scheduleDb } from '../db/scheduleDb';
import { uid } from '../utils/id';
import type { ObsNight } from '../types';

export interface NightInput {
  date: string;
  siteName: string;
  siteLat: number;
  siteLng: number;
  moonPhasePct: number;
  moonrise: string;
  moonset: string;
  sunset: string;
  sunrise: string;
  cloudText: string;
  primary: boolean;
  backup: boolean;
  dutyOfficer: string;
  remark?: string;
}

interface NightState {
  nights: ObsNight[];
  currentNightId: string;
  hydrated: boolean;
  hydrate: () => Promise<void>;
  setCurrentNight: (id: string) => void;
  addNight: (input: NightInput) => Promise<ObsNight>;
  updateNight: (id: string, patch: Partial<NightInput>) => Promise<void>;
  removeNight: (id: string) => Promise<void>;
}

/** 观测夜与主夜 / 备用夜（排程员侧）：仅写入 schedule-db，改不到协调员的目标库 */
export const useNightStore = create<NightState>()((set, get) => ({
  nights: [],
  currentNightId: '',
  hydrated: false,

  hydrate: async () => {
    const nights = await scheduleDb.nights.orderBy('date').toArray();
    const current = get().currentNightId || nights.find((night) => night.primary)?.id || nights[0]?.id || '';
    set({ nights, currentNightId: current, hydrated: true });
  },

  setCurrentNight: (id) => set({ currentNightId: id }),

  addNight: async (input) => {
    const night: ObsNight = {
      id: uid('night'),
      date: input.date,
      siteName: input.siteName.trim(),
      siteLat: Number(input.siteLat) || 0,
      siteLng: Number(input.siteLng) || 0,
      moonPhasePct: Number(input.moonPhasePct) || 0,
      moonrise: input.moonrise,
      moonset: input.moonset,
      sunset: input.sunset,
      sunrise: input.sunrise,
      cloudText: input.cloudText,
      primary: input.primary,
      backup: input.backup,
      dutyOfficer: input.dutyOfficer.trim(),
      remark: input.remark?.trim() || undefined,
    };
    await scheduleDb.transaction('rw', scheduleDb.nights, async () => {
      await persistRow('nights', night);
    });
    set({ nights: [...get().nights, night].sort((a, b) => a.date.localeCompare(b.date)) });
    return night;
  },

  updateNight: async (id, patch) => {
    const current = get().nights.find((night) => night.id === id);
    if (!current) return;
    const next: ObsNight = { ...current, ...patch };
    await scheduleDb.transaction('rw', scheduleDb.nights, async () => {
      await persistRow('nights', next);
    });
    set({ nights: get().nights.map((night) => (night.id === id ? next : night)) });
  },

  removeNight: async (id) => {
    await scheduleDb.transaction('rw', scheduleDb.nights, async () => {
      await deleteRow('nights', id);
    });
    set({ nights: get().nights.filter((night) => night.id !== id) });
  },
}));
