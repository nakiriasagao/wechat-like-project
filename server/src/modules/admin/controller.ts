import type { Request, Response } from "express";
import bcrypt from "bcryptjs";
import { AppError, BizCode, Role, AccountStatus } from "shared";
import { getDb } from "../../db/database.js";

/** 平台统计概览 */
export function stats(req: Request, res: Response) {
  const db = getDb();
  const totalUsers = (db.prepare("SELECT COUNT(*) c FROM users").get() as any).c;
  const totalConversations = (db.prepare("SELECT COUNT(*) c FROM conversations").get() as any).c;
  const totalGroups = (db.prepare("SELECT COUNT(*) c FROM conversations WHERE type='GROUP'").get() as any).c;
  const totalMessages = (db.prepare("SELECT COUNT(*) c FROM messages").get() as any).c;
  const pendingReports = (db.prepare("SELECT COUNT(*) c FROM reports WHERE status IN ('PENDING','REVIEWING','APPEALING','ESCALATED')").get() as any).c;
  const bannedUsers = (db.prepare("SELECT COUNT(*) c FROM users WHERE status='BANNED'").get() as any).c;
  const mutes = (db.prepare("SELECT COUNT(*) c FROM users WHERE status='MUTED'").get() as any).c;
  res.json({ totalUsers, totalConversations, totalGroups, totalMessages, pendingReports, bannedUsers, mutes });
}

/** 全量举报（含历史）用于溯源 */
export function allReports(req: Request, res: Response) {
  const items = getDb().prepare("SELECT * FROM reports ORDER BY created_at DESC").all();
  res.json({ items });
}

/** 用户列表（含封禁/禁言状态），供管理后台做"用户管理" */
export function listUsers(_req: Request, res: Response) {
  const items = getDb()
    .prepare("SELECT id, username, nickname, role, status, mute_until as muteUntil FROM users ORDER BY id")
    .all();
  res.json({ items });
}

/** 封禁/解除账号 */
export function banAccount(req: Request, res: Response) {
  const userId = Number(req.body?.userId);
  const ban = req.body?.ban ? true : false;
  const db = getDb();
  const target = db.prepare("SELECT role FROM users WHERE id = ?").get(userId) as any;
  if (!target) throw AppError.notFound(BizCode.USER_NOT_FOUND, "用户不存在");
  if (target.role !== Role.USER) throw AppError.conflict(BizCode.STATE_CONFLICT, "只能封禁普通用户");
  db.prepare("UPDATE users SET status = ? WHERE id = ?").run(ban ? AccountStatus.BANNED : AccountStatus.ACTIVE, userId);
  res.json({ banned: ban });
}

/** 客服账号列表 / 新增（仅管理员+超管） */
export function listServiceAccounts(_req: Request, res: Response) {
  const items = getDb()
    .prepare("SELECT id, username, nickname, role, status FROM users WHERE role IN (?, ?)")
    .all(Role.CUSTOMER_SERVICE, Role.PLATFORM_ADMIN);
  res.json({ items });
}

/** 新增客服账号 */
export function createServiceAccount(req: Request, res: Response) {
  const { username, nickname, password } = req.body ?? {};
  const role = req.body?.role === Role.PLATFORM_ADMIN ? Role.PLATFORM_ADMIN : Role.CUSTOMER_SERVICE;
  if (!username || !password) throw AppError.bad(BizCode.INVALID_INPUT, "用户名与密码必填");
  const db = getDb();
  if (db.prepare("SELECT id FROM users WHERE username = ?").get(username))
    throw AppError.bad(BizCode.STATE_CONFLICT, "用户名已存在");
  const hash = bcrypt.hashSync(password, 10);
  const r = db
    .prepare("INSERT INTO users (username, password_hash, nickname, role, status, created_at) VALUES (?, ?, ?, ?, 'ACTIVE', ?)")
    .run(username, hash, nickname ?? username, role, Date.now());
  res.status(201).json({ id: Number(r.lastInsertRowid) });
}
