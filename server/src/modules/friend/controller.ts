import type { Request, Response } from "express";
import { AppError, BizCode, FriendStatus, ConversationType, GroupRole } from "shared";
import { getDb, tx } from "../../db/database.js";
import { now } from "../../utils/helpers.js";

/** 读两用户之间与该视角的关系 */
function relationBetween(a: number, b: number) {
  const row = getDb()
    .prepare("SELECT * FROM friendships WHERE (user_a = ? AND user_b = ?) OR (user_a = ? AND user_b = ?)")
    .get(a, b, b, a) as any;
  if (!row) return { status: FriendStatus.NONE };
  if (row.status === "ACCEPTED") return { status: FriendStatus.ACCEPTED, row };
  if (row.status === "PENDING") {
    return { status: row.requester === a ? FriendStatus.PENDING : FriendStatus.REQUESTED, row };
  }
  // BLOCKED：谁拉黑谁
  if (row.requester === a) return { status: FriendStatus.BLOCKED, row };
  return { status: FriendStatus.BLOCKED_BY, row };
}

/** 搜索用户（用于加好友） */
export function search(req: Request, res: Response) {
  const q = String(req.query.q ?? "").trim();
  if (!q) return res.json({ items: [] });
  const rows = getDb()
    .prepare("SELECT id, username, nickname FROM users WHERE username LIKE ? AND id != ? LIMIT 20")
    .all(`%${q}%`, req.user!.id);
  res.json({ items: rows });
}

/** 发送好友申请 */
export function sendRequest(req: Request, res: Response) {
  const targetId = Number(req.body?.userId);
  if (targetId === req.user!.id) throw AppError.forbidden(BizCode.CANNOT_SELF_FRIEND, "不能添加自己为好友");
  const target = getDb().prepare("SELECT id FROM users WHERE id = ?").get(targetId);
  if (!target) throw AppError.notFound(BizCode.USER_NOT_FOUND, "用户不存在");
  const { status } = relationBetween(req.user!.id, targetId);
  if (status === FriendStatus.ACCEPTED) throw AppError.bad(BizCode.STATE_CONFLICT, "已是好友");
  if (status === FriendStatus.BLOCKED_BY) throw AppError.forbidden(BizCode.FORBIDDEN, "对方已拉黑你");
  if (status === FriendStatus.BLOCKED) throw AppError.bad(BizCode.STATE_CONFLICT, "请先解除拉黑");
  if (status === FriendStatus.PENDING || status === FriendStatus.REQUESTED)
    throw AppError.bad(BizCode.STATE_CONFLICT, "已有待处理申请");

  const a = Math.min(req.user!.id, targetId);
  const b = Math.max(req.user!.id, targetId);
  getDb()
    .prepare("INSERT INTO friendships (user_a, user_b, status, requester, created_at, updated_at) VALUES (?, ?, 'PENDING', ?, ?, ?)")
    .run(a, b, req.user!.id, now(), now());
  res.status(201).json({ message: "申请已发送" });
}

/** 我的好友列表 */
export function listFriends(req: Request, res: Response) {
  const db = getDb();
  const rows = db
    .prepare(
      `SELECT f.*, u.id as uid, u.nickname, u.username FROM friendships f
       JOIN users u ON u.id = (CASE WHEN f.user_a = ? THEN f.user_b ELSE f.user_a END)
       WHERE (f.user_a = ? OR f.user_b = ?) AND f.status = 'ACCEPTED'`
    )
    .all(req.user!.id, req.user!.id, req.user!.id);
  res.json({ items: rows.map((r: any) => ({ userId: r.uid, nickname: r.nickname, username: r.username })) });
}

/** 我的待处理 / 申请列表（friendships 统一存 user_a=min、user_b=max，requester=发起方） */
export function listRequests(req: Request, res: Response) {
  const db = getDb();
  // 收到的申请：对方（requester）发起，我作为另一端点
  const incoming = db
    .prepare(
      `SELECT f.requester, u.nickname, u.username, f.updated_at FROM friendships f
       JOIN users u ON u.id = f.requester
       WHERE f.status = 'PENDING' AND f.requester != ? AND (f.user_a = ? OR f.user_b = ?)`
    )
    .all(req.user!.id, req.user!.id, req.user!.id);
  // 我发出的申请：requester 是我，对方是另一端点
  const outgoing = db
    .prepare(
      `SELECT f.user_b as uid, u.nickname, u.username, f.updated_at FROM friendships f
       JOIN users u ON u.id = f.user_b
       WHERE f.status = 'PENDING' AND f.requester = ?`
    )
    .all(req.user!.id);
  res.json({ incoming, outgoing });
}

/** 接受好友申请：建立好友 + 自动创建单聊 */
export function acceptRequest(req: Request, res: Response) {
  const requester = Number(req.body?.userId);
  const db = getDb();
  tx(() => {
    const rel = db
      .prepare("SELECT * FROM friendships WHERE status='PENDING' AND requester = ? AND (user_a = ? OR user_b = ?)")
      .get(requester, req.user!.id, req.user!.id) as any;
    if (!rel) throw AppError.bad(BizCode.STATE_CONFLICT, "没有可接受的申请");
    db.prepare("UPDATE friendships SET status='ACCEPTED', updated_at=? WHERE id=?").run(now(), rel.id);
    createDirectConversation(requester, req.user!.id);
  });
  res.json({ message: "已添加好友" });
}

/** 拒绝好友申请 */
export function rejectRequest(req: Request, res: Response) {
  const requester = Number(req.body?.userId);
  const db = getDb();
  const del = db
    .prepare("DELETE FROM friendships WHERE status='PENDING' AND requester = ? AND (user_a = ? OR user_b = ?)")
    .run(requester, req.user!.id, req.user!.id);
  if (!del.changes) throw AppError.bad(BizCode.STATE_CONFLICT, "没有可拒绝的申请");
  res.json({ message: "已拒绝申请" });
}

/** 删除好友：双向删除关系，但保留历史消息（单聊会话保留） */
export function deleteFriend(req: Request, res: Response) {
  const other = Number(req.params.userId);
  const db = getDb();
  const del = db
    .prepare("DELETE FROM friendships WHERE ((user_a=? AND user_b=?) OR (user_a=? AND user_b=?)) AND status='ACCEPTED'")
    .run(req.user!.id, other, other, req.user!.id);
  if (!del.changes) throw AppError.bad(BizCode.STATE_CONFLICT, "你们不是好友");
  res.json({ message: "已删除好友" });
}

/** 拉黑（单向） */
export function blockUser(req: Request, res: Response) {
  const other = Number(req.body?.userId);
  const db = getDb();
  tx(() => {
    const rel = db
      .prepare("SELECT * FROM friendships WHERE (user_a=? AND user_b=?) OR (user_a=? AND user_b=?)")
      .get(req.user!.id, other, other, req.user!.id) as any;
    if (rel) {
      db.prepare("DELETE FROM friendships WHERE id = ?").run(rel.id);
    }
    const a = Math.min(req.user!.id, other);
    const b = Math.max(req.user!.id, other);
    db.prepare("INSERT INTO friendships (user_a, user_b, status, requester, created_at, updated_at) VALUES (?, ?, 'BLOCKED', ?, ?, ?)")
      .run(a, b, req.user!.id, now(), now());
  });
  res.json({ message: "已拉黑" });
}

/** 解除拉黑 */
export function unblockUser(req: Request, res: Response) {
  const other = Number(req.body?.userId);
  const db = getDb();
  const del = db
    .prepare("DELETE FROM friendships WHERE ((user_a=? AND user_b=?) OR (user_a=? AND user_b=?)) AND status='BLOCKED' AND requester=?")
    .run(req.user!.id, other, other, req.user!.id, req.user!.id);
  if (!del.changes) throw AppError.bad(BizCode.STATE_CONFLICT, "未拉黑该用户");
  res.json({ message: "已解除拉黑" });
}

/** 创建单聊会话（去重 dm_key） */
export function createDirectConversation(a: number, b: number) {
  const db = getDb();
  const key = [a, b].sort((x, y) => x - y).join(":");
  const existing = db.prepare("SELECT id FROM conversations WHERE dm_key = ?").get(key);
  if (existing) return Number(existing.id);
  const r = db
    .prepare("INSERT INTO conversations (type, name, status, created_at, dm_key) VALUES ('DIRECT', NULL, 'ACTIVE', ?, ?)")
    .run(now(), key);
  const convId = Number(r.lastInsertRowid);
  const add = db.prepare("INSERT INTO conversation_members (conversation_id, user_id, role, joined_at) VALUES (?, ?, 'MEMBER', ?)");
  add.run(convId, a, now());
  add.run(convId, b, now());
  return convId;
}
