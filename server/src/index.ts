import { buildApp } from "./app.js";
import { migrate } from "./db/migrate.js";
import { config } from "./config.js";

migrate();
const app = buildApp();

app.listen(config.port, () => {
  console.log(`[server] 已启动: http://localhost:${config.port}`);
  console.log(`[server] 数据库: ${config.dbFile}`);
  console.log(`[server] 提示: 运行 npm run seed 生成演示账号`);
});
