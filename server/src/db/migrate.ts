import { getDb } from "./database.js";

/** 幂等的建表 / 初始化。所有表结构集中在此处定义。 */
export function migrate() {
  const db = getDb();
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      username      TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      nickname      TEXT NOT NULL,
      role          TEXT NOT NULL DEFAULT 'USER',
      status        TEXT NOT NULL DEFAULT 'ACTIVE',
      wechat_id     TEXT UNIQUE,           -- 微信号（可自定义，默认取 username）
      mute_until    INTEGER,
      created_at    INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS friendships (
      id           INTEGER PRIMARY KEY AUTOINCREMENT,
      user_a       INTEGER NOT NULL,
      user_b       INTEGER NOT NULL,
      status       TEXT NOT NULL DEFAULT 'PENDING',
      requester    INTEGER NOT NULL,
      message      TEXT,                    -- 好友申请验证消息
      created_at   INTEGER NOT NULL,
      updated_at   INTEGER NOT NULL,
      UNIQUE(user_a, user_b)
    );

    CREATE TABLE IF NOT EXISTS conversations (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      type       TEXT NOT NULL,             -- DIRECT | GROUP
      name       TEXT,                       -- 群名
      owner_id   INTEGER,                    -- 群主（群聊）
      status     TEXT NOT NULL DEFAULT 'ACTIVE', -- ACTIVE | FROZEN | DISBANDED
      notice     TEXT,                       -- 群公告
      mute_all   INTEGER NOT NULL DEFAULT 0, -- 全员禁言
      created_at INTEGER NOT NULL,
      dm_key     TEXT UNIQUE                 -- 单聊去重（a:b 排序）
    );

    CREATE TABLE IF NOT EXISTS conversation_members (
      conversation_id INTEGER NOT NULL,
      user_id         INTEGER NOT NULL,
      role            TEXT NOT NULL DEFAULT 'MEMBER', -- MEMBER | ADMIN | OWNER
      muted_until     INTEGER,               -- 个人禁言截止
      pin             INTEGER NOT NULL DEFAULT 0,
      notify          INTEGER NOT NULL DEFAULT 1,
      last_read_msg_id INTEGER NOT NULL DEFAULT 0,
      joined_at       INTEGER NOT NULL,
      UNIQUE(conversation_id, user_id)
    );

    CREATE TABLE IF NOT EXISTS messages (
      id              INTEGER PRIMARY KEY AUTOINCREMENT,
      conversation_id INTEGER NOT NULL,
      sender_id       INTEGER NOT NULL,
      type            TEXT NOT NULL DEFAULT 'TEXT',
      content         TEXT,
      reply_to        INTEGER,
      mentions        TEXT,                  -- JSON 数组
      recalled        INTEGER NOT NULL DEFAULT 0,
      recalled_by     INTEGER,
      deleted_by      TEXT,                  -- JSON: 本地删除用户数组
      created_at      INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_msg_conv ON messages(conversation_id, id);

    CREATE TABLE IF NOT EXISTS reports (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      reporter_id   INTEGER NOT NULL,
      target_type   TEXT NOT NULL,           -- MESSAGE | USER | GROUP
      target_id     INTEGER NOT NULL,
      category      TEXT NOT NULL,
      description   TEXT,
      status        TEXT NOT NULL DEFAULT 'PENDING',
      assignee_id   INTEGER,                 -- 当前处理的客服/管理员
      punish_action TEXT,
      punish_detail TEXT,
      review_note   TEXT,
      escalated_note TEXT,
      created_at    INTEGER NOT NULL,
      updated_at    INTEGER NOT NULL,
      resolved_at   INTEGER
    );
    CREATE INDEX IF NOT EXISTS idx_report_status ON reports(status);

    CREATE TABLE IF NOT EXISTS report_events (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      report_id   INTEGER NOT NULL,
      actor_id    INTEGER,
      action      TEXT NOT NULL,             -- ASSIGN | REVIEW | PUNISH | REJECT | ESCALATE | APPEAL | SUSTAIN | REVERT | RESET
      from_status TEXT,
      to_status   TEXT,
      note        TEXT,
      created_at  INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS appeals (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      report_id   INTEGER NOT NULL,
      appealer_id INTEGER NOT NULL,
      reason      TEXT NOT NULL,
      status      TEXT NOT NULL DEFAULT 'PENDING', -- PENDING | SUSTAINED(驳回) | REVERTED(成立)
      handled_by  INTEGER,
      created_at  INTEGER NOT NULL,
      updated_at  INTEGER NOT NULL
    );
  `);

  // 为已存在的旧库补充字段（SQLite 无 ADD COLUMN IF NOT EXISTS，用 try/catch 幂等）：
  try { db.exec("ALTER TABLE friendships ADD COLUMN message TEXT"); } catch { /* 已存在 */ }
  try { db.exec("ALTER TABLE conversations ADD COLUMN avatar TEXT"); } catch { /* 已存在 */ }
  try { db.exec("ALTER TABLE users ADD COLUMN wechat_id TEXT"); } catch { /* 已存在 */ }
  // 回填微信号：空则取 username（username 唯一，故微信号也唯一）
  db.exec("UPDATE users SET wechat_id = username WHERE wechat_id IS NULL OR wechat_id = ''");
  db.exec("CREATE UNIQUE INDEX IF NOT EXISTS idx_users_wechat ON users(wechat_id)");
}

/** 最近一次本地迁移版本号（预留，当前单版本） */
export const SCHEMA_VERSION = 1;
