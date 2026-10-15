# 小丹AI漫剧授权服务部署与运维手册

版本 2.0.4，2026-10-15。适用服务器 `8.130.130.8`（Ubuntu 22.04）。
本文档中的命令都在该服务器上实测通过，备份/恢复演练见第 6 节。

## 1. 拓扑

```
桌面端 APP（客户机器）
  └─ 本地 apps/server ──HTTPS──→ https://www.xiaodukeji.online/license
                                        │ nginx（复用 xiaodukeji.online 证书，剥掉 /license 前缀）
                                        ▼
                                 127.0.0.1:8092  xiaodan-license.service（Bun + SQLite）
                                        │
                                        │ ① 下单：POST {商城}/api/partner/payments（HMAC 签名）
  https://www.xiaodukeji.online ────────┤
     xiaodan-market.service (127.0.0.1:4173)  ② 七相PAY 回调 → 核销
                                        │     ③ 回调：POST {授权服务}/v1/payments/mall/notify（HMAC 签名）
                                        ▲
                                  七相PAY 收银台（微信／支付宝）
```

服务之间走公网 HTTPS，但也都在同一台机器上；`/license` 路径由 nginx 转发，不额外占用域名与证书。

## 2. 文件与目录

| 路径 | 说明 | 权限 |
| --- | --- | --- |
| `/var/lib/xiaodan-license/` | 授权服务数据目录 | 0700 `xdlicense` |
| `…/signingPrivate.pem` | Ed25519 签名私钥（**丢失无法恢复，客户端全部失效**） | 0600 |
| `…/licenses.sqlite` | 许可、设备、事件、订单、Key 密文（WAL 模式） | 0600 |
| `…/keyPackages.json` | API Key 套餐目录 | 0600 |
| `/etc/xiaodan-license.env` | 服务环境变量（含商城共享密钥与 Key 加密密钥） | 0600 root |
| `/etc/xiaodan-license/partner.key` | 商城合作方共享密钥 | 0600 root |
| `/etc/xiaodan-license/encryption.key` | API Key 交付加密密钥（64 hex） | 0600 root |
| `/etc/systemd/system/xiaodan-license.service` | systemd 单元 | 0644 |
| `/etc/nginx/sites-available/xiaodukeji.online` | 含 `location /license/` 转发 | — |
| `/home/codes/xiaodan-ai-drama` | 源码与依赖（Bun 1.3.14，`/usr/local/bin/bun`） | — |
| `/opt/bun`、`/opt/node-v22` | 运行时 | — |

> **备份集必须同时包含数据目录与 `/etc/xiaodan-license*`。** Key 加密密钥与共享密钥不在数据目录里，
> 只备份数据目录时，换机恢复后历史交付的 API Key 将无法解密、商城支付也会验签失败。

## 3. 环境变量（`/etc/xiaodan-license.env`）

| 变量 | 说明 |
| --- | --- |
| `XIAODAN_LICENSE_PORT` | 监听端口，默认 8092，仅 1024–65535 |
| `XIAODAN_LICENSE_DATA_DIR` | 数据目录绝对路径 |
| `XIAODAN_LICENSE_PUBLIC_HOSTS` | 允许的 Host，英文逗号分隔（当前 `www.xiaodukeji.online`） |
| `XIAODAN_LICENSE_TRUST_PROXY` | `1` 表示按 `X-Forwarded-For` 做限流分桶 |
| `XIAODAN_MALL_BASE_URL` | 商城地址，必须 HTTPS |
| `XIAODAN_MALL_PARTNER_KEY` | 与商城 `PARTNER_API_KEY` 相同的共享密钥（≥32 位） |
| `XIAODAN_PAYMENT_PUBLIC_URL` | 本服务对外地址，用于生成回调地址 |
| `XIAODAN_KEY_ENCRYPTION_KEY` | 64 个十六进制字符 |

商城侧对应项在 `/home/codes/xiaodan-market/.env`：`PARTNER_API_KEY`、`PARTNER_NOTIFY_ALLOWED_HOSTS`。

## 4. 日常操作

```sh
# 状态与自启
systemctl status xiaodan-license.service
systemctl is-enabled xiaodan-license.service

# 启停与重启（改环境变量或代码后必须重启）
systemctl restart xiaodan-license.service

# 日志
journalctl -u xiaodan-license.service -n 100 --no-pager
journalctl -u xiaodan-market.service -n 100 --no-pager

# 健康检查（本机与公网）
curl -sS http://127.0.0.1:8092/health
curl -sS https://www.xiaodukeji.online/license/health
curl -sS https://www.xiaodukeji.online/api/health

# nginx 改动后
nginx -t && systemctl reload nginx
```

重启商城（改动商城代码或 `.env` 后）：

```sh
systemctl restart xiaodan-market.service
```

## 5. 密钥与凭证

| 密钥 | 丢失后果 | 轮换 |
| --- | --- | --- |
| `signingPrivate.pem`（授权签名） | 所有已发激活码与租约失效 | 未实现轮换流程：需换 key 并**重新打包客户端**（`apps/server/src/utils/license/config.ts` 的 `publicKey`） |
| `XIAODAN_KEY_ENCRYPTION_KEY` | 历史交付的 API Key 无法解密 | 当前不支持轮换，必须长期备份保管 |
| `PARTNER_API_KEY`（商城共享） | 无法下单收款 | 支持轮换，见下 |
| 七相PAY 商户密钥 | 商城收款失败 | 在商城 `.env` 更新 `QIXIANG_KEY` 后重启商城 |
| `XIAODAN_JWT_SECRET`（商城登录） | 用户登录态失效 | 商城 `.env` 更新后重启（未配置时用 `data/.jwt-secret` 文件） |

### 解除设备 / 撤销许可

```sh
cd /home/codes/xiaodan-ai-drama
RUN="runuser -u xdlicense -- env XIAODAN_LICENSE_DATA_DIR=/var/lib/xiaodan-license /usr/local/bin/bun run --cwd /home/codes/xiaodan-ai-drama/apps/licenseServer"
$RUN manage list                          # 查看许可 ID
$RUN manage devices <许可ID>              # 查看已绑定设备
$RUN manage releaseDevice <许可ID> <设备ID>
$RUN manage revoke <许可ID>               # 已签名离线租约最多再有效 24 小时
```

### 协同密钥轮换（`PARTNER_API_KEY`）

两端必须同时改，中间会有短暂无法下单的窗口，建议在低峰进行：

```sh
NEW=$(openssl rand -hex 32)
echo "$NEW" > /etc/xiaodan-license/partner.key && chmod 600 /etc/xiaodan-license/partner.key
sed -i "s|^XIAODAN_MALL_PARTNER_KEY=.*|XIAODAN_MALL_PARTNER_KEY=$NEW|" /etc/xiaodan-license.env
sed -i '/^PARTNER_API_KEY=/d' /home/codes/xiaodan-market/.env
printf 'PARTNER_API_KEY=%s\n' "$NEW" >> /home/codes/xiaodan-market/.env
chown moding:moding /home/codes/xiaodan-market/.env && chmod 600 /home/codes/xiaodan-market/.env
systemctl restart xiaodan-market.service xiaodan-license.service
curl -sS https://www.xiaodukeji.online/license/health
```

轮换后做一次第 8 节的下单验证；失败时先看商城日志里的 `签名无效`。

## 6. 备份与恢复（已实测）

### 备份

必须**先停服务**再整目录打包，运行中只拷主库会丢掉 WAL 里尚未合并的数据。

```sh
BK=/var/backups/xiaodan-license; install -d -m 0700 "$BK"
TS=$(date +%Y%m%d-%H%M%S)
systemctl stop xiaodan-license.service
tar -czf "$BK/license-data-$TS.tar.gz" -C /var/lib xiaodan-license
install -d -m 0700 "$BK/config-$TS"                     # 密钥不在数据目录里，必须单独备份
cp -a /etc/xiaodan-license.env /etc/xiaodan-license "$BK/config-$TS/"
systemctl start xiaodan-license.service
```

`config-*` 里含明文密钥，必须另存到加密介质或密钥管理服务，不要和代码一起提交。
建议加一个每日 cron，并把备份同步到另一台机器；恢复演练每季度做一次。

### 恢复（含演练结果）

```sh
systemctl stop xiaodan-license.service
tar -czf /tmp/before-restore.tar.gz -C /var/lib xiaodan-license    # 先留一份现状
rm -rf /var/lib/xiaodan-license && install -d -m 0700 -o xdlicense -g xdlicense /var/lib/xiaodan-license
tar -xzf "$BK/license-data-$TS.tar.gz" -C /var/lib/xiaodan-license --strip-components=1
chown -R xdlicense:xdlicense /var/lib/xiaodan-license
cp -a "$BK/config-$TS/xiaodan-license.env" /etc/xiaodan-license.env
cp -a "$BK/config-$TS/xiaodan-license/." /etc/xiaodan-license/
systemctl start xiaodan-license.service

# 校验：keyId 必须与备份前一致，许可清单应完整
runuser -u xdlicense -- env XIAODAN_LICENSE_DATA_DIR=/var/lib/xiaodan-license \
  /usr/local/bin/bun run --cwd /home/codes/xiaodan-ai-drama/apps/licenseServer manage publicKey
```

**实测记录（2026-10-15）**：停服务 → 打包 → 恢复到临时目录 → 用恢复的数据在 8093 端口另起实例 →
`/v1/activate` 返回 `code:200` 并签发租约；恢复后 `keyId` 与生产一致（`28f8ab3f5fc155766ac9eec1`）。
演练数据与临时实例均已清理。

> 换机恢复还要同步 nginx 配置、systemd 单元、Bun 运行时，以及把 DNS/证书指到新机。

## 7. 套餐上架与下架

编辑 `/var/lib/xiaodan-license/keyPackages.json`（JSON 数组），字段：`id`（1–32 位**字母或数字**，不能含连字符）、
`label`、`priceFen`（售价，整数分）、`creditFen`（承诺额度，整数分）、`description`（≤500 字）。

```sh
vi /var/lib/xiaodan-license/keyPackages.json
chown xdlicense:xdlicense /var/lib/xiaodan-license/keyPackages.json && chmod 600 /var/lib/xiaodan-license/keyPackages.json
systemctl restart xiaodan-license.service    # 目录在进程启动时读取
```

改完在 APP 里点“刷新订单”核对价格与说明；`catalog()` 校验失败会让客户端看到“套餐购买尚未开放”。
**下架某个套餐直接删除对应条目**；已创建的订单仍可继续付款与交付。
要整体停售，把文件内容改成 `[]` 或删除该文件。

当前是示例条目 `exampleStarter`（99 元 / 200 元额度），上架前必须改成实际价格。

## 8. 管理员操作

```sh
cd /home/codes/xiaodan-ai-drama
RUN="runuser -u xdlicense -- env XIAODAN_LICENSE_DATA_DIR=/var/lib/xiaodan-license /usr/local/bin/bun run --cwd /home/codes/xiaodan-ai-drama/apps/licenseServer"

# 许可
$RUN manage init                              # 仅首次，重复执行会报错并保留原私钥
$RUN manage issue 30 2 standard               # 30 天、最多 2 台设备（激活码只显示一次）
$RUN manage list
$RUN manage renew <许可ID> 30
$RUN manage publicKey

# API Key 订单
$RUN manage keyOrders                         # 查看待交付订单
# 先在 TF-Router 建好与套餐额度相符的独立 Key，写入 600 权限的私有文件
$RUN manage deliverKey <订单ID> /root/.xd-key-tmp && shred -u /root/.xd-key-tmp
```

交付后由用户在 APP“设置 → 购买 API Key”里领取。命令不打印 Key 明文，也不覆盖已交付 Key。

### 一次完整下单验证（不花钱）

对已激活的设备和已上架套餐：

```sh
curl -sS -X POST https://www.xiaodukeji.online/license/v1/activate \
  -H 'Content-Type: application/json' \
  -d '{"code":"<激活码>","deviceId":"<uuid>","deviceSecret":"<43位base64url>"}'
```

拿到凭证后调 `/v1/keyShop/order` 应返回以 `https://api.payqixiang.cn/...` 开头的 `qrCode`；
用浏览器打开该地址能看到收银台即为正常（**不要真的付款**）。

## 9. 客户端发布注意

`apps/server/src/utils/license/config.ts` 已固定正式地址与公钥：

- `serviceUrl = https://www.xiaodukeji.online/license`
- `publicKey = <当前 keyId 28f8ab3f5fc155766ac9eec1 对应的 PEM>`

**需要重新打包安装包才生效**（桌面端与 Android 都是）。换服务端私钥时必须同步换这里的公钥并重新发版，
客户端不接受页面或响应里提供的信任根。

## 10. 监控建议

- 定时探测 `https://www.xiaodukeji.online/license/health` 与 `/api/health`，非 200 告警。
- 商城库中 `SELECT status,notified_at FROM partner_orders WHERE status='paid' AND notified_at IS NULL;`
  长时间非空表示回调投递异常（用户仍可点“查询付款结果”兜底核销）。
- `systemctl is-active` 两个服务；systemd 已配置 `Restart=always`。
- 磁盘：`/` 当前约 18G 可用，注意 SQLite WAL 与备份目录增长。

## 11. 故障排查

| 现象 | 可能原因 | 处理 |
| --- | --- | --- |
| APP 里“套餐购买尚未开放” | 套餐为空、`XIAODAN_KEY_ENCRYPTION_KEY` 格式不对、或商城配置缺失 | 检查三个条件；看 `saleChannels()` 逻辑与 `/etc/xiaodan-license.env` |
| 下单返回“支付服务暂时无法处理订单” | 商城合作方接口非 2xx（签名、金额、回调白名单、七相PAY） | 看 `journalctl -u xiaodan-market`；核对两端 `PARTNER_API_KEY` 是否一致 |
| 调合作方接口返回 401 | 共享密钥不一致或时间偏差 >5 分钟 | 校时（chrony），重做第 5 节轮换 |
| 返回 403“不允许的请求来源” | Host 不在白名单，或请求带了浏览器 Origin | 补 `XIAODAN_LICENSE_PUBLIC_HOSTS`；不要用浏览器页面直连授权服务 |
| 返回 429 | 同一来源 POST 超过 30 次/分钟 | 确认 `XIAODAN_LICENSE_TRUST_PROXY=1`；检查是否有异常刷接口 |
| 回调后订单仍 `pending` | 商城回调失败 | 用户在 APP 点“查询付款结果”即通过商城主动查单核销；同时查 `notified_at` |
| 激活码无效 | 库被清空/覆盖，或码输错 | 用 `manage list` 核对；换机恢复后确认用的是同一份数据目录 |
| APP 提示授权签名无效 | 客户端公钥与服务端私钥不匹配 | 核对 `manage publicKey` 的 keyId 与 `config.ts` 的 PEM |

## 12. 验收边界

已实测：公网激活/刷新、签名下单取七相PAY 收银台地址、模拟支付成功 → 商城核销 → 签名回调 → 授权订单转 `paid`、
金额一致、Host/Origin/未签名防护、备份恢复演练、两端类型检查与单元测试（商城 29/29）。

**未验收**：真实付款与真实退款、真实 API Key 交付、24 小时离线租约与时钟篡改、各平台真机安装包、
`apps/server` 整包构建（其 `typecheck` 因仓库已有的 `electrobun.config.ts` 缺失 `.hutch` 生成物而报错，与本次改动无关）。

## 13. 附：漫剧网页服务（对外预览）

把整套 Web + 业务服务作为网页跑在服务器上，浏览器可直接访问；这不是桌面安装包。

| 项 | 值 |
| --- | --- |
| 单元 | `xiaodan-drama-web.service`（已 enable，开机自启） |
| 应用端口 | `127.0.0.1:3010`（`TOONFLOW_PORT` 环境变量，默认 3000） |
| 入口 | `build/server/index.js`，静态资源 `build/web` |
| 数据目录 | `/home/codes/xiaodan-ai-drama/data` |
| 本机隧道 | SSH 端口转发 `127.0.0.1:3010`，浏览器开 `http://localhost:3010` |
| 对外入口 | `https://www.xiaodukeji.online:8080`（nginx `xiaodan-drama-external`，HTTPS + Basic Auth） |

### 为什么必须加鉴权

`apps/server` 没有登录／会话，接口里有任意文件读写（`/api/workspaces/files/{read,write}`）、
浏览器操控、模型调用和 API Key 领取；它原本靠「只监听 `127.0.0.1` + Host 白名单 + Origin 同源」
**替代**鉴权。因此对外暴露必须由 nginx 在前面补一层鉴权，不能直接放行。

### nginx 反代的头重写（关键）

应用要求 `Host` 只允许 localhost，且 `Origin`／`Referer` 必须与 `Host` 同源。反代里把两者
一起改写成 `localhost:3010` 即可同时满足，**无需修改应用代码**：

```nginx
proxy_set_header Host localhost:3010;
proxy_set_header Origin http://localhost:3010;
proxy_set_header Referer http://localhost:3010/;
proxy_set_header Connection "";   # 只有 SSE，没有 WebSocket
proxy_buffering off;              # 不关缓冲，流式输出会卡住
```

注意：`index.ts` 的 Host 白名单与 `getAppOrigin` 都不能放开成任意域名，否则浏览器 DNS 重绑定
可以绕过来源校验。要调整来源策略必须同时评估这两处。

### 账号口令

| 项 | 值 |
| --- | --- |
| 用户名 | `xiaodan` |
| 口令文件 | `/etc/nginx/.htpasswd-xiaodan-drama`（640 `root:www-data`） |
| 口令备份 | `/etc/xiaodan-license/drama-basic-auth.txt`（600，**勿入 Git**） |

```sh
NEW=$(openssl rand -base64 18 | tr -d '/+=' | cut -c1-20)
printf 'xiaodan:%s\n' "$(openssl passwd -apr1 "$NEW")" > /etc/nginx/.htpasswd-xiaodan-drama
chown root:www-data /etc/nginx/.htpasswd-xiaodan-drama && chmod 640 /etc/nginx/.htpasswd-xiaodan-drama
printf '%s' "$NEW" > /etc/xiaodan-license/drama-basic-auth.txt && chmod 600 /etc/xiaodan-license/drama-basic-auth.txt
systemctl reload nginx
```

### 重新构建与重启

```sh
cd /home/codes/xiaodan-ai-drama
bun run build:server                            # 构建 nodes/tools/ext + web + server
systemctl restart xiaodan-drama-web.service
journalctl -u xiaodan-drama-web.service -n 50 --no-pager
```

### 风险与建议

- Basic Auth 是单一口令、无二次验证，公网会被持续爆破；建议再加 nginx `limit_req` 或 fail2ban，
  并定期换口令。
- 该入口具备服务器文件读写能力，拿到它约等于拿到这台机器的可写权限；不建议长期对外开放。
- 阿里云安全组当前已放行 TCP 8080（实测外网可达）；需要收紧时在安全组与 nginx `allow/deny`
  两处同时限制来源 IP。
- 对外用的是 `www.xiaodukeji.online` 的证书，**必须用域名访问**；直接用 IP 会触发证书不匹配告警。

端口说明：`index.ts` 的端口原本硬编码 3000，与同机 `personal-site.service` 冲突，现已可用
`TOONFLOW_PORT` 覆盖（默认仍是 3000）。
