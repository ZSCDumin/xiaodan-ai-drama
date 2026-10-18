import { Router } from "express";
import u from "@/utils";
import { success } from "@/lib/responseFormat";
import { z } from "zod";
import { validateFields } from "@/lib/middleware";
import { getMallSession, mallAccountFetch } from "@/utils/mallAuth";

export default Router().post("/", validateFields({ orderId: z.string().regex(/^[a-f0-9]{32}$/) }), async (req, res) => {
  u.mcpControl.assertAppRequest(req);
  const session = getMallSession(req);
  // 已登录商城账号：Key 归属 mall-<用户ID>，通过商城接口领取。
  if (session) {
    const { response, data } = await mallAccountFetch(session, "/api/drama/reveal", { method: "POST", body: JSON.stringify({ orderId: req.body.orderId }) });
    if (!response.ok) throw Object.assign(new Error(data?.error ?? "领取 Key 失败，请稍后重试"), { status: response.status === 409 ? 409 : 502 });
    res.set("Cache-Control", "no-store").json(success(data?.data ?? {}));
    return;
  }
  res.set("Cache-Control", "no-store").json(success(await u.license.requestKeyShop("reveal", { orderId: req.body.orderId })));
});
