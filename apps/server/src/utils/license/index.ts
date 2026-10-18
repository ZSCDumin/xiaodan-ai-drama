import { createHash, createPublicKey, randomBytes, randomUUID, verify } from "node:crypto";
import { z } from "zod";
import conf from "@/utils/conf";
import { licenseConfig } from "./config";
import type { LicenseStatus } from "./types";

const envelopeSchema = z.strictObject({ keyId: z.string().length(24), payload: z.string().min(1).max(6000), signature: z.string().regex(/^[A-Za-z0-9_-]{86}$/) });
const payloadSchema = z.strictObject({
  type: z.literal("xiaodanLicense"), version: z.literal(1), product: z.literal("xiaodan-ai-drama"),
  licenseId: z.uuid(), deviceId: z.uuid(), plan: z.string().regex(/^[a-zA-Z0-9]{1,32}$/),
  revision: z.number().int().positive(), issuedAt: z.number().int().positive(),
  subscriptionExpiresAt: z.number().int().positive(), leaseExpiresAt: z.number().int().positive(),
});
const stateSchema = z.strictObject({
  deviceId: z.uuid(), deviceSecret: z.string().regex(/^[A-Za-z0-9_-]{43}$/),
  lease: envelopeSchema.nullable(), blocked: z.boolean(), lastSeenAt: z.number().nonnegative(), lastCheckedAt: z.number().nonnegative(),
});
type LicenseState = z.infer<typeof stateSchema>;
let queue: Promise<unknown> = Promise.resolve();
let lastAttempt = 0;
let monotonicStart = performance.now();
let wallStart = Date.now();

function exclusive<T>(operation: () => Promise<T>): Promise<T> {
  const next = queue.then(operation);
  queue = next.catch(() => {});
  return next;
}

function getState(): LicenseState {
  const value = conf.get("license");
  if (value !== undefined) {
    const parsed = stateSchema.safeParse(value);
    if (!parsed.success) throw Object.assign(new Error("本机授权记录损坏，请联系管理员恢复备份"), { status: 409 });
    return parsed.data;
  }
  const state: LicenseState = { deviceId: randomUUID(), deviceSecret: randomBytes(32).toString("base64url"), lease: null, blocked: false, lastSeenAt: Date.now(), lastCheckedAt: 0 };
  conf.set("license", state);
  return state;
}

function decodeLease(value: unknown, deviceId: string) {
  const envelope = envelopeSchema.parse(value);
  const key = createPublicKey(licenseConfig.publicKey);
  const keyId = createHash("sha256").update(licenseConfig.publicKey).digest("hex").slice(0, 24);
  if (key.asymmetricKeyType !== "ed25519" || envelope.keyId !== keyId
    || !verify(null, Buffer.from(envelope.payload), key, Buffer.from(envelope.signature, "base64url"))) throw new Error("授权签名无效");
  const payload = payloadSchema.parse(JSON.parse(Buffer.from(envelope.payload, "base64url").toString("utf8")));
  if (payload.deviceId !== deviceId || payload.leaseExpiresAt > payload.subscriptionExpiresAt
    || payload.leaseExpiresAt <= payload.issuedAt || payload.leaseExpiresAt - payload.issuedAt > 86400000) throw new Error("授权内容无效");
  return payload;
}

export function getLicenseStatus(): LicenseStatus {
  const state = getState(), now = Date.now();
  const status: LicenseStatus = { state: "inactive", canCreate: false, message: "尚未激活，请输入激活码", deviceId: state.deviceId, lastCheckedAt: state.lastCheckedAt, serviceUrl: licenseConfig.serviceUrl };
  // ACT: 只防普通时钟回退；本机管理员仍可篡改记录，不构成硬件 DRM。
  if (now + 300000 < state.lastSeenAt || now + 300000 < wallStart + performance.now() - monotonicStart)
    return { ...status, state: "clockError", message: "系统时间异常，请校准后联网刷新授权" };
  if (now - state.lastSeenAt >= 60000) { state.lastSeenAt = now; conf.set("license", state); }
  if (state.blocked) return { ...status, state: "blocked", message: "授权已撤销或设备已解除，请联系管理员" };
  if (!state.lease) return status;
  try {
    const payload = decodeLease(state.lease, state.deviceId);
    Object.assign(status, { licenseId: payload.licenseId, plan: payload.plan, subscriptionExpiresAt: payload.subscriptionExpiresAt, leaseExpiresAt: payload.leaseExpiresAt });
    if (payload.issuedAt > now + 300000) return { ...status, state: "clockError", message: "系统时间早于授权时间，请校准后重试" };
    if (payload.subscriptionExpiresAt <= now) return { ...status, state: "expired", message: "授权已到期，请续期后刷新" };
    if (payload.leaseExpiresAt <= now) return { ...status, state: "refreshRequired", message: "离线授权已到期，请联网刷新" };
    return { ...status, state: "active", canCreate: true, message: "授权有效" };
  } catch { return { ...status, state: "blocked", message: "授权签名或内容无效，请联网刷新" }; }
}

async function requestLicense(action: string, body: unknown) {
  const url = new URL(licenseConfig.serviceUrl);
  if (url.username || url.password || url.search || url.hash
    || (url.protocol !== "https:" && !(url.protocol === "http:" && ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)))) throw new Error("授权服务地址配置无效");
  const response = await fetch(`${url.href.replace(/\/$/, "")}/v1/${action}`, {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body), redirect: "error", signal: AbortSignal.timeout(8000),
  });
  const reader = response.body?.getReader();
  if (!reader) throw new Error("授权服务响应为空");
  let size = 0;
  const chunks: Uint8Array[] = [];
  try {
    while (true) {
      const item = await reader.read();
      if (item.done) break;
      size += item.value.length;
      if (size > 64000) throw new Error("授权服务响应过大");
      chunks.push(item.value);
    }
  } finally { await reader.cancel().catch(() => {}); }
  const result = JSON.parse(Buffer.concat(chunks).toString("utf8"));
  if (!response.ok || result.code !== 200) {
    const message = action.startsWith("keyShop/") ? response.status === 503 ? "套餐购买尚未开放，请联系管理员" : response.status === 403 ? "请先激活软件后购买或领取 Key" : response.status === 409 ? "订单当前尚不能领取 Key，请刷新订单状态" : response.status === 404 ? "订单不存在" : "订单请求未完成，请稍后重试"
      : response.status === 409 ? "授权设备数量已达上限，请先解除旧设备" : response.status === 403 ? "激活码、设备凭证无效或授权已到期/撤销" : "授权服务暂时不可用，请稍后重试";
    throw Object.assign(new Error(message), { licenseDenied: response.status === 403, status: response.status === 409 ? 409 : 400 });
  }
  return result.data;
}

export function activateLicense(code: string, mallUserId?: string) {
  return exclusive(async () => {
    const state = getState();
    if (state.lease || state.blocked) throw Object.assign(new Error("请先解除当前设备授权，再更换激活码；续期请使用刷新授权"), { status: 409 });
    const lease = envelopeSchema.parse(await requestLicense("activate", { code, deviceId: state.deviceId, deviceSecret: state.deviceSecret, ...(mallUserId ? { mallUserId } : {}) }));
    decodeLease(lease, state.deviceId);
    const now = Date.now();
    conf.set("license", { ...state, lease, blocked: false, lastSeenAt: now, lastCheckedAt: now });
    lastAttempt = now; wallStart = now; monotonicStart = performance.now();
    return getLicenseStatus();
  });
}

export function refreshLicense(force = false) {
  return exclusive(async () => {
    const state = getState(), now = Date.now();
    if (!force && (!state.lease || now - lastAttempt < 60000 || now - state.lastCheckedAt < 3600000)) return getLicenseStatus();
    lastAttempt = now;
    try {
      const lease = envelopeSchema.parse(await requestLicense("refresh", { deviceId: state.deviceId, deviceSecret: state.deviceSecret }));
      decodeLease(lease, state.deviceId);
      conf.set("license", { ...state, lease, blocked: false, lastCheckedAt: now, lastSeenAt: now });
      wallStart = now; monotonicStart = performance.now();
    } catch (error) {
      if ((error as { licenseDenied?: boolean }).licenseDenied) conf.set("license", { ...state, lease: null, blocked: true, lastCheckedAt: now });
      if (force) throw Object.assign(new Error(error instanceof Error && (error as { status?: number }).status ? error.message : "无法连接授权服务；已有离线授权仍按原期限生效"), { status: 400 });
    }
    return getLicenseStatus();
  });
}

export function deactivateLicense() {
  return exclusive(async () => {
    const state = getState();
    try { await requestLicense("deactivate", { deviceId: state.deviceId, deviceSecret: state.deviceSecret }); }
    catch (error) { if (!(error as { licenseDenied?: boolean }).licenseDenied) throw error; }
    conf.set("license", { ...state, deviceId: randomUUID(), deviceSecret: randomBytes(32).toString("base64url"), lease: null, blocked: false, lastCheckedAt: Date.now() });
    return getLicenseStatus();
  });
}

export function assertLicense() {
  const status = getLicenseStatus();
  if (!status.canCreate) throw Object.assign(new Error(`${status.message}。请前往“设置 → 软件授权”。已有项目仍可查看和导出。`), { status: 402 });
}

export async function ensureLicense() {
  await refreshLicense();
  assertLicense();
}

export function requestKeyShop(action: "status" | "order" | "orderStatus" | "reveal", body: Record<string, unknown> = {}) {
  const state = getState();
  const credentials = { deviceId: state.deviceId, deviceSecret: state.deviceSecret };
  return requestLicense(`keyShop/${action}`, action === "status" ? credentials : { ...body, credentials });
}
