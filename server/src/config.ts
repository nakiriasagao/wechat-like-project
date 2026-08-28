import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export const config = {
  port: Number(process.env.PORT ?? 3000),
  dbFile: process.env.DB_FILE ?? path.resolve(__dirname, "../../../data/wechat.sqlite"),
  jwtSecret: process.env.JWT_SECRET ?? "dev-secret-change-me",
  jwtExpires: process.env.JWT_EXPIRES ?? "7d",
  // 超时升级阈值（毫秒）：PENDING/REVIEWING 超过该值自动升级超管
  escalateAfterMs: Number(process.env.ESCALATE_AFTER_MS ?? 1000 * 60 * 60),
  bcryptRounds: 10,
} as const;
