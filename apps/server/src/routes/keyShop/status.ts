import { Router } from "express";
import u from "@/utils";
import { success } from "@/lib/responseFormat";
import { getMallSession, mallAccountFetch } from "@/utils/mallAuth";

export default Router().get("/", async (req, res) => {
  u.mcpControl.assertAppRequest(req);
  const status = await u.license.requestKeyShop("status");
  const session = getMallSession(req);
  // 已登录商城账号时，订单列表按商城账号取；套餐与渠道仍用授权服务的目录，两边是同一批档位。
  let orders = status.orders;
  if (session) {
    const { response, data } = await mallAccountFetch(session, "/api/drama/orders");
    orders = response.ok && Array.isArray(data?.orders) ? data.orders : [];
  }
  res.set("Cache-Control", "no-store").json(success({ packages: status.packages, channels: status.channels, orders }));
});
