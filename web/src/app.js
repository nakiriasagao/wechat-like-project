import { api, get, post, del, setToken, setUser, currentUser, isLoggedIn } from "./api.js";

const $app = document.getElementById("app");
const $toast = document.getElementById("toast");

// DOM 构建辅助
function h(tag, attrs = {}, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === "class") el.className = v;
    else if (k === "onclick") el.onclick = v;
    else if (k.startsWith("on")) el.addEventListener(k.slice(2), v);
    else if (v === true) el.setAttribute(k, "");
    else if (k === "text") el.textContent = v;
    else if (k === "html") el.innerHTML = v;
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
  $toast.classList.add("show");
  $toast.style.background = ok ? "rgba(0,0,0,.8)" : "#fa5151";
  setTimeout(() => $toast.classList.remove("show"), 2200);
}
function roleLabel(r) {
  return { USER: "用户", CUSTOMER_SERVICE: "客服", PLATFORM_ADMIN: "管理员", SUPER_ADMIN: "超管" }[r] || r;
}
function avatarOf(u, cls = "") {
  const bg = u.role === "PLATFORM_ADMIN" || u.role === "SUPER_ADMIN" ? "admin" : u.role === "CUSTOMER_SERVICE" ? "service" : "";
  return h("div", { class: `avatar ${bg} ${cls}` }, (u.nickname || u.username || "?").slice(0, 1));
}

// ============ 全局状态 ============
const S = {
  me: currentUser(),
  convs: [],
  active: null, // active conversation
  msgs: [],
  friends: [],
  requests: { incoming: [], outgoing: [] },
  group: null,
  searchQ: "",
  tab: "chats", // chats | friends
  timer: null,
};

// ============ 登录 ============
function renderLogin() {
  $app.replaceChildren(
    h("div", { class: "login-wrap" },
      h("div", { class: "login-box" },
        h("h1", { text: "微信 · 用户端" }),
        h("div", { class: "sub", text: "登录或注册账号" }),
        h("div", { class: "row" }, h("input", { id: "lg-user", placeholder: "用户名" })),
        h("div", { class: "row" }, h("input", { id: "lg-pass", type: "password", placeholder: "密码" })),
        h("div", { class: "row", id: "lg-nickwrap", style: "display:none" },
          h("input", { id: "lg-nick", placeholder: "昵称" })),
        h("div", { class: "actions" },
          h("button", { id: "lg-submit", text: "登录" }),
          h("button", { class: "secondary", id: "lg-toggle", text: "注册" })),
        h("div", { class: "hint", style: "margin-top:12px" },
          h("div", { text: "演示账号：user1 / user2 / user3 / service / admin / superadmin，密码 password" }))
      )));
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

// ============ 主界面 ============
function bootstrap() {
  startPolling();
  render();
}

function startPolling() {
  stopPolling();
  S.timer = setInterval(async () => {
    try {
      await refreshConversations();
    } catch (e) {}
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

async function refreshConversations(keepActive = true) {
  const res = await get("/conversations");
  S.convs = res.items || [];
  if (keepActive && S.active) {
    const found = S.convs.find((c) => c.id === S.active.id);
    if (found) S.active = found;
    else { S.active = null; S.msgs = []; }
  }
}

function render() {
  if (!isLoggedIn()) return renderLogin();
  const top = h("div", { class: "topbar" },
    h("div", { class: "title" }, S.active ? convTitle(S.active) : "微信"),
    h("div", { style: "display:flex;gap:8px" },
      h("button", { class: "secondary small", onclick: openCreateGroup, text: "发起群聊" }),
      h("button", { class: "secondary small", onclick: openReports, text: "我的举报" }),
      h("button", { class: "danger small", onclick: logout, text: "退出" })));

  const content = S.active
    ? h("div", { class: "chat", id: "chatbox" })
    : h("div", { class: "empty", text: S.tab === "chats" ? "选择一个会话开始聊天" : "管理你的好友" });
  if (!S.active) renderHomePanel(content);

  const app = h("div", { class: "app" },
    h("div", { class: "sidebar" },
      h("div", { class: "me" },
        avatarOf(S.me, "lg"),
        h("div", { class: "info" },
          h("div", { class: "name", text: S.me.nickname || S.me.username }),
          h("div", { class: "role", text: `${roleLabel(S.me.role)} · ${S.me.username}` })),
        h("button", { class: "small", onclick: logout, text: "退出" })),
      h("div", { class: "tabs" },
        h("div", { class: `tab ${S.tab === "chats" ? "active" : ""}`, onclick: () => switchTab("chats"), text: "聊天" }),
        h("div", { class: `tab ${S.tab === "friends" ? "active" : ""}`, onclick: () => switchTab("friends"), text: "通讯录" })),
      h("div", { class: "search" }, h("input", { placeholder: "搜索用户 / 群...", oninput: (e) => { S.searchQ = e.target.value; render(); } })),
      h("div", { class: "list", id: "list" })),
    h("div", { class: "main" }, top, content));

  if (S.active) {
    renderMessages();
  } else {
    renderList();
  }
  $app.replaceChildren(app);
}

function switchTab(tab) {
  S.tab = tab;
  render();
}

function convTitle(c) {
  if (c.type === "GROUP") return c.name + "  群";
  return c.name || "单聊";
}

function renderHomePanel(content) {
  content.textContent = "";
  content.appendChild(S.tab === "friends" ? friendsPanel() : emptyHint());
}
function emptyHint() {
  return h("div", { class: "empty", text: S.tab === "chats" ? "搜索用户可直接发起会话；从好友列表或创建群聊开始" : "" });
}

function renderHomeList() {
  if (S.tab === "friends") renderFriendsList();
  else renderConvList();
}

// ============ 会话列表 ============
function renderList() {
  const list = document.getElementById("list");
  if (!list) return;
  list.replaceChildren();
  if (S.tab === "friends") {
    renderFriendsList(list);
    return;
  }
  const q = S.searchQ.trim().toLowerCase();
  const convs = q && S.active
    ? S.convs.filter((c) => (c.name || "").toLowerCase().includes(q))
    : S.convs;
  if (!convs.length) {
    list.appendChild(h("div", { class: "empty", text: "暂无会话。搜索用户、接受好友申请或发起群聊。" }));
    return;
  }
  for (const c of convs) {
    list.appendChild(convRow(c));
  }
}

function convRow(c) {
  const last = c.lastMessage;
  const prev = last
    ? `${last.senderId === S.me.id ? "我：" : ""}${(last.content || "").slice(0, 40)}`
    : c.type === "GROUP" ? (c.notice || "暂无消息") : "暂无消息";
  const title = c.type === "GROUP" ? c.name : c.name || "单聊";
  return h("div", { class: `conv ${S.active && S.active.id === c.id ? "active" : ""}`, onclick: () => selectConv(c) },
    avatarOf(c.type === "GROUP" ? { nickname: title.slice(0, 1) } : c, ""),
    h("div", { class: "cbody" },
      h("div", { class: "ctitle" },
        h("span", { text: title }),
        c.unread > 0 ? h("span", { class: "unread", text: c.unread }) : ""),
      h("div", { class: "cprev", text: prev })));
}

// ============ 会话窗口 ============
async function selectConv(c) {
  S.active = c;
  S.active.id = Number(c.id);
  await loadMessages();
  render();
  markRead();
  openChat();
}
function openChat() {
  const chat = document.getElementById("chatbox");
  if (!chat) return;
  chat.replaceChildren();
  chat.appendChild(h("div", { onclick: openConvPanel, id: "conv-banner" }));
  const composer = h("div", { class: "composer" },
    h("select", { id: "msg-type", style: "width:90px" },
      h("option", { value: "TEXT", text: "文字" }),
      h("option", { value: "EMOTICON", text: "表情" }),
      h("option", { value: "IMAGE", text: "图片" }),
      h("option", { value: "FILE", text: "文件" }),
      h("option", { value: "VOICE", text: "语音" })),
    h("input", { id: "msg-input", placeholder: "输入消息，Enter 发送" }),
    h("button", { onclick: sendMessage, text: "发送" }));
  chat.appendChild(composer);
  document.getElementById("msg-input").addEventListener("keydown", (e) => {
    if (e.key === "Enter") sendMessage();
  });
  renderMessages();
  chat.scrollTop = chat.scrollHeight;
}

async function loadMessages() {
  const res = await get(`/conversations/${S.active.id}/messages?limit=50`);
  S.msgs = res.items || [];
}

function renderMessages() {
  const chat = document.getElementById("chatbox");
  if (!chat) return;
  const banner = document.getElementById("conv-banner");
  if (banner) {
    banner.className = "section-title";
    banner.style.cursor = "pointer";
    banner.textContent = S.active.type === "GROUP"
      ? `群：${S.active.name} · ${S.active.notice || "点击查看成员/管理"}` : S.active.name || "单聊";
    banner.onclick = openConvPanel;
  }
  // 移除旧消息（保留 banner 和 composer）
  Array.from(chat.querySelectorAll(":scope > .msg, :scope > .system-msg")).forEach((el) => el.remove());
  const composer = chat.querySelector(".composer");
  for (const m of S.msgs) {
    if (m.recalled) {
      const sys = h("div", { class: "system-msg", text: `${m.senderId === S.me.id ? "你" : "对方"}撤回了一条消息` });
      chat.insertBefore(sys, composer);
      continue;
    }
    const mine = m.senderId === S.me.id;
    const bubble = h("div", { class: "bubble", text: m.content || "" });
    if (m.deletedBy && m.deletedBy.includes(S.me.id)) {
      bubble.className = "bubble muted-text";
      bubble.textContent = "（已删除）";
    }
    const meta = h("div", { class: "meta" },
      h("span", { text: timeStr(m.createdAt) }),
      mine && !m.recalled ? h("button", { class: "small", text: "撤回", onclick: () => recallMessage(m) }) : "",
      mine && !m.recalled ? h("button", { class: "small", text: "删除", onclick: () => deleteMessage(m) }) : "",
      h("button", { class: "small", text: "举报", onclick: () => openReportMessage(m) }));
    const row = h("div", { class: `msg ${mine ? "mine" : ""}` }, bubble, h("div", {}, meta));
    chat.insertBefore(row, composer);
  }
  chat.scrollTop = chat.scrollHeight;
}

async function sendMessage() {
  const input = document.getElementById("msg-input");
  const type = document.getElementById("msg-type").value;
  const content = input.value.trim();
  if (!content) return;
  try {
    await post("/messages", { convId: Number(S.active.id), type, content });
    input.value = "";
    await loadMessages();
    renderMessages();
    refreshConversations();
  } catch (e) {
    toast(e.message, false);
  }
}

async function recallMessage(m) {
  try {
    await post("/messages/recall", { messageId: m.id });
    await loadMessages();
    renderMessages();
  } catch (e) {
    toast(e.message, false);
  }
}
async function deleteMessage(m) {
  try {
    await post("/messages/delete", { messageId: m.id });
    await loadMessages();
    renderMessages();
  } catch (e) {
    toast(e.message, false);
  }
}

function markRead() {
  if (!S.active) return;
  const maxMsg = S.msgs.length ? S.msgs[S.msgs.length - 1].id : 0;
  post("/messages/read", { convId: Number(S.active.id), lastReadMsgId: maxMsg }).catch(() => {});
}

// ============ 好友 ============
function friendsPanel() {
  const q = S.searchQ.trim();
  return h("div", { class: "list" }, h("div", {
    class: "empty",
    html: q
      ? `<button class="small" data-search>搜索用户 "${escapeHtml(q)}"</button>`
      : "在上方搜索用户添加好友",
  }), h("div", { id: "friends-content" }));
}
function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

async function loadFriends() {
  const [fr, rq] = await Promise.all([get("/friends"), get("/friends/requests")]);
  S.friends = fr.items || [];
  S.requests = rq || { incoming: [], outgoing: [] };
}
async function renderFriendsList(list) {
  list.replaceChildren();
  try {
    await loadFriends();
  } catch (e) {
    list.appendChild(h("div", { class: "empty", text: e.message }));
    return;
  }
  const q = S.searchQ.trim().toLowerCase();
  if (q) {
    const res = await get(`/friends/search?q=${encodeURIComponent(q)}`).catch(() => ({ items: [] }));
    list.appendChild(h("div", { class: "section-title", text: "搜索结果" }));
    for (const u of res.items || []) {
      list.appendChild(h("div", { class: "frow" },
        avatarOf(u),
        h("div", { class: "fname" }, h("div", { text: u.nickname }), h("div", { class: "muted-text", text: "@" + u.username })),
        h("div", { class: "ops" }, h("button", { class: "small", onclick: () => sendFriendRequest(u.id), text: "加好友" }))));
    }
    return;
  }
  // 收到的好友申请
  if (S.requests.incoming.length) {
    list.appendChild(h("div", { class: "section-title", text: "好友申请" }));
    for (const r of S.requests.incoming) {
      list.appendChild(h("div", { class: "frow" },
        avatarOf({ nickname: r.nickname, username: r.username }),
        h("div", { class: "fname", text: r.nickname }),
        h("div", { class: "ops" },
          h("button", { class: "small", onclick: () => acceptRequest(r.requester), text: "同意" }),
          h("button", { class: "small danger", onclick: () => rejectRequest(r.requester), text: "拒绝" }))));
    }
  }
  if (S.requests.outgoing.length) {
    list.appendChild(h("div", { class: "section-title", text: "已发送申请" }));
    for (const r of S.requests.outgoing) {
      list.appendChild(h("div", { class: "frow" },
        avatarOf({ nickname: r.nickname, username: r.username }),
        h("div", { class: "fname", text: r.nickname }),
        h("div", { class: "muted-text", text: "等待确认" })));
    }
  }
  list.appendChild(h("div", { class: "section-title", text: "我的好友" }));
  for (const f of S.friends) {
    const u = { nickname: f.nickname, username: f.username, ...f };
    list.appendChild(h("div", { class: "frow" },
      avatarOf(u),
      h("div", { class: "fname" }, h("div", { text: f.nickname }), h("div", { class: "muted-text", text: "@" + f.username })),
      h("div", { class: "ops" },
        h("button", { class: "small", onclick: () => openDirectWith(f.userId), text: "聊天" }),
        h("button", { class: "small danger", onclick: () => deleteFriend(f.userId), text: "删除" }),
        h("button", { class: "small secondary", onclick: () => blockUser(f.userId), text: "拉黑" }))));
  }
  if (!S.friends.length && !S.requests.incoming.length && !S.requests.outgoing.length) {
    list.appendChild(h("div", { class: "empty", text: "还没有好友，搜索用户名添加吧" }));
  }
}

async function sendFriendRequest(userId) {
  try {
    await post("/friends/request", { userId });
    toast("好友申请已发送");
    render();
  } catch (e) {
    toast(e.message, false);
  }
}
async function acceptRequest(userId) {
  try { await post("/friends/accept", { userId }); toast("已添加好友"); render(); } catch (e) { toast(e.message, false); }
}
async function rejectRequest(userId) {
  try { await post("/friends/reject", { userId }); toast("已拒绝"); render(); } catch (e) { toast(e.message, false); }
}
async function deleteFriend(userId) {
  if (!confirm("确定删除该好友？")) return;
  try { await del(`/friends/${userId}`); toast("已删除"); loadFriends().then(() => render()); } catch (e) { toast(e.message, false); }
}
async function blockUser(userId) {
  try { await post("/friends/block", { userId }); toast("已拉黑"); loadFriends().then(() => render()); } catch (e) { toast(e.message, false); }
}
async function openDirectWith(userId) {
  await post("/friends/request", { userId }).catch(() => {});
  await post("/friends/accept", { userId }).catch(() => {});
  await refreshConversations();
  const found = S.convs.find((x) => x.type === "DIRECT" && x.name !== S.me.nickname && x.name === S.friends.find((f) => f.userId === userId)?.nickname)
    || S.convs.find((x) => x.type === "DIRECT");
  if (found) selectConv(found);
}

// ============ 群 ============
function openCreateGroup() {
  const box = h("div", { class: "panel" },
    h("h3", { text: "创建群聊" }),
    h("label", { text: "群名" }), h("input", { id: "cg-name", placeholder: "群名" }),
    h("div", { class: "section-title", text: "选择成员（有好友关系可拉入）" }),
    h("div", { id: "cg-members", style: "max-height:180px;overflow-y:auto" }),
    h("div", { class: "ops" },
      h("button", { onclick: createGroup, text: "创建" }),
      h("button", { class: "secondary", onclick: closePanel, text: "取消" })));
  overlay(box);
  const list = document.getElementById("cg-members");
  get("/friends").then((f) => {
    for (const m of f.items || []) {
      const lab = h("label", { style: "display:flex;gap:8px;padding:4px 0" },
        h("input", { type: "checkbox", class: "cg-friend", value: m.userId }),
        h("span", { text: m.nickname }));
      list.appendChild(lab);
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
  const panel = h("div", { class: "panel" });
  const ops = h("div", { class: "ops" });
  if (c.type === "GROUP") {
    panel.appendChild(h("h3", { text: c.name }));
    panel.appendChild(h("div", { class: "kv" }, h("span", { text: "我的群内角色" }), h("span", { text: myRole(c.myRole) })));
    panel.appendChild(h("div", { class: "section-title", text: "成员" }));
    const members = h("div", { id: "gp-members" });
    panel.appendChild(members);
    loadGroupInfo(c.id).then((g) => {
      const oid = g.ownerId;
      members.replaceChildren();
      for (const m of g.members || []) {
        const canManage = (c.myRole === "OWNER") || (c.myRole === "ADMIN" && m.role === "MEMBER");
        members.appendChild(h("div", { class: "frow" },
          avatarOf({ nickname: m.nickname, username: m.username }),
          h("div", { class: "fname" },
            h("div", { text: m.nickname + (m.role === "OWNER" ? " 👑" : m.role === "ADMIN" ? " ⭐" : "") }),
            h("div", { class: "muted-text", text: "@" + m.username })),
          canManage ? h("div", { class: "ops" },
            h("button", { class: "small", onclick: () => muteMember(m.user_id), text: "禁言" }),
            h("button", { class: "small danger", onclick: () => kickUser(m.user_id), text: "踢出" }),
            c.myRole === "OWNER" ? h("button", { class: "small secondary", onclick: () => setAdmin(m.user_id, false), text: "取消管理" }) : "") : ""));
        if (c.myRole === "OWNER" && m.role === "MEMBER") {
          // 设置管理员按钮放在下一行
          members.appendChild(h("div", { class: "ops", style: "padding:0 12px 8px" },
            h("button", { class: "small", onclick: () => setAdmin(m.user_id, true), text: `设置 ${m.nickname} 为管理员` })));
        }
      }
    });
    dispatch(() => {
      appendOpsGroup(ops, c);
    });
  } else {
    panel.appendChild(h("h3", { text: c.name || "单聊" }));
    const opsWrap = h("div", { class: "ops" });
    panel.appendChild(opsWrap);
    opsWrap.appendChild(h("button", { class: "small danger", onclick: deleteFriend(Number(c.id)), text: "删除好友" }));
  }
  panel.appendChild(ops);
  panel.appendChild(h("div", { class: "ops" }, h("button", { class: "secondary", onclick: closePanel, text: "关闭" })));
  overlay(panel);
}

function myRole(r) {
  return { OWNER: "群主", ADMIN: "群管理员", MEMBER: "成员" }[r] || r;
}
async function loadGroupInfo(convId) {
  return await get(`/group/${convId}`);
}
function appendOpsGroup(ops, c) {
  ops.appendChild(h("button", { class: "small", onclick: () => inviteMembers(c), text: "邀请成员" }));
  if (c.myRole === "OWNER") {
    ops.appendChild(h("button", { class: "small", onclick: () => toggleMuteAll(true), text: "全员禁言" }));
    ops.appendChild(h("button", { class: "small", onclick: () => transferOwner(c), text: "转让群主" }));
    ops.appendChild(h("button", { class: "small danger", onclick: () => disbandGroup(c), text: "解散群" }));
  }
  ops.appendChild(h("button", { class: "small secondary", onclick: () => leaveGroup(c), text: "退出群聊" }));
}
async function inviteMembers(c) {
  const box = h("div", { class: "panel" }, h("h3", { text: "邀请成员" }),
    h("div", { id: "iv-list" }),
    h("div", { class: "ops" }, h("button", { onclick: doInvite, text: "发送邀请" }), h("button", { class: "secondary", onclick: closePanel, text: "取消" })));
  overlay(box);
  const list = document.getElementById("iv-list");
  get("/friends").then((f) => {
    for (const m of f.items || []) {
      list.appendChild(h("label", { style: "display:flex;gap:8px;padding:4px 0" },
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
  if (!confirm("确定踢出该成员？")) return;
  try {
    await post(`/group/${S.active.id}/kick`, { userId });
    toast("已踢出");
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
    openConvPanel();
  } catch (e) { toast(e.message, false); }
}
async function transferOwner(c) {
  const userId = prompt("输入新群主 userId");
  if (!userId) return;
  try {
    await post(`/group/${c.id}/transfer`, { userId: Number(userId) });
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

// ============ 举报 ============
function openReportMessage(m) {
  openReport("MESSAGE", m.id, `举报这条消息`);
}
function openReport(targetType, targetId, title) {
  const box = h("div", { class: "panel" },
    h("h3", { text: title }),
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
    h("h3", { text: "我的举报" }),
    h("div", { id: "myreports", style: "max-height:60vh;overflow-y:auto" }),
    h("div", { class: "ops" }, h("button", { class: "secondary", onclick: closePanel, text: "关闭" })));
  overlay(box);
  const list = document.getElementById("myreports");
  const res = await get("/reports/mine").catch((e) => { toast(e.message, false); return { items: [] }; });
  for (const r of res.items || []) {
    list.appendChild(h("div", { class: "frow", style: "flex-direction:column;align-items:flex-start" },
      h("div", { style: "display:flex;justify-content:space-between;width:100%" },
        h("span", { text: `${targetLabel(r.targetType)} #${r.targetId} · ${catLabel(r.category)}` }),
        h("span", { class: "badge", text: statusLabel(r.status) })),
      h("div", { class: "muted-text", text: r.description || "（无说明）" }),
      h("div", { class: "muted-text", text: "时间 " + timeStr(r.createdAt) })));
  }
  if (!(res.items || []).length) list.appendChild(h("div", { class: "empty", text: "还没有举报记录" }));
}
function targetLabel(t) { return { MESSAGE: "消息", USER: "用户", GROUP: "群" }[t] || t; }
function catLabel(c) {
  return { HARASSMENT: "骚扰", AD: "广告", ILLEGAL: "违法", PORNOGRAPHY: "涉黄", FRAUD: "诈骗", OTHER: "其他" }[c] || c;
}
function statusLabel(s) {
  return {
    PENDING: "待处理", REVIEWING: "处理中", ESCALATED: "已升级", PUNISHED: "已处罚",
    REJECTED: "已驳回", APPEALING: "申诉中", SUSTAINED: "维持处罚", REVERTED: "已撤销",
  }[s] || s;
}

// ============ 工具 ============
function overlay(content) {
  const ov = h("div", { class: "panel-overlay" }, content);
  ov.addEventListener("click", (e) => { if (e.target === ov) ov.remove(); });
  document.body.appendChild(ov);
  return ov;
}
function closePanel() {
  document.querySelectorAll(".panel-overlay").forEach((n) => n.remove());
}
function timeStr(ts) {
  if (!ts) return "";
  return new Date(ts).toLocaleString("zh-CN");
}
function dispatch(fn) { setTimeout(fn, 0); }

// ============ 启动 ============
if (isLoggedIn()) {
  bootstrap();
} else {
  renderLogin();
}
