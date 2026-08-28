import { DatabaseSync } from "node:sqlite";
import bcrypt from "bcryptjs";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DB_FILE = process.env.DB_FILE ?? path.resolve(__dirname, "../../data/wechat.sqlite");
const BASE = process.env.BASE ?? "http://localhost:3000/api";
let pass = 0, fail = 0;
function ok(name: string, cond: boolean, extra = "") {
  if (cond) { pass++; console.log(`  PASS  ${name} ${extra}`); }
  else { fail++; console.log(`  FAIL  ${name} ${extra}`); }
}
async function req(method: string, p: string, token?: string, body?: unknown) {
  const res = await fetch(`${BASE}${p}`, {
    method,
    headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let data: any = null;
  try { data = text ? JSON.parse(text) : null; } catch {}
  return { status: res.status, data };
}

/** 自建测试账号（不依赖 seed），按全局角色直接插入用户表 */
function bootstrapAccounts() {
  const db = new DatabaseSync(DB_FILE);
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT, username TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL, nickname TEXT NOT NULL, role TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'ACTIVE', mute_until INTEGER, created_at INTEGER NOT NULL
    );
  `);
  const hash = bcrypt.hashSync("password", 10);
  const accs: Array<[string, string, string]> = [
    ["user1", "用户一号", "USER"],
    ["user2", "用户二号", "USER"],
    ["user3", "用户三号", "USER"],
    ["service", "客服小蓝", "CUSTOMER_SERVICE"],
    ["admin", "平台管理员", "PLATFORM_ADMIN"],
    ["superadmin", "超级管理员", "SUPER_ADMIN"],
  ];
  const ins = db.prepare("INSERT INTO users (username, password_hash, nickname, role, status, created_at) VALUES (?, ?, ?, ?, 'ACTIVE', ?)");
  for (const [u, n, r] of accs) {
    if (!db.prepare("SELECT id FROM users WHERE username = ?").get(u)) ins.run(u, hash, n, r, Date.now());
  }
  db.close();
}

async function main() {
  bootstrapAccounts();
  const login = async (u: string) => (await req("POST", "/auth/login", undefined, { username: u, password: "password" })).data;
  const reg = async (u: string) => (await req("POST", "/auth/register", undefined, { username: u, password: "password", nickname: u })).data;
  const t1 = (await login("user1")).token;
  const t2 = (await login("user2")).token;
  const t3 = (await login("user3")).token;
  const tService = (await login("service")).token;
  const tAdmin = (await login("admin")).token;

  // 新用户注册可用
  const newTok = (await reg("fresh_user")).token;
  ok("注册接口可用", !!newTok);

  console.log("\n[1] 权限 200/403");
  let r = await req("GET", "/reports/queue", t1);
  ok("user 访问客服队列 -> 403", r.status === 403, `(${r.status})`);
  r = await req("GET", "/reports/queue", tService);
  ok("客服访问客服队列 -> 200", r.status === 200, `(${r.status})`);
  r = await req("GET", "/admin/stats", t1);
  ok("user 访问统计 -> 403", r.status === 403, `(${r.status})`);
  r = await req("GET", "/admin/stats", tAdmin);
  ok("管理员访问统计 -> 200", r.status === 200, `(${r.status})`);
  r = await req("POST", "/admin/service-accounts", tAdmin, { username: "svc2", password: "pw", nickname: "客服2" });
  ok("管理员新增客服 -> 201", r.status === 201, `(${r.status})`);
  r = await req("POST", "/admin/service-accounts", t1, { username: "x", password: "pw" });
  ok("user 新增客服 -> 403", r.status === 403, `(${r.status})`);
  r = await req("GET", "/admin/stats", tService);
  ok("客服访问统计 -> 403", r.status === 403, `(${r.status})`);

  console.log("\n[2] 好友");
  r = await req("POST", "/friends/request", t3, { userId: 1 });
  ok("user3 请求加 user1 -> 201", r.status === 201, `(${r.status})`);
  r = await req("POST", "/friends/accept", t1, { userId: 3 });
  ok("user1 接受 -> 200", r.status === 200, `(${r.status})`);
  let convs = (await req("GET", "/conversations", t3)).data.items;
  ok("接受后自动生成单聊", convs.some((c: any) => c.type === "DIRECT"));
  r = await req("POST", "/friends/request", t1, { userId: 2 });
  ok("user1 请求加 user2 -> 201", r.status === 201, `(${r.status})`);
  r = await req("POST", "/friends/accept", t2, { userId: 1 });
  ok("user2 接受 -> 200", r.status === 200, `(${r.status})`);

  console.log("\n[3] 消息");
  const dm = (await req("GET", "/conversations", t3)).data.items.find((c: any) => c.type === "DIRECT");
  r = await req("POST", "/messages", t3, { convId: dm.id, type: "TEXT", content: "你好" });
  ok("发送单聊消息 -> 201", r.status === 201, `(${r.status})`);
  const mine = r.data.message.id;
  r = await req("POST", "/messages", t1, { convId: dm.id, type: "TEXT", content: "收到" });
  ok("对方回复 -> 201", r.status === 201, `(${r.status})`);
  const theirs = r.data.message.id;
  convs = (await req("GET", "/conversations", t3)).data.items;
  ok("未读数更新", convs.find((c: any) => c.id === dm.id).unread >= 1);
  r = await req("POST", "/messages/read", t3, { convId: dm.id, lastReadMsgId: mine });
  ok("标记已读 -> 200", r.status === 200, `(${r.status})`);
  r = await req("POST", "/messages/recall", t3, { messageId: mine });
  ok("撤回自己的消息 -> 200", r.status === 200, `(${r.status})`);
  r = await req("POST", "/messages/recall", t3, { messageId: theirs });
  ok("不能撤回他人消息 -> 403", r.status === 403, `(${r.status})`);

  console.log("\n[4] 群治理");
  r = await req("POST", "/conversations/group", t1, { name: "测试群", memberIds: [2, 3] });
  ok("创建群 -> 201", r.status === 201, `(${r.status} conv=${r.data?.conversationId})`);
  const gid = r.data.conversationId;
  const g = (await req("GET", `/group/${gid}`, t2)).data;
  ok("群主=user1", g.ownerId === 1);
  r = await req("POST", `/group/${gid}/mute-all`, t3, { mute: true });
  ok("普通成员全员禁言 -> 403", r.status === 403, `(${r.status})`);
  r = await req("POST", `/group/${gid}/mute-all`, t1, { mute: true });
  ok("群主全员禁言 -> 200", r.status === 200, `(${r.status})`);
  r = await req("POST", "/messages", t3, { convId: gid, type: "TEXT", content: "说话" });
  ok("全员禁言下成员发言被拒 -> 403", r.status === 403, `(${r.status})`);
  r = await req("POST", `/group/${gid}/mute-all`, t1, { mute: false });
  ok("群主解除禁言 -> 200", r.status === 200, `(${r.status})`);
  r = await req("POST", `/group/${gid}/set-admin`, t2, { userId: 3, isAdmin: true });
  ok("非群主设管理员 -> 403", r.status === 403, `(${r.status})`);
  r = await req("POST", `/group/${gid}/set-admin`, t1, { userId: 2, isAdmin: true });
  ok("群主设 user2 为管理员 -> 200", r.status === 200, `(${r.status})`);
  r = await req("POST", `/group/${gid}/mute`, t2, { userId: 3, until: Date.now() + 3600000 });
  ok("管理员禁言成员 -> 200", r.status === 200, `(${r.status})`);
  r = await req("POST", "/messages", t3, { convId: gid, type: "TEXT", content: "被禁言" });
  ok("被禁言成员发言被拒 -> 403", r.status === 403, `(${r.status})`);
  r = await req("POST", `/group/${gid}/kick`, t2, { userId: 3 });
  ok("管理员踢普通成员 -> 200", r.status === 200, `(${r.status})`);
  r = await req("POST", `/group/${gid}/transfer`, t1, { userId: 2 });
  ok("群主转让 -> 200", r.status === 200, `(${r.status})`);
  r = await req("POST", `/group/${gid}/disband`, t2, {});
  ok("转让后新群主解散 -> 200", r.status === 200, `(${r.status})`);

  console.log("\n[5] 举报 -> 客服 -> 管理员 -> 申诉");
  r = await req("POST", "/reports", t1, { targetType: "USER", targetId: 2, category: "HARASSMENT", description: "恶意骚扰" });
  ok("创建举报 -> 201", r.status === 201, `(${r.status} id=${r.data?.reportId})`);
  const rid1 = r.data.reportId;
  r = await req("POST", `/reports/${rid1}/punish`, tService, { action: "MUTE_7D", detail: "禁言7天" });
  ok("客服直接终裁 -> 403", r.status === 403, `(${r.status})`);
  r = await req("POST", `/reports/${rid1}/assign`, tService, {});
  ok("客服认领 -> 200", r.status === 200, `(${r.status})`);
  r = await req("POST", `/reports/${rid1}/reject`, tService, { note: "证据不足" });
  ok("客服打回 -> 200", r.status === 200, `(${r.status})`);
  r = await req("POST", "/reports", t1, { targetType: "USER", targetId: 2, category: "FRAUD", description: "诈骗" });
  const rid2 = r.data.reportId;
  r = await req("POST", `/reports/${rid2}/assign`, tService, {});
  ok("客服认领2 -> 200", r.status === 200, `(${r.status})`);
  r = await req("POST", `/reports/${rid2}/punish`, tAdmin, { action: "MUTE_7D", detail: "确认诈骗" });
  ok("管理员终裁 -> 200", r.status === 200, `(${r.status})`);
  r = await req("POST", `/reports/${rid2}/appeal`, t2, { reason: "我没有诈骗" });
  ok("被处罚人申诉 -> 200", r.status === 200, `(${r.status})`);
  r = await req("POST", `/reports/${rid2}/decide`, tAdmin, { decision: "SUSTAIN" });
  ok("管理员维持 -> 200", r.status === 200, `(${r.status})`);
  r = await req("POST", "/messages", t2, { convId: dm.id, type: "TEXT", content: "还在吗" });
  ok("禁言账号被拒发消息 -> 403", r.status === 403, `(${r.status})`);
  r = await req("POST", `/reports/${rid2}/decide`, tAdmin, { decision: "REVERT" });
  ok("已裁决后再次裁定 -> 400", r.status === 400, `(${r.status})`);
  // 事件日志
  r = await req("GET", `/reports/${rid2}/events`, tService);
  ok("事件审计可读 -> 200", r.status === 200, `(${r.status} events=${r.data?.items?.length})`);

  console.log("\n[6] 消息本地删除");
  r = await req("POST", "/messages", t3, { convId: dm.id, type: "TEXT", content: "可删除" });
  const delId = r.data.message.id;
  r = await req("POST", "/messages/delete", t3, { messageId: delId });
  ok("本地删除消息 -> 200", r.status === 200, `(${r.status})`);
  r = await req("GET", `/conversations/${dm.id}/messages`, t3);
  ok("消息列表含 deletedBy", r.status === 200, `(${JSON.stringify((r.data.items[0] as any)?.deletedBy)})`);

  console.log("\n[7] 朋友圈");
  r = await req("POST", "/moments", t1, { content: "第一条动态" });
  ok("发表朋友圈 -> 201", r.status === 201, `(${r.status})`);
  const mom1 = r.data?.moment?.id;
  r = await req("GET", "/moments", t2);
  ok("好友可见动态", (r.data.items || []).some((m: any) => m.id === mom1), `(${r.status})`);
  r = await req("POST", "/moments", t2, { content: "第二条" });
  const mom2 = r.data?.moment?.id;
  r = await req("GET", "/moments", t3);
  ok("非好友不可见动态", !(r.data.items || []).some((m: any) => m.id === mom2), `(${r.status})`);
  r = await req("POST", `/moments/${mom1}/like`, t2, {});
  ok("点赞 -> 200", r.status === 200 && r.data?.liked === true, `(${r.status})`);
  r = await req("POST", `/moments/${mom1}/comment`, t2, { content: "沙发" });
  ok("评论 -> 201", r.status === 201, `(${r.status})`);
  const cid = r.data?.comment?.id;
  r = await req("POST", `/moments/${mom1}/comment`, t3, { content: "回复@沙发", replyTo: cid });
  ok("回复评论 -> 201", r.status === 201, `(${r.status})`);
  r = await req("POST", `/moments/${mom1}/comment`, t3, { content: "也是好友可见" });
  ok("好友可评论 -> 201", r.status === 201, `(${r.status})`);
  r = await req("DELETE", `/moments/${mom1}`, t2, {});
  ok("删除他人动态 -> 403", r.status === 403, `(${r.status})`);
  r = await req("DELETE", `/moments/${mom1}`, t1, {});
  ok("删除自己的动态 -> 200", r.status === 200, `(${r.status})`);

  console.log("\n===== 汇总 =====");
  console.log(`通过 ${pass} / ${pass + fail}`);
  process.exit(fail ? 1 : 0);
}
main().catch((e) => { console.error(e); process.exit(1); });
