import type { Request, Response } from "express";
import { AppError, BizCode, GroupRole, GroupStatus } from "shared";
import { getDb, tx } from "../../db/database.js";
import { now } from "../../utils/helpers.js";

/** 群信息 + 成员列表（普通用户可看，踢人靠守卫） */
export function getGroup(req: Request, res: Response) {
  const convId = Number(req.params.convId);
  const db = getDb();
  const conv = db.prepare("SELECT * FROM conversations WHERE id = ? AND type='GROUP'").get(convId) as any;
  if (!conv) throw AppError.notFound(BizCode.GROUP_NOT_FOUND, "群不存在");
  const members = db
    .prepare(
      `SELECT cm.user_id, cm.role, cm.muted_until as mutedUntil, u.nickname, u.username, cm.joined_at
       FROM conversation_members cm JOIN users u ON u.id = cm.user_id
       WHERE cm.conversation_id = ?`
    )
    .all(convId);
  res.json({
    id: conv.id, name: conv.name, ownerId: conv.owner_id, status: conv.status,
    notice: conv.notice, muteAll: !!conv.mute_all, members,
  });
}

/** 邀请成员（群管理员/群主） */
export function invite(req: Request, res: Response) {
  const convId = req.convId!;
  const userIds: number[] = Array.isArray(req.body?.userIds) ? req.body.userIds : [];
  const db = getDb();
  tx(() => {
    const add = db.prepare("INSERT INTO conversation_members (conversation_id, user_id, role, joined_at) VALUES (?, ?, 'MEMBER', ?)");
    for (const u of userIds) {
      if (!db.prepare("SELECT id FROM users WHERE id = ?").get(u)) continue;
      const exists = db.prepare("SELECT id FROM conversation_members WHERE conversation_id = ? AND user_id = ?").get(convId, u);
      if (exists) continue;
      add.run(convId, u, now());
    }
  });
  res.json({ message: "已发起邀请" });
}

/** 踢出成员（管理员/群主；不能踢群主） */
export function kick(req: Request, res: Response) {
  const convId = req.convId!;
  const target = Number(req.body?.userId);
  const db = getDb();
  const conv = db.prepare("SELECT owner_id FROM conversations WHERE id = ?").get(convId) as any;
  const targetMember = db.prepare("SELECT role FROM conversation_members WHERE conversation_id = ? AND user_id = ?").get(convId, target) as any;
  if (!targetMember) throw AppError.bad(BizCode.INVALID_INPUT, "目标不在群内");
  if (target === conv.owner_id) throw AppError.forbidden(BizCode.FORBIDDEN, "不能踢出群主");
  if (target === req.user!.id) throw AppError.bad(BizCode.INVALID_INPUT, "不能移除自己");

  // 群管理员不可踢其他管理员/群主
  if (req.user!.role === "USER" && req.groupRole === GroupRole.ADMIN && targetMember.role !== GroupRole.MEMBER)
    throw AppError.forbidden(BizCode.FORBIDDEN, "管理员只能踢普通成员");

  db.prepare("DELETE FROM conversation_members WHERE conversation_id = ? AND user_id = ?").run(convId, target);
  res.json({ message: "已移除成员" });
}

/** 禁言成员（管理员/群主；平台角色介入） */
export function muteMember(req: Request, res: Response) {
  const convId = req.convId!;
  const target = Number(req.body?.userId);
  const until = Number(req.body?.until) || 0; // time, 0=解禁（NaN/缺省亦视为解禁）
  const db = getDb();
  if (target === req.user!.id) throw AppError.bad(BizCode.INVALID_INPUT, "不能禁言自己");
  const tm = db.prepare("SELECT role FROM conversation_members WHERE conversation_id = ? AND user_id = ?").get(convId, target) as any;
  if (!tm) throw AppError.bad(BizCode.INVALID_INPUT, "目标不在群内");
  // 群管理员不能对其他管理员/群主禁言（群主可禁言包括管理员）
  if (req.user!.role === "USER" && req.groupRole === GroupRole.ADMIN && tm.role !== GroupRole.MEMBER)
    throw AppError.forbidden(BizCode.FORBIDDEN, "管理员只能禁言普通成员");

  db.prepare("UPDATE conversation_members SET muted_until = ? WHERE conversation_id = ? AND user_id = ?").run(until || null, convId, target);
  res.json({ message: until ? "已禁言" : "已解除禁言" });
}

/** 全员禁言（群主） */
export function muteAll(req: Request, res: Response) {
  const convId = req.convId!;
  const mute = req.body?.mute ? 1 : 0;
  getDb().prepare("UPDATE conversations SET mute_all = ? WHERE id = ?").run(mute, convId);
  res.json({ muteAll: !!mute });
}

/** 转让群主（群主） */
export function transferOwner(req: Request, res: Response) {
  const convId = req.convId!;
  const target = Number(req.body?.userId);
  const db = getDb();
  tx(() => {
    const tm = db.prepare("SELECT role FROM conversation_members WHERE conversation_id = ? AND user_id = ?").get(convId, target) as any;
    if (!tm) throw AppError.bad(BizCode.INVALID_INPUT, "目标不在群内");
    if (target === req.user!.id) throw AppError.bad(BizCode.INVALID_INPUT, "不能转让给自己");
    db.prepare("UPDATE conversation_members SET role='OWNER' WHERE conversation_id = ? AND user_id = ?").run(convId, target);
    db.prepare("UPDATE conversation_members SET role='MEMBER' WHERE conversation_id = ? AND user_id = ?").run(convId, req.user!.id);
    db.prepare("UPDATE conversations SET owner_id = ? WHERE id = ?").run(target, convId);
  });
  res.json({ message: "群主已转让" });
}

/** 设置/取消管理员（群主） */
export function setAdmin(req: Request, res: Response) {
  const convId = req.convId!;
  const target = Number(req.body?.userId);
  const isAdmin = req.body?.isAdmin ? GroupRole.ADMIN : GroupRole.MEMBER;
  const db = getDb();
  const tm = db.prepare("SELECT role FROM conversation_members WHERE conversation_id = ? AND user_id = ?").get(convId, target) as any;
  if (!tm) throw AppError.bad(BizCode.INVALID_INPUT, "目标不在群内");
  if (target === req.user!.id) throw AppError.bad(BizCode.INVALID_INPUT, "不能修改自己的角色");
  if (tm.role === GroupRole.OWNER) throw AppError.forbidden(BizCode.FORBIDDEN, "不能修改群主角色");
  db.prepare("UPDATE conversation_members SET role = ? WHERE conversation_id = ? AND user_id = ?").run(isAdmin, convId, target);
  res.json({ message: isAdmin === GroupRole.ADMIN ? "已设为管理员" : "已取消管理员" });
}

/** 修改群名（管理员/群主/平台） */
export function renameGroup(req: Request, res: Response) {
  const convId = req.convId!;
  const name = String(req.body?.name ?? "").trim();
  if (!name) throw AppError.bad(BizCode.INVALID_INPUT, "群名必填");
  getDb().prepare("UPDATE conversations SET name = ? WHERE id = ?").run(name, convId);
  res.json({ name });
}

/** 群公告（管理员/群主/平台） */
export function updateNotice(req: Request, res: Response) {
  const convId = req.convId!;
  const notice = String(req.body?.notice ?? "");
  getDb().prepare("UPDATE conversations SET notice = ? WHERE id = ?").run(notice, convId);
  res.json({ notice });
}

/** 解散群（群主/超管）；解散后成员失去权限 */
export function disband(req: Request, res: Response) {
  const convId = Number(req.params.convId);
  const db = getDb();
  const conv = db.prepare("SELECT owner_id, type FROM conversations WHERE id = ?").get(convId) as any;
  if (conv.type !== "GROUP") throw AppError.bad(BizCode.INVALID_INPUT, "非群聊无法解散");
  if (req.user!.role === "USER" && req.user!.id !== conv.owner_id)
    throw AppError.forbidden(BizCode.NOT_GROUP_OWNER, "仅群主可解散");
  db.prepare("UPDATE conversations SET status='DISBANDED' WHERE id = ?").run(convId);
  res.json({ message: "群已解散" });
}

/** 冻结群（平台管理员/超管） */
export function freeze(req: Request, res: Response) {
  const convId = Number(req.body?.convId);
  const db = getDb();
  db.prepare("UPDATE conversations SET status='FROZEN' WHERE id = ? AND type='GROUP'").run(convId);
  res.json({ message: "群已冻结" });
}

/** 群内成员状态校验辅助（供 message 复用校验群） */
export function assertGroupStatus(convId: number) {
  const c = getDb().prepare("SELECT status FROM conversations WHERE id = ?").get(convId) as any;
  if (c?.status === GroupStatus.DISBANDED) throw AppError.forbidden(BizCode.GROUP_DISBANDED, "群已解散");
}
