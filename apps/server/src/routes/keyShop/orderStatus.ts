import { Router } from "express";
import u from "@/utils";
import { success } from "@/lib/responseFormat";
import { z } from "zod";
import { validateFields } from "@/lib/middleware";

export default Router().post("/", validateFields({ orderId: z.string().regex(/^[a-f0-9]{32}$/) }), async (req, res) => {
  u.mcpControl.assertAppRequest(req);
  res.set("Cache-Control", "no-store").json(success(await u.license.requestKeyShop("orderStatus", { orderId: req.body.orderId })));
});
