import { createApp } from "./app";
import { openStore } from "./store";

process.umask(0o077);
const port = Number(process.env.XIAODAN_LICENSE_PORT || "8092");
if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error("授权端口必须是 1024–65535 的整数");
const store = openStore();
const server = createApp(store).listen(port, "127.0.0.1", () => {
  console.log(`小丹AI漫剧授权服务：http://127.0.0.1:${port}`);
  console.log(`签名公钥标识：${store.keyId}`);
});
for (const signal of ["SIGINT", "SIGTERM"] as const) process.on(signal, () => {
  server.close(() => { store.db.close(); process.exit(0); });
});
server.on("error", error => { store.db.close(); console.error(error.message); process.exit(1); });
