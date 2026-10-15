import { Router } from "express";
import u from "@/utils";
import { success } from "@/lib/responseFormat";
import { z } from "zod";
import { validateFields } from "@/lib/middleware";

export default Router().post("/", validateFields({ requestId: z.uuid(), channel: z.enum(["wechat", "alipay"]), packageId: z.string().regex(/^[a-zA-Z0-9]{1,32}$/) }), async (req, res) => {
  u.mcpControl.assertAppRequest(req);
  res.set("Cache-Control", "no-store").json(success(await u.license.requestKeyShop("order", { requestId: req.body.requestId, channel: req.body.channel, packageId: req.body.packageId })));
});
