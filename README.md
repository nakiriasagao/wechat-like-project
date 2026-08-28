# 类微信聊天软件（WeChat Clone）

复刻微信核心体验的即时通讯（IM）课程项目。评分重点不是代码量或功能数量，而是**业务逻辑深度**——状态机、角色权限联动、异常与客服/超管介入流程。

> 完整业务范围、权限矩阵与流程见 `docs/design.md`；给开发者/Agent 的速查见 `AGENTS.md`。

---

## 一、项目定位

### 做深做透的核心模块
- 单聊 / 群聊会话：未读数、置顶、免打扰、消息撤回、已读、本地删除
- 好友关系链：搜索、申请、同意/拒绝、删除、拉黑
- **群组治理**：建群、邀请、退群、踢人、转让群主、管理员、禁言/全员禁言、公告、解散（群主/管理员/成员权限差异）
- **内容安全与举报**（深度联动）：举报 → 客服初审 → 管理员终裁处罚 → 申诉 → 终裁，全程审计留痕
- **多端**：用户端 Web + 管理后台，均已真实落地

### 明确不做（避免半成品）
支付、真实短信、真正的长连接推送（用 WebSocket + 轮询兜底）、公众号等。朋友圈仅做文字/表情（不做图片），见 `docs/design.md` §3.6。

---

## 二、架构：四个 npm workspace

```
wechat-clone/
├── shared/   根级独立 workspace：权限矩阵、角色、业务码、状态机的【单源定义】
├── server/   后端 API（Express + 内置 node:sqlite）
├── web/      用户端 SPA（vanilla-JS，零依赖，server.mjs 静态托管）
└── admin/    管理后台 SPA（vanilla-JS，零依赖，server.mjs 静态托管）
```

### 后端分层
- `server/src/index.ts`：入口，`migrate()` 后 `buildApp().listen()`
- `server/src/app.ts`：**全部路由集中在此**，按模块挂中间件
- `server/src/middleware/`：`auth`（JWT+禁用校验）、`guard`（权限守卫）、`error`（AppError→JSON）
- `server/src/db/`：`database`（SQLite+事务）、`migrate`（全部建表）、`seed`（演示数据）
- `server/src/modules/{auth,friend,conversation,message,group,report,admin}/controller.ts`

### 核心设计理念：单源 + 后端强制守卫
1. **权限矩阵单源定义**在 `shared/src/permissions.ts`（平台动作 + 群内动作两张表）
2. 后端用 `guard(action)`（全局动作）和 `guardGroup(action)`（群内动作）强制校验，**禁止只靠前端隐藏按钮**
3. 业务错误统一抛 `AppError`，业务码在 `shared/src/error.ts`，HTTP 状态由码段决定（`100xx→401`、`2xxxx→400`、`3xxxx→404`、`403xx→403`）
4. `shared/src/report.ts` 定义举报工单状态机；`report_events` 表记录每次转移（谁、何时、做了什么、原因）

---

## 三、角色体系（两组角色）

**平台角色**（全局）：普通用户 `USER` / 平台客服 `CUSTOMER_SERVICE`（初审+打回）/ 平台管理员 `PLATFORM_ADMIN`（终裁+处罚）/ 超级管理员 `SUPER_ADMIN`

**群内角色**：群主 `OWNER` / 群管理员 `ADMIN` / 成员 `MEMBER`

> 关键设计：`groupRoleFromGlobal()` 让客服/管理员/超管以**最高权限（视为群主）**介入任意群——这是设计而非 bug。

### 举报状态机（核心）
```
PENDING → REVIEWING → PUNISHED / REJECTED
              ↘ ESCALATED（打回 / 超时升级超管）
PUNISHED → APPEALING → SUSTAINED（维持）/ REVERTED（撤销）
```

---

## 四、技术栈与运行环境

| 项 | 说明 |
|---|---|
| 运行环境 | Node `>=24`（根 engines）；数据库用内置 `node:sqlite` 需 Node ≥ 22.5 |
| 后端 | TypeScript + Express + `node:sqlite`（WAL 模式）+ JWT + bcrypt |
| 前端 | **零依赖 vanilla-JS**，无构建产物，各自 `server.mjs` 静态托管 |
| 类型校验 | server/shared 用 `tsc --noEmit`；web/admin 用 `node --check` 语法校验 |
| ESM | `"type":"module"`；**本地 TS 文件 import 必须带 `.js` 后缀**（如 `import { buildApp } from "./app.js"`） |

---

## 五、如何运行

### 1. 安装依赖
```bash
npm install
```

### 2. 写入演示数据（可选但推荐）
```bash
npm run seed
```
创建演示账号与一个"演示交流群"：

| 账号 | 角色 | 密码 |
|---|---|---|
| user1 / user2 / user3 | 普通用户 | password |
| service | 平台客服 | password |
| admin | 平台管理员 | password |
| superadmin | 超级管理员 | password |

### 3. 启动三个服务（分终端）
```bash
# 终端 A：后端 API         → http://localhost:3000/api
npm run dev:server

# 终端 B：用户端 SPA       → http://localhost:5173
npm run dev -w web

# 终端 C：管理后台 SPA     → http://localhost:5273
npm run dev -w admin
```

### 4. 体验流程建议
1. 用 `user1` 登录用户端：通讯录搜索 `user2` → 加好友 → 互相同意 → 自动生成单聊 → 发消息/撤回/已读
2. 创建群聊拉好友入群；用群主身份体验禁言/踢人/转让/解散
3. 对用户/群/消息发起**举报** → 用 `service` 登录管理后台**认领/打回/升级** → 用 `admin` **终裁处罚** → 被处罚者申诉 → 管理员维持/撤销，全程可在"审计"查看时间线

---

## 六、如何测试

后端真正的验证是端到端冒烟脚本（**不是 vitest 用例**）：

```bash
npm run test -w server        # = vitest run，但仓库没有 *.test.ts，会报 "No test files found" 退出 1 —— 正常现象
```

真正的冒烟测试需要**先跑起 server**：
```bash
# 终端 A 已在运行时，在 server/ 目录：
npx tsx src/smoke.ts    # BASE 默认 localhost:3000/api
```

> ⚠️ 冒烟测试**不幂等**：它自行建账号，重复跑会因 `fresh_user` / 好友申请 / 新群重复而失败。每次跑前先删除数据文件：
> ```bash
> Remove-Item data/*.sqlite    # 或换一个 DB_FILE 环境变量
> ```
> 在干净库上单次运行会**通过 45 / 45**（已实测验证）。

### 校验命令
```bash
npm run typecheck -w server   # = tsc --noEmit（server 的 lint 与 typecheck 相同）
npm run typecheck -w shared
npm run build                 # 依次 build shared→server→web→admin，均已跑通
```

---

## 七、环境变量（均可省略，用默认值）

- `PORT=3000`、`DB_FILE=<repo>/data/wechat.sqlite`、`JWT_SECRET=dev-secret-change-me`、`JWT_EXPIRES=7d`、`ESCALATE_AFTER_MS=3600000`（举报超时自动升级阈值，默认 1 小时）
- 前端：`WEB_PORT=5173`、`ADMIN_PORT=5273`

---

## 八、注意事项

- 权限必须后端守卫，前端只渲染；受保护接口统一返回 `403 + 业务码`。
- 改权限或状态机前，先同步 `docs/design.md`（权限矩阵 + 流程），再改代码。
- 本地 `.ts` 之间的 import 必须带 `.js` 后缀。
- 数据库文件 `.sqlite` 已 gitignore；每次冒烟前记得清库。
