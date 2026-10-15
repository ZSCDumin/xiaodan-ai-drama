import type { Express } from "express";
import { z } from "zod";
import { credentialsSchema } from "./store";
import type { LicenseStore } from "./store";
import { authenticate } from "./auth";
import { catalog, publicOrder, saleChannels } from "./keyShop";
import type { createKeyShop } from "./keyShop";
import { createPayment, mallNotification, queryPayment } from "./payments";

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
  app.post("/v1/payments/mall/notify", (req, res) => {
    const raw = callbackBodies.get(req);
    if (!raw) { res.status(400).json({ code: 400, data: null, message: "请求体缺失" }); return; }
    shop.paid(mallNotification(raw, { get: name => req.get(name) ?? null }));
    res.json({ code: 200, data: null, message: "成功" });
  });
}
