import type { NextFunction, Request, Response } from "express";
import jwt from "jsonwebtoken";
import { AppError, BizCode, Role, AccountStatus } from "shared";
import { config } from "../config.js";
import { getDb } from "../db/database.js";

export interface AuthUser {
  id: number;
  username: string;
  nickname: string;
  role: Role;
  status: AccountStatus;
  muteUntil: number | null;
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      user?: AuthUser;
    }
  }
}

export function signToken(user: AuthUser): string {
  return jwt.sign(
    { id: user.id, username: user.username, role: user.role },
    config.jwtSecret,
    { expiresIn: config.jwtExpires as any }
  );
}

export function verifyToken(token: string): { id: number; username: string; role: Role } {
  const payload = jwt.verify(token, config.jwtSecret) as {
    id: number;
    username: string;
    role: Role;
  };
  return payload;
}

/** 认证中间件：解析并校验 JWT，挂载 user（禁用账号拒绝） */
export function requireAuth(req: Request, _res: Response, next: NextFunction) {
  const header = req.headers.authorization ?? "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : "";
  if (!token) return next(AppError.unauthorized(BizCode.UNAUTHENTICATED, "缺少登录凭证"));

  let payload;
  try {
    payload = verifyToken(token);
  } catch {
    return next(AppError.unauthorized(BizCode.TOKEN_EXPIRED, "登录已过期，请重新登录"));
  }

  const row = getDb()
    .prepare("SELECT id, username, nickname, role, status, mute_until as muteUntil FROM users WHERE id = ?")
    .get(payload.id) as any;

  if (!row) return next(AppError.unauthorized(BizCode.UNAUTHENTICATED, "账号不存在"));
  if (row.status === AccountStatus.BANNED)
    return next(AppError.forbidden(BizCode.FORBIDDEN, "账号已被封禁"));

  req.user = row as AuthUser;
  next();
}
