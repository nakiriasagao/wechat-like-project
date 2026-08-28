import { AppError, BizCode, ConversationType, GroupStatus } from "shared";
import { getDb } from "../db/database.js";

/** 会话是否存在且未被解散 */
export function getConversation(convId: number) {
  const conv = getDb().prepare("SELECT * FROM conversations WHERE id = ?").get(convId) as any;
  if (!conv) throw AppError.notFound(BizCode.CONVERSATION_NOT_FOUND, "会话不存在");
  if (conv.type === ConversationType.GROUP && conv.status === GroupStatus.DISBANDED)
    throw AppError.forbidden(BizCode.GROUP_DISBANDED, "群已解散");
  return conv;
}

export function getMember(convId: number, userId: number) {
  return getDb()
    .prepare("SELECT * FROM conversation_members WHERE conversation_id = ? AND user_id = ?")
    .get(convId, userId) as any;
}

/** 是否并发禁止（全员禁言或个别禁言） */
export function assertCanSpeakInGroup(convId: number, userId: number) {
  const conv = getConversation(convId);
  if (conv.type === ConversationType.DIRECT) return;
  if (conv.status === GroupStatus.FROZEN) throw AppError.forbidden(BizCode.GROUP_FROZEN, "群已被冻结，仅可查看");
  if (conv.mute_all) throw AppError.forbidden(BizCode.MEMBER_MUTED, "全员禁言中");
  const member = getMember(convId, userId);
  if (member?.muted_until && member.muted_until > Date.now())
    throw AppError.forbidden(BizCode.MEMBER_MUTED, "你已被禁言");
}

/** 用户当前是否被禁言（账号级） */
export function assertUserCanSpeak(user: { status: string; muteUntil: number | null }) {
  if (user.muteUntil && user.muteUntil > Date.now())
    throw AppError.forbidden(BizCode.MEMBER_MUTED, "账号禁言中，禁止发消息");
}

/** 校验成为好友（含黑名单） */
export function assertFriends(userA: number, userB: number) {
  const rel = getDb()
    .prepare("SELECT * FROM friendships WHERE (user_a = ? AND user_b = ?) OR (user_a = ? AND user_b = ?)")
    .get(userA, userB, userB, userA) as any;
  if (!rel || rel.status !== "ACCEPTED")
    throw AppError.forbidden(BizCode.NOT_FRIEND, "你与对方不是好友");
  return rel;
}

/** 序列化消息（含撤回/删除状态 + 发送者昵称） */
export function serializeMessage(row: any) {
  return {
    id: row.id,
    conversationId: row.conversation_id,
    senderId: row.sender_id,
    senderNickname: row.sender_nickname ?? null,
    type: row.type,
    content: row.content,
    replyTo: row.reply_to,
    mentions: row.mentions ? JSON.parse(row.mentions) : null,
    recalled: !!row.recalled,
    deletedBy: row.deleted_by ? JSON.parse(row.deleted_by) : [],
    createdAt: row.created_at,
  };
}

export const now = () => Date.now();
