// 收款不再直连微信／支付宝官方商户，改为调用「小丹AI漫剧商城」的合作方支付接口。
// 商城负责七相PAY 下单、验签与收款，支付成功后再签名回调本服务标记订单已付款。
// 本服务只保存自己的订单，不接触商户私钥，也不需要微信/支付宝的 APIv3 密钥。
import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { z } from "zod";
import type { KeyOrder } from "./keyShop";

export type PaymentChannel = "wechat" | "alipay";
const TIMESTAMP_HEADER = "x-xd-timestamp";
const NONCE_HEADER = "x-xd-nonce";
const SIGNATURE_HEADER = "x-xd-signature";
const SIGNATURE_WINDOW_MS = 5 * 60 * 1000;

const orderSchema = z.object({
  outTradeNo: z.string().regex(/^[A-Za-z0-9_-]{1,64}$/),
  status: z.enum(["unpaid", "paid", "failed", "expired"]),
  amountCents: z.number().int().positive().max(10000000),
  channel: z.enum(["wechat", "alipay"]),
  tradeNo: z.string().max(128).nullable().optional(),
  payUrl: z.string().nullable(),
  expiresAt: z.string().nullable(),
  paidAt: z.string().nullable(),
});
const callbackSchema = z.strictObject({
  outTradeNo: z.string().regex(/^[a-f0-9]{32}$/),
  channel: z.enum(["wechat", "alipay"]),
  tradeNo: z.string().min(1).max(128),
  amountCents: z.number().int().positive().max(10000000),
  status: z.literal("paid"),
  timestamp: z.number().int().positive(),
});

function readConfig() {
  const base = String(process.env.XIAODAN_MALL_BASE_URL ?? "").trim().replace(/\/$/, "");
  const partnerKey = String(process.env.XIAODAN_MALL_PARTNER_KEY ?? "").trim();
  const publicUrl = String(process.env.XIAODAN_PAYMENT_PUBLIC_URL ?? "").trim().replace(/\/$/, "");
  return { base, partnerKey, publicUrl };
}
// 商城与本服务之间必须 HTTPS；只在同机联调时允许回环 HTTP。
function transportValid(value: string) {
  try {
    const url = new URL(value);
    if (url.username || url.password || url.search || url.hash) return false;
    if (url.protocol === "https:") return true;
    return url.protocol === "http:" && ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
  } catch { return false; }
}
function requireConfig() {
  const config = readConfig();
  if (!transportValid(config.base) || !transportValid(config.publicUrl) || config.partnerKey.length < 32)
    throw Object.assign(new Error("充值渠道尚未开通，请联系管理员"), { status: 503 });
  return config;
}
export function paymentChannels() {
  try { requireConfig(); return { wechat: true, alipay: true }; }
  catch { return { wechat: false, alipay: false }; }
}
const canonical = (timestamp: string, nonce: string, rawBody: string) => `${timestamp}\n${nonce}\n${rawBody}`;
function sign(secret: string, timestamp: string, nonce: string, rawBody: string) {
  return createHmac("sha256", secret).update(canonical(timestamp, nonce, rawBody), "utf8").digest("hex");
}
function signatureMatches(secret: string, timestamp: string, nonce: string, rawBody: string, provided: string) {
  const received = String(provided).toLowerCase(), expected = sign(secret, timestamp, nonce, rawBody);
  return received.length === expected.length && timingSafeEqual(Buffer.from(received), Buffer.from(expected));
}
function notifyUrl() { return `${readConfig().publicUrl}/v1/payments/mall/notify`; }

async function mallRequest(path: string, payload: unknown) {
  const { base, partnerKey } = requireConfig();
  const raw = JSON.stringify(payload);
  const timestamp = String(Date.now()), nonce = randomBytes(16).toString("hex");
  const response = await fetch(`${base}/api/partner/payments${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-XD-Timestamp": timestamp, "X-XD-Nonce": nonce, "X-XD-Signature": sign(partnerKey, timestamp, nonce, raw) },
    body: raw, redirect: "error", signal: AbortSignal.timeout(15000),
  });
  const reader = response.body?.getReader();
  if (!reader) throw Object.assign(new Error("支付服务响应为空"), { status: 502 });
  let size = 0;
  const chunks: Uint8Array[] = [];
  try {
    while (true) {
      const item = await reader.read();
      if (item.done) break;
      size += item.value.length;
      if (size > 32000) throw Object.assign(new Error("支付服务响应过大"), { status: 502 });
      chunks.push(item.value);
    }
  } finally { await reader.cancel().catch(() => {}); }
  let result: { code?: number; data?: unknown; error?: string };
  try { result = JSON.parse(Buffer.concat(chunks).toString("utf8")); } catch { throw Object.assign(new Error("支付服务返回格式不正确"), { status: 502 }); }
  if (!response.ok) throw Object.assign(new Error(result.error === "签名无效" ? "支付服务拒绝了本次请求，请联系管理员" : "支付服务暂时无法处理订单，请稍后重试"), { status: 502 });
  return orderSchema.parse(result);
}

export async function createPayment(order: KeyOrder) {
  const result = await mallRequest("", { outTradeNo: order.id, channel: order.channel, amountCents: order.amountFen, subject: "小丹AI漫剧 API 额度购买", notifyUrl: notifyUrl() });
  if (result.amountCents !== order.amountFen || result.channel !== order.channel) throw Object.assign(new Error("支付订单信息不匹配"), { status: 502 });
  if (result.status === "paid") return { orderId: order.id, channel: order.channel, amountFen: order.amountFen, qrCode: null, paid: true as const, tradeNo: result.tradeNo || order.id };
  if (result.status === "expired") throw Object.assign(new Error("支付订单已过期，请重新下单"), { status: 409 });
  if (!result.payUrl) throw Object.assign(new Error("支付下单未返回支付地址，请稍后重试"), { status: 502 });
  return { orderId: order.id, channel: order.channel, amountFen: order.amountFen, qrCode: result.payUrl, paid: false as const };
}

export async function queryPayment(order: KeyOrder) {
  const result = await mallRequest("/query", { outTradeNo: order.id });
  if (result.status !== "paid") return null;
  if (result.amountCents !== order.amountFen || result.channel !== order.channel) throw Object.assign(new Error("支付查询结果与本地订单不一致"), { status: 502 });
  return { orderId: order.id, channel: order.channel, tradeId: result.tradeNo || order.id, amountFen: result.amountCents };
}

// 支付回调：与商城共用同一套 HMAC 签名与时间窗，随机串在窗口内不可重复。
const seenCallbacks = new Map<string, number>();
export function mallNotification(raw: string, headers: { get(name: string): string | null }) {
  const { partnerKey } = requireConfig();
  const timestamp = headers.get(TIMESTAMP_HEADER) ?? "", nonce = headers.get(NONCE_HEADER) ?? "", provided = headers.get(SIGNATURE_HEADER) ?? "";
  const invalid = () => Object.assign(new Error("支付回调签名无效"), { status: 403 });
  if (!/^\d{13}$/.test(timestamp) || Math.abs(Date.now() - Number(timestamp)) > SIGNATURE_WINDOW_MS) throw invalid();
  if (!/^[a-f0-9]{16,64}$/i.test(nonce)) throw invalid();
  if (!signatureMatches(partnerKey, timestamp, nonce, raw, provided)) throw invalid();
  const now = Date.now();
  for (const [key, until] of seenCallbacks) if (until <= now) seenCallbacks.delete(key);
  if (seenCallbacks.has(nonce) || seenCallbacks.size >= 10000) throw invalid();
  seenCallbacks.set(nonce, now + SIGNATURE_WINDOW_MS);
  const data = callbackSchema.parse(JSON.parse(raw));
  return { orderId: data.outTradeNo, channel: data.channel, tradeId: data.tradeNo, amountFen: data.amountCents };
}
