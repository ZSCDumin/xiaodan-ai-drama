import { Router } from "express";
import u from "@/utils";
import { success } from "@/lib/responseFormat";
import { z } from "zod";
import { validateFields } from "@/lib/middleware";
import { getMallSession, mallAccountFetch } from "@/utils/mallAuth";

export default Router().post("/", validateFields({ requestId: z.uuid(), channel: z.enum(["wechat", "alipay"]), packageId: z.string().regex(/^[a-zA-Z0-9]{1,32}$/) }), async (req, res) => {
  u.mcpControl.assertAppRequest(req);
  const session = getMallSession(req);
  // 已登录商城账号：按账号下单，订单归属商城用户，可在商城「我的订单」里看到。
  if (session) {
    const amount = Number(String(req.body.packageId).replace(/^recharge/, ""));
    if (![100, 200, 500, 1000].includes(amount)) throw Object.assign(new Error("套餐与商城充值档位不匹配，请刷新后重试"), { status: 400 });
    const { response, data } = await mallAccountFetch(session, "/api/drama/recharge", {
      method: "POST",
      body: JSON.stringify({ amount, channel: req.body.channel }),
    });
    if (!response.ok) throw Object.assign(new Error(data?.error ?? "充值下单失败，请稍后重试"), { status: response.status === 429 ? 429 : 502 });
    const order = data?.data ?? {};
    if (!order.id) throw Object.assign(new Error("充值下单返回异常，请稍后重试"), { status: 502 });
    res.set("Cache-Control", "no-store").json(success({ ...order, orderId: order.orderId ?? order.id, qrCode: order.qrCode ?? order.payUrl ?? null }));
    return;
  }
  res.set("Cache-Control", "no-store").json(success(await u.license.requestKeyShop("order", { requestId: req.body.requestId, channel: req.body.channel, packageId: req.body.packageId })));
});
