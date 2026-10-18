import { randomUUID } from "node:crypto";
import { z } from "zod";
import { dataDirectory, hash, initialize, newCode, openStore } from "./store";
import type { LicenseRow } from "./store";
import { createKeyShop } from "./keyShop";

process.umask(0o077);
const [command, ...args] = process.argv.slice(2);
if (command === "init") {
  initialize();
  console.log(`签名身份已初始化：${dataDirectory}。请离线备份，禁止随客户端分发。`);
} else if (["issue", "list", "renew", "revoke", "devices", "releaseDevice", "publicKey", "keyOrders", "deliverKey", "refundKeyOrder", "redeliverKey"].includes(command ?? "")) {
  const store = openStore();
  const { db, record } = store;
  const daysSchema = z.coerce.number().int().min(1).max(3650);
  try {
    const shop = createKeyShop(store);
    if (command === "keyOrders") console.log(JSON.stringify(db.query("SELECT id, licenseId, label, amountFen, creditFen, state, createdAt, paidAt, deliveredAt FROM keyOrders ORDER BY createdAt DESC LIMIT 100").all(), null, 2));
    if (command === "deliverKey") {
      shop.deliver(z.string().regex(/^[a-f0-9]{32}$/).parse(args[0]), z.string().min(1).parse(args[1]));
      console.log("Key 已加密交付，用户可在 APP 中领取");
    }
    if (command === "refundKeyOrder") {
      const order = shop.refund(z.string().regex(/^[a-f0-9]{32}$/).parse(args[0]));
      console.log(`订单已退款，本地 Key 密文已清除：${order.id}（${order.label}）`);
      console.log("提醒：请同时到上游（TF-Router）吊销该订单对应的 API Key，否则旧 Key 仍可用。");
    }
    if (command === "redeliverKey") {
      const id = z.string().regex(/^[a-f0-9]{32}$/).parse(args[0]);
      shop.redeliver(id, z.string().min(1).parse(args[1]));
      console.log(`补发完成：${id} 的 Key 已替换。请提醒用户重新领取，并到上游吊销旧 Key。`);
    }
    if (command === "publicKey") console.log(JSON.stringify({ keyId: store.keyId, publicKey: store.publicPem }, null, 2));
    if (command === "issue") {
      const days = daysSchema.parse(args[0]);
      const maxDevices = z.coerce.number().int().min(1).max(100).parse(args[1] ?? "1");
      const plan = z.string().regex(/^[a-zA-Z0-9]{1,32}$/).parse(args[2] ?? "standard");
      const id = randomUUID(), code = newCode(), now = Date.now(), expiresAt = now + days * 86400000;
      db.transaction(() => {
        db.query("INSERT INTO licenses (id, codeHash, plan, createdAt, expiresAt, maxDevices) VALUES (?, ?, ?, ?, ?, ?)").run(id, hash(code), plan, now, expiresAt, maxDevices);
        record(id, "issue");
      }).immediate();
      console.log(JSON.stringify({ id, code, plan, expiresAt: new Date(expiresAt).toISOString(), maxDevices }, null, 2));
      console.log("激活码仅此次显示；请通过安全渠道交付。有效期从签发时起计算。");
    }
    if (command === "list") console.log(JSON.stringify(db.query("SELECT id, plan, mallUserId, createdAt, expiresAt, maxDevices, revokedAt, revision, (SELECT count(*) FROM devices d WHERE d.licenseId = l.id) AS activeDevices FROM licenses l ORDER BY createdAt DESC LIMIT 200").all(), null, 2));
    if (["renew", "revoke", "devices", "releaseDevice"].includes(command!)) {
      const id = z.uuid().parse(args[0]);
      db.transaction(() => {
        const license = db.query<LicenseRow, [string]>("SELECT * FROM licenses WHERE id = ?").get(id);
        if (!license) throw new Error("许可编号不存在");
        if (command === "renew") {
          if (license.revokedAt !== null) throw new Error("已撤销的许可不能续期，请签发新的许可");
          const expiresAt = Math.max(Date.now(), license.expiresAt) + daysSchema.parse(args[1]) * 86400000;
          db.query("UPDATE licenses SET expiresAt = ?, revision = revision + 1 WHERE id = ?").run(expiresAt, id);
          record(id, "renew");
          console.log(`已续期至 ${new Date(expiresAt).toISOString()}`);
        }
        if (command === "revoke") {
          db.query("UPDATE licenses SET revokedAt = ?, revision = revision + 1 WHERE id = ?").run(Date.now(), id);
          record(id, "revoke");
          console.log("已撤销；已有离线租约最多继续有效 24 小时。");
        }
        if (command === "devices") console.log(JSON.stringify(db.query("SELECT deviceId, createdAt, lastSeenAt FROM devices WHERE licenseId = ?").all(id), null, 2));
        if (command === "releaseDevice") {
          const deviceId = z.uuid().parse(args[1]);
          const result = db.query("DELETE FROM devices WHERE licenseId = ? AND deviceId = ?").run(id, deviceId);
          if (!result.changes) throw new Error("设备不存在");
          record(id, "releaseDevice");
          console.log("设备名额已释放；原离线租约仍受 24 小时有效期限制。");
        }
      }).immediate();
    }
  } finally { db.close(); }
} else {
  console.error("用法：manage init | publicKey | issue <天数> [设备数] [方案] | list | renew <许可ID> <天数> | revoke <许可ID> | devices <许可ID> | releaseDevice <许可ID> <设备ID> | keyOrders | deliverKey <订单ID> <私有Key文件路径> | refundKeyOrder <订单ID> | redeliverKey <订单ID> <私有Key文件路径>");
  process.exitCode = 1;
}
