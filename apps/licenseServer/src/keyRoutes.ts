import type { Express } from "express";
import { timingSafeEqual } from "node:crypto";
import { z } from "zod";
import { credentialsSchema } from "./store";
import type { LicenseStore } from "./store";
import { authenticate } from "./auth";
import { catalog, publicOrder, saleChannels } from "./keyShop";
import type { createKeyShop } from "./keyShop";
import { createPayment, mallNotification, queryPayment } from "./payments";

// ACT: 反代（nginx）会把公网请求的 remoteAddress 变成 127.0.0.1，因此本机来源判断
// 不足以保护内部接口；必须用独立共享密钥做常量时间校验。
function internalCallAllowed(req: { get: (name: string) => string | undefined }) {
  const expected = process.env.XIAODAN_MALL_INTERNAL_TOKEN ?? "";
  const provided = req.get("x-mall-internal") ?? "";
  if (expected.length < 32) return false;
  const a = Buffer.from(provided), b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

const ownedSchema = z.strictObject({ credentials: credentialsSchema, orderId: z.string().regex(/^[a-f0-9]{32}$/) });
export function registerKeyRoutes(app: Express, store: LicenseStore, shop: ReturnType<typeof createKeyShop>, callbackBodies: WeakMap<object, string>) {
  app.post("/v1/keyShop/status", (req, res) => {
    const license = authenticate(store, req.body, false);
    res.json({ code: 200, data: { packages: catalog(), channels: saleChannels(), orders: shop.list(license.id) }, message: "成功" });
  });
  app.post("/v1/keyShop/order", async (req, res) => {
    const input = z.strictObject({ credentials: credentialsSchema, requestId: z.uuid(), channel: z.enum(["wechat", "alipay"]), packageId: z.string().regex(/^[a-zA-Z0-9]{1,32}$/) }).parse(req.body);
    const license = authenticate(store, input.credentials);
    if (!saleChannels()[input.channel]) throw Object.assign(new Error("套餐购买尚未开放，请联系管理员"), { status: 503 });
    const order = shop.order(license.id, input.requestId, input.packageId, input.channel);
    // 商城可能已经收款但回调丢失，下单时若发现已付款就直接按已付款处理。
    let checkout: Record<string, unknown> = {};
    if (order.state === "pending") {
      const payment = await createPayment(order);
      if (payment.paid) shop.paid({ orderId: order.id, channel: payment.channel, tradeId: payment.tradeNo, amountFen: payment.amountFen });
      else checkout = payment;
    }
    res.json({ code: 200, data: { ...publicOrder(shop.get(order.id, license.id)), ...checkout, orderId: order.id }, message: "成功" });
  });
  app.post("/v1/keyShop/orderStatus", async (req, res) => {
    const input = ownedSchema.parse(req.body), license = authenticate(store, input.credentials, false);
    const order = shop.get(input.orderId, license.id);
    if (order.state === "pending") { const paid = await queryPayment(order); if (paid) shop.paid(paid); }
    res.json({ code: 200, data: publicOrder(shop.get(order.id, license.id)), message: "成功" });
  });
  app.post("/v1/keyShop/reveal", (req, res) => {
    const input = ownedSchema.parse(req.body), license = authenticate(store, input.credentials, false);
    res.json({ code: 200, data: shop.reveal(input.orderId, license.id), message: "成功" });
  });
  // 商城代用户下单，无需设备凭证；仅允许持有内部共享密钥的商城服务调用。
  const mallOrderSchema = z.strictObject({ mallUserId: z.string().regex(/^\d{1,16}$/), requestId: z.uuid(), channel: z.enum(["wechat", "alipay"]), packageId: z.string().regex(/^[a-zA-Z0-9]{1,32}$/) });
  app.post("/v1/keyShop/mallOrder", async (req, res) => {
    if (!internalCallAllowed(req)) {
      res.status(403).json({ code: 403, data: null, message: "仅允许内部服务调用" }); return;
    }
    const input = mallOrderSchema.parse(req.body);
    if (!saleChannels()[input.channel]) throw Object.assign(new Error("套餐购买尚未开放，请联系管理员"), { status: 503 });
    const order = shop.mallOrder(input.mallUserId, input.requestId, input.packageId, input.channel);
    let checkout: Record<string, unknown> = {};
    if (order.state === "pending") {
      const payment = await createPayment(order);
      if (payment.paid) shop.paid({ orderId: order.id, channel: payment.channel, tradeId: payment.tradeNo, amountFen: payment.amountFen });
      else checkout = payment;
    }
    res.json({ code: 200, data: { ...shop.mallStatus(input.mallUserId, order.id), ...checkout, orderId: order.id }, message: "成功" });
  });
  app.post("/v1/keyShop/mallStatus", (req, res) => {
    if (!internalCallAllowed(req)) {
      res.status(403).json({ code: 403, data: null, message: "仅允许内部服务调用" }); return;
    }
    // 返回该商城用户的全部充值订单（前端「我的订单」需要列表，orderId 仅作兼容保留）。
    const input = z.strictObject({ mallUserId: z.string().regex(/^\d{1,16}$/), orderId: z.string().regex(/^[a-f0-9]{32}$/).optional() }).parse(req.body);
    res.json({ code: 200, data: shop.mallList(input.mallUserId), message: "成功" });
  });
  // 商城账号领取 Key：与设备许可领取共用解密与审计，只是归属换成 mall-<用户ID>。
  app.post("/v1/keyShop/mallReveal", (req, res) => {
    if (!internalCallAllowed(req)) {
      res.status(403).json({ code: 403, data: null, message: "仅允许内部服务调用" }); return;
    }
    const input = z.strictObject({ mallUserId: z.string().regex(/^\d{1,16}$/), orderId: z.string().regex(/^[a-f0-9]{32}$/) }).parse(req.body);
    res.json({ code: 200, data: shop.mallReveal(input.mallUserId, input.orderId), message: "成功" });
  });
  app.post("/v1/payments/mall/notify", (req, res) => {
    const raw = callbackBodies.get(req);
    if (!raw) { res.status(400).json({ code: 400, data: null, message: "请求体缺失" }); return; }
    shop.paid(mallNotification(raw, { get: name => req.get(name) ?? null }));
    res.json({ code: 200, data: null, message: "成功" });
  });
}
