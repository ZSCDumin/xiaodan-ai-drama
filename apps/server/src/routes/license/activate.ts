import { Router } from "express";
import { z } from "zod";
import u from "@/utils";
import { validateFields } from "@/lib/middleware";
import { success } from "@/lib/responseFormat";
import { getMallSession } from "@/utils/mallAuth";

export default Router().post("/", validateFields({ code: z.string().regex(/^XD-[A-Za-z0-9_-]{32}$/) }), async (req, res) => {
  u.mcpControl.assertAppRequest(req);
  res.set("Cache-Control", "no-store");
  // 登录后才会走到这里；把商城账号一并带上，授权服务据此记录归属并执行一码一账号。
  const session = getMallSession(req);
  res.json(success(await u.license.activateLicense(req.body.code, session?.userId)));
});
