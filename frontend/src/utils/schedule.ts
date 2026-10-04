import { NIGHT_TOTAL_MINUTES, type ObsNight, type ObsSession } from '../types';
import { durationMinutes, hhmmToClock } from './astro';

/**
 * 排程容量工具：排程员侧用它判断某夜某望远镜还能不能再排段。
 * 容量 = 该夜日落到日出的暗时段分钟数（时间轴兜底 720 分钟）。
 */

/** 某观测夜的可用容量（分钟）：日落到日出的暗时段，跨零点兜底 720 分钟 */
export function nightCapacityMinutes(night: ObsNight | undefined): number {
  if (!night) return NIGHT_TOTAL_MINUTES;
  // 用时钟分钟算暗时段：日落到次日日出（跨零点），如 17:42 → 05:26 = (326 - 1062 + 1440) % 1440 = 704
  const darkMinutes = (hhmmToClock(night.sunrise) - hhmmToClock(night.sunset) + 1440) % 1440;
  return Math.max(0, Math.min(NIGHT_TOTAL_MINUTES, darkMinutes));
}

/**
 * 某望远镜在某夜已确认占用的分钟数。
 * 已取消（因云取消）与待重排的段不占容量；可传 excludeSessionId 排除自身。
 */
export function telescopeLoadMinutes(
  sessions: ObsSession[],
  nightId: string,
  telescopeId: string,
  excludeSessionId?: string,
): number {
  return sessions
    .filter((session) => session.nightId === nightId && session.telescopeId === telescopeId && session.id !== excludeSessionId)
    .filter((session) => session.status !== '因云取消' && session.status !== '待重排')
    .reduce((sum, session) => sum + durationMinutes(session.startTime, session.endTime), 0);
}

/** 按日期排在 nightId 之后的下一个观测夜（无则 undefined） */
export function nextNight(nights: ObsNight[], nightId: string): ObsNight | undefined {
  const sorted = [...nights].sort((a, b) => a.date.localeCompare(b.date));
  const index = sorted.findIndex((night) => night.id === nightId);
  return index >= 0 ? sorted[index + 1] : undefined;
}
