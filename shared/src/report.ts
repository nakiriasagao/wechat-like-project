/**
 * 举报工单状态机（design.md §3.1）。
 * 正常流：PENDING -> REVIEWING -> PUNISHED / REJECTED
 * 打回流：REVIEWING -> REJECTED（可附说明回用户）
 * 超时升级：PENDING/REVIEWING -> ESCALATED（待超管处理）
 * 申诉：PUNISHED -> APPEALING -> REVERTED / SUSTAINED
 */
export const ReportStatus = {
  PENDING: "PENDING", // 待客服初审
  REVIEWING: "REVIEWING", // 客服处理中
  PUNISHED: "PUNISHED", // 已处罚（终裁生效）
  REJECTED: "REJECTED", // 打回（无需处罚 / 举报无效）
  ESCALATED: "ESCALATED", // 超时/复杂，升级超管
  APPEALING: "APPEALING", // 处罚后申诉中
  SUSTAINED: "SUSTAINED", // 申诉驳回，维持处罚
  REVERTED: "REVERTED", // 申诉成立，撤销处罚
} as const;

export type ReportStatus = (typeof ReportStatus)[keyof typeof ReportStatus];

/** 可被举报的目标类型 */
export const ReportTargetType = {
  MESSAGE: "MESSAGE",
  USER: "USER",
  GROUP: "GROUP",
} as const;

export type ReportTargetType =
  (typeof ReportTargetType)[keyof typeof ReportTargetType];

/** 举报类别 */
export const ReportCategory = {
  HARASSMENT: "HARASSMENT", // 骚扰
  AD: "AD", // 广告
  ILLEGAL: "ILLEGAL", // 违法
  PORNOGRAPHY: "PORNOGRAPHY", // 涉黄
  FRAUD: "FRAUD", // 诈骗
  OTHER: "OTHER", // 其他
} as const;

export type ReportCategory =
  (typeof ReportCategory)[keyof typeof ReportCategory];

/** 处罚动作（终裁时选择） */
export const PunishAction = {
  MUTE_1D: "MUTE_1D",
  MUTE_7D: "MUTE_7D",
  MUTE_30D: "MUTE_30D",
  BAN_ACCOUNT: "BAN_ACCOUNT", // 封禁账号
  FREEZE_GROUP: "FREEZE_GROUP", // 冻结群
  DISBAND_GROUP: "DISBAND_GROUP", // 解散群
  DELETE_MESSAGE: "DELETE_MESSAGE", // 删除消息
  KICK_MEMBER: "KICK_MEMBER", // 踢出成员
} as const;

export type PunishAction = (typeof PunishAction)[keyof typeof PunishAction];

/** 账号状态 */
export const AccountStatus = {
  ACTIVE: "ACTIVE",
  MUTED: "MUTED", // 含 mute_until
  BANNED: "BANNED", // 永久封禁
} as const;

export type AccountStatus = (typeof AccountStatus)[keyof typeof AccountStatus];

/** 群状态 */
export const GroupStatus = {
  ACTIVE: "ACTIVE",
  FROZEN: "FROZEN",
  DISBANDED: "DISBANDED",
} as const;

export type GroupStatus = (typeof GroupStatus)[keyof typeof GroupStatus];
