import express from "express";
import type { ErrorRequestHandler } from "express";
import { z } from "zod";
import { credentialsSchema, hash } from "./store";
import type { LicenseRow, LicenseStore } from "./store";
import { createKeyShop } from "./keyShop";
import { registerKeyRoutes } from "./keyRoutes";

const activationSchema = credentialsSchema.extend({ code: z.string().regex(/^XD-[A-Za-z0-9_-]{32}$/) });

export function createApp(store: LicenseStore) {
  const { db, record, lease } = store;
  const app = express();
  app.disable("x-powered-by");
  app.disable("etag");
  const attempts = new Map<string, { count: number; until: number }>();
  app.use((req, res, next) => {
    res.set("Cache-Control", "no-store");
    let hostname = "";
    try { hostname = new URL(`http://${req.headers.host ?? ""}`).hostname; } catch {}
    if (!["localhost", "127.0.0.1", "[::1]"].includes(hostname) || req.headers.origin) {
      res.status(403).json({ code: 403, data: null, message: "不允许的请求来源" });
      return;
    }
    if (req.method === "POST" && !/^\/v1\/payments\/(wechat|alipay)\/notify$/.test(req.path)) {
      const now = Date.now();
      for (const [key, value] of attempts) if (value.until <= now) attempts.delete(key);
      const address = req.socket.remoteAddress ?? "unknown";
      let bucket = attempts.get(address);
      if (!bucket) {
        if (attempts.size >= 10000) { res.status(503).end(); return; }
        bucket = { count: 0, until: now + 60000 };
        attempts.set(address, bucket);
      }
      if (++bucket.count > 30) {
        res.set("Retry-After", "60").status(429).json({ code: 429, data: null, message: "请求过于频繁，请稍后重试" });
        return;
      }
    }
    next();
  });
  const callbackBodies = new WeakMap<object, string>();
  app.use(express.json({ limit: "16kb", strict: true, verify(req, _res, body) {
    if (req.url === "/v1/payments/wechat/notify") callbackBodies.set(req, body.toString("utf8"));
  } }));
  app.use("/v1/payments/alipay/notify", express.urlencoded({ extended: false, limit: "16kb", parameterLimit: 100 }));
  registerKeyRoutes(app, store, createKeyShop(store), callbackBodies);
  app.get("/health", (_req, res) => res.json({ code: 200, data: { status: "ok" }, message: "成功" }));
  app.get("/v1/publicKey", (_req, res) => res.json({ code: 200, data: { keyId: store.keyId, publicKey: store.publicPem }, message: "成功" }));
  app.post("/v1/activate", (req, res) => {
    const input = activationSchema.parse(req.body);
    const result = db.transaction(() => {
      const license = db.query<LicenseRow, [string]>("SELECT * FROM licenses WHERE codeHash = ?").get(hash(input.code));
      if (!license) throw Object.assign(new Error("激活码无效"), { status: 403 });
      const signed = lease(license, input.deviceId);
      const device = db.query<{ secretHash: string }, [string, string]>("SELECT secretHash FROM devices WHERE licenseId = ? AND deviceId = ?").get(license.id, input.deviceId);
      const secretHash = hash(input.deviceSecret);
      if (device && device.secretHash !== secretHash) throw Object.assign(new Error("设备凭证不匹配，请联系管理员解除旧设备"), { status: 403 });
      const now = Date.now();
      if (!device) {
        const count = db.query<{ count: number }, [string]>("SELECT count(*) AS count FROM devices WHERE licenseId = ?").get(license.id)!.count;
        if (count >= license.maxDevices) throw Object.assign(new Error("已达到授权设备数量上限"), { status: 409 });
        if (db.query("SELECT 1 FROM devices WHERE secretHash = ?").get(secretHash)) throw Object.assign(new Error("请为此安装生成独立设备凭证"), { status: 409 });
        db.query("INSERT INTO devices (licenseId, deviceId, secretHash, createdAt, lastSeenAt) VALUES (?, ?, ?, ?, ?)").run(license.id, input.deviceId, secretHash, now, now);
        record(license.id, "activate");
      } else {
        db.query("UPDATE devices SET lastSeenAt = ? WHERE licenseId = ? AND deviceId = ?").run(now, license.id, input.deviceId);
      }
      return signed;
    }).immediate();
    res.json({ code: 200, data: result, message: "激活成功" });
  });
  for (const action of ["refresh", "deactivate"] as const) {
    app.post(`/v1/${action}`, (req, res) => {
      const input = credentialsSchema.parse(req.body);
      const result = db.transaction(() => {
        const license = db.query<LicenseRow, [string, string]>("SELECT l.* FROM licenses l JOIN devices d ON d.licenseId = l.id WHERE d.deviceId = ? AND d.secretHash = ?").get(input.deviceId, hash(input.deviceSecret));
        if (!license) throw Object.assign(new Error("设备凭证无效"), { status: 403 });
        if (action === "deactivate") {
          db.query("DELETE FROM devices WHERE licenseId = ? AND deviceId = ?").run(license.id, input.deviceId);
          record(license.id, "deactivate");
          return null;
        }
        const signed = lease(license, input.deviceId);
        db.query("UPDATE devices SET lastSeenAt = ? WHERE licenseId = ? AND deviceId = ?").run(Date.now(), license.id, input.deviceId);
        return signed;
      }).immediate();
      res.json({ code: 200, data: result, message: "成功" });
    });
  }
  app.use((_req, res) => { res.status(404).json({ code: 404, data: null, message: "接口不存在" }); });
  const handleError: ErrorRequestHandler = (err, _req, res, _next) => {
    const status = err instanceof z.ZodError ? 400 : [400, 402, 403, 404, 409, 413, 415, 502, 503].includes(err.status) ? err.status : 500;
    res.status(status).json({ code: status, data: null, message: status === 500 ? "授权服务内部错误" : status === 400 ? "参数格式错误" : status === 413 ? "请求体过大" : err.message });
  };
  app.use(handleError);
  return app;
}
