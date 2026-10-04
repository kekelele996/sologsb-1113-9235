/**
 * 数据归属侧：目标库与编排表分侧管理，各自管各的。
 * - coordinator（目标协调员）：观测目标、曝光参数、地平高度阈值（targets 表）
 * - scheduler（值班排程员）：观测夜、排程段、望远镜占用（nights / sessions / telescopes / instruments 表）
 */
export type OwnerRole = 'coordinator' | 'scheduler';

/** 归属侧显示名 */
export const OWNER_LABEL: Record<OwnerRole, string> = {
  coordinator: '目标协调员',
  scheduler: '值班排程员',
};

/** 各归属侧管辖范围说明（页面副标题与归属徽标使用） */
export const OWNER_SCOPE_LABEL: Record<OwnerRole, string> = {
  coordinator: '观测目标 / 曝光参数 / 高度阈值',
  scheduler: '观测夜 / 排程段 / 望远镜占用',
};
