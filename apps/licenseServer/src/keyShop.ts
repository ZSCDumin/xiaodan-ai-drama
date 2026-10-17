import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { join } from "node:path";
import { existsSync, readFileSync, statSync } from "@toonflow/file";
import { z } from "zod";
import { dataDirectory, hash } from "./store";
import type { LicenseStore } from "./store";
import { paymentChannels } from "./payments";

const packageSchema = z.strictObject({ id: z.string().regex(/^[a-zA-Z0-9]{1,32}$/), label: z.string().min(1).max(80), priceFen: z.number().int().min(1).max(10000000), creditFen: z.number().int().positive().max(100000000), description: z.string().max(500) });
export interface KeyOrder { id: string; licenseId: string; requestId: string; packageId: string; label: string; description: string; creditFen: number; amountFen: number; channel: "wechat" | "alipay"; state: "pending" | "paid" | "delivered" | "refunded"; tradeId: string | null; createdAt: number; paidAt: number | null; deliveredAt: number | null; encryptedKey: string | null; keyHash: string | null; maskedKey: string | null }
export function catalog() {
  const path = join(dataDirectory, "keyPackages.json");
  const items = existsSync(path) ? z.array(packageSchema).max(50).parse(JSON.parse(readFileSync(path, "utf8"))) : [];
  if (new Set(items.map(item => item.id)).size !== items.length) throw new Error("套餐编号重复");
  return items;
}
function encryptionKey() {
  const value = process.env.XIAODAN_KEY_ENCRYPTION_KEY ?? "";
  if (!/^[a-fA-F0-9]{64}$/.test(value)) throw new Error("尚未配置 Key 交付加密密钥");
  return Buffer.from(value, "hex");
}
export function saleChannels() {
  try { encryptionKey(); return catalog().length ? paymentChannels() : { wechat: false, alipay: false }; }
  catch { return { wechat: false, alipay: false }; }
}
export function publicOrder(order: KeyOrder) {
  const { encryptedKey, keyHash, tradeId, licenseId, requestId, ...result } = order;
  return result;
}
export function createKeyShop(store: LicenseStore) {
  const { db, record } = store;
  db.exec(`CREATE TABLE IF NOT EXISTS keyOrders (
    id TEXT PRIMARY KEY, licenseId TEXT NOT NULL REFERENCES licenses(id), requestId TEXT NOT NULL,
    packageId TEXT NOT NULL, label TEXT NOT NULL, description TEXT NOT NULL, creditFen INTEGER NOT NULL,
    amountFen INTEGER NOT NULL, channel TEXT NOT NULL, state TEXT NOT NULL DEFAULT 'pending', tradeId TEXT,
    createdAt INTEGER NOT NULL, paidAt INTEGER, deliveredAt INTEGER, encryptedKey TEXT, keyHash TEXT UNIQUE, maskedKey TEXT,
    UNIQUE(licenseId, requestId), UNIQUE(channel, tradeId)
  ); CREATE INDEX IF NOT EXISTS keyOrdersOwner ON keyOrders(licenseId, createdAt);`);
  function get(id: string, licenseId?: string) {
    const row = db.query<KeyOrder, [string]>("SELECT * FROM keyOrders WHERE id = ?").get(id);
    if (!row || (licenseId && row.licenseId !== licenseId)) throw Object.assign(new Error("订单不存在"), { status: 404 });
    return row;
  }
  function order(licenseId: string, requestId: string, packageId: string, channel: KeyOrder["channel"]) {
    return db.transaction(() => {
      const prior = db.query<KeyOrder, [string, string]>("SELECT * FROM keyOrders WHERE licenseId = ? AND requestId = ?").get(licenseId, requestId);
      if (prior) {
        if (prior.packageId !== packageId || prior.channel !== channel) throw Object.assign(new Error("订单参数不一致"), { status: 409 });
        return prior;
      }
      const item = catalog().find(item => item.id === packageId);
      if (!item) throw Object.assign(new Error("套餐已下架"), { status: 400 });
      const id = randomBytes(16).toString("hex");
      db.query("INSERT INTO keyOrders (id,licenseId,requestId,packageId,label,description,creditFen,amountFen,channel,createdAt) VALUES (?,?,?,?,?,?,?,?,?,?)").run(id, licenseId, requestId, item.id, item.label, item.description, item.creditFen, item.priceFen, channel, Date.now());
      return get(id);
    }).immediate();
  }
  function paid(input: { orderId: string; channel: string; tradeId: string; amountFen: number }) {
    db.transaction(() => {
      const row = get(input.orderId);
      if (row.channel !== input.channel || row.amountFen !== input.amountFen || !input.tradeId || (row.tradeId && row.tradeId !== input.tradeId)) throw Object.assign(new Error("支付订单不匹配"), { status: 409 });
      if (row.state !== "pending") return;
      db.query("UPDATE keyOrders SET state='paid', tradeId=?, paidAt=? WHERE id=?").run(input.tradeId, Date.now(), row.id);
      record(row.licenseId, `keyOrderPaid:${row.id}`);
    }).immediate();
  }
  // Key 文件的读取与校验（先校验再动数据库，避免把订单打成半成品）。
  function readKeyFile(path: string) {
    const info = statSync(path);
    if (!info.isFile() || info.size > 4096 || (process.platform !== "win32" && (info.mode & 0o077))) throw new Error("Key 文件须为不超过 4096 字节的私有文件（权限 600）");
    return z.string().min(12).max(2048).regex(/^\S+$/).parse(readFileSync(path, "utf8").trim());
  }
  function encryptKey(id: string, key: string) {
    const nonce = randomBytes(12), cipher = createCipheriv("aes-256-gcm", encryptionKey(), nonce);
    cipher.setAAD(Buffer.from(id));
    const ciphertext = Buffer.concat([cipher.update(key, "utf8"), cipher.final()]);
    return Buffer.concat([nonce, cipher.getAuthTag(), ciphertext]).toString("base64");
  }
  function deliver(id: string, path: string, options: { replace?: boolean } = {}) {
    const key = readKeyFile(path);
    db.transaction(() => {
      const row = get(id);
      if (row.state === "delivered" && row.keyHash === hash(key)) return;
      // replace=true 用于补发：允许覆盖已交付的订单，其余情况仍要求处于 paid。
      if (row.state !== "paid" && !(options.replace && row.state === "delivered")) throw new Error("仅允许交付已付款且未交付的订单");
      db.query("UPDATE keyOrders SET state='delivered', deliveredAt=?,encryptedKey=?,keyHash=?,maskedKey=? WHERE id=?").run(Date.now(), encryptKey(id, key), hash(key), `${key.slice(0, 3)}••••${key.slice(-4)}`, id);
      record(row.licenseId, options.replace ? `keyRedelivered:${id}` : `keyDelivered:${id}`);
    }).immediate();
  }
  // 补发：客户 Key 泄露或丢失时用新 Key 覆盖；旧 Key 的本地密文被替换，需同步在上游吊销旧 Key。
  function redeliver(id: string, path: string) {
    deliver(id, path, { replace: true });
  }
  // 退款：作废已交付的 Key（清空密文后连管理员也无法 reveal），并留审计记录。
  // 只允许商城充值订单走这条路径，避免误退真实激活码订单。
  function refund(id: string) {
    db.transaction(() => {
      const row = get(id);
      if (!row.licenseId.startsWith("mall-")) throw Object.assign(new Error("该订单不属于商城充值，不能通过商城退款"), { status: 403 });
      if (row.state === "refunded") return;
      db.query("UPDATE keyOrders SET state='refunded', encryptedKey=NULL, keyHash=NULL, maskedKey=NULL WHERE id=?").run(id);
      record(row.licenseId, `keyOrderRefunded:${id}`);
    }).immediate();
    return publicOrder(get(id));
  }
  function reveal(id: string, licenseId: string) {
    const row = get(id, licenseId);
    if (row.state === "refunded") throw Object.assign(new Error("订单已退款，Key 已作废"), { status: 409 });
    if (row.state !== "delivered" || !row.encryptedKey) throw Object.assign(new Error("Key 尚未交付"), { status: 409 });
    const bytes = Buffer.from(row.encryptedKey, "base64"), decipher = createDecipheriv("aes-256-gcm", encryptionKey(), bytes.subarray(0, 12));
    decipher.setAuthTag(bytes.subarray(12, 28)); decipher.setAAD(Buffer.from(id));
    const apiKey = Buffer.concat([decipher.update(bytes.subarray(28)), decipher.final()]).toString("utf8");
    record(row.licenseId, `keyRevealed:${id}`);
    return { apiKey };
  }
  function ensureMallLicense(mallUserId: string) {
    const licenseId = `mall-${mallUserId}`;
    const exists = db.query<{ id: string }, [string]>("SELECT id FROM licenses WHERE id = ?").get(licenseId);
    if (!exists) {
      const now = Date.now();
      // 商城用户虚拟授权：codeHash 以 "mall-" 开头避免与真实激活码 XD- 冲突
      db.query("INSERT INTO licenses (id, codeHash, plan, createdAt, expiresAt, maxDevices, revision) VALUES (?, ?, ?, ?, ?, ?, ?)").run(licenseId, `mall-${mallUserId}`, "mall-recharge", now, 4102444800000, 1, 1);
    }
    return licenseId;
  }
  function mallOrder(mallUserId: string, requestId: string, packageId: string, channel: KeyOrder["channel"]) {
    const licenseId = ensureMallLicense(mallUserId);
    return order(licenseId, requestId, packageId, channel);
  }
  function mallStatus(mallUserId: string, orderId: string) {
    const licenseId = `mall-${mallUserId}`;
    return publicOrder(get(orderId, licenseId));
  }
  function list(licenseId: string) {
    return db.query<KeyOrder, [string]>("SELECT * FROM keyOrders WHERE licenseId=? ORDER BY createdAt DESC LIMIT 50").all(licenseId).map(publicOrder);
  }
  function mallList(mallUserId: string) {
    return list(`mall-${mallUserId}`);
  }
  return { get, order, paid, deliver, redeliver, refund, reveal, mallOrder, mallStatus, mallList, list };
}
