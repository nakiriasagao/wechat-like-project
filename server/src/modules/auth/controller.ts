import type { Request, Response } from "express";
import bcrypt from "bcryptjs";
import { AppError, BizCode, Role } from "shared";
import { config } from "../../config.js";
import { getDb } from "../../db/database.js";
import { signToken, type AuthUser } from "../../middleware/auth.js";

export function register(req: Request, res: Response) {
  const { username, nickname, password } = req.body ?? {};
  if (!username || !password) throw AppError.bad(BizCode.INVALID_INPUT, "用户名与密码必填");
  if (typeof username !== "string" || typeof password !== "string")
    throw AppError.bad(BizCode.INVALID_INPUT, "参数类型错误");

  const db = getDb();
  const dup = db.prepare("SELECT id FROM users WHERE username = ?").get(username);
  if (dup) throw AppError.bad(BizCode.STATE_CONFLICT, "用户名已存在");

  const hash = bcrypt.hashSync(password, config.bcryptRounds);
  const r = db
    .prepare("INSERT INTO users (username, password_hash, nickname, role, status, created_at) VALUES (?, ?, ?, 'USER', 'ACTIVE', ?)")
    .run(username, hash, nickname ?? username, Date.now());
  const id = Number(r.lastInsertRowid);

  const row = db.prepare("SELECT id, username, nickname, role, status, mute_until as muteUntil FROM users WHERE id = ?").get(id) as any;
  const token = signToken(row as AuthUser);
  res.status(201).json({ token, user: row });
}

export function login(req: Request, res: Response) {
  const { username, password } = req.body ?? {};
  const db = getDb();
  const row = db.prepare("SELECT * FROM users WHERE username = ?").get(username) as any;
  if (!row || !bcrypt.compareSync(password ?? "", row.password_hash)) {
    throw AppError.unauthorized(BizCode.LOGIN_FAILED, "用户名或密码错误");
  }
  if (row.status === "BANNED") throw AppError.forbidden(BizCode.FORBIDDEN, "账号已被封禁");

  const user = { id: row.id, username: row.username, nickname: row.nickname, role: row.role, status: row.status, muteUntil: row.mute_until } as AuthUser;
  const token = signToken(user);
  res.json({ token, user });
}

export function me(req: Request, res: Response) {
  res.json({ user: req.user });
}
