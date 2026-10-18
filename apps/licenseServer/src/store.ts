import { Database } from "bun:sqlite";
import { createHash, createPrivateKey, createPublicKey, generateKeyPairSync, randomBytes, sign } from "node:crypto";
import { resolve, join } from "node:path";
import { chmodSync, mkdirSync, readFileSync, writeFileSync } from "@toonflow/file";
import { z } from "zod";

export const dataDirectory = resolve(process.env.XIAODAN_LICENSE_DATA_DIR || resolve(import.meta.dir, import.meta.path.endsWith(".ts") ? "../../.." : "../..", "data/licenseServer"));
export const keyPath = join(dataDirectory, "signingPrivate.pem");
export const product = "xiaodan-ai-drama";

export function hash(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

export function initialize() {
  mkdirSync(dataDirectory, { recursive: true, mode: 0o700 });
  chmodSync(dataDirectory, 0o700);
  const keys = generateKeyPairSync("ed25519");
  // ACT: wx 防止重跑初始化时替换已有签名身份；私钥从不写入客户端资源。
  writeFileSync(keyPath, keys.privateKey.export({ type: "pkcs8", format: "pem" }), { flag: "wx", mode: 0o600 });
}

export function openStore() {
  // 必须先初始化，不能在生产启动时悄悄生成另一个签名身份。
  const privateKey = createPrivateKey(readFileSync(keyPath));
  if (privateKey.asymmetricKeyType !== "ed25519") throw new Error("授权私钥必须为 Ed25519");
  const publicKey = createPublicKey(privateKey);
  const publicPem = publicKey.export({ type: "spki", format: "pem" }).toString();
  const keyId = hash(publicPem).slice(0, 24);
  const dbPath = join(dataDirectory, "licenses.sqlite");
  const db = new Database(dbPath, { create: true, strict: true });
  chmodSync(dbPath, 0o600);
  db.exec("PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;");
  db.exec(`
    CREATE TABLE IF NOT EXISTS licenses (
      id TEXT PRIMARY KEY, codeHash TEXT NOT NULL UNIQUE, plan TEXT NOT NULL,
      createdAt INTEGER NOT NULL, expiresAt INTEGER NOT NULL, maxDevices INTEGER NOT NULL,
      revokedAt INTEGER, revision INTEGER NOT NULL DEFAULT 1
    );
    CREATE TABLE IF NOT EXISTS devices (
      licenseId TEXT NOT NULL REFERENCES licenses(id), deviceId TEXT NOT NULL,
      secretHash TEXT NOT NULL UNIQUE, createdAt INTEGER NOT NULL, lastSeenAt INTEGER NOT NULL,
      PRIMARY KEY (licenseId, deviceId)
    );
    CREATE TABLE IF NOT EXISTS events (
      id INTEGER PRIMARY KEY, licenseId TEXT NOT NULL, action TEXT NOT NULL,
      createdAt INTEGER NOT NULL
    );
  `);
  // 账号绑定（mallUserId）是后加字段：旧库就地补列，首次激活时回填。
  const licenseColumns = new Set(db.query<{ name: string }, []>("PRAGMA table_info(licenses)").all().map(column => column.name));
  if (!licenseColumns.has("mallUserId")) db.exec("ALTER TABLE licenses ADD COLUMN mallUserId TEXT");
  function record(licenseId: string, action: string) {
    db.query("INSERT INTO events (licenseId, action, createdAt) VALUES (?, ?, ?)").run(licenseId, action, Date.now());
  }
  function lease(license: LicenseRow, deviceId: string) {
    const now = Date.now();
    if (license.revokedAt !== null || license.expiresAt <= now) throw Object.assign(new Error("授权已到期或已撤销"), { status: 403 });
    // ACT: 固定 24 小时离线租约；撤销在下次刷新或租约到期时生效，不能承诺即时离线撤销。
    const payload = Buffer.from(JSON.stringify({
      type: "xiaodanLicense", version: 1, product, licenseId: license.id, deviceId,
      plan: license.plan, revision: license.revision, issuedAt: now,
      subscriptionExpiresAt: license.expiresAt, leaseExpiresAt: Math.min(now + 86400000, license.expiresAt),
    })).toString("base64url");
    return { keyId, payload, signature: sign(null, Buffer.from(payload), privateKey).toString("base64url") };
  }
  return { db, publicPem, keyId, record, lease };
}

export type LicenseStore = ReturnType<typeof openStore>;
export interface LicenseRow {
  id: string;
  codeHash: string;
  plan: string;
  createdAt: number;
  expiresAt: number;
  maxDevices: number;
  revokedAt: number | null;
  revision: number;
  /** 首次激活时绑定的商城账号；为空表示尚未绑定（旧码或旧客户端）。 */
  mallUserId: string | null;
}
export const credentialsSchema = z.strictObject({
  deviceId: z.uuid(),
  deviceSecret: z.string().regex(/^[A-Za-z0-9_-]{43}$/),
});

export function newCode() {
  return `XD-${randomBytes(24).toString("base64url")}`;
}
