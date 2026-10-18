// 小丹 AI 商城账号登录：验证码、登录、会话、访问门槛，以及账号维度的购买代理。
//
// 设计要点：
// - 商城令牌只保存在服务端（data/mall-sessions.json，0600），浏览器只拿到一个签名过的会话 ID。
// - 会话 Cookie 是 HttpOnly + SameSite=Lax；HTTPS 下自动加 Secure。
// - 所有 /api、/mcp、/a2a 请求都要求已登录；未登录的页面请求 302 到 /login。
// - 子路径部署（如 nginx 的 /ai_drama/）通过 XIAODAN_PUBLIC_BASE 生成正确的跳转地址。
import type { Express, NextFunction, Request, Response } from "express";
import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { z } from "zod";

const MALL_BASE = String(process.env.XIAODAN_MALL_BASE_URL ?? "https://www.xiaodukeji.online").replace(/\/+$/, "");
// 对外路径前缀：网页部署是 /ai_drama，桌面端与本地是空串。
const PUBLIC_BASE = String(process.env.XIAODAN_PUBLIC_BASE ?? "").replace(/\/+$/, "");
const COOKIE_NAME = "xd_mall_session";
const SESSION_TTL_MS = 30 * 24 * 3600 * 1000;

const dataDirectory = resolve(process.env.TOONFLOW_DATA_DIR ?? join(process.cwd(), "data"));
mkdirSync(dataDirectory, { recursive: true, mode: 0o700 });
const secretPath = join(dataDirectory, "mall-session.key");
if (!existsSync(secretPath)) writeFileSync(secretPath, randomBytes(32).toString("hex"), { mode: 0o600 });
const sessionSecret = readFileSync(secretPath, "utf8").trim();
const sessionPath = join(dataDirectory, "mall-sessions.json");

interface MallSession {
  userId: string;
  name: string;
  phone: string;
  role: string;
  /** 商城 Bearer 令牌，只留在服务端。 */
  token: string;
  exp: number;
}
const sessions = new Map<string, MallSession>();
try {
  const stored = JSON.parse(readFileSync(sessionPath, "utf8")) as Record<string, MallSession>;
  const now = Date.now();
  for (const [id, session] of Object.entries(stored)) if (session.exp > now) sessions.set(id, session);
} catch {
  // 首次运行或文件损坏：当作没有历史会话，重新登录即可。
}
function persistSessions() {
  writeFileSync(sessionPath, JSON.stringify(Object.fromEntries(sessions)), { mode: 0o600 });
  try { chmodSync(sessionPath, 0o600); } catch {}
}

const signSessionId = (id: string) => createHmac("sha256", sessionSecret).update(id).digest("base64url");
function parseCookies(request: Request) {
  const result: Record<string, string> = {};
  for (const part of String(request.headers.cookie ?? "").split(";")) {
    const index = part.indexOf("=");
    if (index < 0) continue;
    const name = part.slice(0, index).trim();
    if (name) result[name] = decodeURIComponent(part.slice(index + 1).trim());
  }
  return result;
}
function currentSession(request: Request): MallSession | null {
  const raw = parseCookies(request)[COOKIE_NAME];
  if (!raw) return null;
  const [id, signature] = raw.split(".");
  if (!id || !signature) return null;
  const expected = signSessionId(id);
  if (signature.length !== expected.length || !timingSafeEqual(Buffer.from(signature), Buffer.from(expected))) return null;
  const session = sessions.get(id);
  if (!session) return null;
  const now = Date.now();
  if (session.exp <= now) { sessions.delete(id); persistSessions(); return null; }
  // 滑动续期：剩余不足一半时续满，桌面端长期离线使用也不会在第 30 天被强制下线。
  // 写入频率约为每 3.5 天一次，不影响请求路径。
  if (session.exp - now < SESSION_TTL_MS / 2) {
    session.exp = now + SESSION_TTL_MS;
    persistSessions();
  }
  return session;
}
function cookieHeader(request: Request, value: string, maxAgeSeconds: number) {
  const secure = request.secure || String(request.headers["x-forwarded-proto"] ?? "").includes("https");
  return `${COOKIE_NAME}=${value}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAgeSeconds}${secure ? "; Secure" : ""}`;
}

/** 客户端的真实来源地址：反代场景优先 X-Real-IP，其次 socket。 */
function clientAddress(request: Request) {
  const real = String(request.headers["x-real-ip"] ?? "").trim();
  if (real) return real.replace(/^::ffff:/, "");
  return String(request.socket.remoteAddress ?? "").replace(/^::ffff:/, "");
}

async function mallFetch(path: string, init: RequestInit & { clientIp?: string } = {}) {
  const headers: Record<string, string> = { ...(init.headers as Record<string, string> | undefined) };
  // 商城的登录限流按来源 IP 分桶；不转发真实地址的话所有用户会共用服务器这一个桶。
  if (init.clientIp) headers["X-Forwarded-For"] = init.clientIp;
  const response = await fetch(`${MALL_BASE}${path}`, { ...init, headers, redirect: "error", signal: AbortSignal.timeout(15000) });
  const text = await response.text();
  if (text.length > 200_000) throw new Error("商城响应过大");
  let data: any = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = null; }
  return { response, data };
}

/** 以某个商城账号的身份调用商城接口（令牌只在本进程内使用）。 */
export function mallAccountFetch(session: MallSession, path: string, init: RequestInit = {}) {
  return mallFetch(path, {
    ...init,
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${session.token}`, ...(init.headers as Record<string, string> | undefined) },
  });
}

export function getMallSession(request: Request): MallSession | null {
  return (request as Request & { mallSession?: MallSession }).mallSession ?? currentSession(request);
}

const loginSchema = z.object({
  phone: z.string().regex(/^\+?\d{6,20}$/),
  password: z.string().min(1).max(128),
  captchaId: z.string().min(1).max(64),
  captchaCode: z.string().min(1).max(8),
});

/**
 * 商城按原样匹配手机号（库里存的是 `+86...`），用户习惯只填 11 位。
 * 这里统一补全，避免"账号没错却提示手机号或密码错误"。
 */
function normalizePhone(value: string) {
  const raw = String(value ?? "").replace(/[\s-]/g, "");
  if (/^\+86\d{6,12}$/.test(raw)) return raw;
  if (/^86\d{11}$/.test(raw)) return `+${raw}`;
  if (/^1\d{10}$/.test(raw)) return `+86${raw}`;
  if (/^\d{6,12}$/.test(raw)) return `+86${raw}`;
  return raw;
}

function loginPage(desktop = false) {
  const base = PUBLIC_BASE;
  return `<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8"/><meta name="viewport" content="width=device-width,initial-scale=1"/>
<title>登录 · 小丹AI漫剧</title>
<style>
*{box-sizing:border-box}body{margin:0;min-height:100vh;display:grid;place-items:center;background:#f4f6f8;font-family:system-ui,-apple-system,"PingFang SC","Microsoft YaHei",sans-serif;color:#1f2937}
.card{width:min(400px,92vw);background:#fff;border:1px solid #e5e7eb;border-radius:16px;padding:32px 28px;box-shadow:0 10px 30px rgba(15,23,42,.06)}
h1{font-size:20px;margin:0 0 6px}p.sub{margin:0 0 22px;color:#6b7280;font-size:13px}
label{display:block;font-size:13px;font-weight:600;margin:14px 0 6px}
input{width:100%;height:42px;border:1px solid #d1d5db;border-radius:10px;padding:0 12px;font-size:14px;outline:none}
input:focus{border-color:#f04c27;box-shadow:0 0 0 3px rgba(240,76,39,.12)}
.captcha{display:flex;gap:10px;align-items:center}.captcha input{flex:1}
.captcha img{height:42px;width:128px;border:1px solid #e5e7eb;border-radius:10px;cursor:pointer;background:#f3f5f8;object-fit:cover}
button{width:100%;height:44px;margin-top:22px;border:0;border-radius:11px;background:#f04c27;color:#fff;font-size:15px;font-weight:700;cursor:pointer}
button:disabled{opacity:.6;cursor:default}
.err{min-height:20px;margin-top:12px;color:#dc2626;font-size:13px}
</style></head><body>
<form class="card" id="form">
  <h1>登录小丹AI漫剧</h1>
  <p class="sub">使用小丹科研AI商城的手机号与密码登录</p>
  <label for="phone">手机号</label>
  <input id="phone" name="phone" inputmode="tel" autocomplete="username" placeholder="手机号（+86 可省略）" required/>
  <label for="password">密码</label>
  <input id="password" name="password" type="password" autocomplete="current-password" required/>
  <label for="captchaCode">图形验证码</label>
  <div class="captcha">
    <input id="captchaCode" name="captchaCode" maxlength="8" autocomplete="off" required/>
    <img id="captchaImage" alt="验证码" title="点击刷新"/>
  </div>
  <button id="submit" type="submit">登录</button>
  <div class="err" id="err"></div>
</form>
<script>
(function(){
  var base=${JSON.stringify(base)};
  var captchaId="",image=document.getElementById("captchaImage"),err=document.getElementById("err"),submit=document.getElementById("submit"),form=document.getElementById("form");
  // 登录页不加载 Vue，需要单独通知原生宿主展示窗口。
  if (${desktop}) window.addEventListener("load",function(){
    fetch(base+"/api/desktop/ready",{method:"POST",headers:{"Content-Type":"application/json","x-toonflow-desktop":"1"},body:JSON.stringify({loginPage:true})})
      .then(function(response){if(!response.ok)throw new Error("显示登录窗口失败（"+response.status+"）")})
      .catch(function(error){err.textContent=error.message});
  },{once:true});
  async function refresh(){
    try{
      var r=await fetch(base+"/api/mall/auth/captcha",{credentials:"same-origin"});
      var j=await r.json();
      if(!r.ok||!j.data)throw new Error((j&&j.message)||"获取验证码失败");
      captchaId=j.data.captchaId;image.src=j.data.imageUrl;
    }catch(e){err.textContent=e.message||"获取验证码失败"}
  }
  image.addEventListener("click",refresh);
  form.addEventListener("submit",async function(event){
    event.preventDefault();err.textContent="";
    var phone=document.getElementById("phone").value.trim().replace(/\\s+/g,"");
    var password=document.getElementById("password").value;
    var captchaCode=document.getElementById("captchaCode").value.trim();
    if(!phone||!password||!captchaCode){err.textContent="请填写手机号、密码和验证码";return}
    submit.disabled=true;
    try{
      var r=await fetch(base+"/api/mall/auth/login",{method:"POST",headers:{"Content-Type":"application/json"},credentials:"same-origin",body:JSON.stringify({phone:phone,password:password,captchaId:captchaId,captchaCode:captchaCode})});
      var j=await r.json().catch(function(){return {}});
      if(!r.ok)throw new Error((j&&j.message)||"登录失败");
      location.replace(base+"/");
    }catch(e){err.textContent=e.message||"登录失败";submit.disabled=false;document.getElementById("captchaCode").value="";refresh()}
  });
  refresh();
})();
</script>
</body></html>`;
}

export function registerMallAuth(app: Express) {
  app.get("/login", (request, response) => {
    response.set("Cache-Control", "no-store").type("html").send(loginPage(Boolean(request.app.locals.desktop)));
  });
  app.get("/api/mall/auth/captcha", async (request, response) => {
    const { response: upstream, data } = await mallFetch("/api/auth/captcha", { clientIp: clientAddress(request) });
    if (!upstream.ok || !data?.captchaId) return response.status(502).json({ code: 502, data: null, message: "获取验证码失败，请稍后重试" });
    response.set("Cache-Control", "no-store").json({ code: 200, data: { captchaId: data.captchaId, imageUrl: `${PUBLIC_BASE}/api/mall/auth/captcha-image/${data.captchaId}` }, message: "成功" });
  });
  app.get("/api/mall/auth/captcha-image/:id", async (request, response) => {
    const id = z.string().regex(/^[a-f0-9]{1,64}$/).parse(request.params.id);
    const upstream = await fetch(`${MALL_BASE}/api/auth/captcha/${id}.svg`, { redirect: "error", signal: AbortSignal.timeout(10000) });
    if (!upstream.ok) return response.status(404).end();
    const buffer = Buffer.from(await upstream.arrayBuffer());
    response.set("Content-Type", "image/svg+xml").set("Cache-Control", "no-store").send(buffer);
  });
  app.post("/api/mall/auth/login", async (request, response) => {
    const input = loginSchema.parse({ ...request.body, phone: normalizePhone(request.body?.phone) });
    const { response: upstream, data } = await mallFetch("/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input),
      clientIp: clientAddress(request),
    });
    if (!upstream.ok || !data?.token || !data?.user) {
      return response.status(upstream.status === 429 ? 429 : 401).json({ code: 401, data: null, message: data?.error ?? "手机号、密码或验证码不正确" });
    }
    const id = randomBytes(24).toString("base64url");
    const session: MallSession = {
      userId: String(data.user.id),
      name: String(data.user.name ?? ""),
      phone: String(data.user.phone ?? ""),
      role: String(data.user.role ?? "user"),
      token: String(data.token),
      exp: Date.now() + SESSION_TTL_MS,
    };
    sessions.set(id, session);
    persistSessions();
    response.set("Set-Cookie", cookieHeader(request, `${id}.${signSessionId(id)}`, Math.floor(SESSION_TTL_MS / 1000)));
    response.json({ code: 200, data: { user: { id: session.userId, name: session.name, phone: session.phone, role: session.role } }, message: "登录成功" });
  });
  app.post("/api/mall/auth/logout", (request, response) => {
    const raw = parseCookies(request)[COOKIE_NAME];
    const id = raw?.split(".")[0];
    if (id) { sessions.delete(id); persistSessions(); }
    response.set("Set-Cookie", cookieHeader(request, "", 0));
    response.json({ code: 200, data: null, message: "已退出登录" });
  });
  app.get("/api/mall/auth/me", (request, response) => {
    const session = currentSession(request);
    if (!session) return response.status(401).json({ code: 401, data: null, message: "未登录" });
    response.json({ code: 200, data: { user: { id: session.userId, name: session.name, phone: session.phone, role: session.role } }, message: "成功" });
  });
  // 方便直接访问的退出入口：清会话后回到登录页。
  app.get("/logout", (request, response) => {
    const raw = parseCookies(request)[COOKIE_NAME];
    const id = raw?.split(".")[0];
    if (id) { sessions.delete(id); persistSessions(); }
    response.set("Set-Cookie", cookieHeader(request, "", 0));
    response.redirect(302, `${PUBLIC_BASE}/login`);
  });
}

/** 访问门槛：未登录时 API 返回 401，页面跳登录页。登录相关接口与健康检查放行。 */
export function requireMallSession(request: Request, response: Response, next: NextFunction) {
  const session = currentSession(request);
  if (session) {
    (request as Request & { mallSession?: MallSession }).mallSession = session;
    return next();
  }
  const path = request.path;
  // 登录前只允许展示桌面窗口；此路径仍受 desktopRequest 的同源与宿主校验保护。
  if (request.method === "POST" && path === "/api/desktop/ready" && request.app.locals.desktop) return next();
  if (path === "/login" || path === "/logout" || path === "/health" || path.startsWith("/api/mall/auth/")) return next();
  if (path.startsWith("/api/") || path.startsWith("/mcp") || path.startsWith("/a2a")) {
    return response.status(401).json({ code: 401, data: null, message: "请先登录小丹AI商城账号" });
  }
  return response.redirect(302, `${PUBLIC_BASE}/login`);
}
