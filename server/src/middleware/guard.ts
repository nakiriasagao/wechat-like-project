import type { NextFunction, Request, Response } from "express";
import { AppError, BizCode, GroupRole, canPlatform, canInGroup, groupRoleFromGlobal, type Role } from "shared";
import { getDb } from "../db/database.js";

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      groupRole?: GroupRole;
      convId?: number;
    }
  }
}

/**
 * 平台动作守卫：校验 req.user.role 是否被权限矩阵允许，否则 403 + 业务码。
 * 用法：router.post('/x', requireAuth, guard('report:review'), handler)
 */
export function guard(action: keyof Record<string, Role[]>) {
  return (req: Request, _res: Response, next: NextFunction) => {
    const user = req.user!;
    if (!canPlatform(action as any, user.role)) {
      return next(AppError.forbidden(BizCode.ADMIN_REQUIRED, `当前角色无权执行: ${String(action)}`));
    }
    next();
  };
}

/** 读取会话 id（优先 convId 参数/请求体/查询串），失败返回 null */
function readConvId(req: Request): number | null {
  const raw = req.params.convId ?? req.params.id ?? req.body?.convId ?? req.query.convId;
  const convId = Number(raw);
  if (!raw || !Number.isFinite(convId) || convId <= 0) return null;
  return convId;
}

/**
 * 群内动作守卫：会话既可能是群聊（按成员角色判定）也允许平台角色介入。
 */
export function guardGroup(action: keyof Record<string, GroupRole[]>) {
  return (req: Request, _res: Response, next: NextFunction) => {
    const user = req.user!;
    const convId = readConvId(req);
    if (!convId) return next(AppError.bad(BizCode.INVALID_INPUT, "缺少会话 id"));

    // 平台角色（客服/管理员/超管）以最高权限介入
    const platformGr = groupRoleFromGlobal(user.role);
    if (platformGr) {
      req.groupRole = platformGr;
      req.convId = convId;
      return next();
    }

    const member = getDb()
      .prepare("SELECT role FROM conversation_members WHERE conversation_id = ? AND user_id = ?")
      .get(convId, user.id) as any;
    if (!member) {
      return next(AppError.forbidden(BizCode.NOT_IN_GROUP, "你不在该群"));
    }

    if (!canInGroup(action as any, member.role)) {
      return next(AppError.forbidden(BizCode.NOT_GROUP_ADMIN, `群内角色无权执行: ${String(action)}`));
    }
    req.groupRole = member.role;
    req.convId = convId;
    next();
  };
}
