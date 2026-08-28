# AGENTS.md — 类微信聊天软件

课程小组作业：复刻微信核心体验的即时通讯（IM）软件。考察重点是**业务逻辑深度**（状态机、角色权限联动、异常与客服/超管介入），不是代码量或功能数量。

> 完整业务范围、权限矩阵、15 条流程与修订规则见 `docs/design.md`，改权限/状态机前先读它。

## 最高优先级约束（最容易犯的错）

- **权限必须后端强制守卫**，禁止仅靠前端按钮隐藏来实现。受保护接口统一返回 `403 + 业务码`（`BizCode`）。
- **权限矩阵单源定义**（`shared/src/permissions.ts` + `role.ts`），前端只渲染，不要散落魔法字符串。
- **"做了就做完整，不做就明确不做"** —— 不实现支付/短信/长连接推送（用 WebSocket + 轮询兜底），避免半成品。
- 改动**任何**角色权限或状态机，必须先同步 `docs/design.md`（权限表 + 流程），再改代码。

## 角色（最小集，见 design.md §2 矩阵）

平台角色：普通用户 / 平台客服（初审+打回）/ 平台管理员（终裁+处罚）/ 超级管理员。群内角色：成员 / 群管理员 / 群主。

- 注意：`shared/src/permissions.ts` 的 `groupRoleFromGlobal()` 让客服/管理员/超管以最高权限（视为群主）介入任意群，这是设计而非 bug。
- `guardGroup` 来自 `server/src/middleware/guard.ts`，平台角色直接放行，普通用户按 `conversation_members.role` 判定。

## 版本与运行环境

- Node 运行时: 根 `engines` 要求 `>=24`。数据库用内置 `node:sqlite`（`DatabaseSync`），需要 Node >= 22.5。
- 四个 workspace 均已实现：`shared`、`server`、`web`（用户端 SPA）、`admin`（管理后台 SPA）。`web`/`admin` 是**零依赖 vanilla-JS**，由各自 `server.mjs` 静态托管（无构建产物），`typecheck`=`node --check` 语法校验。
- server 是 ESM（`"type":"module"`）。本地 `.ts` 之间的 import **必须带 `.js` 后缀**（如 `import { buildApp } from "./app.js"`），新建文件时别漏，否则 tsc/tsx 报错。

## 常用命令（from package.json，均已验证）

```bash
npm install                          # 一次装根 + 各 workspace
npm run seed                         # 写演示账号（user1/2/3, service, admin, superadmin，密码均为 password）与演示群
npm run dev:server                   # API（tsx watch，默认 http://localhost:3000/api）
npm run dev -w web                   # 用户端 SPA（web/server.mjs，http://localhost:5173）
npm run dev -w admin                 # 管理后台 SPA（admin/server.mjs，http://localhost:5273）

# 校验（server 的 lint 与 typecheck 相同，都是 tsc --noEmit；暂无 ESLint）
npm run typecheck -w server|shared   # web/admin 的 typecheck -> node --check 语法校验
npm run build -w server              # 根 build 会依次 build:shared/server/web/admin，均已跑通
```

- 环境变量（`server/src/config.ts`，均可省略用默认值）：`PORT`(3000)、`DB_FILE`(基于 `server/src` 的 `../../../data/wechat.sqlite`)、`JWT_SECRET`、`JWT_EXPIRES`(7d)、`ESCALATE_AFTER_MS`(举报超时升级阈值，默认 1h)。前端另有 `WEB_PORT`(5173)/`ADMIN_PORT`(5273)。

## 测试（注意: 不是 vitest 用例）

- `npm run test -w server` = `vitest run`，但仓库当前**没有** `*.test.ts`/`*.spec.ts`，vitest 会报 "No test files found" 退出码 1。
- 真正的验证是 `server/src/smoke.ts`——一个**需要先跑起 server**（`npm run dev:server`）的端到端脚本，用 `fetch` 打真实接口，输出 `通过 N / 总数`。

```bash
npm run dev:server        # 终端 A
npx tsx src/smoke.ts      # 终端 B（在 server/ 目录，BASE 默认 localhost:3000/api）
```

- **smoke 不幂等**：它自行建账号，但 "fresh_user/好友申请/新群" 会在同一 DB 上重跑时因重复而失败。每次跑前删除 `data/*.sqlite`（或换一个 `DB_FILE`）。单次运行在干净库上通过 45/45。
- 已有单测场景：权限 200/403、好友、消息（撤回/已读）、群治理（禁言/踢人/转让/解散）、举报→客服→管理员→申诉、本地删除。

## 目录与入口

```
server/src/index.ts        # 入口：migrate() 后 buildApp().listen()
server/src/app.ts          # 全部路由集中在此，按模块挂 requireAuth/guard/guardGroup
server/src/middleware/     # auth(JWT+禁用校验) / guard(权限) / error(AppError->JSON)
server/src/db/             # database(SQLite+tx) / migrate(全部建表) / seed
server/src/modules/{auth,friend,conversation,message,group,report,admin}/controller.ts
shared/src/                # 根级独立 workspace，被 server 以 "shared" 导入
  role.ts  report.ts  error.ts(BizCode)  permissions.ts(矩阵)  AppError.ts
web/    index.html + src/{api,app}.js + style.css   # 用户端 SPA（vanilla-JS，server.mjs 静态托管）
admin/  index.html + src/{api,app}.js + style.css   # 管理后台 SPA（vanilla-JS，server.mjs 静态托管）
```

- 无 `src/common/`（守卫在 `src/middleware/`），shared 不是 `src/shared/` 而是根级 workspace——写路径、找枚举时别按 AGENTS 旧稿的目录走。
- 路由/守卫约定：全局动作 `guard(action)`，群内动作 `guardGroup(action)`；参数取 `params.convId → body.convId → query.convId`。
- 业务错误：抛 `AppError`（`shared/src/AppError.ts`），code => HTTP 状态映射在 `shared/src/error.ts`（100xx→401、2xxxx→400、3xxxx→404、403xx→403）。

## 状态机（见 `shared/src/report.ts`）

举报工单：`PENDING → REVIEWING → PUNISHED/REJECTED`；打回与超时升级 `→ ESCALATED`；申诉 `PUNISHED → APPEALING → SUSTAINED/REVERTED`。每次转移都写 `report_events`（审计）。

## Git 规范

- 分支：`main`（稳定）+ `develop` + `feature|fix|refactor/<名称>`。
- 提交信息：Conventional Commits，如 `feat(group): 实现群禁言权限守卫`。
- 合并前须通过 typecheck + smoke；不 stash / 不 force-push，用 PR + review。
