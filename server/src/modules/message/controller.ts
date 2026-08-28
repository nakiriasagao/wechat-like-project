import type { Request, Response } from "express";
import { AppError, BizCode, MessageType, ConversationType } from "shared";
import { getDb, tx } from "../../db/database.js";
import { now, getConversation, getMember, assertCanSpeakInGroup, assertUserCanSpeak, assertFriends, serializeMessage } from "../../utils/helpers.js";

const RECALL_WINDOW_MS = 1000 * 60 * 2; // 2 分钟撤回窗口

export function sendMessage(req: Request, res: Response) {
  const convId = Number(req.body?.convId);
  const type = (req.body?.type as MessageType) ?? MessageType.TEXT;
  const content = req.body?.content ?? "";
  const replyTo = req.body?.replyTo ? Number(req.body.replyTo) : null;

  const user = req.user!;
  assertUserCanSpeak(user);

  const conv = getConversation(convId);
  // 单聊必须为好友；群聊必须为成员
  if (conv.type === ConversationType.DIRECT) {
    const partnerId = getConversationPartner(convId, user.id);
    if (!partnerId) throw AppError.forbidden(BizCode.NOT_IN_GROUP, "你不在该会话");
    assertFriends(user.id, partnerId);
  } else {
    const member = getMember(convId, user.id);
    if (!member) throw AppError.forbidden(BizCode.NOT_IN_GROUP, "你不在该群");
    assertCanSpeakInGroup(convId, user.id);
  }

  const db = getDb();
  const r = tx(() => {
    const mentions = Array.isArray(req.body?.mentions) ? JSON.stringify(req.body.mentions) : null;
    const ins = db
      .prepare("INSERT INTO messages (conversation_id, sender_id, type, content, reply_to, mentions, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)")
      .run(convId, user.id, type, String(content), replyTo, mentions, now());
    return Number(ins.lastInsertRowid);
  });
  const msg = db
    .prepare("SELECT m.*, u.nickname as sender_nickname FROM messages m LEFT JOIN users u ON u.id = m.sender_id WHERE m.id = ?")
    .get(r);
  res.status(201).json({ message: serializeMessage(msg) });
}

function getConversationPartner(convId: number, userId: number): number {
  const row = getDb()
    .prepare("SELECT user_id FROM conversation_members WHERE conversation_id = ? AND user_id != ? LIMIT 1")
    .get(convId, userId) as any;
  return row?.user_id;
}

/** 拉取消息（游标分页） */
export function listMessages(req: Request, res: Response) {
  const convId = Number(req.params.convId);
  const before = Number(req.query.before ?? Number.MAX_SAFE_INTEGER);
  const limit = Math.min(Number(req.query.limit ?? 30), 100);
  const userId = req.user!.id;

  const member = getMember(convId, userId);
  if (!member) throw AppError.forbidden(BizCode.NOT_IN_GROUP, "你不在该会话");

  const rows = getDb()
    .prepare("SELECT m.*, u.nickname as sender_nickname FROM messages m LEFT JOIN users u ON u.id = m.sender_id WHERE m.conversation_id = ? AND m.id < ? ORDER BY m.id DESC LIMIT ?")
    .all(convId, before, limit);
  res.json({
    items: rows.map(serializeMessage).reverse(),
    hasMore: rows.length === limit,
  });
}

/** 标记已读：更新会话成员 last_read_msg_id */
export function markRead(req: Request, res: Response) {
  const convId = Number(req.body?.convId);
  const msgId = Number(req.body?.lastReadMsgId ?? 0);
  const r = getDb()
    .prepare("UPDATE conversation_members SET last_read_msg_id = MAX(last_read_msg_id, ?) WHERE conversation_id = ? AND user_id = ?")
    .run(msgId, convId, req.user!.id);
  if (!r.changes) throw AppError.forbidden(BizCode.NOT_IN_GROUP, "你不在该会话");
  res.json({ ok: true });
}

/** 撤回（窗口内，仅本人或超管） */
export function recallMessage(req: Request, res: Response) {
  const msgId = Number(req.body?.messageId);
  const db = getDb();
  const msg = db.prepare("SELECT * FROM messages WHERE id = ?").get(msgId) as any;
  if (!msg) throw AppError.notFound(BizCode.MESSAGE_NOT_FOUND, "消息不存在");
  if (msg.recalled) throw AppError.bad(BizCode.STATE_CONFLICT, "消息已撤回");

  const isOwner = msg.sender_id === req.user!.id;
  const isIntervener = req.user!.role === "SUPER_ADMIN" || req.user!.role === "PLATFORM_ADMIN";
  if (!isOwner && !isIntervener) throw AppError.forbidden(BizCode.FORBIDDEN, "只能撤回自己的消息");
  if (isOwner && Date.now() - msg.created_at > RECALL_WINDOW_MS)
    throw AppError.forbidden(BizCode.RECALL_EXPIRED, "超过 2 分钟，无法撤回");

  db.prepare("UPDATE messages SET recalled = 1, recalled_by = ? WHERE id = ?").run(req.user!.id, msgId);
  res.json({ message: serializeMessage({ ...msg, recalled: 1, recalled_by: req.user!.id }) });
}

/** 本地删除（隐藏该消息于自己视角，不影响他人） */
export function deleteMessage(req: Request, res: Response) {
  const msgId = Number(req.body?.messageId);
  const db = getDb();
  const msg = db.prepare("SELECT * FROM messages WHERE id = ?").get(msgId) as any;
  if (!msg) throw AppError.notFound(BizCode.MESSAGE_NOT_FOUND, "消息不存在");
  const me = req.user!.id;
  let deletedBy: number[] = msg.deleted_by ? JSON.parse(msg.deleted_by) : [];
  if (!deletedBy.includes(me)) deletedBy.push(me);
  db.prepare("UPDATE messages SET deleted_by = ? WHERE id = ?").run(JSON.stringify(deletedBy), msgId);
  res.json({ message: serializeMessage({ ...msg, deleted_by: JSON.stringify(deletedBy) }) });
}
