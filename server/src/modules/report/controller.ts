import type { Request, Response } from "express";
import {
  AppError, BizCode, ReportStatus, PunishAction, AccountStatus, GroupStatus,
  ReportTargetType, MessageType,
} from "shared";
import { getDb, tx } from "../../db/database.js";
import { now } from "../../utils/helpers.js";
import { config } from "../../config.js";

/** write report event + transition */
function logEvent(reportId: number, actorId: number | null, action: string, from: string | null, to: string, note?: string) {
  getDb()
    .prepare("INSERT INTO report_events (report_id, actor_id, action, from_status, to_status, note, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)")
    .run(reportId, actorId, action, from, to, note ?? null, now());
}

function transition(report: any, to: ReportStatus, actorId: number | null, action: string, note?: string) {
  getDb()
    .prepare("UPDATE reports SET status = ?, updated_at = ?, resolved_at = CASE WHEN ? IN (?, ?) THEN ? ELSE resolved_at END WHERE id = ?")
    .run(to, now(), to, ReportStatus.REJECTED, ReportStatus.PUNISHED, now(), report.id);
  logEvent(report.id, actorId, action, report.status, to, note);
  return { ...report, status: to };
}

/** 举报：对消息/用户/群 */
export function createReport(req: Request, res: Response) {
  const { targetType, targetId, category, description } = req.body ?? {};
  if (!ReportTargetType[targetType as keyof typeof ReportTargetType]) throw AppError.bad(BizCode.INVALID_INPUT, "非法举报目标类型");
  if (!targetId) throw AppError.bad(BizCode.INVALID_INPUT, "缺少举报目标");
  const db = getDb();

  // 校验目标存在
  if (targetType === "MESSAGE") {
    if (!db.prepare("SELECT id FROM messages WHERE id = ?").get(targetId)) throw AppError.notFound(BizCode.MESSAGE_NOT_FOUND, "消息不存在");
  } else if (targetType === "USER") {
    if (!db.prepare("SELECT id FROM users WHERE id = ?").get(targetId)) throw AppError.notFound(BizCode.USER_NOT_FOUND, "用户不存在");
  } else if (targetType === "GROUP") {
    if (!db.prepare("SELECT id FROM conversations WHERE id = ?").get(targetId)) throw AppError.notFound(BizCode.GROUP_NOT_FOUND, "群不存在");
  }

  if (Number(targetId) === req.user!.id) throw AppError.bad(BizCode.INVALID_INPUT, "不能举报自己");

  const r = db
    .prepare("INSERT INTO reports (reporter_id, target_type, target_id, category, description, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, 'PENDING', ?, ?)")
    .run(req.user!.id, targetType, Number(targetId), category, description ?? null, now(), now());
  const reportId = Number(r.lastInsertRowid);
  logEvent(reportId, req.user!.id, "CREATE", null, ReportStatus.PENDING, "创建举报");

  res.status(201).json({ reportId });
}

/** 处理超时升级：PENDING / REVIEWING 超时自动 ESCALATED */
function autoEscalateRows() {
  const cutoff = now() - config.escalateAfterMs;
  const db = getDb();
  const stale = db.prepare("SELECT * FROM reports WHERE status IN (?, ?) AND updated_at < ?").all(ReportStatus.PENDING, ReportStatus.REVIEWING, cutoff);
  for (const s of stale as any[]) {
    try {
      transition(s, ReportStatus.ESCALATED, null, "AUTO_ESCALATE", "超时未处理，自动升级平台管理员");
    } catch {
      /* ignore */
    }
  }
}

/** 我的举报列表 */
export function myReports(req: Request, res: Response) {
  autoEscalateRows();
  const items = getDb()
    .prepare("SELECT * FROM reports WHERE reporter_id = ? ORDER BY created_at DESC")
    .all(req.user!.id);
  res.json({ items: items.map(serializeReport) });
}

/** 客服：待处理队列 */
export function pendingQueue(req: Request, res: Response) {
  autoEscalateRows();
  const items = getDb()
    .prepare("SELECT * FROM reports WHERE status IN (?, ?) ORDER BY created_at ASC")
    .all(ReportStatus.PENDING, ReportStatus.REVIEWING);
  res.json({ items: items.map(serializeReport) });
}

/** 客服：认领工单（PENDING -> REVIEWING） */
export function assign(req: Request, res: Response) {
  const reportId = Number(req.params.reportId);
  const db = getDb();
  const report = getReport(reportId);
  if (report.status !== ReportStatus.PENDING)
    throw AppError.conflict(BizCode.STATE_CONFLICT, "仅待处理工单可认领");
  db.prepare("UPDATE reports SET assignee_id = ? WHERE id = ?").run(req.user!.id, reportId);
  transition(report, ReportStatus.REVIEWING, req.user!.id, "ASSIGN", "客服认领工单");
  res.json({ report: serializeReport(getReport(reportId)) });
}

/** 客服：审核打回（REVIEWING -> REJECTED）：认定为举报无效/无需处罚 */
export function reviewReject(req: Request, res: Response) {
  const reportId = Number(req.params.reportId);
  const note = String(req.body?.note ?? "证据不足，不予处理");
  const report = getReport(reportId);
  if (![ReportStatus.PENDING, ReportStatus.REVIEWING].includes(report.status))
    throw AppError.conflict(BizCode.STATE_CONFLICT, "当前状态不可打回");
  const r = transition(report, ReportStatus.REJECTED, req.user!.id, "REJECT", note);
  res.json({ report: serializeReport(r) });
}

/** 客服：升级超管（PENDING/REVIEWING -> ESCALATED） */
export function escalate(req: Request, res: Response) {
  const reportId = Number(req.params.reportId);
  const note = String(req.body?.note ?? "复杂工单，申请超管终裁");
  const report = getReport(reportId);
  if (![ReportStatus.PENDING, ReportStatus.REVIEWING].includes(report.status))
    throw AppError.conflict(BizCode.STATE_CONFLICT, "当前状态不可升级");
  const r = transition(report, ReportStatus.ESCALATED, req.user!.id, "ESCALATE", note);
  res.json({ report: serializeReport(r) });
}

/** 平台管理员：终裁处罚（PENDING/REVIEWING/ESCALATED -> PUNISHED） */
export function punish(req: Request, res: Response) {
  const reportId = Number(req.params.reportId);
  const action = req.body?.action as PunishAction;
  const detail = String(req.body?.detail ?? "");
  const db = getDb();
  const report = getReport(reportId);

  if (![ReportStatus.PENDING, ReportStatus.REVIEWING, ReportStatus.ESCALATED].includes(report.status))
    throw AppError.conflict(BizCode.STATE_CONFLICT, "当前状态不可终裁");

  const VALID_ACTIONS: PunishAction[] = Object.values(PunishAction);
  if (!VALID_ACTIONS.includes(action)) throw AppError.bad(BizCode.INVALID_INPUT, "非法处罚动作");

  // 处罚动作必须与举报目标类型匹配，否则会误伤（如对消息启用封禁账号）
  const ACTIONS_BY_TARGET: Record<string, PunishAction[]> = {
    USER: [PunishAction.BAN_ACCOUNT, PunishAction.MUTE_1D, PunishAction.MUTE_7D, PunishAction.MUTE_30D, PunishAction.KICK_MEMBER],
    GROUP: [PunishAction.FREEZE_GROUP, PunishAction.DISBAND_GROUP],
    MESSAGE: [PunishAction.DELETE_MESSAGE],
  };
  if (!(ACTIONS_BY_TARGET[report.target_type] ?? []).includes(action))
    throw AppError.bad(BizCode.INVALID_INPUT, `处罚动作与举报目标不匹配: ${action} 不可用于 ${report.target_type}`);

  switch (action) {
    case PunishAction.BAN_ACCOUNT: applyBan(report.target_id); break;
    case PunishAction.MUTE_1D:
    case PunishAction.MUTE_7D:
    case PunishAction.MUTE_30D: applyMute(report.target_id, action); break;
    case PunishAction.FREEZE_GROUP: applyFreeze(report.target_id); break;
    case PunishAction.DISBAND_GROUP: applyDisband(report.target_id); break;
    case PunishAction.DELETE_MESSAGE: applyDeleteMessage(report.target_id); break;
    case PunishAction.KICK_MEMBER: applyKick(report.target_id); break;
  }

  db.prepare("UPDATE reports SET punish_action = ?, punish_detail = ? WHERE id = ?").run(action, detail, reportId);
  const r = transition(report, ReportStatus.PUNISHED, req.user!.id, "PUNISH", `${action} ${detail}`);
  res.json({ report: serializeReport(r) });
}

function applyBan(targetUserId: number) {
  const db = getDb();
  const target = db.prepare("SELECT role FROM users WHERE id = ?").get(targetUserId) as any;
  if (!target) throw AppError.notFound(BizCode.USER_NOT_FOUND, "举报目标用户不存在");
  if (target.role !== "USER") throw AppError.conflict(BizCode.STATE_CONFLICT, "不能封禁平台角色账号");
  db.prepare("UPDATE users SET status = 'BANNED' WHERE id = ?").run(targetUserId);
}

function applyMute(targetUserId: number, action: PunishAction) {
  const days = action === PunishAction.MUTE_1D ? 1 : action === PunishAction.MUTE_7D ? 7 : 30;
  getDb().prepare("UPDATE users SET mute_until = ?, status = 'MUTED' WHERE id = ?").run(now() + days * 86400000, targetUserId);
}

function applyFreeze(convId: number) {
  getDb().prepare("UPDATE conversations SET status = 'FROZEN' WHERE id = ? AND type='GROUP'").run(convId);
}

function applyDisband(convId: number) {
  getDb().prepare("UPDATE conversations SET status = 'DISBANDED' WHERE id = ? AND type='GROUP'").run(convId);
}

function applyDeleteMessage(msgId: number) {
  getDb().prepare("UPDATE messages SET recalled = 1 WHERE id = ?").run(msgId);
}

function applyKick(targetUserId: number) {
  const db = getDb();
  const m = db.prepare("SELECT conversation_id, role FROM conversation_members WHERE user_id = ? AND role != 'OWNER' LIMIT 1").get(targetUserId) as any;
  if (m) db.prepare("DELETE FROM conversation_members WHERE conversation_id = ? AND user_id = ?").run(m.conversation_id, targetUserId);
}

/** 申诉：被处罚方针对 PUNISHED 工单发起 */
export function createAppeal(req: Request, res: Response) {
  const reportId = Number(req.params.reportId);
  const reason = String(req.body?.reason ?? "");
  const db = getDb();
  const report = getReport(reportId);
  if (report.status !== ReportStatus.PUNISHED)
    throw AppError.conflict(BizCode.STATE_CONFLICT, "仅处于已处罚状态可申诉");
  // 仅被处罚方（举报目标）可申诉，防止他人替申诉
  if (!isReportTarget(report, req.user!.id))
    throw AppError.forbidden(BizCode.FORBIDDEN, "仅举报目标可发起申诉");
  db.prepare("INSERT INTO appeals (report_id, appealer_id, reason, status, created_at, updated_at) VALUES (?, ?, ?, 'PENDING', ?, ?)")
    .run(reportId, req.user!.id, reason, now(), now());
  const r = transition(report, ReportStatus.APPEALING, req.user!.id, "APPEAL", reason);
  res.json({ report: serializeReport(r) });
}

/** 平台管理员：申诉裁定（APPEALING -> SUSTAINED 维持 / REVERTED 撤销） */
export function decideAppeal(req: Request, res: Response) {
  const reportId = Number(req.params.reportId);
  const decision = req.body?.decision as "SUSTAIN" | "REVERT";
  const note = String(req.body?.note ?? "");
  const db = getDb();
  const report = getReport(reportId);
  if (report.status !== ReportStatus.APPEALING)
    throw AppError.conflict(BizCode.STATE_CONFLICT, "当前无待裁决的申诉");

  db.prepare("UPDATE appeals SET status = ?, handled_by = ?, updated_at = ? WHERE report_id = ? AND status = 'PENDING'")
    .run(decision === "REVERT" ? "REVERTED" : "SUSTAINED", req.user!.id, now(), reportId);

  let to: ReportStatus;
  if (decision === "REVERT") {
    to = ReportStatus.REVERTED;
    revertPunish(report);
  } else {
    to = ReportStatus.SUSTAINED;
  }
  const r = transition(report, to, req.user!.id, decision === "REVERT" ? "REVERT" : "SUSTAIN", note);
  res.json({ report: serializeReport(r) });
}

/** 撤销处罚：恢复账号/群状态 */
function revertPunish(report: any) {
  const db = getDb();
  const action = report.punish_action as PunishAction;
  if (action === PunishAction.BAN_ACCOUNT) {
    db.prepare("UPDATE users SET status='ACTIVE' WHERE id = ?").run(report.target_id);
  } else if (action?.startsWith("MUTE_")) {
    db.prepare("UPDATE users SET mute_until=NULL, status='ACTIVE' WHERE id = ?").run(report.target_id);
  } else if (action === PunishAction.FREEZE_GROUP) {
    db.prepare("UPDATE conversations SET status='ACTIVE' WHERE id = ?").run(report.target_id);
  } else if (action === PunishAction.DISBAND_GROUP) {
    db.prepare("UPDATE conversations SET status='ACTIVE' WHERE id = ?").run(report.target_id);
  } else if (action === PunishAction.DELETE_MESSAGE) {
    db.prepare("UPDATE messages SET recalled=0 WHERE id = ?").run(report.target_id);
  } else if (action === PunishAction.KICK_MEMBER) {
    // 简单恢复为成员（重新加入需群主邀请，此处仅提示）
  }
}

function getReport(reportId: number) {
  const report = getDb().prepare("SELECT * FROM reports WHERE id = ?").get(reportId) as any;
  if (!report) throw AppError.notFound(BizCode.REPORT_NOT_FOUND, "举报工单不存在");
  return report;
}

/** 是否为举报目标的当事人（诉求申诉权限的依据） */
function isReportTarget(report: any, userId: number): boolean {
  const db = getDb();
  if (report.target_type === ReportTargetType.USER) return Number(report.target_id) === userId;
  if (report.target_type === ReportTargetType.MESSAGE) {
    const m = db.prepare("SELECT sender_id FROM messages WHERE id = ?").get(report.target_id) as any;
    return m?.sender_id === userId;
  }
  if (report.target_type === ReportTargetType.GROUP) {
    const g = db.prepare("SELECT owner_id FROM conversations WHERE id = ?").get(report.target_id) as any;
    return g?.owner_id === userId;
  }
  return false;
}

/** 事件审计日志 */
export function reportEvents(req: Request, res: Response) {
  const reportId = Number(req.params.reportId);
  getReport(reportId);
  const items = getDb().prepare("SELECT * FROM report_events WHERE report_id = ? ORDER BY id").all(reportId);
  res.json({ items });
}

export function serializeReport(r: any) {
  return {
    id: r.id,
    reporterId: r.reporter_id,
    targetType: r.target_type,
    targetId: r.target_id,
    category: r.category,
    description: r.description,
    status: r.status,
    assigneeId: r.assignee_id,
    punishAction: r.punish_action,
    punishDetail: r.punish_detail,
    reviewNote: r.review_note,
    escalatedNote: r.escalated_note,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
    resolvedAt: r.resolved_at,
  };
}
