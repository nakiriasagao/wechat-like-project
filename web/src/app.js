import { api, get, post, del, setToken, setUser, currentUser, isLoggedIn } from "./api.js";

const $app = document.getElementById("app");
const $toast = document.getElementById("toast");

// ---------- DOM 辅助 ----------
function h(tag, attrs = {}, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === "class") el.className = v;
    else if (k === "onclick") el.onclick = v;
    else if (k.startsWith("on")) el.addEventListener(k.slice(2), v);
    else if (v === true) el.setAttribute(k, "");
    else if (v === false || v == null) continue;
    else if (k === "text") el.textContent = v;
    else if (k === "html") el.innerHTML = v;
    else if (k === "value") el.value = v;
    else el.setAttribute(k, v);
  }
  for (const c of children.flat()) {
    if (c == null || c === false || c === "") continue;
    el.append(c.nodeType ? c : document.createTextNode(String(c)));
  }
  return el;
}
function toast(msg, ok = true) {
  $toast.textContent = msg;
  $toast.classList.add("show");
  $toast.style.background = ok ? "rgba(0,0,0,.78)" : "#fa5151";
  setTimeout(() => $toast.classList.remove("show"), 2200);
}
function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}
function roleLabel(r) {
  return { USER: "用户", CUSTOMER_SERVICE: "客服", PLATFORM_ADMIN: "管理员", SUPER_ADMIN: "超管" }[r] || r;
}
function avatarOf(u, cls = "") {
  const bg = u.role === "PLATFORM_ADMIN" || u.role === "SUPER_ADMIN" ? "admin" : u.role === "CUSTOMER_SERVICE" ? "service" : "";
  return h("div", { class: `avatar ${bg} ${cls}` }, (u.nickname || u.username || "?").slice(0, 1));
}
function timeStr(ts) {
  if (!ts) return "";
  const d = new Date(ts);
  const now = new Date();
  const sameDay = d.toDateString() === now.toDateString();
  if (sameDay) return d.toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" });
  return d.toLocaleDateString("zh-CN", { month: "numeric", day: "numeric" });
}

// ---------- 全局状态 ----------
const S = {
  me: currentUser(),
  nav: "chats", // chats | contacts | moments
  convs: [],
  active: null,
  msgs: [],
  friends: [],
  blacklist: [],
  requests: { incoming: [], outgoing: [] },
  conv: null,
  moments: [],
  searchQ: "",
  timer: null,
};

// ---------- 登录 ----------
function renderLogin() {
  $app.replaceChildren(
    h("div", { class: "login-wrap" },
      h("div", { class: "login-box" },
        h("div", { class: "logo", text: "微" }),
        h("h1", { text: "微信" }),
        h("div", { class: "sub", text: "登录或注册账号" }),
        h("div", { class: "row" }, h("input", { id: "lg-user", placeholder: "用户名 / 微信号" })),
        h("div", { class: "row" }, h("input", { id: "lg-pass", type: "password", placeholder: "密码" })),
        h("div", { class: "row", id: "lg-nickwrap", style: "display:none" }, h("input", { id: "lg-nick", placeholder: "昵称（注册）" })),
        h("div", { class: "actions" },
          h("button", { id: "lg-submit", text: "登录" }),
          h("button", { class: "secondary", id: "lg-toggle", text: "注册" })),
        h("div", { class: "hint" },
          h("div", { text: "演示账号：user1 / user2 / user3 / service / admin / superadmin，密码均 password" })))));
  let mode = "login";
  const toggle = () => {
    mode = mode === "login" ? "register" : "login";
    document.getElementById("lg-submit").textContent = mode === "login" ? "登录" : "注册";
    document.getElementById("lg-nickwrap").style.display = mode === "login" ? "none" : "block";
    document.getElementById("lg-toggle").textContent = mode === "login" ? "注册" : "登录";
  };
  document.getElementById("lg-toggle").onclick = toggle;
  document.getElementById("lg-submit").onclick = async () => {
    const username = document.getElementById("lg-user").value.trim();
    const password = document.getElementById("lg-pass").value;
    const nickname = document.getElementById("lg-nick").value.trim();
    if (!username || !password) return toast("用户名与密码必填", false);
    try {
      const res = mode === "login"
        ? await post("/auth/login", { username, password })
        : await post("/auth/register", { username, password, nickname });
      setToken(res.token);
      setUser(res.user);
      S.me = res.user;
      bootstrap();
    } catch (e) {
      toast(e.message, false);
    }
  };
}

// ---------- 启动 / 轮询 ----------
async function bootstrap() {
  startPolling();
  try { await refreshConversations(); } catch (e) {}
  render();
}
function startPolling() {
  stopPolling();
  S.timer = setInterval(async () => {
    try { await refreshConversations(); } catch (e) {}
    if (S.nav === "chats") {
      const pl = document.getElementById("panel-list");
      if (pl && !S.searchQ.trim()) renderSidebarContent();
    }
    try { await syncActiveMessages(); } catch (e) {}
  }, 5000);
}
function stopPolling() {
  if (S.timer) clearInterval(S.timer);
}
function logout() {
  setToken(null);
  setUser(null);
  stopPolling();
  renderLogin();
}
function doLogout() {
  if (!confirm("确定退出登录？")) return;
  closePanel();
  logout();
}
async function refreshConversations(keepActive = true) {
  const res = await get("/conversations");
  S.convs = res.items || [];
  if (keepActive && S.active) {
    const found = S.convs.find((c) => c.id === S.active.id);
    if (found) S.active = found;
    else { S.active = null; S.msgs = []; S.conv = null; }
  }
}

// ================= 主渲染 =================
function render() {
  if (!isLoggedIn()) return renderLogin();
  const nav = renderNav();
  const sidebar = renderSidebar();
  const main = renderMain();
  $app.replaceChildren(h("div", { class: "wx-app" }, nav, sidebar, main));
  // render() 重建 DOM 后会生成空的 #panel-list，必须立即填充侧边栏，
  // 否则会等到下一次 5s 轮询才刷新（表现为左侧聊天栏短暂消失再现）。
  renderSidebarContent();
}

function renderNav() {
  const icons = {
    chats: { label: "聊天", svg: chatSvg() },
    contacts: { label: "通讯录", svg: contactSvg() },
    moments: { label: "朋友圈", svg: momentsSvg() },
  };
  const items = Object.entries(icons).map(([key, it]) =>
    h("div", { class: `rail-item ${S.nav === key ? "active" : ""}`, onclick: () => { S.nav = key; S.searchQ = ""; S.active = null; render(); } },
      h("div", { class: "rail-ico", html: it.svg }),
      h("div", { class: "rail-label", text: it.label })));
  return h("div", { class: "rail" },
    h("div", { class: "rail-icons" }, ...items),
    h("div", { class: "rail-avatar", onclick: openProfile }, avatarOf(S.me, "lg")),
    h("div", { class: "rail-settings", title: "个人信息", onclick: openProfile, html: gearSvg() }));
}

// ================= 中间列 =================
function renderSidebar() {
  const isMoments = S.nav === "moments";
  const inputAttrs = { id: "search-input", placeholder: isMoments ? "朋友圈" : (S.nav === "contacts" ? "搜索朋友" : "搜索"), value: S.searchQ || "" };
  if (!isMoments) inputAttrs.oninput = (e) => { S.searchQ = e.target.value; renderSidebarContent(); };
  const search = h("div", { class: "search" },
    h("span", { class: "search-ico", html: isMoments ? momentsSvg() : searchSvg() }),
    h("input", inputAttrs));
  const extra = isMoments
    ? h("div", { class: "sidebar-extra" }, h("div", { class: "icon-btn", title: "发布动态", onclick: openMomentComposer, html: momentCamSvg() }))
    : h("div", { class: "sidebar-extra" },
        h("div", { class: "icon-btn", title: "添加好友", onclick: openAddFriendPage, html: plusSvg() }),
        h("div", { class: "icon-btn", title: "发起群聊", onclick: openCreateGroup, html: groupSvg() }),
        h("div", { class: "icon-btn", title: "我的举报", onclick: openReports, html: flagSvg() }));
  return h("div", { class: "sidebar" },
    h("div", { class: "sidebar-head" }, search, extra),
    h("div", { class: "panel-list", id: "panel-list" }));
}
function renderSidebarContent() {
  const list = document.getElementById("panel-list");
  if (!list) return;
  list.replaceChildren();
  const q = S.searchQ.trim();
  if (S.nav === "moments") {
    renderMomentSidebar(list);
  } else if (S.nav === "contacts") {
    renderContactsList(list, q);
  } else if (q) {
    renderUserSearch(list, q);
  } else {
    renderConversationList(list);
  }
}
function renderMomentSidebar(list) {
  list.replaceChildren();
  list.appendChild(h("div", { class: "frow", onclick: openMomentComposer },
    avatarOf(S.me, "lg"),
    h("div", { class: "fname" },
      h("div", { class: "n", text: S.me.nickname }),
      h("div", { class: "s", text: "点击发布朋友圈动态" }))));
  list.appendChild(h("div", { class: "group-label", text: "朋友圈" }));
  list.appendChild(h("div", { class: "empty", text: "仅好友 + 本人可见的动态会出现在右侧。" }));
}

// ----- 会话列表 -----
function renderConversationList(list) {
  if (!S.convs.length) {
    list.appendChild(h("div", { class: "empty", text: "暂无会话。搜索用户开始聊天，或发起群聊。" }));
    return;
  }
  for (const c of S.convs) list.appendChild(convRow(c));
}

function convRow(c) {
  const last = c.lastMessage;
  let prev = "暂无消息";
  if (last) {
    const raw = (last.content || "").replace(/\n/g, " ");
    prev = `${last.senderId === S.me.id ? "我：" : ""}${raw.slice(0, 40)}`;
  } else if (c.type === "GROUP") {
    prev = c.notice || "暂无消息";
  }
  const title = c.type === "GROUP" ? c.name : c.name || "单聊";
  return h("div", { class: `conv ${S.active && S.active.id === c.id ? "active" : ""}`, onclick: () => selectConv(c) },
    avatarOf(c.type === "GROUP" ? { nickname: title.slice(0, 1) } : c, ""),
    h("div", { class: "cbody" },
      h("div", { class: "ctitle" },
        h("span", { class: "t", text: title }),
        !c.notify ? h("span", { class: "muted-tag", text: "免打扰" }) : "",
        last ? h("span", { class: "time", text: timeStr(last.createdAt) }) : ""),
      h("div", { class: "cprev", text: prev })),
    c.unread > 0 ? h("span", { class: "unread", text: c.unread > 99 ? "99+" : c.unread }) : "");
}

// ----- 搜索用户（可加好友 / 发消息）-----
async function renderUserSearch(list, q) {
  list.appendChild(h("div", { class: "group-label", text: `搜索 “${q}”` }));
  let items = [];
  try {
    items = (await get(`/friends/search?q=${encodeURIComponent(q)}`)).items || [];
  } catch (e) {
    list.appendChild(h("div", { class: "empty", text: e.message }));
    return;
  }
  if (!items.length) {
    list.appendChild(h("div", { class: "empty", text: "没有找到相关用户" }));
    return;
  }
  for (const u of items) list.appendChild(searchResultRow(u));
}

function relationAction(u) {
  switch (u.relation) {
    case "PENDING": return h("span", { class: "muted-text", text: "等待对方验证" });
    case "REQUESTED": return h("button", { class: "small", onclick: () => acceptRequest(u.id), text: "同意" });
    case "ACCEPTED": return h("button", { class: "small", onclick: () => openDirectById(u.id), text: "发消息" });
    case "BLOCKED": return h("button", { class: "small secondary", onclick: () => unblockUser(u.id), text: "解除拉黑" });
    case "BLOCKED_BY": return h("span", { class: "muted-text", text: "对方拉黑了你" });
    default: return h("button", { class: "small", onclick: () => openAddFriend(u), text: "加好友" });
  }
}
function searchResultRow(u) {
  return h("div", { class: "frow" },
    avatarOf(u),
    h("div", { class: "fname" },
      h("div", { class: "n", text: u.nickname }),
      h("div", { class: "s", text: "微信号：" + (u.wechatId || u.username) })),
    h("div", { class: "ops" }, relationAction(u)));
}

// ----- 通讯录 -----
async function renderContactsList(list, q) {
  list.appendChild(h("div", { class: "frow", onclick: openAddFriendPage },
    h("div", { class: "avatar", style: "background:#e8e8e8;color:#6a6a6a" }, "＋"),
    h("div", { class: "fname", style: "color:#191919" }, h("div", { class: "n", text: "添加朋友" }))));
  try {
    await loadFriends();
  } catch (e) {
    list.appendChild(h("div", { class: "empty", text: e.message }));
    return;
  }
  const toLower = q.toLowerCase();
  const matched = (f) => !q || f.nickname.toLowerCase().includes(toLower) || (f.username || "").toLowerCase().includes(toLower);

  if (S.requests.incoming.length) {
    list.appendChild(h("div", { class: "group-label", text: "好友申请" }));
    for (const r of S.requests.incoming) {
      list.appendChild(h("div", { class: "frow" },
        avatarOf({ nickname: r.nickname, username: r.username }),
        h("div", { class: "fname" },
          h("div", { class: "n", text: r.nickname }),
          h("div", { class: "s", text: "微信号：" + (r.wechatId || r.username) + (r.message ? " · 验证：" + r.message : "") })),
        h("div", { class: "ops" },
          h("button", { class: "small", onclick: () => acceptRequest(r.requester), text: "同意" }),
          h("button", { class: "small danger", onclick: () => rejectRequest(r.requester), text: "拒绝" }))));
    }
  }
  if (S.requests.outgoing.length) {
    list.appendChild(h("div", { class: "group-label", text: "已发送申请" }));
    for (const r of S.requests.outgoing) {
      list.appendChild(h("div", { class: "frow" },
        avatarOf({ nickname: r.nickname, username: r.username }),
        h("div", { class: "fname" },
          h("div", { class: "n", text: r.nickname }),
          h("div", { class: "s", text: r.message ? "验证：" + r.message : "" })),
        h("div", { class: "ops" }, h("span", { class: "muted-text", text: "等待确认" }))));
    }
  }
  list.appendChild(h("div", { class: "group-label", text: `我的好友（${S.friends.length}）` }));
  if (!S.friends.length) list.appendChild(h("div", { class: "empty", text: "还没有好友，搜一搜添加吧" }));
  for (const f of S.friends) {
    if (!matched(f)) continue;
    const u = { nickname: f.nickname, username: f.username, ...f };
    list.appendChild(h("div", { class: "frow", onclick: () => openDirectWith(f.userId) },
      avatarOf(u),
      h("div", { class: "fname" },
        h("div", { class: "n", text: f.nickname }),
        h("div", { class: "s", text: "微信号：" + (f.wechatId || f.username) })),
      h("div", { class: "ops" },
        h("button", { class: "small", onclick: (e) => { e.stopPropagation(); openDirectWith(f.userId); }, text: "发消息" }),
        h("button", { class: "small secondary", onclick: (e) => { e.stopPropagation(); blockUser(f.userId); }, text: "拉黑" }),
        h("button", { class: "small danger", onclick: (e) => { e.stopPropagation(); deleteFriend(f.userId); }, text: "删除" }))));
  }
  if (S.blacklist.length) {
    list.appendChild(h("div", { class: "group-label", text: "黑名单" }));
    for (const b of S.blacklist) {
      list.appendChild(h("div", { class: "frow" },
        avatarOf(b),
        h("div", { class: "fname" },
          h("div", { class: "n", text: b.nickname }),
          h("div", { class: "s", text: "微信号：" + (b.wechatId || b.username) })),
        h("div", { class: "ops" }, h("button", { class: "small secondary", onclick: () => unblockUser(b.userId), text: "解除拉黑" }))));
    }
  }
}

// ================= 右侧主区 =================
function renderMain() {
  if (S.nav === "moments") return renderMoments();
  if (S.active) return renderChat();
  return h("div", { class: "main" },
    h("div", { class: "chat-header" },
      h("div", { class: "htitle", text: S.nav === "contacts" ? "通讯录" : "微信" }),
      h("div", { class: "h-ops" })),
    h("div", { class: "empty-wrap" },
      h("div", { class: "wx-logo", html: wechatLogoSvg() }),
      h("div", { class: "empty-tip", text: S.nav === "contacts" ? "从通讯录选择一个好友发起聊天" : "选择一个会话开始聊天" })));
}

function convTitle(c) {
  if (c.type === "GROUP") return c.name + "";
  return c.name || "单聊";
}

// ================= 聊天窗口 =================
function renderChat() {
  const c = S.active;
  const canGroup = c.type === "GROUP";
  const header = h("div", { class: "chat-header" },
    h("div", { class: "htitle", onclick: openConvPanel, style: "cursor:pointer" },
      h("span", { text: convTitle(c) }),
      canGroup && c.notice ? h("span", { class: "mask", text: c.notice }) : ""),
    h("div", { class: "h-ops" },
      h("div", { class: "icon-btn", title: "聊天信息", onclick: openConvPanel, html: infoSvg() }),
      h("div", { class: "icon-btn", title: "我的举报", onclick: openReports, html: flagSvg() })));

  const body = h("div", { class: "chat-body", id: "chat-body" }, h("div", { class: "chat-inner", id: "chat-inner" }));

  const composer = h("div", { class: "composer" },
    h("div", { class: "composer-toolbar" },
      h("div", { class: "tool", title: "表情", onclick: () => toggleEmoji(), html: emojiSvg() }),
      h("div", { class: "tool", title: "图片 / 文件", onclick: () => document.getElementById("msg-input").focus(), html: photoSvg() })),
    h("div", { class: "msg-type-row" },
      h("select", { id: "msg-type" },
        h("option", { value: "TEXT", text: "文字" }),
        h("option", { value: "EMOTICON", text: "表情" }),
        h("option", { value: "IMAGE", text: "图片" }),
        h("option", { value: "FILE", text: "文件" }),
        h("option", { value: "VOICE", text: "语音" }))),
    h("div", { class: "composer-input" },
      h("textarea", { id: "msg-input", placeholder: "", onkeydown: (e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); sendMessage(); } } }),
      h("button", { class: "send-btn", onclick: sendMessage, text: "发送" })));

  const main = h("div", { class: "main" }, header, body, composer);

  // 渲染消息
  requestAnimationFrame(() => {
    const inner = document.getElementById("chat-inner");
    if (inner) renderMessages(inner);
    const el = document.getElementById("chat-body");
    if (el) el.scrollTop = el.scrollHeight;
  });
  return main;
}

async function selectConv(c) {
  S.active = c;
  S.active.id = Number(c.id);
  S.nav = "chats";
  S.searchQ = "";
  try {
    await loadMessages();
  } catch (e) {
    toast(e.message, false);
  }
  render();
  markRead();
}
async function loadMessages() {
  const res = await get(`/conversations/${S.active.id}/messages?limit=50`);
  S.msgs = res.items || [];
}
async function syncActiveMessages() {
  const inner = document.getElementById("chat-inner");
  if (!inner || !S.active) return;
  const el = document.getElementById("chat-body");
  const nearBottom = el && el.scrollHeight - el.scrollTop - el.clientHeight < 90;
  try { await loadMessages(); } catch (e) { return; }
  renderMessages(inner);
  if (el && nearBottom) el.scrollTop = el.scrollHeight;
}

function renderMessages(inner) {
  inner.replaceChildren();
  if (!S.active) return;
  if (S.active.type === "GROUP" && S.active.notice) {
    inner.appendChild(h("div", { class: "conv-banner", onclick: openConvPanel, text: `群公告：${S.active.notice}` }));
  }
  let lastTime = 0;
  for (const m of S.msgs) {
    if (m.createdAt - lastTime > 5 * 60 * 1000) {
      inner.appendChild(h("div", { class: "time-chip" }, h("span", { text: timeStr(m.createdAt) })));
    }
    lastTime = m.createdAt;
    if (m.recalled) {
      inner.appendChild(h("div", { class: "recall-tip", text: `${m.senderId === S.me.id ? "你" : (m.senderNickname || "对方")}撤回了一条消息` }));
      continue;
    }
    inner.appendChild(messageRow(m));
  }
}

function messageRow(m) {
  const mine = m.senderId === S.me.id;
  const mineDeleted = m.deletedBy && m.deletedBy.includes(S.me.id);
  const bubble = h("div", { class: `bubble${mineDeleted ? " deleted" : ""}` },
    h("span", { class: "bubble-tail" }),
    mineDeleted ? "已删除" : (m.content || ""));
  const name = !mine && S.active.type === "GROUP" ? h("div", { class: "sender", text: m.senderNickname || "成员" }) : "";
  const meta = h("div", { class: "meta" },
    h("span", { text: timeStr(m.createdAt) }),
    mine && !m.recalled ? h("span", { class: "mop", text: "撤回", onclick: () => recallMessage(m) }) : "",
    mine && !m.recalled ? h("span", { class: "mop", text: "删除", onclick: () => deleteMessage(m) }) : "",
    h("span", { class: "mop danger", text: "举报", onclick: () => openReport("MESSAGE", m.id, "举报这条消息") }));
  const body = h("div", { class: "mbody" }, name, bubble, meta);
  const av = avatarOf({ nickname: mine ? S.me.nickname : (m.senderNickname || "?") }, "");
  return h("div", { class: `msg ${mine ? "mine" : ""}` }, av, body);
}

async function sendMessage() {
  const input = document.getElementById("msg-input");
  const type = document.getElementById("msg-type").value;
  const content = input.value.replace(/\n$/, "").trim();
  if (!content) return;
  try {
    await post("/messages", { convId: Number(S.active.id), type, content });
    input.value = "";
    await loadMessages();
    render();
  } catch (e) {
    toast(e.message, false);
  }
}
async function recallMessage(m) {
  try {
    await post("/messages/recall", { messageId: m.id });
    await loadMessages();
    render();
  } catch (e) {
    toast(e.message, false);
  }
}
async function deleteMessage(m) {
  try {
    await post("/messages/delete", { messageId: m.id });
    await loadMessages();
    render();
  } catch (e) {
    toast(e.message, false);
  }
}
function markRead() {
  if (!S.active) return;
  const maxMsg = S.msgs.length ? S.msgs[S.msgs.length - 1].id : 0;
  post("/messages/read", { convId: Number(S.active.id), lastReadMsgId: maxMsg }).catch(() => {});
}
function toggleEmoji() {
  const input = document.getElementById("msg-input");
  if (!input) return;
  const box = emojiPanel();
  input.focus();
  box.addEventListener("click", (e) => {
    if (e.target.dataset && e.target.dataset.em) {
      input.value += e.target.dataset.em;
      input.focus();
    }
  });
  overlay(box, { panelOnly: true });
}

// ================= 好友 =================
async function loadFriends() {
  const [fr, rq, bl] = await Promise.all([get("/friends"), get("/friends/requests"), get("/friends/blacklist")]);
  S.friends = fr.items || [];
  S.requests = rq || { incoming: [], outgoing: [] };
  S.blacklist = bl.items || [];
}

function openAddFriend(u) {
  const box = h("div", { class: "panel" },
    h("div", { class: "p-header" }, h("h3", { text: "添加好友" }), h("span", { class: "close", onclick: closePanel, text: "✕" })),
    h("label", { text: `你已找到：${u.nickname}（@${u.username}）` }),
    h("div", { class: "kv" }, h("span", { text: "验证消息" }), h("span", { text: "让对方确认" })),
    h("input", { id: "fr-message", placeholder: "例：我是张三", value: `我是 ${S.me.nickname || S.me.username}` }),
    h("div", { class: "ops" },
      h("button", { onclick: () => submitAddFriend(u.id), text: "发送申请" }),
      h("button", { class: "secondary", onclick: closePanel, text: "取消" })));
  overlay(box);
}
async function submitAddFriend(userId) {
  const message = document.getElementById("fr-message").value.trim();
  try {
    await post("/friends/request", { userId, message });
    toast("好友申请已发送");
    closePanel();
    loadFriends().then(() => render());
  } catch (e) {
    toast(e.message, false);
  }
}

function openAddFriendPage() {
  const box = h("div", { class: "panel", style: "width:480px;max-width:92vw" },
    h("div", { class: "p-header" }, h("h3", { text: "添加朋友" }), h("span", { class: "close", onclick: closePanel, text: "✕" })),
    h("label", { text: "微信号 / 手机号" }),
    h("div", { class: "inline-form" },
      h("input", { id: "af-wechat", placeholder: "输入对方微信号，如 wx_user2", oninput: () => doWechatSearch(), onkeydown: (e) => { if (e.key === "Enter") doWechatSearch(); } }),
      h("button", { onclick: () => doWechatSearch(), text: "搜索" })),
    h("div", { class: "section-title", text: "搜索结果" }),
    h("div", { id: "af-results", class: "af-results" }),
    h("div", { class: "note", text: "敲下对方的微信号即可查找；对方同意后你们将成为好友。" }),
    h("div", { class: "ops" }, h("button", { class: "secondary", onclick: closePanel, text: "关闭" })));
  overlay(box);
  const ib = document.getElementById("af-wechat");
  if (ib) ib.focus();
}
async function doWechatSearch() {
  const res = document.getElementById("af-results");
  if (!res) return;
  const q = document.getElementById("af-wechat").value.trim();
  res.replaceChildren();
  if (!q) { res.appendChild(h("div", { class: "muted-text", text: "请输入微信号搜索" })); return; }
  let items = [];
  try { items = (await get(`/friends/search?q=${encodeURIComponent(q)}`)).items || []; }
  catch (e) { res.appendChild(h("div", { class: "empty", text: e.message })); return; }
  if (!items.length) { res.appendChild(h("div", { class: "empty", text: "未找到该微信号对应的用户" })); return; }
  for (const u of items) {
    res.appendChild(h("div", { class: "frow" },
      avatarOf(u),
      h("div", { class: "fname" },
        h("div", { class: "n", text: u.nickname }),
        h("div", { class: "s", text: "微信号：" + (u.wechatId || u.username) })),
      h("div", { class: "ops" }, relationAction(u))));
  }
}

async function acceptRequest(userId) {
  try { await post("/friends/accept", { userId }); toast("已添加好友"); loadFriends().then(() => render()); } catch (e) { toast(e.message, false); }
}
async function rejectRequest(userId) {
  try { await post("/friends/reject", { userId }); toast("已拒绝"); loadFriends().then(() => render()); } catch (e) { toast(e.message, false); }
}
async function deleteFriend(userId) {
  if (!confirm("确定删除该好友？删除后将解除好友关系。")) return;
  try { await del(`/friends/${userId}`); toast("已删除好友"); loadFriends().then(() => render()); } catch (e) { toast(e.message, false); }
}
async function blockUser(userId) {
  if (!confirm("加入黑名单后，对方将无法向你发消息。确定？")) return;
  try { await post("/friends/block", { userId }); toast("已加入黑名单"); loadFriends().then(() => render()); } catch (e) { toast(e.message, false); }
}
async function unblockUser(userId) {
  try { await post("/friends/unblock", { userId }); toast("已解除拉黑"); loadFriends().then(() => render()); } catch (e) { toast(e.message, false); }
}
async function openDirectWith(userId) {
  await post("/friends/request", { userId }).catch(() => {});
  await post("/friends/accept", { userId }).catch(() => {});
  await refreshConversations();
  const found = S.convs.find((x) => x.type === "DIRECT" && Number(x.partnerId) === Number(userId));
  if (!found) { toast("请先互为好友", false); return; }
  selectConv(found);
}
async function openDirectById(userId) {
  const found = S.convs.find((x) => x.type === "DIRECT" && Number(x.partnerId) === Number(userId));
  if (found) return selectConv(found);
  await openDirectWith(userId);
}

// ================= 群 =================
function openCreateGroup() {
  const box = h("div", { class: "panel" },
    h("div", { class: "p-header" }, h("h3", { text: "发起群聊" }), h("span", { class: "close", onclick: closePanel, text: "✕" })),
    h("label", { text: "群名" }), h("input", { id: "cg-name", placeholder: "群名" }),
    h("div", { class: "section-title", text: "选择成员（已有好友关系）" }),
    h("div", { id: "cg-members", style: "max-height:200px;overflow-y:auto;border:1px solid #f0f0f0;border-radius:8px;padding:4px" }),
    h("div", { class: "ops" },
      h("button", { onclick: createGroup, text: "创建" }),
      h("button", { class: "secondary", onclick: closePanel, text: "取消" })));
  overlay(box);
  const list = document.getElementById("cg-members");
  get("/friends").then((f) => {
    for (const m of f.items || []) {
      list.appendChild(h("label", { style: "display:flex;gap:8px;padding:6px 8px;cursor:pointer" },
        h("input", { type: "checkbox", class: "cg-friend", value: m.userId }),
        h("span", { text: m.nickname })));
    }
  });
}
async function createGroup() {
  const name = document.getElementById("cg-name").value.trim();
  const memberIds = Array.from(document.querySelectorAll(".cg-friend:checked")).map((n) => Number(n.value));
  if (!name) return toast("群名必填", false);
  try {
    const res = await post("/conversations/group", { name, memberIds });
    toast("群已创建");
    await refreshConversations();
    closePanel();
    const c = S.convs.find((x) => x.id === Number(res.conversationId));
    if (c) selectConv(c);
    else render();
  } catch (e) { toast(e.message, false); }
}

function openConvPanel() {
  const c = S.active;
  if (!c) return;
  const panel = h("div", { class: "panel", style: "width:440px" });
  if (c.type === "GROUP") {
    addGroupSettings(panel, c);
  } else {
    panel.appendChild(h("div", { class: "p-header" }, h("h3", { text: c.name || "单聊" }), h("span", { class: "close", onclick: closePanel, text: "✕" })));
    panel.appendChild(contactCard(panel, c, c.partnerId));
  }
  addConvManagement(panel, c);
  overlay(panel);
}

/** 会话级设置：置顶 + 消息免打扰（对齐微信电脑端） */
function addConvManagement(panel, c) {
  panel.appendChild(h("div", { class: "section-title", text: "会话设置" }));
  const rows = h("div", { style: "display:flex;flex-direction:column;gap:8px" });
  // 置顶
  rows.appendChild(h("div", { class: "frow" },
    h("span", { text: "置顶聊天" }),
    h("div", { class: "ops" },
      h("button", { class: `small ${c.pin ? "ok" : "secondary"}`, onclick: () => togglePin(c, !c.pin), text: c.pin ? "已置顶" : "置顶" }))));
  // 免打扰
  const muted = !c.notify;
  rows.appendChild(h("div", { class: "frow" },
    h("span", { text: "消息免打扰" }),
    h("div", { class: "ops" },
      h("button", { class: `small ${muted ? "ok" : "secondary"}`, onclick: () => toggleNotify(c, muted), text: muted ? "已开启" : "开启" }))));
  panel.appendChild(rows);
}
async function togglePin(c, pin) {
  try {
    await post("/conversations/pin", { convId: Number(c.id), pin });
    toast(pin ? "已置顶" : "已取消置顶");
    await refreshConversations();
    render();
  } catch (e) { toast(e.message, false); }
}
async function toggleNotify(c, mute) {
  try {
    await post("/conversations/notify", { convId: Number(c.id), notify: !mute });
    toast(mute ? "已开启免打扰" : "已关闭免打扰");
    if (S.active && Number(S.active.id) === Number(c.id)) S.active.notify = !mute;
    render();
    openConvPanel();
  } catch (e) { toast(e.message, false); }
}

function contactCard(panel, c, userId) {
  panel.appendChild(h("div", { class: "section-title", text: "会话信息" }));
  panel.appendChild(h("div", { class: "profile-hero" },
    avatarOf({ nickname: c.name } || { nickname: c.name }, "lg"),
    h("div", {},
      h("div", { class: "n", text: c.name || "单聊" }),
      h("div", { class: "s", text: "类型：单聊" }))));
  const ops = h("div", { class: "ops" });
  ops.appendChild(h("button", { class: "small", onclick: () => openDirectById(c.partnerId), text: "发消息" }));
  if (userId) ops.appendChild(h("button", { class: "small danger", onclick: () => deleteFriend(Number(userId)), text: "删除好友" }));
  ops.appendChild(h("button", { class: "small secondary", onclick: closePanel, text: "关闭" }));
  panel.appendChild(ops);
}

function addGroupSettings(panel, c) {
  panel.appendChild(h("div", { class: "p-header" }, h("h3", { text: "群聊设置" }), h("span", { class: "close", onclick: closePanel, text: "✕" })));
  panel.appendChild(h("div", { class: "kv" }, h("span", { text: "我的角色" }), h("b", { text: myRole(c.myRole) })));

  const canRename = ["OWNER", "ADMIN"].includes(c.myRole);
  const canNotice = ["OWNER", "ADMIN"].includes(c.myRole);

  if (canRename) {
    panel.appendChild(h("label", { text: "群聊名称" }));
    panel.appendChild(h("div", { class: "inline-form" },
      h("input", { id: "gp-name", placeholder: "群名", value: c.name || "" }),
      h("button", { class: "small", onclick: renameGroup, text: "保存" })));
  } else {
    panel.appendChild(h("div", { class: "kv" }, h("span", { text: "群聊名称" }), h("b", { text: c.name })));
  }
  if (canNotice) {
    panel.appendChild(h("label", { text: "群公告" }));
    panel.appendChild(h("div", { class: "inline-form" },
      h("input", { id: "gp-notice", placeholder: "填写群公告", value: c.notice || "" }),
      h("button", { class: "small", onclick: editNotice, text: "发布" })));
  } else if (c.notice) {
    panel.appendChild(h("div", { class: "kv" }, h("span", { text: "群公告" }), h("span", { text: c.notice })));
  }

  panel.appendChild(h("div", { class: "section-title", text: "群成员" }));
  const members = h("div", { id: "gp-members" });
  panel.appendChild(members);
  loadGroupInfo(c.id).then((g) => {
    activateGroupMembers(members, g, c);
    S.conv = g;
  });

  const ops = h("div", { class: "ops" });
  ops.appendChild(h("button", { class: "small", onclick: () => inviteMembers(c), text: "邀请成员" }));
  if (["OWNER", "ADMIN"].includes(c.myRole)) {
    ops.appendChild(h("button", { class: "small", onclick: () => toggleMuteAll(!(c.muteAll || false)), text: c.muteAll ? "取消全员禁言" : "全员禁言" }));
  }
  if (c.myRole === "OWNER") {
    ops.appendChild(h("button", { class: "small warn", onclick: () => transferOwner(c), text: "转让群主" }));
    ops.appendChild(h("button", { class: "small danger", onclick: () => disbandGroup(c), text: "解散群" }));
  }
  if (c.myRole !== "OWNER") {
    ops.appendChild(h("button", { class: "small danger", onclick: () => leaveGroup(c), text: "退出群聊" }));
  }
  ops.appendChild(h("button", { class: "small secondary", onclick: closePanel, text: "关闭" }));
  panel.appendChild(ops);
}

function activateGroupMembers(members, g, c) {
  members.replaceChildren();
  members.classList.add("af-results");
  for (const m of g.members || []) {
    const roleTag = m.role === "OWNER" ? "群主" : m.role === "ADMIN" ? "管理员" : "";
    const isSelf = m.user_id === S.me.id;
    const canManage = (c.myRole === "OWNER" && !isSelf) || (c.myRole === "ADMIN" && m.role === "MEMBER" && !isSelf);
    members.appendChild(h("div", { class: "frow" },
      avatarOf({ nickname: m.nickname, username: m.username }),
      h("div", { class: "fname" },
        h("div", { class: "n", text: m.nickname + (isSelf ? "（我）" : "") }),
        h("div", { class: "s", text: "微信号：" + m.username + (roleTag ? " · " + roleTag : "") })),
      canManage ? h("div", { class: "ops" },
        h("button", { class: "small", onclick: () => muteMember(m.user_id), text: "禁言" }),
        c.myRole === "OWNER" ? h("button", { class: "small secondary", onclick: () => setAdmin(m.user_id, m.role !== "ADMIN"), text: m.role === "ADMIN" ? "取消管理" : "设管理" }) : "",
        h("button", { class: "small danger", onclick: () => kickUser(m.user_id), text: "移出" })) : ""));
  }
}

async function renameGroup() {
  const name = document.getElementById("gp-name").value.trim();
  if (!name) return toast("群名不能为空", false);
  try {
    await post(`/group/${S.active.id}/rename`, { name });
    toast("群名已更新");
    S.active.name = name;
    await refreshConversations();
    render();
  } catch (e) { toast(e.message, false); }
}
async function editNotice() {
  const notice = document.getElementById("gp-notice").value.trim();
  try {
    await post(`/group/${S.active.id}/notice`, { notice });
    toast("群公告已发布");
    S.active.notice = notice;
    await refreshConversations();
    render();
  } catch (e) { toast(e.message, false); }
}
function myRole(r) {
  return { OWNER: "群主", ADMIN: "群管理员", MEMBER: "成员" }[r] || r;
}
async function loadGroupInfo(convId) {
  return await get(`/group/${convId}`);
}
async function inviteMembers(c) {
  const box = h("div", { class: "panel" },
    h("div", { class: "p-header" }, h("h3", { text: "邀请成员" }), h("span", { class: "close", onclick: closePanel, text: "✕" })),
    h("div", { id: "iv-list", style: "max-height:240px;overflow-y:auto" }),
    h("div", { class: "ops" }, h("button", { onclick: doInvite, text: "发送邀请" }), h("button", { class: "secondary", onclick: closePanel, text: "取消" })));
  overlay(box);
  const list = document.getElementById("iv-list");
  get("/friends").then((f) => {
    for (const m of f.items || []) {
      list.appendChild(h("label", { style: "display:flex;gap:8px;padding:6px 8px;cursor:pointer" },
        h("input", { type: "checkbox", class: "iv-friend", value: m.userId }),
        h("span", { text: m.nickname })));
    }
  });
}
async function doInvite() {
  const userIds = Array.from(document.querySelectorAll(".iv-friend:checked")).map((n) => Number(n.value));
  try {
    await post(`/group/${S.active.id}/invite`, { userIds });
    toast("已邀请");
    closePanel();
    openConvPanel();
  } catch (e) { toast(e.message, false); }
}
async function muteMember(userId) {
  try {
    await post(`/group/${S.active.id}/mute`, { userId, until: Date.now() + 3600000 });
    toast("已禁言 1 小时");
    openConvPanel();
  } catch (e) { toast(e.message, false); }
}
async function kickUser(userId) {
  if (!confirm("确定将该成员移出群聊？")) return;
  try {
    await post(`/group/${S.active.id}/kick`, { userId });
    toast("已移出");
    openConvPanel();
  } catch (e) { toast(e.message, false); }
}
async function setAdmin(userId, isAdmin) {
  try {
    await post(`/group/${S.active.id}/set-admin`, { userId, isAdmin });
    toast(isAdmin ? "已设为管理员" : "已取消管理员");
    openConvPanel();
  } catch (e) { toast(e.message, false); }
}
async function toggleMuteAll(mute) {
  try {
    await post(`/group/${S.active.id}/mute-all`, { mute });
    toast(mute ? "已全员禁言" : "已取消全员禁言");
    S.active.muteAll = mute;
    openConvPanel();
  } catch (e) { toast(e.message, false); }
}
async function transferOwner(c) {
  const target = prompt("输入新群主的 userId", "");
  if (!target) return;
  try {
    await post(`/group/${c.id}/transfer`, { userId: Number(target) });
    toast("群主已转让");
    closePanel();
    await refreshConversations();
    render();
  } catch (e) { toast(e.message, false); }
}
async function disbandGroup(c) {
  if (!confirm("确定解散该群？此操作不可恢复。")) return;
  try {
    await post(`/group/${c.id}/disband`, {});
    toast("群已解散");
    S.active = null;
    await refreshConversations();
    render();
  } catch (e) { toast(e.message, false); }
}
async function leaveGroup(c) {
  if (c.myRole === "OWNER") return toast("群主不能直接退群，请先转让", false);
  try {
    await post("/conversations/leave", { convId: Number(c.id) });
    toast("已退出群");
    S.active = null;
    await refreshConversations();
    render();
  } catch (e) { toast(e.message, false); }
}

// ================= 举报 =================
function openReport(targetType, targetId, title) {
  const box = h("div", { class: "panel" },
    h("div", { class: "p-header" }, h("h3", { text: title }), h("span", { class: "close", onclick: closePanel, text: "✕" })),
    h("label", { text: "举报类别" }),
    h("select", { id: "rp-cat" },
      h("option", { value: "HARASSMENT", text: "骚扰" }),
      h("option", { value: "AD", text: "广告" }),
      h("option", { value: "ILLEGAL", text: "违法" }),
      h("option", { value: "PORNOGRAPHY", text: "涉黄" }),
      h("option", { value: "FRAUD", text: "诈骗" }),
      h("option", { value: "OTHER", text: "其他" })),
    h("label", { text: "补充说明" }),
    h("textarea", { id: "rp-desc", rows: 3, placeholder: "描述具体情况" }),
    h("div", { class: "ops" },
      h("button", { onclick: submitReport, text: "提交举报" }),
      h("button", { class: "secondary", onclick: closePanel, text: "取消" })));
  overlay(box);
  window.__rp = { targetType, targetId };
}
async function submitReport() {
  const category = document.getElementById("rp-cat").value;
  const description = document.getElementById("rp-desc").value.trim();
  try {
    await post("/reports", { targetType: window.__rp.targetType, targetId: window.__rp.targetId, category, description });
    toast("举报已提交");
    closePanel();
  } catch (e) { toast(e.message, false); }
}
async function openReports() {
  const box = h("div", { class: "panel", style: "width:520px;max-width:90vw" },
    h("div", { class: "p-header" }, h("h3", { text: "我的举报" }), h("span", { class: "close", onclick: closePanel, text: "✕" })),
    h("div", { id: "myreports", style: "max-height:60vh;overflow-y:auto" }),
    h("div", { class: "ops" }, h("button", { class: "secondary", onclick: closePanel, text: "关闭" })));
  overlay(box);
  const list = document.getElementById("myreports");
  const res = await get("/reports/mine").catch((e) => { toast(e.message, false); return { items: [] }; });
  for (const r of res.items || []) {
    list.appendChild(h("div", { class: "frow", style: "flex-direction:column;align-items:flex-start;border:1px solid #f2f2f2;border-radius:8px;margin:6px 0" },
      h("div", { style: "display:flex;justify-content:space-between;width:100%" },
        h("span", { text: `${targetLabel(r.targetType)} #${r.targetId} · ${catLabel(r.category)}` }),
        h("span", { class: "badge", text: statusLabel(r.status) })),
      h("div", { class: "muted-text", text: r.description || "（无说明）" }),
      h("div", { class: "muted-text", text: "时间 " + timeStr(r.createdAt) })));
  }
  if (!(res.items || []).length) list.appendChild(h("div", { class: "empty", text: "还没有举报记录" }));
}
function targetLabel(t) { return { MESSAGE: "消息", USER: "用户", GROUP: "群" }[t] || t; }
function catLabel(c) { return { HARASSMENT: "骚扰", AD: "广告", ILLEGAL: "违法", PORNOGRAPHY: "涉黄", FRAUD: "诈骗", OTHER: "其他" }[c] || c; }
function statusLabel(s) { return { PENDING: "待处理", REVIEWING: "处理中", ESCALATED: "已升级", PUNISHED: "已处罚", REJECTED: "已驳回", APPEALING: "申诉中", SUSTAINED: "维持处罚", REVERTED: "已撤销" }[s] || s; }

// ================= 朋友圈 =================
let momentReply = null; // { momentId, replyTo, nickname }

function renderMoments() {
  const header = h("div", { class: "chat-header" },
    h("div", { class: "htitle", text: "朋友圈" }),
    h("div", { class: "h-ops" },
      h("div", { class: "icon-btn", title: "发布动态", onclick: openMomentComposer, html: momentCamSvg() })));
  const feed = h("div", { class: "moment-feed", id: "moment-feed" });
  const main = h("div", { class: "main moment-main" }, header, feed);
  requestAnimationFrame(() => renderMomentFeed());
  return main;
}
async function renderMomentFeed() {
  const el = document.getElementById("moment-feed");
  if (!el) return;
  const scrollTop = el.scrollTop;
  el.replaceChildren();
  try {
    S.moments = (await get("/moments")).items || [];
  } catch (e) {
    el.appendChild(h("div", { class: "empty", text: e.message }));
    return;
  }
  el.replaceChildren();
  if (!S.moments.length) {
    el.appendChild(h("div", { class: "empty", text: "还没有动态，发布你的第一条朋友圈吧。" }));
    return;
  }
  for (const m of S.moments) el.appendChild(momentCard(m));
  // 点赞/评论/删除后重新拉取会清空列表，还原滚动位置避免列表跳回顶部
  el.scrollTop = scrollTop;
}
function momentCard(m) {
  const mine = m.author.id === S.me.id;
  const head = h("div", { class: "moment-head" },
    avatarOf({ nickname: m.author.nickname }),
    h("div", { class: "grow" },
      h("div", { class: "author", text: m.author.nickname + (mine ? "（我）" : "") }),
      h("div", { class: "mtime", text: momentTime(m.createdAt) })),
    mine ? h("button", { class: "small danger", onclick: () => deleteMoment(m), text: "删除" }) : "");
  const actions = h("div", { class: "m-actions" },
    h("span", { class: `like ${m.likedByMe ? "on" : ""}`, onclick: () => toggleMomentLike(m), text: `${m.likedByMe ? "❤️" : "🤍"} ${m.likeCount || ""}`.trim() }),
    h("span", { class: "cmt", onclick: () => focusMomentComment(m.id), text: "评论" }));
  const comments = h("div", { class: "m-comments" },
    ...m.comments.map((c) => momentCommentRow(m, c)));
  const input = h("div", { class: "m-comment-row" },
    h("input", { id: `cmt-${m.id}`, placeholder: "写评论...", onkeydown: (e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); submitMomentComment(m); } } }),
    h("button", { class: "small", onclick: () => submitMomentComment(m), text: "发送" }));
  const body = h("div", { class: "moment-body" },
    h("div", { class: "mcontent", text: m.content }),
    actions,
    m.likeCount > 0 ? h("div", { class: "m-likes", text: `${m.likeCount} 人赞过` }) : "",
    m.comments.length ? comments : "",
    input);
  return h("div", { class: "moment" }, head, body);
}
function momentCommentRow(m, c) {
  const label = c.replyTo
    ? h("span", {}, h("b", { text: c.nickname }), h("span", { text: " 回复 " }), h("b", { text: c.replyNickname || "?" }), h("span", { text: `：${c.content}` }))
    : h("span", {}, h("b", { text: c.nickname }), h("span", { text: `：${c.content}` }));
  return h("div", { class: "m-comment" },
    label,
    h("span", { class: "rep", onclick: () => setMomentReply(m, c), text: "回复" }));
}
function momentTime(ts) {
  if (!ts) return "";
  const d = new Date(ts), n = new Date();
  if (d.toDateString() === n.toDateString()) return d.toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" });
  return d.toLocaleDateString("zh-CN", { month: "numeric", day: "numeric" }) + " " + d.toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" });
}
function focusMomentComment(momentId) {
  const inp = document.getElementById(`cmt-${momentId}`);
  if (inp) { momentReply = null; inp.placeholder = "写评论..."; inp.focus(); }
}
function setMomentReply(m, c) {
  momentReply = { momentId: m.id, replyTo: c.id, nickname: c.nickname };
  const inp = document.getElementById(`cmt-${m.id}`);
  if (inp) { inp.placeholder = `回复 @${c.nickname}`; inp.focus(); }
}
async function toggleMomentLike(m) {
  try { await post(`/moments/${m.id}/like`, {}); await renderMomentFeed(); } catch (e) { toast(e.message, false); }
}
async function submitMomentComment(m) {
  const inp = document.getElementById(`cmt-${m.id}`);
  if (!inp) return;
  const content = inp.value.trim();
  if (!content) return;
  const reply = momentReply && momentReply.momentId === m.id ? { replyTo: momentReply.replyTo } : {};
  try {
    await post(`/moments/${m.id}/comment`, { content, ...reply });
    inp.value = ""; momentReply = null;
    await renderMomentFeed();
  } catch (e) { toast(e.message, false); }
}
async function deleteMoment(m) {
  if (!confirm("确定删除这条动态？将同时删除其点赞与评论。")) return;
  try { await del(`/moments/${m.id}`); toast("已删除动态"); await renderMomentFeed(); } catch (e) { toast(e.message, false); }
}
function openMomentComposer() {
  const box = h("div", { class: "panel" },
    h("div", { class: "p-header" }, h("h3", { text: "发朋友圈" }), h("span", { class: "close", onclick: closePanel, text: "✕" })),
    h("textarea", { id: "mo-content", rows: 5, placeholder: "这一刻的想法...（文字/表情）", style: "width:100%;box-sizing:border-box;border:1px solid #f0f0f0;border-radius:8px;padding:8px;resize:vertical" }),
    h("div", { class: "ops" },
      h("button", { onclick: insertMomentEmoji, text: "表情" }),
      h("button", { onclick: publishMoment, text: "发表" }),
      h("button", { class: "secondary", onclick: closePanel, text: "取消" })));
  overlay(box);
  const ta = document.getElementById("mo-content");
  if (ta) ta.focus();
}
function insertMomentEmoji() {
  const ta = document.getElementById("mo-content");
  if (!ta) return;
  const box = emojiPanel();
  box.addEventListener("click", (e) => {
    if (e.target.dataset && e.target.dataset.em) {
      ta.value += e.target.dataset.em;
      ta.focus();
    }
  });
  overlay(box, { panelOnly: true });
}
async function publishMoment() {
  const ta = document.getElementById("mo-content");
  const content = ta ? ta.value.trim() : "";
  if (!content) return toast("内容不能为空", false);
  try {
    await post("/moments", { content });
    toast("已发表");
    closePanel();
    if (S.nav === "moments") await renderMomentFeed();
  } catch (e) { toast(e.message, false); }
}

// ================= 个人资料 =================
function openProfile() {
  const box = h("div", { class: "panel" },
    h("div", { class: "p-header" }, h("h3", { text: "个人信息" }), h("span", { class: "close", onclick: closePanel, text: "✕" })),
    h("div", { class: "profile-hero" },
      avatarOf(S.me, "lg"),
      h("div", {},
        h("div", { class: "n", text: S.me.nickname }),
        h("div", { class: "s", text: "用户名：@" + S.me.username + " · " + roleLabel(S.me.role) }))),
    h("label", { text: "微信号（可自定义，字母开头、6-20 位）" }),
    h("div", { class: "inline-form" },
      h("input", { id: "pf-wechat", placeholder: "填写你的微信号", value: S.me.wechatId || "", onkeydown: (e) => { if (e.key === "Enter") saveWechat(); } }),
      h("button", { onclick: saveWechat, text: "保存" })),
    h("div", { class: "note", text: "微信号是别人搜索并添加你的唯一标识，请谨慎设置。" }),
    h("div", { class: "ops" },
      h("button", { class: "danger", onclick: doLogout, text: "退出登录" }),
      h("button", { class: "secondary", onclick: closePanel, text: "关闭" })));
  overlay(box);
  const inp = document.getElementById("pf-wechat");
  if (inp) inp.focus();
}
async function saveWechat() {
  const wechatId = document.getElementById("pf-wechat").value.trim();
  try {
    const res = await post("/users/wechat", { wechatId });
    S.me.wechatId = res.wechatId;
    setUser(S.me);
    toast("微信号已更新");
    closePanel();
    render();
  } catch (e) { toast(e.message, false); }
}

// ================= 通用 =================
function overlay(content, opts = {}) {
  const ov = h("div", { class: "panel-overlay" }, content);
  ov.addEventListener("click", (e) => { if (e.target === ov) ov.remove(); });
  document.body.appendChild(ov);
  return ov;
}
function closePanel() {
  document.querySelectorAll(".panel-overlay").forEach((n) => n.remove());
}

// ---------- 表情面板 ----------
function emojiPanel() {
  const emojis = ["😀","😁","😂","🤣","😊","😍","🤔","😅","😉","😎","🙃","😴","🥳","😭","😡","🤝","👍","👎","👏","🙏","💪","🎉","❤️","💔","🌹","🌞","🌙","☀️","🔥","⚡","🍎","☕","🐶","🐱","✌️","🤗","😇","🤩","😌","😏"];
  return h("div", { class: "panel", style: "width:300px" }, h("div", { class: "af-results" },
    ...emojis.map((e) => h("span", { class: "clickable", style: "margin:12px;font-size:24px", "data-em": e, text: e }))));
}

// ================= 启动 =================
if (isLoggedIn()) bootstrap();
else renderLogin();

// ================= SVG 图标 =================
function chatSvg() {
  return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M21 11.5c0 4.14-4.03 7.5-9 7.5-1.15 0-2.25-.16-3.27-.46L4 20l1.53-2.01C4.17 16.7 3 14.42 3 11.5 3 7.36 7.03 4 12 4s9 3.36 9 7.5z"/></svg>`;
}
function contactSvg() {
  return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><rect x="4" y="3" width="16" height="18" rx="2"/><circle cx="12" cy="10" r="3"/><path d="M7 17c.7-1.8 2.7-2.5 5-2.5s4.3.7 5 2.5"/></svg>`;
}
function searchSvg() {
  return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></svg>`;
}
function plusSvg() {
  return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 5v14M5 12h14"/></svg>`;
}
function groupSvg() {
  return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="9" cy="8" r="3"/><circle cx="16" cy="10" r="2.5"/><path d="M4 20c.7-3 2.7-4 5-4s4.3 1 5 4M14.5 16.7c2.4 0 4.3.8 5 3.3"/></svg>`;
}
function flagSvg() {
  return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M5 3v18M5 4h13l-2.5 4L18 12H5"/></svg>`;
}
function infoSvg() {
  return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><circle cx="12" cy="12" r="9"/><path d="M12 8h.01M11 12h1v4h1"/></svg>`;
}
function momentsSvg() {
  return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="3"/><path d="M17.5 5.5c1.4 1.4 2 3 2.5 4.5M5.5 17.5C4.1 16.1 3.5 14.5 3 13M6.5 5.5C5.1 6.9 4.5 8.5 4 10M17.5 17.5c1.4-1.4 2-3 2.5-4.5"/></svg>`;
}
function momentCamSvg() {
  return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><rect x="3" y="7" width="18" height="14" rx="2"/><path d="M8 7l1.5-2h5L16 7"/><circle cx="12" cy="13" r="3"/></svg>`;
}
function emojiSvg() {
  return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><circle cx="12" cy="12" r="9"/><path d="M8 14s1.5 2 4 2 4-2 4-2M9 9h.01M15 9h.01"/></svg>`;
}
function photoSvg() {
  return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><rect x="3" y="4" width="18" height="16" rx="2"/><circle cx="9" cy="9" r="2"/><path d="m4 17 5-5 3 3 4-4 4 4"/></svg>`;
}
function gearSvg() {
  return `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .34 1.87l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.7 1.7 0 0 0-1.87-.34 1.7 1.7 0 0 0-1 1.55V21a2 2 0 1 1-4 0v-.09a1.7 1.7 0 0 0-1-1.55 1.7 1.7 0 0 0-1.87.34l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.7 1.7 0 0 0 .34-1.87 1.7 1.7 0 0 0-1.55-1H3a2 2 0 1 1 0-4h.09a1.7 1.7 0 0 0 1.55-1 1.7 1.7 0 0 0-.34-1.87l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.7 1.7 0 0 0 1.87.34h0a1.7 1.7 0 0 0 1-1.55V3a2 2 0 1 1 4 0v.09a1.7 1.7 0 0 0 1 1.55h0a1.7 1.7 0 0 0 1.87-.34l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.7 1.7 0 0 0-.34 1.87v0a1.7 1.7 0 0 0 1.55 1H21a2 2 0 1 1 0 4h-.09a1.7 1.7 0 0 0-1.55 1z"/></svg>`;
}
function wechatLogoSvg() {
  return `<svg viewBox="0 0 120 120" fill="none">
    <rect x="8" y="16" width="66" height="48" rx="10" fill="#e5e5e5"/>
    <rect x="44" y="48" width="66" height="48" rx="10" fill="#fff" stroke="#e2e2e2"/>
    <circle cx="36" cy="40" r="4" fill="#c9c9c9"/>
    <circle cx="52" cy="40" r="4" fill="#c9c9c9"/>
    <circle cx="74" cy="68" r="4" fill="#d9d9d9"/>
    <circle cx="90" cy="68" r="4" fill="#d9d9d9"/>
  </svg>`;
}
