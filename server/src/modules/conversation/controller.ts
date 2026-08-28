import type { Request, Response } from "express";
import { AppError, BizCode, ConversationType, GroupRole, GroupStatus } from "shared";
import { getDb, tx } from "../../db/database.js";
import { now } from "../../utils/helpers.js";

/** 会话列表（含未读数、置顶、免打扰） */
export function listConversations(req: Request, res: Response) {
  const userId = req.user!.id;
  const rows = getDb()
    .prepare(
      `SELECT c.id, c.type, c.name, c.status, c.notice, c.mute_all, c.owner_id,
              cm.pin, cm.notify, cm.role as my_role, cm.last_read_msg_id as lastRead,
              (SELECT MAX(id) FROM messages m WHERE m.conversation_id = c.id) as last_msg_id,
              (SELECT COUNT(*) FROM messages m WHERE m.conversation_id = c.id
                 AND m.recalled = 0 AND m.id > cm.last_read_msg_id AND m.sender_id != ?) as unread
       FROM conversation_members cm
       JOIN conversations c ON c.id = cm.conversation_id
       WHERE cm.user_id = ?
       ORDER BY cm.pin DESC, last_msg_id DESC`
    )
    .all(userId, userId);

  const items = rows.map((r: any) => {
    const last = r.last_msg_id
      ? getDb().prepare("SELECT sender_id, content, type, created_at FROM messages WHERE id = ?").get(r.last_msg_id)
      : null;
    return {
      id: r.id,
      type: r.type,
      name: r.type === "DIRECT" ? directPartnerName(r.id, userId) : r.name,
      partnerId: r.type === "DIRECT" ? directPartnerId(r.id, userId) : null,
      status: r.status,
      notice: r.notice,
      pin: !!r.pin,
      notify: !!r.notify,
      muteAll: !!r.mute_all,
      myRole: r.my_role,
      unread: r.unread,
      lastMessage: last ? { senderId: last.sender_id, content: last.content, type: last.type, createdAt: last.created_at } : null,
    };
  });
  res.json({ items });
}

function directPartnerName(convId: number, userId: number) {
  const p = getDb()
    .prepare("SELECT u.nickname, u.username FROM conversation_members cm JOIN users u ON u.id = cm.user_id WHERE cm.conversation_id = ? AND cm.user_id != ? LIMIT 1")
    .get(convId, userId) as any;
  return p ? p.nickname : "单聊";
}

function directPartnerId(convId: number, userId: number) {
  const p = getDb()
    .prepare("SELECT user_id FROM conversation_members WHERE conversation_id = ? AND user_id != ? LIMIT 1")
    .get(convId, userId) as any;
  return p ? p.user_id : null;
}

/** 创建群聊 */
export function createGroup(req: Request, res: Response) {
  const name = String(req.body?.name ?? "").trim();
  const memberIds: number[] = Array.isArray(req.body?.memberIds) ? req.body.memberIds : [];
  if (!name) throw AppError.bad(BizCode.INVALID_INPUT, "群名必填");
  const db = getDb();
  const id = tx(() => {
    const r = db
      .prepare("INSERT INTO conversations (type, name, owner_id, status, mute_all, created_at) VALUES (?, ?, ?, 'ACTIVE', 0, ?)")
      .run(ConversationType.GROUP, name, req.user!.id, now());
    const convId = Number(r.lastInsertRowid);
    const add = db.prepare("INSERT INTO conversation_members (conversation_id, user_id, role, joined_at) VALUES (?, ?, ?, ?)");
    add.run(convId, req.user!.id, GroupRole.OWNER, now());
    for (const m of [...new Set(memberIds)]) {
      if (m === req.user!.id) continue;
      if (!db.prepare("SELECT id FROM users WHERE id = ?").get(m)) continue;
      add.run(convId, m, GroupRole.MEMBER, now());
    }
    return convId;
  });
  res.status(201).json({ conversationId: id });
}

/** 加入群（凭推荐 / 直接加入为成员） */
export function joinGroup(req: Request, res: Response) {
  const convId = Number(req.body?.convId);
  const db = getDb();
  const conv = db.prepare("SELECT * FROM conversations WHERE id = ? AND type = 'GROUP'").get(convId) as any;
  if (!conv) throw AppError.notFound(BizCode.GROUP_NOT_FOUND, "群不存在");
  if (conv.status === GroupStatus.DISBANDED) throw AppError.forbidden(BizCode.GROUP_DISBANDED, "群已解散");
  const exists = db.prepare("SELECT id FROM conversation_members WHERE conversation_id = ? AND user_id = ?").get(convId, req.user!.id);
  if (exists) throw AppError.bad(BizCode.STATE_CONFLICT, "已在群内");
  db.prepare("INSERT INTO conversation_members (conversation_id, user_id, role, joined_at) VALUES (?, ?, 'MEMBER', ?)").run(convId, req.user!.id, now());
  res.json({ message: "已加入群" });
}

/** 本人退群 */
export function leaveGroup(req: Request, res: Response) {
  const convId = Number(req.body?.convId ?? req.params.convId);
  const db = getDb();
  const member = db.prepare("SELECT * FROM conversation_members WHERE conversation_id = ? AND user_id = ?").get(convId, req.user!.id) as any;
  if (!member) throw AppError.forbidden(BizCode.NOT_IN_GROUP, "你不在该群");
  if (member.role === GroupRole.OWNER) throw AppError.forbidden(BizCode.OWNER_CANNOT_LEAVE, "群主不能直接退群，请先转让");
  db.prepare("DELETE FROM conversation_members WHERE conversation_id = ? AND user_id = ?").run(convId, req.user!.id);
  res.json({ message: "已退出群" });
}

/** 置顶 / 取消置顶 */
export function setPin(req: Request, res: Response) {
  const convId = Number(req.body?.convId);
  const pin = req.body?.pin ? 1 : 0;
  const r = getDb().prepare("UPDATE conversation_members SET pin = ? WHERE conversation_id = ? AND user_id = ?").run(pin, convId, req.user!.id);
  if (!r.changes) throw AppError.forbidden(BizCode.NOT_IN_GROUP, "你不在该会话");
  res.json({ pin: !!pin });
}

/** 免打扰开关 */
export function setNotify(req: Request, res: Response) {
  const convId = Number(req.body?.convId);
  const notify = req.body?.notify ? 1 : 0;
  const r = getDb().prepare("UPDATE conversation_members SET notify = ? WHERE conversation_id = ? AND user_id = ?").run(notify, convId, req.user!.id);
  if (!r.changes) throw AppError.forbidden(BizCode.NOT_IN_GROUP, "你不在该会话");
  res.json({ notify: !!notify });
}
