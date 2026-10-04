import { useEffect, useState } from 'react';
import { bootstrapDatabases } from '../db/bootstrap';
import { useEquipmentStore } from '../stores/equipmentStore';
import { useNightStore } from '../stores/nightStore';
import { useSessionStore } from '../stores/sessionStore';
import { useTargetStore } from '../stores/targetStore';

/** 把两个 Dexie 库的数据同步到各 Zustand store */
export async function hydrateAllStores(): Promise<void> {
  await Promise.all([
    useTargetStore.getState().hydrate(),
    useSessionStore.getState().hydrate(),
    useEquipmentStore.getState().hydrate(),
    useNightStore.getState().hydrate(),
  ]);
}

let bootstrap: Promise<void> | null = null;

/**
 * 封装两个物理隔离库的装载：首次调用时打开 target-db 与 schedule-db、
 * 把升级前混库的老数据按现有内容回填到两个新库、写入示例数据，再把表数据灌入 store。
 * 各页面用它判断数据是否就绪（多次调用复用同一 bootstrap，不重复装载）。
 */
export function usePersistentStore(): { ready: boolean; error: string } {
  const [ready, setReady] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    let alive = true;
    if (!bootstrap) {
      bootstrap = (async () => {
        await bootstrapDatabases();
        await hydrateAllStores();
      })();
    }
    bootstrap
      .then(() => {
        if (alive) setReady(true);
      })
      .catch((reason: unknown) => {
        if (alive) {
          setError((reason as Error).message);
          setReady(true);
        }
      });
    return () => {
      alive = false;
    };
  }, []);

  return { ready, error };
}
