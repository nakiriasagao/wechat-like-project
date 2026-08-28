/**
 * 全局角色（平台维度）。群内角色见 GroupRole。
 * 对应 design.md §2。改角色或权限前先读 docs/design.md。
 */
export const Role = {
  USER: "USER", // 普通用户
  CUSTOMER_SERVICE: "CUSTOMER_SERVICE", // 平台客服（初审 + 打回）
  PLATFORM_ADMIN: "PLATFORM_ADMIN", // 平台管理员（终裁 + 处罚）
  SUPER_ADMIN: "SUPER_ADMIN", // 超级管理员（系统与权限配置）
} as const;

export type Role = (typeof Role)[keyof typeof Role];

export const ALL_ROLES = Object.values(Role) as Role[];

/** 群内角色（会话维度）。 */
export const GroupRole = {
  MEMBER: "MEMBER",
  ADMIN: "ADMIN", // 群管理员
  OWNER: "OWNER", // 群主
} as const;

export type GroupRole = (typeof GroupRole)[keyof typeof GroupRole];

/** 会话类型 */
export const ConversationType = {
  DIRECT: "DIRECT", // 单聊
  GROUP: "GROUP", // 群聊
} as const;

export type ConversationType =
  (typeof ConversationType)[keyof typeof ConversationType];

/** 消息类型 */
export const MessageType = {
  TEXT: "TEXT",
  IMAGE: "IMAGE",
  FILE: "FILE",
  VOICE: "VOICE",
  EMOTICON: "EMOTICON",
  SYSTEM: "SYSTEM",
} as const;

export type MessageType = (typeof MessageType)[keyof typeof MessageType];

/** 好友关系 */
export const FriendStatus = {
  NONE: "NONE", // 无关系
  PENDING: "PENDING", // 以待确认（发给对方申请）
  ACCEPTED: "ACCEPTED", // 互为好友
  REQUESTED: "REQUESTED", // 对方申请我，待我确认
  BLOCKED: "BLOCKED", // 我拉黑对方
  BLOCKED_BY: "BLOCKED_BY", // 对方拉黑我
} as const;

export type FriendStatus = (typeof FriendStatus)[keyof typeof FriendStatus];
