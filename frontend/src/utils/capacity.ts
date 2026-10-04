import { NIGHT_START_MINUTES, NIGHT_TOTAL_MINUTES, type ObsNight, type ObsSession, type SessionStatus } from '../types';
import { durationMinutes } from './astro';

/** 占用望远镜容量的排程段状态（已确认的段；待重排与因云取消不占容量） */
export const OCCUPYING_STATUSES: SessionStatus[] = ['待执行', '进行中', '已完成'];

/** 目标参数变更时可被挑入待重排的状态（已拍完与已取消的照旧保留） */
export const INVALIDATABLE_STATUSES: SessionStatus[] = ['待执行', '进行中'];

/** 写入时需要做容量检查的状态（历史已完成的段不再参与排队） */
export const QUEUE_CHECK_STATUSES: SessionStatus[] = ['待执行', '进行中'];

function clockMinutes(hhmm: string): number {
  const [h, m] = hhmm.split(':').map((v) => Number(v) || 0);
  return h * 60 + m;
}

/**
 * 观测夜可用于排程的容量（分钟）：日落 → 日出落在夜间时间轴（18:00 → 次日 06:00）内的时长。
 * 日落早于 18:00 按时间轴起点计，日出晚于 06:00 按终点计；缺观测夜数据时按整个时间轴计。
 */
export function nightCapacityMinutes(night?: ObsNight): number {
  if (!night) return NIGHT_TOTAL_MINUTES;
  const sunset = clockMinutes(night.sunset);
  const sunrise = clockMinutes(night.sunrise);
  const from = Math.max(0, sunset - NIGHT_START_MINUTES);
  const sunriseAxis = sunrise >= NIGHT_START_MINUTES ? sunrise - NIGHT_START_MINUTES : sunrise + (1440 - NIGHT_START_MINUTES);
  const to = Math.min(NIGHT_TOTAL_MINUTES, sunriseAxis);
  return Math.max(0, to - from);
}

/** 某夜某望远镜已被确认排程段占用的分钟数（可排除正在编辑的段） */
export function occupiedMinutes(sessions: ObsSession[], nightId: string, telescopeId: string, ignoreSessionId?: string): number {
  return sessions
    .filter(
      (session) =>
        session.id !== ignoreSessionId &&
        session.nightId === nightId &&
        session.telescopeId === telescopeId &&
        OCCUPYING_STATUSES.includes(session.status),
    )
    .reduce((sum, session) => sum + durationMinutes(session.startTime, session.endTime), 0);
}
