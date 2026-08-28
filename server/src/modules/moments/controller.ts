import type { Request, Response } from "express";
import { AppError, BizCode } from "shared";
import { getDb, tx } from "../../db/database.js";
import { now } from "../../utils/helpers.js";

/** 是否为互为好友（ACCEPTED）；拉黑后双方不再可见彼此动态 */
function areFriends(a: number, b: number): boolean {
  if (a === b) return true;
  const row = getDb()
    .prepare("SELECT id FROM friendships WHERE ((user_a=? AND user_b=?) OR (user_a=? AND user_b=?)) AND status='ACCEPTED'")
    .get(a, b, b, a);
  return !!row;
}

function getMoment(momentId: number) {
  const m = getDb().prepare("SELECT * FROM moments WHERE id = ?").get(momentId) as any;
  if (!m) throw AppError.notFound(BizCode.MOMENT_NOT_FOUND, "动态不存在");
  return m;
}

/** 校验可见性：仅好友 + 本人可用（后端强制守卫） */
function assertCanView(moment: any, userId: number) {
  if (moment.author_id !== userId && !areFriends(moment.author_id, userId))
    throw AppError.forbidden(BizCode.NOT_FRIEND, "仅好友可见该动态");
}

/** 发表动态（文字/表情） */
export function publish(req: Request, res: Response) {
  const content = String(req.body?.content ?? "").trim();
  if (!content) throw AppError.bad(BizCode.INVALID_INPUT, "动态内容不能为空");
  const db = getDb();
  const r = db.prepare("INSERT INTO moments (author_id, content, created_at) VALUES (?, ?, ?)").run(req.user!.id, content, now());
  const moment = db
    .prepare("SELECT m.*, u.nickname as author_nickname, u.username as author_username, u.wechat_id as author_wechat FROM moments m JOIN users u ON u.id = m.author_id WHERE m.id = ?")
    .get(Number(r.lastInsertRowid));
  res.status(201).json({ moment: serializeMoment(moment, req.user!.id) });
}

/** 朋友圈时间线（好友 + 本人，游标分页） */
export function timeline(req: Request, res: Response) {
  const userId = req.user!.id;
  const before = Number(req.query.before ?? Number.MAX_SAFE_INTEGER);
  const limit = Math.min(Math.max(Number(req.query.limit) || 20, 1), 50);
  const db = getDb();
  const rows = db
    .prepare(
      `SELECT m.*, u.nickname as author_nickname, u.username as author_username, u.wechat_id as author_wechat
       FROM moments m JOIN users u ON u.id = m.author_id
       WHERE m.id < ? AND (
         m.author_id = ?
         OR m.author_id IN (
           SELECT CASE WHEN f.user_a = ? THEN f.user_b ELSE f.user_a END
           FROM friendships f
           WHERE f.status = 'ACCEPTED' AND (f.user_a = ? OR f.user_b = ?)
         )
       )
       ORDER BY m.id DESC LIMIT ?`
    )
    .all(before, userId, userId, userId, userId, limit) as any[];
  res.json({
    items: rows.map((r) => serializeMoment(r, userId)),
    hasMore: rows.length === limit,
  });
}

/** 点赞 / 取消点赞（切换） */
export function toggleLike(req: Request, res: Response) {
  const momentId = Number(req.params.momentId);
  const db = getDb();
  const moment = getMoment(momentId);
  assertCanView(moment, req.user!.id);
  const existing = db.prepare("SELECT id FROM moment_likes WHERE moment_id = ? AND user_id = ?").get(momentId, req.user!.id);
  if (existing) {
    db.prepare("DELETE FROM moment_likes WHERE id = ?").run(existing.id);
    res.json({ liked: false });
  } else {
    db.prepare("INSERT INTO moment_likes (moment_id, user_id, created_at) VALUES (?, ?, ?)").run(momentId, req.user!.id, now());
    res.json({ liked: true });
  }
}

/** 评论 / 回复评论 */
export function comment(req: Request, res: Response) {
  const momentId = Number(req.params.momentId);
  const content = String(req.body?.content ?? "").trim();
  const replyTo = req.body?.replyTo ? Number(req.body.replyTo) : null;
  if (!content) throw AppError.bad(BizCode.INVALID_INPUT, "评论不能为空");
  const db = getDb();
  const moment = getMoment(momentId);
  assertCanView(moment, req.user!.id);
  if (replyTo) {
    const rc = db.prepare("SELECT id, moment_id FROM moment_comments WHERE id = ?").get(replyTo) as any;
    if (!rc || rc.moment_id !== momentId)
      throw AppError.bad(BizCode.INVALID_INPUT, "回复的评论不存在");
  }
  let commentId = 0;
  tx(() => {
    commentId = Number(
      db.prepare("INSERT INTO moment_comments (moment_id, user_id, reply_to, content, created_at) VALUES (?, ?, ?, ?, ?)")
        .run(momentId, req.user!.id, replyTo, content, now()).lastInsertRowid
    );
  });
  const c = db
    .prepare(
      `SELECT c.id, c.moment_id as momentId, c.user_id as userId, c.reply_to as replyTo, c.content,
              u.nickname, r.nickname as replyNickname
       FROM moment_comments c
       JOIN users u ON u.id = c.user_id
       LEFT JOIN moment_comments rc ON rc.id = c.reply_to
       LEFT JOIN users r ON r.id = rc.user_id
       WHERE c.id = ?`
    )
    .get(commentId);
  res.status(201).json({ comment: serializeComment(c) });
}

/** 删除自己的动态（级联删除点赞与评论，仅作者） */
export function remove(req: Request, res: Response) {
  const momentId = Number(req.params.momentId);
  const db = getDb();
  const moment = getMoment(momentId);
  if (moment.author_id !== req.user!.id)
    throw AppError.forbidden(BizCode.FORBIDDEN, "只能删除自己的动态");
  tx(() => {
    db.prepare("DELETE FROM moment_likes WHERE moment_id = ?").run(momentId);
    db.prepare("DELETE FROM moment_comments WHERE moment_id = ?").run(momentId);
    db.prepare("DELETE FROM moments WHERE id = ?").run(momentId);
  });
  res.json({ message: "已删除动态" });
}

function serializeComment(c: any) {
  return {
    id: c.id,
    momentId: c.momentId,
    userId: c.userId,
    nickname: c.nickname,
    content: c.content,
    replyTo: c.replyTo,
    replyNickname: c.replyNickname ?? null,
  };
}

function serializeMoment(row: any, userId: number) {
  const db = getDb();
  const likes = db
    .prepare("SELECT u.id as userId, u.nickname FROM moment_likes l JOIN users u ON u.id = l.user_id WHERE l.moment_id = ? ORDER BY l.id")
    .all(row.id) as any[];
  const comments = db
    .prepare(
      `SELECT c.id, c.user_id as userId, c.content, c.reply_to as replyTo, u.nickname, r.nickname as replyNickname
       FROM moment_comments c
       JOIN users u ON u.id = c.user_id
       LEFT JOIN moment_comments rc ON rc.id = c.reply_to
       LEFT JOIN users r ON r.id = rc.user_id
       WHERE c.moment_id = ? ORDER BY c.id`
    )
    .all(row.id) as any[];
  return {
    id: row.id,
    author: {
      id: row.author_id,
      nickname: row.author_nickname,
      wechatId: row.author_wechat ?? row.author_username,
    },
    content: row.content,
    createdAt: row.created_at,
    likeCount: likes.length,
    likedByMe: likes.some((l) => l.userId === userId),
    likes: likes.map((l) => ({ userId: l.userId, nickname: l.nickname })),
    comments: comments.map(serializeComment),
  };
}
