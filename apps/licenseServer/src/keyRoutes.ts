import type { Express } from "express";
import { z } from "zod";
import { credentialsSchema } from "./store";
import type { LicenseStore } from "./store";
import { authenticate } from "./auth";
import { catalog, publicOrder, saleChannels } from "./keyShop";
import type { createKeyShop } from "./keyShop";
import { alipayNotification, createPayment, queryPayment, wechatNotification } from "./payments";

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
    const checkout = order.state === "pending" ? await createPayment(order) : {};
    res.json({ code: 200, data: { ...publicOrder(order), ...checkout, orderId: order.id }, message: "成功" });
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
  app.post("/v1/payments/wechat/notify", (req, res) => {
    const raw = callbackBodies.get(req);
    if (!raw) { res.status(400).end(); return; }
    shop.paid(wechatNotification(raw, { get: name => req.get(name) ?? null }));
    res.status(204).end();
  });
  app.post("/v1/payments/alipay/notify", (req, res) => {
    const paid = alipayNotification(req.body);
    if (paid) shop.paid(paid);
    res.type("text/plain").send("success");
  });
}
