import { Router } from "express";
import u from "@/utils";
import { success } from "@/lib/responseFormat";
import { z } from "zod";
import { validateFields } from "@/lib/middleware";
import { getMallSession, mallAccountFetch } from "@/utils/mallAuth";

export default Router().post("/", validateFields({ orderId: z.string().regex(/^[a-f0-9]{32}$/) }), async (req, res) => {
  u.mcpControl.assertAppRequest(req);
  const session = getMallSession(req);
  // 已登录商城账号：订单状态从商城账号的订单列表里取（含主动查单兜底）。
  if (session) {
    const { response, data } = await mallAccountFetch(session, "/api/drama/status", { method: "POST", body: JSON.stringify({ orderId: req.body.orderId }) });
    if (!response.ok) throw Object.assign(new Error(data?.error ?? "查询订单失败，请稍后重试"), { status: 502 });
    const list = Array.isArray(data?.data) ? data.data : [];
    const order = list.find((item: { id?: string }) => item.id === req.body.orderId);
    if (!order) throw Object.assign(new Error("订单不存在"), { status: 404 });
    res.set("Cache-Control", "no-store").json(success(order));
    return;
  }
  res.set("Cache-Control", "no-store").json(success(await u.license.requestKeyShop("orderStatus", { orderId: req.body.orderId })));
});
