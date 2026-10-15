import { AlipaySdk } from "alipay-sdk";
import { createDecipheriv, createPrivateKey, createPublicKey, randomBytes, sign, verify } from "node:crypto";
import { readFileSync } from "@toonflow/file";
import { z } from "zod";
import type { KeyOrder } from "./keyShop";

export type PaymentChannel = "wechat" | "alipay";
const paymentSchema = z.object({ out_trade_no: z.string().regex(/^[a-f0-9]{32}$/), transaction_id: z.string().min(1), trade_state: z.string(), mchid: z.string(), appid: z.string(), amount: z.object({ total: z.number().int().positive(), currency: z.literal("CNY") }) });
const fields = {
  wechat: ["WECHAT_APP_ID", "WECHAT_MCH_ID", "WECHAT_MCH_SERIAL", "WECHAT_PRIVATE_KEY_PATH", "WECHAT_PAY_PUBLIC_KEY_ID", "WECHAT_PAY_PUBLIC_KEY_PATH", "WECHAT_API_V3_KEY"],
  alipay: ["ALIPAY_APP_ID", "ALIPAY_SELLER_ID", "ALIPAY_PRIVATE_KEY_PATH", "ALIPAY_PUBLIC_KEY_PATH"],
};
export function paymentChannels() {
  let publicUrl = false;
  try { const url = new URL(process.env.XIAODAN_PAYMENT_PUBLIC_URL ?? ""); publicUrl = url.protocol === "https:" && !url.username && !url.password && !url.search && !url.hash; } catch {}
  function configured(channel: PaymentChannel) {
    if (!publicUrl || !fields[channel].every(key => !!process.env[key])) return false;
    try {
      const prefix = channel === "wechat" ? "WECHAT" : "ALIPAY";
      const privateKey = createPrivateKey(readFileSync(process.env[`${prefix}_PRIVATE_KEY_PATH`]!, "utf8"));
      const publicKey = createPublicKey(readFileSync(process.env[channel === "wechat" ? "WECHAT_PAY_PUBLIC_KEY_PATH" : "ALIPAY_PUBLIC_KEY_PATH"]!, "utf8"));
      return privateKey.asymmetricKeyType === "rsa" && publicKey.asymmetricKeyType === "rsa" && (channel !== "wechat" || Buffer.byteLength(process.env.WECHAT_API_V3_KEY!) === 32);
    } catch { return false; }
  }
  return { wechat: configured("wechat"), alipay: configured("alipay") };
}
function requireChannel(channel: PaymentChannel) {
  if (!paymentChannels()[channel]) throw Object.assign(new Error("充值渠道尚未开通，请联系管理员"), { status: 503 });
}
function notifyUrl(channel: PaymentChannel) { return `${process.env.XIAODAN_PAYMENT_PUBLIC_URL!.replace(/\/$/, "")}/v1/payments/${channel}/notify`; }
function alipay() {
  requireChannel("alipay");
  return new AlipaySdk({ appId: process.env.ALIPAY_APP_ID!, privateKey: readFileSync(process.env.ALIPAY_PRIVATE_KEY_PATH!, "utf8"),
    alipayPublicKey: readFileSync(process.env.ALIPAY_PUBLIC_KEY_PATH!, "utf8"), keyType: "PKCS8", timeout: 10000 });
}
function amountYuan(fen: number) { return `${Math.floor(fen / 100)}.${String(fen % 100).padStart(2, "0")}`; }
function parseFen(value: unknown) {
  const amount = z.string().regex(/^\d{1,8}(\.\d{1,2})?$/).parse(value);
  const [integer, decimals = ""] = amount.split(".");
  return Number(integer) * 100 + Number(decimals.padEnd(2, "0"));
}
function verifyWechat(raw: string, headers: { get(name: string): string | null }) {
  requireChannel("wechat");
  const timestamp = headers.get("wechatpay-timestamp"), nonce = headers.get("wechatpay-nonce"), signature = headers.get("wechatpay-signature");
  if (!timestamp || !/^\d{10}$/.test(timestamp) || !nonce || !signature
    || Math.abs(Date.now() / 1000 - Number(timestamp)) > 300
    || headers.get("wechatpay-serial") !== process.env.WECHAT_PAY_PUBLIC_KEY_ID
    || !verify("RSA-SHA256", Buffer.from(`${timestamp}\n${nonce}\n${raw}\n`), readFileSync(process.env.WECHAT_PAY_PUBLIC_KEY_PATH!, "utf8"), Buffer.from(signature, "base64"))) throw Object.assign(new Error("支付签名无效"), { status: 403 });
}
async function wechat(method: "POST" | "GET", path: string, body?: unknown) {
  requireChannel("wechat");
  const raw = body === undefined ? "" : JSON.stringify(body);
  const timestamp = String(Math.floor(Date.now() / 1000)), nonce = randomBytes(16).toString("hex");
  const signature = sign("RSA-SHA256", Buffer.from(`${method}\n${path}\n${timestamp}\n${nonce}\n${raw}\n`), readFileSync(process.env.WECHAT_PRIVATE_KEY_PATH!, "utf8")).toString("base64");
  const authorization = `WECHATPAY2-SHA256-RSA2048 mchid="${process.env.WECHAT_MCH_ID}",nonce_str="${nonce}",timestamp="${timestamp}",serial_no="${process.env.WECHAT_MCH_SERIAL}",signature="${signature}"`;
  const response = await fetch(`https://api.mch.weixin.qq.com${path}`, { method, headers: { Authorization: authorization, Accept: "application/json", "Content-Type": "application/json" }, ...(body === undefined ? {} : { body: raw }), redirect: "error", signal: AbortSignal.timeout(10000) });
  const text = await response.text();
  if (text.length > 100000) throw new Error("支付响应过大");
  verifyWechat(text, response.headers);
  if (!response.ok) throw Object.assign(new Error("支付平台暂时无法处理订单，请稍后重试"), { status: 502 });
  return JSON.parse(text);
}
export async function createPayment(order: KeyOrder) {
  const description = "小丹AI漫剧 API 额度购买";
  let qrCode: string;
  if (order.channel === "wechat") {
    const response = await wechat("POST", "/v3/pay/transactions/native", { appid: process.env.WECHAT_APP_ID, mchid: process.env.WECHAT_MCH_ID, description, out_trade_no: order.id, notify_url: notifyUrl("wechat"), amount: { total: order.amountFen, currency: "CNY" } });
    qrCode = z.string().startsWith("weixin://wxpay/").parse(response.code_url);
  } else {
    const response = await alipay().curl<{ qr_code: string }>("POST", "/v3/alipay/trade/precreate", { body: { out_trade_no: order.id, total_amount: amountYuan(order.amountFen), subject: description, notify_url: notifyUrl("alipay") } });
    qrCode = z.string().url().parse(response.data.qr_code);
    if (new URL(qrCode).protocol !== "https:") throw new Error("支付链接无效");
  }
  return { orderId: order.id, channel: order.channel, amountFen: order.amountFen, qrCode };
}
export function wechatNotification(raw: string, headers: { get(name: string): string | null }) {
  verifyWechat(raw, headers);
  const event = z.object({ event_type: z.literal("TRANSACTION.SUCCESS"), resource: z.object({ algorithm: z.literal("AEAD_AES_256_GCM"), original_type: z.literal("transaction"), nonce: z.string(), associated_data: z.string().optional(), ciphertext: z.string() }) }).parse(JSON.parse(raw));
  const key = Buffer.from(process.env.WECHAT_API_V3_KEY!, "utf8");
  if (key.length !== 32) throw new Error("微信 APIv3 密钥长度错误");
  const encrypted = Buffer.from(event.resource.ciphertext, "base64");
  const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(event.resource.nonce));
  decipher.setAuthTag(encrypted.subarray(-16));
  decipher.setAAD(Buffer.from(event.resource.associated_data ?? ""));
  return wechatCredit(JSON.parse(Buffer.concat([decipher.update(encrypted.subarray(0, -16)), decipher.final()]).toString("utf8")));
}
function wechatCredit(value: unknown) {
  const data = paymentSchema.parse(value);
  if (data.mchid !== process.env.WECHAT_MCH_ID || data.appid !== process.env.WECHAT_APP_ID || data.trade_state !== "SUCCESS") throw new Error("支付商户或状态不匹配");
  return { orderId: data.out_trade_no, channel: "wechat", tradeId: data.transaction_id, amountFen: data.amount.total };
}
export function alipayNotification(body: unknown) {
  const values = z.record(z.string(), z.string()).parse(body);
  if (values.sign_type !== "RSA2" || !alipay().checkNotifySignV2(values) || values.app_id !== process.env.ALIPAY_APP_ID || values.seller_id !== process.env.ALIPAY_SELLER_ID) throw Object.assign(new Error("支付签名或商户无效"), { status: 403 });
  if (!["TRADE_SUCCESS", "TRADE_FINISHED"].includes(values.trade_status)) return null;
  return { orderId: z.string().regex(/^[a-f0-9]{32}$/).parse(values.out_trade_no), channel: "alipay", tradeId: z.string().min(1).parse(values.trade_no), amountFen: parseFen(values.total_amount) };
}
export async function queryPayment(order: KeyOrder) {
  if (order.channel === "wechat") {
    const result = await wechat("GET", `/v3/pay/transactions/out-trade-no/${order.id}?mchid=${encodeURIComponent(process.env.WECHAT_MCH_ID!)}`);
    return result.trade_state === "SUCCESS" ? wechatCredit(result) : null;
  }
  const response = await alipay().curl<Record<string, unknown>>("POST", "/v3/alipay/trade/query", { body: { out_trade_no: order.id } });
  const data = response.data;
  if (!["TRADE_SUCCESS", "TRADE_FINISHED"].includes(String(data.trade_status))) return null;
  if (data.out_trade_no !== order.id || data.seller_id !== process.env.ALIPAY_SELLER_ID) throw new Error("支付查询商户不匹配");
  return { orderId: order.id, channel: "alipay", tradeId: z.string().min(1).parse(data.trade_no), amountFen: parseFen(data.total_amount) };
}
