/**
 * 业务错误码（单源定义）。HTTP 状态码由 code 决定：
 * - 100xx 认证类 -> 401
 * - 200xx 业务校验 -> 400
 * - 300xx 资源不存在 -> 404
 * - 403xx 权限拒绝 -> 403
 * 禁止在业务代码里散落魔法字符串。
 */
export const BizCode = {
  // 认证 (401)
  UNAUTHENTICATED: 10001,
  TOKEN_EXPIRED: 10002,
  LOGIN_FAILED: 10003,

  // 业务校验 (400)
  VALIDATION_ERROR: 20001,
  INVALID_INPUT: 20002,
  STATE_CONFLICT: 20003, // 状态机不允许的跳转

  // 资源 (404)
  NOT_FOUND: 30001,
  USER_NOT_FOUND: 30002,
  CONVERSATION_NOT_FOUND: 30003,
  GROUP_NOT_FOUND: 30004,
  MESSAGE_NOT_FOUND: 30005,
  REPORT_NOT_FOUND: 30006,
  MOMENT_NOT_FOUND: 30007,

  // 权限 (403) —— 与 permissions.ts 对应
  FORBIDDEN: 40300,
  NOT_GROUP_OWNER: 40301,
  NOT_GROUP_ADMIN: 40302,
  OWNER_CANNOT_LEAVE: 40303,
  MEMBER_MUTED: 40304,
  GROUP_FROZEN: 40305,
  NOT_IN_GROUP: 40306,
  NOT_CONVERSATION_MEMBER: 40307,
  NOT_FRIEND: 40308,
  CANNOT_SELF_FRIEND: 40309,
  GROUP_DISBANDED: 40310,
  RECALL_EXPIRED: 40311,
  ADMIN_REQUIRED: 40312,
} as const;

export type BizCode = (typeof BizCode)[keyof typeof BizCode];

/** 从业务码映射到 HTTP 状态码 */
export function httpStatusFor(code: number): number {
  if (code >= 10000 && code < 20000) return 401;
  if (code >= 20000 && code < 30000) return 400;
  if (code >= 30000 && code < 40300) return 404;
  if (code >= 40300 && code < 50000) return 403;
  return 500;
}
