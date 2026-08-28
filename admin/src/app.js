import { api, get, post, setToken, setUser, currentUser, isLoggedIn } from "./api.js";

const $app = document.getElementById("app");
const $toast = document.createElement("div");
$toast.className = "note";
$toast.style.cssText = "position:fixed;bottom:24px;left:50%;transform:translateX(-50%);background:rgba(0,0,0,.8);color:#fff;padding:10px 18px;border-radius:8px;z-index:200;opacity:0;transition:opacity .2s;pointer-events:none;";
document.body.appendChild($toast);

function h(tag, attrs = {}, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === "class") el.className = v;
    else if (k.startsWith("on")) el.addEventListener(k.slice(2), v);
    else if (v === true) el.setAttribute(k, "");
    else if (k === "text") el.textContent = v;
    else el.setAttribute(k, v);
  }
  for (const c of children.flat()) {
    if (c == null || c === false) continue;
    el.append(c.nodeType ? c : document.createTextNode(String(c)));
  }
  return el;
}
function toast(msg, ok = true) {
  $toast.textContent = msg;
  $toast.style.background = ok ? "rgba(0,0,0,.8)" : "#fa5151";
  $toast.style.opacity = "1";
  setTimeout(() => ($toast.style.opacity = "0"), 2200);
}
function $id(id) { return document.getElementById(id); }

// ============ 权限（仅渲染；真正守卫在后端） ============
const ROLE = { CS: "CUSTOMER_SERVICE", ADMIN: "PLATFORM_ADMIN", SUPER: "SUPER_ADMIN" };
function can(role, action) {
  const m = {
    "report:review": [ROLE.CS, ROLE.SUPER],
    "report:punish": [ROLE.ADMIN, ROLE.SUPER],
    "stats:view": [ROLE.ADMIN, ROLE.SUPER],
    "admin:manage_service": [ROLE.ADMIN, ROLE.SUPER],
    "account:ban": [ROLE.ADMIN, ROLE.SUPER],
  };
  return (m[action] || []).includes(role);
}
const roleLabel = (r) => ({ USER: "用户", CUSTOMER_SERVICE: "客服", PLATFORM_ADMIN: "管理员", SUPER_ADMIN: "超管" }[r] || r);

const S = { me: currentUser(), view: "queue" };

// ============ 登录 ============
function renderLogin() {
  $app.replaceChildren(
    h("div", { class: "login-wrap" },
      h("div", { class: "login-box" },
        h("h1", { text: "微信 · 管理后台" }),
        h("div", { class: "sub", text: "登录客服 / 管理员 / 超管账号" }),
        h("div", { class: "row" }, h("input", { id: "lg-user", placeholder: "用户名" })),
        h("div", { class: "row" }, h("input", { id: "lg-pass", type: "password", placeholder: "密码" })),
        h("div", { class: "actions" }, h("button", { id: "lg-submit", text: "登录" })),
        h("div", { class: "hint", style: "margin-top:12px" },
          h("div", { text: "演示账号：service / admin / superadmin，密码 password" })))));
  $id("lg-submit").onclick = async () => {
    const username = $id("lg-user").value.trim();
    const password = $id("lg-pass").value;
    try {
      const res = await post("/auth/login", { username, password });
      if (!["CUSTOMER_SERVICE", "PLATFORM_ADMIN", "SUPER_ADMIN"].includes(res.user.role)) {
        return toast("请使用客服 / 管理员 / 超管账号登录", false);
      }
      setToken(res.token);
      setUser(res.user);
      S.me = res.user;
      render();
    } catch (e) { toast(e.message, false); }
  };
}

function logout() {
  setToken(null); setUser(null); S.me = null; renderLogin();
}

// ============ 主界面 ============
const NAV = () => [
  { key: "queue", label: "待处理工单", show: can(S.me.role, "report:review") },
  { key: "appeals", label: "申诉处理", show: can(S.me.role, "report:punish") },
  { key: "reports", label: "全部举报", show: can(S.me.role, "report:punish") },
  { key: "stats", label: "数据统计", show: can(S.me.role, "stats:view") },
  { key: "service", label: "客服账号", show: can(S.me.role, "admin:manage_service") },
  { key: "users", label: "用户管理", show: can(S.me.role, "account:ban") },
].filter((n) => n.show);

function render() {
  if (!isLoggedIn()) return renderLogin();
  const nav = h("div", { class: "nav" },
    h("div", { class: "brand" }, h("span", { class: "dot" }), "微信管理后台"),
    ...NAV().map((n) => h("div", { class: `item ${S.view === n.key ? "active" : ""}`, onclick: () => { S.view = n.key; render(); }, text: n.label })),
    h("div", { class: "spacer" }),
    h("div", { class: "who", text: `${roleLabel(S.me.role)} · ${S.me.username}` }),
    h("button", { class: "logout", onclick: logout, text: "退出" }));
  const content = h("div", { class: "content", id: "content" });
  $app.replaceChildren(h("div", { class: "app" }, nav, content));
  loadView();
}

async function loadView() {
  const c = $id("content");
  c.replaceChildren(h("div", { class: "empty", text: "加载中..." }));
  c.replaceChildren();
  const map = { queue: viewQueue, appeals: viewAppeals, reports: viewAllReports, stats: viewStats, service: viewService, users: viewUsers };
  await (map[S.view] || viewQueue)(c);
}

// ============ 待处理工单 ============
async function viewQueue(c) {
  c.appendChild(h("h2", { text: "待处理工单" }));
  c.appendChild(h("div", { class: "note", text: "客服：认领、打回、升级超管；管理员/超管：终裁处罚。" }));
  let items = [];
  try { items = (await get("/reports/queue")).items || []; } catch (e) { c.appendChild(h("div", { class: "empty", text: e.message })); return; }
  if (!items.length) { c.appendChild(h("div", { class: "empty", text: "当前没有待处理工单" })); return; }
  const list = h("div", {});
  for (const r of items) list.appendChild(reportRow(r, false));
  c.appendChild(list);
}

function statusBadge(s) {
  const cls = { PENDING: "b-pending", REVIEWING: "b-reviewing", PUNISHED: "b-punished", REJECTED: "b-rejected", ESCALATED: "b-escalated", APPEALING: "b-appealing", SUSTAINED: "b-sustained", REVERTED: "b-reverted" }[s] || "";
  const label = { PENDING: "待处理", REVIEWING: "处理中", ESCALATED: "已升级", PUNISHED: "已处罚", REJECTED: "已驳回", APPEALING: "申诉中", SUSTAINED: "维持处罚", REVERTED: "已撤销" }[s] || s;
  return h("span", { class: `badge ${cls}`, text: label });
}
const targetLabel = (t) => ({ MESSAGE: "消息", USER: "用户", GROUP: "群" }[t] || t);
const catLabel = (c) => ({ HARASSMENT: "骚扰", AD: "广告", ILLEGAL: "违法", PORNOGRAPHY: "涉黄", FRAUD: "诈骗", OTHER: "其他" }[c] || c);
// 处罚动作与举报目标类型的合法组合（与后端 ACTIONS_BY_TARGET 保持一致）
const PUNISH_LABEL = {
  MUTE_1D: "禁言 1 天", MUTE_7D: "禁言 7 天", MUTE_30D: "禁言 30 天", BAN_ACCOUNT: "封禁账号",
  FREEZE_GROUP: "冻结群", DISBAND_GROUP: "解散群", DELETE_MESSAGE: "删除消息", KICK_MEMBER: "移出成员",
};
const ACTIONS_BY_TARGET = {
  USER: ["BAN_ACCOUNT", "MUTE_1D", "MUTE_7D", "MUTE_30D", "KICK_MEMBER"],
  GROUP: ["FREEZE_GROUP", "DISBAND_GROUP"],
  MESSAGE: ["DELETE_MESSAGE"],
};

function reportRow(r, detailOnly) {
  const ops = h("div", { class: "ops" });
  // 客服动作
  if (can(S.me.role, "report:review") && r.status === "PENDING") {
    ops.appendChild(h("button", { class: "small", onclick: () => doAssign(r), text: "认领" }));
  }
  if (can(S.me.role, "report:review") && ["PENDING", "REVIEWING"].includes(r.status)) {
    ops.appendChild(h("button", { class: "small warn", onclick: () => doEscalate(r), text: "升级" }));
    ops.appendChild(h("button", { class: "small danger", onclick: () => doReject(r), text: "打回" }));
  }
  // 管理员动作
  if (can(S.me.role, "report:punish") && ["PENDING", "REVIEWING", "ESCALATED"].includes(r.status)) {
    ops.appendChild(h("button", { class: "small ok", onclick: () => openPunish(r), text: "终裁处罚" }));
  }
  ops.appendChild(h("button", { class: "small secondary", onclick: () => openEvents(r), text: "审计" }));
  return h("div", { class: "list-item" },
    h("div", { class: "grow" },
      h("div", { class: "title" }, statusBadge(r.status), " ", targetLabel(r.targetType), " #" + r.targetId, " · ", catLabel(r.category)),
      h("div", { class: "sub", text: `举报人 ${r.reporterId} · ${r.description || "（无说明）"} · ${timeStr(r.createdAt)}` }),
      r.punishAction ? h("div", { class: "sub", text: `处罚: ${r.punishAction} ${r.punishDetail || ""}` }) : ""),
    ops);
}

async function doAssign(r) {
  try { await post(`/reports/${r.id}/assign`, {}); toast("已认领"); loadView(); } catch (e) { toast(e.message, false); }
}
async function doReject(r) {
  const note = prompt("打回原因（通知举报人）：", "证据不足");
  if (note == null) return;
  try { await post(`/reports/${r.id}/reject`, { note }); toast("已打回"); loadView(); } catch (e) { toast(e.message, false); }
}
async function doEscalate(r) {
  const note = prompt("升级说明：", "复杂工单，申请超管终裁");
  if (note == null) return;
  try { await post(`/reports/${r.id}/escalate`, { note }); toast("已升级"); loadView(); } catch (e) { toast(e.message, false); }
}

function openPunish(r) {
  const actions = ACTIONS_BY_TARGET[r.targetType] || [];
  const opts = actions.map((a) => h("option", { value: a, text: PUNISH_LABEL[a] }));
  const box = h("div", { class: "panel-overlay" }, h("div", { class: "panel" },
    h("h3", { text: `举报 #${r.id} · 终裁处罚` }),
    h("div", { class: "note", text: `目标: ${targetLabel(r.targetType)} #${r.targetId}` }),
    h("label", { text: "处罚动作" }),
    h("select", { id: "p-action" }, ...opts),
    h("label", { text: "处理说明" }), h("input", { id: "p-detail", placeholder: "填写处罚依据" }),
    h("div", { class: "ops" },
      h("button", { onclick: submitPunish, text: "确认处罚" }),
      h("button", { class: "secondary", onclick: closeOverlay, text: "取消" }))));
  box.addEventListener("click", (e) => { if (e.target === box) box.remove(); });
  document.body.appendChild(box);
  window.__punishId = r.id;
}
async function submitPunish() {
  const action = $id("p-action").value;
  const detail = $id("p-detail").value.trim();
  try {
    await post(`/reports/${window.__punishId}/punish`, { action, detail });
    toast("已处罚");
    closeOverlay();
    loadView();
  } catch (e) { toast(e.message, false); }
}

// ============ 申诉处理 ============
async function viewAppeals(c) {
  c.appendChild(h("h2", { text: "申诉处理" }));
  c.appendChild(h("div", { class: "note", text: "对 PUNISHED 后申诉的工单做终裁：维持(SUSTAIN)或撤销(REVERT)。" }));
  let items = [];
  try { items = ((await get("/admin/reports")).items || []).filter((r) => r.status === "APPEALING"); } catch (e) { c.appendChild(h("div", { class: "empty", text: e.message })); return; }
  if (!items.length) { c.appendChild(h("div", { class: "empty", text: "当前无待裁决的申诉" })); return; }
  const list = h("div", {});
  for (const r of items) {
    const appeal = await getAppeal(r.id).catch(() => null);
    const ops = h("div", { class: "ops" },
      h("button", { class: "small ok", onclick: () => decide(r, "SUSTAIN"), text: "维持处罚" }),
      h("button", { class: "small danger", onclick: () => decide(r, "REVERT"), text: "撤销处罚" }));
    list.appendChild(h("div", { class: "list-item" },
      h("div", { class: "grow" },
        h("div", { class: "title" }, targetLabel(r.targetType), " #" + r.targetId, " · 原处罚 ", r.punishAction || ""),
        h("div", { class: "sub", text: `申诉理由: ${appeal ? appeal.reason : r.description || "（无）"}` })),
      ops));
  }
  c.appendChild(list);
}
async function getAppeal(reportId) {
  const r = await get(`/admin/reports`);
  const item = (r.items || []).find((x) => x.id === reportId);
  return item || null;
}
async function decide(r, decision) {
  const note = prompt(`说明${decision === "REVERT" ? "（撤销理由）" : "（维持理由）"}:`, "");
  if (note == null) return;
  try {
    await post(`/reports/${r.id}/decide`, { decision, note });
    toast(decision === "REVERT" ? "已撤销处罚" : "已维持处罚");
    loadView();
  } catch (e) { toast(e.message, false); }
}

// ============ 全部举报 ============
async function viewAllReports(c) {
  c.appendChild(h("h2", { text: "全部举报" }));
  let items = [];
  try { items = (await get("/admin/reports")).items || []; } catch (e) { c.appendChild(h("div", { class: "empty", text: e.message })); return; }
  if (!items.length) { c.appendChild(h("div", { class: "empty", text: "暂无举报记录" })); return; }
  c.appendChild(h("div", { class: "note", text: "点击“审计”查看每次状态变更的完整时间线。" }));
  for (const r of items) c.appendChild(reportRow(r, true));
}

function openEvents(r) {
  const box = h("div", { class: "panel-overlay" }, h("div", { class: "panel", style: "width:480px;max-width:90vw" },
    h("h3", { text: `举报 #${r.id} · 操作审计` }),
    h("div", { class: "events", id: "events" }),
    h("div", { class: "ops", style: "margin-top:12px" }, h("button", { class: "secondary", onclick: closeOverlay, text: "关闭" }))));
  box.addEventListener("click", (e) => { if (e.target === box) box.remove(); });
  document.body.appendChild(box);
  get(`/reports/${r.id}/events`).then((res) => {
    const ev = $id("events");
    for (const e of res.items || []) {
      ev.appendChild(h("div", { class: "event" },
        h("div", { text: `${actionLabel(e.action)} · ${e.from_status || "-"} → ${e.to_status}` }),
        h("div", { class: "sub", text: `操作: ${e.action} ${e.actor_id ? "by " + e.actor_id : ""} · ${e.note || ""} · ${timeStr(e.created_at)}` })));
    }
  });
}

// ============ 数据统计 ============
async function viewStats(c) {
  c.appendChild(h("h2", { text: "数据统计" }));
  let s = {};
  try { s = await get("/admin/stats"); } catch (e) { c.appendChild(h("div", { class: "empty", text: e.message })); return; }
  const cards = [
    ["总用户数", s.totalUsers], ["总会话数", s.totalConversations], ["群聊数", s.totalGroups],
    ["消息总数", s.totalMessages], ["待处理工单", s.pendingReports], ["封禁账号", s.bannedUsers], ["禁言用户", s.mutes],
  ];
  const grid = h("div", { class: "cards" });
  for (const [k, v] of cards) grid.appendChild(h("div", { class: "card" }, h("div", { class: "k", text: k }), h("div", { class: "v", text: v })));
  c.appendChild(grid);
}

// ============ 客服账号 ============
async function viewService(c) {
  c.appendChild(h("h2", { text: "客服账号" }));
  c.appendChild(buildServiceForm());
  let items = [];
  try { items = (await get("/admin/service-accounts")).items || []; } catch (e) { c.appendChild(h("div", { class: "empty", text: e.message })); return; }
  const list = h("div", { class: "panel", style: "margin-top:16px" });
  for (const u of items) {
    list.appendChild(h("div", { class: "list-item" },
      h("div", { class: "grow" },
        h("div", { class: "title", text: `${u.nickname} (@${u.username})` }),
        h("div", { class: "sub", text: roleLabel(u.role) + " · " + u.status }))));
  }
  if (!items.length) list.appendChild(h("div", { class: "empty", text: "暂无客服/管理员账号" }));
  c.appendChild(list);
}
function buildServiceForm() {
  const form = h("div", { class: "panel" },
    h("div", { class: "section-title", text: "新增客服 / 管理员" }),
    h("div", { style: "display:flex;gap:8px;flex-wrap:wrap" },
      h("input", { id: "sa-u", placeholder: "用户名", style: "width:150px" }),
      h("input", { id: "sa-n", placeholder: "昵称", style: "width:150px" }),
      h("input", { id: "sa-p", placeholder: "密码", style: "width:150px" }),
      h("select", { id: "sa-r", style: "width:150px" },
        h("option", { value: "CUSTOMER_SERVICE", text: "客服" }),
        h("option", { value: "PLATFORM_ADMIN", text: "平台管理员" })),
      h("button", { onclick: createService, text: "创建" })));
  return form;
}
async function createService() {
  const username = $id("sa-u").value.trim();
  const nickname = $id("sa-n").value.trim();
  const password = $id("sa-p").value;
  const role = $id("sa-r").value;
  try {
    await post("/admin/service-accounts", { username, nickname, password, role });
    toast("创建成功");
    loadView();
  } catch (e) { toast(e.message, false); }
}

// ============ 用户管理（封禁） ============
async function viewUsers(c) {
  c.appendChild(h("h2", { text: "用户管理" }));
  c.appendChild(h("div", { class: "note", text: "仅可封禁普通用户；封禁后该账号无法登录与发言。" }));
  let items = [];
  try { items = (await get("/admin/users")).items || []; } catch (e) { c.appendChild(h("div", { class: "empty", text: e.message })); return; }
  for (const u of items) {
    const isUser = u.role === "USER";
    const banned = u.status === "BANNED";
    const ops = h("div", { class: "ops" },
      isUser
        ? h("button", { class: `small ${banned ? "ok" : "danger"}`, onclick: () => banUser(u, !banned), text: banned ? "解封" : "封禁" })
        : h("span", { class: "note", text: "平台账号" }));
    c.appendChild(h("div", { class: "list-item" },
      h("div", { class: "grow" },
        h("div", { class: "title", text: `${u.nickname} (@${u.username}) · ${roleLabel(u.role)}` }),
        h("div", { class: "sub", text: `状态: ${u.status}${u.muteUntil && u.muteUntil > Date.now() ? " · 禁言至 " + timeStr(u.muteUntil) : ""}` })),
      ops));
  }
}
async function banUser(u, ban) {
  try {
    await post("/admin/ban", { userId: u.id, ban });
    toast(ban ? "已封禁" : "已解封");
    loadView();
  } catch (e) { toast(e.message, false); }
}

// ============ 工具 ============
function actionLabel(a) {
  return {
    CREATE: "创建", ASSIGN: "认领", REVIEW: "审核", PUNISH: "终裁处罚", REJECT: "打回",
    ESCALATE: "升级", APPEAL: "申请申诉", SUSTAIN: "维持", REVERT: "撤销", RESET: "重置", AUTO_ESCALATE: "超时自动升级",
  }[a] || a;
}
function timeStr(ts) { return ts ? new Date(ts).toLocaleString("zh-CN") : ""; }
function closeOverlay() { document.querySelectorAll(".panel-overlay").forEach((n) => n.remove()); }

if (isLoggedIn()) render();
else renderLogin();
