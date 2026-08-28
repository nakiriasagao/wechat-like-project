import bcrypt from "bcryptjs";
import { getDb, tx } from "./database.js";
import { migrate } from "./migrate.js";
import { Role, GroupRole, ConversationType } from "shared";

/**
 * 生成各角色演示账号，便于前后端联调权限矩阵。
 * 所有账号密码均为 password。
 */
export async function seed() {
  migrate();
  const db = getDb();
  const hash = bcrypt.hashSync("password", 10);
  const now = Date.now();

  const accounts: Array<[string, string, Role]> = [
    ["user1", "用户一号", Role.USER],
    ["user2", "用户二号", Role.USER],
    ["user3", "用户三号", Role.USER],
    ["service", "客服小蓝", Role.CUSTOMER_SERVICE],
    ["admin", "平台管理员", Role.PLATFORM_ADMIN],
    ["superadmin", "超级管理员", Role.SUPER_ADMIN],
  ];

  tx(() => {
    const ins = db.prepare(
      "INSERT INTO users (username, password_hash, nickname, role, status, created_at) VALUES (?, ?, ?, ?, 'ACTIVE', ?)"
    );
    for (const [u, n, r] of accounts) {
      const exists = db.prepare("SELECT id FROM users WHERE username = ?").get(u);
      if (!exists) {
        ins.run(u, hash, n, r, now);
      }
    }

    // 演示群：user1 为群主，user2 为管理员，user3 为成员
    const existing = db.prepare("SELECT id FROM conversations WHERE name = '演示交流群'").get();
    if (!existing) {
      const r = db
        .prepare(
          "INSERT INTO conversations (type, name, owner_id, status, notice, mute_all, created_at) VALUES (?, ?, ?, 'ACTIVE', ?, 0, ?)"
        )
        .run(ConversationType.GROUP, "演示交流群", 1, "群公告：欢迎加入演示交流群", now);
      const gid = Number(r.lastInsertRowid);
      const add = db.prepare(
        "INSERT INTO conversation_members (conversation_id, user_id, role, joined_at) VALUES (?, ?, ?, ?)"
      );
      add.run(gid, 1, GroupRole.OWNER, now);
      add.run(gid, 2, GroupRole.ADMIN, now);
      add.run(gid, 3, GroupRole.MEMBER, now);
    }
  });

  console.log("种子数据已写入。演示账号：");
  for (const [u, n, r] of accounts) {
    console.log(`  ${r.padEnd(17)} ${u} / password`);
  }
}

function isMain(): boolean {
  if (import.meta.url === `file://${process.argv[1]?.replace(/\\/g, "/")}`) return true;
  const entry = process.argv[1] ?? "";
  return /seed\.ts$/.test(entry.replace(/\\/g, "/"));
}

if (isMain()) {
  seed().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
