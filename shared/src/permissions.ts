/**
 * 权限矩阵单源定义（对应 design.md §2）。
 * 后端统一用 checkPermission 强制守卫（403 + 业务码），前端只渲染。
 *
 * 约定：平台动作（Action）用全局 Role 判定；群内动作用 GroupRole + 平台角色联合判定。
 * 任何改动必须同步 docs/design.md。
 */
import { Role, GroupRole } from "./role.js";

/** 平台动作 -> 允许的全局角色 */
export const PermissionMatrix: Record<string, Role[]> = {
  // 发起单聊、发送/撤回自己的消息：所有在线用户
  "conversation:create": [Role.USER, Role.CUSTOMER_SERVICE, Role.PLATFORM_ADMIN, Role.SUPER_ADMIN],
  "message:send": [Role.USER, Role.CUSTOMER_SERVICE, Role.PLATFORM_ADMIN, Role.SUPER_ADMIN],
  "message:recall": [Role.USER, Role.CUSTOMER_SERVICE, Role.PLATFORM_ADMIN, Role.SUPER_ADMIN],

  // 群内治理：群管理员/群主（联合判定见群内函数）
  "group:manage": [Role.USER, Role.CUSTOMER_SERVICE, Role.PLATFORM_ADMIN, Role.SUPER_ADMIN],
  "group:admin": [Role.CUSTOMER_SERVICE, Role.PLATFORM_ADMIN, Role.SUPER_ADMIN],

  // 举报：任何用户可发起
  "report:create": [Role.USER, Role.CUSTOMER_SERVICE, Role.PLATFORM_ADMIN, Role.SUPER_ADMIN],

  // 平台客服：初审 + 打回
  "report:review": [Role.CUSTOMER_SERVICE, Role.SUPER_ADMIN],

  // 平台管理员：终裁 + 处罚
  "report:punish": [Role.PLATFORM_ADMIN, Role.SUPER_ADMIN],

  // 封禁账号 / 封群：管理员 + 超管
  "account:ban": [Role.PLATFORM_ADMIN, Role.SUPER_ADMIN],

  // 查看统计：管理员 + 超管
  "stats:view": [Role.PLATFORM_ADMIN, Role.SUPER_ADMIN],

  // 管理客服账号：平台管理员 + 超管
  "admin:manage_service": [Role.PLATFORM_ADMIN, Role.SUPER_ADMIN],

  // 系统配置 / 权限配置：仅超管
  "system:configure": [Role.SUPER_ADMIN],
};

/** 权限点文本常量，避免散落魔法字符串 */
export const Permission = Object.freeze(PermissionMatrix);

/** 群内动作 -> 需要的群内角色 */
export const GroupPermissionMatrix: Record<string, GroupRole[]> = {
  "group:invite": [GroupRole.ADMIN, GroupRole.OWNER], // 邀请
  "group:kick": [GroupRole.ADMIN, GroupRole.OWNER], // 踢人（默认需群主授权见业务）
  "group:mute_member": [GroupRole.ADMIN, GroupRole.OWNER], // 禁言成员
  "group:mute_all": [GroupRole.OWNER], // 全员禁言，仅群主
  "group:transfer": [GroupRole.OWNER], // 转让群主
  "group:set_admin": [GroupRole.OWNER], // 设置管理员
  "group:notice": [GroupRole.ADMIN, GroupRole.OWNER], // 群公告
  "group:disband": [GroupRole.OWNER], // 解散群
  "group:rename": [GroupRole.ADMIN, GroupRole.OWNER], // 改名
};

export const GroupPermission = Object.freeze(GroupPermissionMatrix);

/** 平台动作权限检查 */
export function canPlatform(action: keyof typeof PermissionMatrix, role: Role): boolean {
  const roles = PermissionMatrix[action];
  if (!roles) return false;
  return roles.includes(role);
}

/** 群内动作权限检查 */
export function canInGroup(action: keyof typeof GroupPermissionMatrix, role: GroupRole | Role): boolean {
  const roles = GroupPermissionMatrix[action];
  if (!roles) return false;
  const gr = isGroupRole(role) ? role : groupRoleFromGlobal(role);
  if (!gr) return false;
  return roles.includes(gr);
}

export function isGroupRole(role: string): role is GroupRole {
  return role === GroupRole.OWNER || role === GroupRole.ADMIN || role === GroupRole.MEMBER;
}

/** 平台角色是否可仅凭平台身份执行群动作（客服/超管可介入） */
export function groupRoleFromGlobal(role: Role): GroupRole | null {
  switch (role) {
    case Role.SUPER_ADMIN:
    case Role.PLATFORM_ADMIN:
    case Role.CUSTOMER_SERVICE:
      return GroupRole.OWNER; // 平台角色介入视为最高权限
    default:
      return null;
  }
}
