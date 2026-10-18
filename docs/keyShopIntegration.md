# API Key 套餐购买与交付

版本：2.2.0，日期：2026-10-16。收款已接入「小丹科研AI商城」，商城前台已提供充值入口，充值订单可在商城「我的订单」查看；真实付款仍待正式商户号验收。

## 当前业务规则

根据经营者最新确认，采用购买额度套餐后交付独立 API Key 的模式。原自建钱包、按请求实际成本乘 1.2 扣费的开发方案已停止并移除。API 用量与额度由 TF-Router 处理；APP 不伪造余额，不按估算 Token 再收费。用户也可自行购买 Key，在模型设置中使用。

第一版由管理员在上游创建独立、有对应额度限制的 Key，核对后手动交付。没有接入 TF-Router 自动创建 Key 的接口，也没有自动向已交付 Key 续充额度。软件授权与 Key 套餐是两类商品，Key 额度不会自动延长软件授权。

## 收款链路（已改为商城代收）

不再直连微信支付／支付宝官方商户，改为调用商城已报备的七相PAY 收单能力。授权服务不保存任何商户私钥。
商城侧实现见 `xiaodan-market` 仓库的 `server/partner.mjs` 与 `docs/partnerPayments.md`。

```
APP(桌面端本地服务)
  └─ POST /v1/keyShop/order ─→ 授权服务
                               ├─ 落本地订单(keyOrders)
                               └─ POST {商城}/api/partner/payments   (HMAC-SHA256 签名)
                                     └─ 七相PAY 下单 → 返回收银台 payUrl
用户扫码付款
  七相PAY ──(MD5 验签回调)──→ 商城 /api/payments/qixiang/notify
                               └─ 核销合作方订单后
                                  POST {授权服务}/v1/payments/mall/notify  (同一套 HMAC 签名)
                                     └─ markPaid：pending → paid
```

- 客户端的“查询付款结果”走 `/v1/keyShop/orderStatus`，授权服务再向商城主动查单，
  商城未支付时会向七相PAY 查单，属于回调丢失时的兜底。
- 回调失败由商城按 1s／5s／15s／60s／300s 重试；最终失败也不影响已收款状态。
- 订单状态：`pending` 待支付 → `paid` 已付款待交付 → `delivered` 已交付。付款不会生成虚假 API Key，也不会增加 APP 钱包余额。

## 商城前台充值（新增）

商城用户不安装桌面端也能购买 API 额度：在商城「AI 漫剧 API 充值」页选择 100／200／500／1000 元，直接走同一套收款链路。

```
商城用户(已登录)
  └─ POST /api/drama/recharge ─→ 商城服务端
       └─ POST 127.0.0.1:8092/v1/keyShop/mallOrder   (X-Mall-Internal 共享密钥)
            └─ 授权服务：建虚拟许可 mall-{用户ID} → 落单 → 调商城 partner 接口 → 七相PAY
                   返回收银台 payUrl，前端跳转支付
  付款后回调核销链路与上文完全相同 → 订单 paid → 管理员交付 Key
```

- 授权服务为每个商城用户自动建立虚拟许可 `mall-{商城用户ID}`（`codeHash` 同样以 `mall-` 开头，不与真实激活码 `XD-` 冲突），用于挂载订单。
- 商城侧 `POST /api/drama/recharge`、`POST /api/drama/status` 需要用户登录态；金额仅允许 100／200／500／1000，套餐号由服务端拼成 `recharge{金额}`，客户端不能自定金额。
- **充值订单展示**：`GET /api/drama/orders`（需登录）返回该用户全部充值订单，数据源是授权服务 `mallStatus` 按 `mall-{用户ID}` 归属筛选出的 `keyOrders`，再并入商城本地 `partner_orders` 的 `pay_url`／`status`。商城「我的订单」页在普通订单上方单独展示「API 充值订单」分区：待支付且链接未过期可直接续付，链接已过期则引导去充值页重新下单，已付款显示等待交付。
- 交付仍是人工：订单变 `paid` 后按「管理员交付」一节操作。商城用户当前没有自助领 Key 入口，需管理员线下发放。

### 内部接口鉴权（重要）

`/v1/keyShop/mallOrder` 与 `/v1/keyShop/mallStatus` 不接受设备凭证，靠 `X-Mall-Internal` 共享密钥鉴权。`mallStatus` 的 `orderId` 参数已改为可选（列表查询不需要它），实际返回值始终是该 `mallUserId` 名下的订单列表，用户隔离由 `mall-{用户ID}` 这一许可编号保证。

**不能只用来源 IP 判断。** nginx 通过 `proxy_pass http://127.0.0.1:8092/` 反代 `/license/`，公网请求到授权服务时 `remoteAddress` 也是 `127.0.0.1`，本机判断形同虚设。曾因此导致公网可直接下单，已改为常量时间比对的共享密钥。

| 变量 | 位置 | 说明 |
| --- | --- | --- |
| `XIAODAN_MALL_INTERNAL_TOKEN` | 两端 `.env` | 至少 32 位随机串，两端必须一致；商城放在 `/home/codes/xiaodan-market/.env`，授权服务放在 `/etc/xiaodan-license.env` |

轮换：生成新值 → 同时更新两端 → 重启两个服务。缺失或不足 32 位时内部接口一律拒绝（失败关闭）。

## 授权服务环境变量

| 变量 | 说明 |
| --- | --- |
| `XIAODAN_MALL_BASE_URL` | 商城地址，必须 HTTPS，例如 `https://www.xiaodukeji.online` |
| `XIAODAN_MALL_PARTNER_KEY` | 与商城共享的 HMAC 密钥，至少 32 位；与商城的 `PARTNER_API_KEY` 相同 |
| `XIAODAN_PAYMENT_PUBLIC_URL` | 本服务的 HTTPS 地址，用于生成商城回调地址，例如 `https://www.xiaodukeji.online/license` |
| `XIAODAN_KEY_ENCRYPTION_KEY` | 64 个十六进制字符（32 字节），AES-256-GCM 加密交付的 Key |
| `XIAODAN_MALL_INTERNAL_TOKEN` | 与商城共享的内部接口密钥，至少 32 位；见「内部接口鉴权」 |
| `XIAODAN_LICENSE_DATA_DIR` / `XIAODAN_LICENSE_PORT` | 数据目录与端口 |
| `XIAODAN_LICENSE_PUBLIC_HOSTS` / `XIAODAN_LICENSE_TRUST_PROXY` | 反向代理部署时的 Host 白名单与限流分桶 |

商城侧需要 `PARTNER_API_KEY`（同值）与 `PARTNER_NOTIFY_ALLOWED_HOSTS`（允许回调的主机名）。
缺套餐、加密密钥或商城配置时禁用下单，客户端看到“套餐购买尚未开放”。

网页版和桌面端都接入小丹科研AI商城的账号登录。登录后 `/api/keyShop/*` 走商城账号维度
（订单归属 `mall-<商城用户ID>`，经商城的 `/api/drama/recharge|status|orders|reveal`），
未登录时回落到设备许可维度。两条链路共用同一套订单表与交付流程。

部署位置、密钥轮换、备份恢复与故障排查见 [授权服务部署与运维手册](licenseServerDeployment.md)。

`XIAODAN_KEY_ENCRYPTION_KEY` 由密钥管理工具生成、注入并离线备份，禁止放入客户端、Git 或聊天。
Key 使用 AES-256-GCM 加密，订单编号绑定到认证附加数据；丢失或更换此密钥会导致历史 Key 无法解密，当前不提供自动轮换。

## 开通套餐

服务器数据目录创建 `keyPackages.json`，内容为 JSON 数组，每项包含：

| 字段 | 含义 |
| --- | --- |
| id | 唯一套餐编号，1–32 个**英文字母或数字**（不能含连字符） |
| label | 套餐名称，最多 80 字 |
| priceFen | 实际售价，人民币整数分，1–10000000 |
| creditFen | 交付 Key 的承诺额度，人民币整数分 |
| description | 有效期、服务范围、交付时间和其他套餐说明，最多 500 字 |

下单时从服务端套餐目录锁定金额和说明，客户端不能指定支付金额；商城也按授权服务传来的金额收款，
回调核销时同时校验渠道与金额。仓库不预填套餐或价格。

## 管理员交付

```sh
bun run --cwd apps/licenseServer manage keyOrders                                    # 查看订单与状态
bun run --cwd apps/licenseServer manage deliverKey <订单ID> <私有Key文件路径>          # 首次交付
bun run --cwd apps/licenseServer manage redeliverKey <订单ID> <私有Key文件路径>        # 补发（换新 Key）
bun run --cwd apps/licenseServer manage refundKeyOrder <订单ID>                      # 退款作废
```

先在 TF-Router 创建仅供该用户使用的、额度与套餐相符的 Key。不得使用经营者主 Key、无限额 Key 或把同一个 Key 交给多个用户。请核对 Key 的权限、额度和有效期；程序没有上游接口核实这些信息。

将 Key 写入权限 600 的私有文件，文件中仅包含 Key，再运行交付命令。命令不会打印 Key，只允许交付已付款订单；相同 Key 同一订单重复交付幂等。**普通 `deliverKey` 不允许覆盖已交付订单**；需要替换时必须显式使用 `redeliverKey`（用于客户 Key 泄露或丢失），数据库仍防止跨订单重复使用同一个 Key。安全删除临时文件，日志中不记录 Key。

### 作废与补发

退款功能当前**未实现**（商城侧没有退款入口），因此作废与补发都是管理员手工执行的运维动作：

- `refundKeyOrder <订单ID>`：作废该订单的 Key。清空密文后**任何人都无法再领取**，订单状态变为 `refunded`。适用于你在支付渠道完成退款、赠品作废等场景。
- `redeliverKey <订单ID> <路径>`：用新 Key 覆盖已交付的旧 Key（客户 Key 泄露或丢失时）。

作废只影响本地密文 —— **上游（TF-Router）的 Key 必须由人工另行吊销**，否则旧 Key 仍然可用。补发同样需要人工先在 TF-Router 建好新 Key，再用 `redeliverKey` 覆盖；请记得吊销被替换掉的旧 Key。

两条命令都只接受商城充值订单（`mall-` 前缀许可）；真实激活码订单会被拒绝，避免误伤正常售出的许可。

用户在“购买 API Key”刷新订单并点击“领取 Key”，复制到对应服务商的模型设置。列表仅显示脱敏 Key，关闭面板清除页面中已领取的明文。领取记录写入审计事件；持有同一软件许可的已绑定设备共享订单。已退款订单点击领取会提示“订单已退款，Key 已作废”。

## 部署位置

| 项 | 值 |
| --- | --- |
| 授权服务 | `https://www.xiaodukeji.online/license` → nginx → `127.0.0.1:8092` |
| 单元 / 用户 | `xiaodan-license.service` / `xdlicense` |
| 数据目录 | `/var/lib/xiaodan-license` |
| 配置 | `/etc/xiaodan-license.env`、`/etc/xiaodan-license/` |

## 发布前条件

- **正式商户号已配置（2026-10-16）**：`QIXIANG_PID=4266`，密钥已由经营者取回并通过 `scripts/merchant.mjs` 校验写入。七相PAY「查询商户信息」实测：账号 `active=1`（正常未封禁）、手续费余额充足、密钥回显与配置一致。早期故障原因是 PID 与 KEY 不匹配（返回「商户密钥错误」），**与账号封禁、余额无关**。密钥需重置时到 [七相PAY 商户中心](https://qixiangpay.cn/user/login.php) 查看或重置（官方文档明确「疑似泄露请立即重置」；旧密钥已失效，重置一个全新的等效）。
  - 切换务必用工具，不要手改：`cd /home/codes/xiaodan-market && node scripts/merchant.mjs check` 先看当前状态，再用 `node scripts/merchant.mjs apply --pid <PID> --key <KEY> --restart` 切换。该工具会**先向七相PAY 校验密钥、通过才写入**（校验走查单接口，不会产生废弃订单），密钥填错会被直接拒绝且不改动 `.env`。
  - 已加保护：只要商户号被识别为测试号（`QIXIANG_SANDBOX_PIDS`，默认 `1003`；设为空字符串可关闭），**真实用户 (`role=user`) 的所有在线支付都会被拒绝**——覆盖普通商品下单、重新发起支付、确认支付结果、漫剧充值，以及七相PAY 回调核销兜底（回 200 但不入账）；只有 `admin`／`test` 账号能继续联调，换成正式商户号后保护自动失效。`GET /api/payments/config` 的 `sandboxMerchant` 字段会暴露当前是否处于测试号状态。理由：测试号收款不会真正到账，却会把订单标记为已付款，导致白送商品或 API Key。
- **真实扫码付款已由人工完成验证（2026-10-16）**：以真实用户（`role=user`）下单 ¥1 → 手机扫码实付 → 七相PAY 回调验签通过 → 订单置 `paid`／`completed` → `deliveries` 表同秒生成 48 位交付令牌 → 交付页用正确令牌返回 200、错误令牌 403。七相PAY 侧同步确认 `status=1` 已支付，商户累计订单 +1、手续费余额扣减 ¥0.01（¥1 的 1.2% 平台费）——**资金真实流动，全链路闭环**。
- 此前用测试账号完成的模拟回调验证仍然有效：商城下单 → 七相PAY 返回收银台 → 模拟 MD5 验签回调 → 商城核销合作方订单 → HMAC 通知授权服务 → 订单 `paid`。
- **退款功能未实现**：管理后台没有任何退款入口。七相PAY 的退款接口需在商户后台单独开启，且退款款只能来自当天未结算的款项，涉及资金安全与对账，暂不提供。管理后台只提供「关闭未付款订单」（`paid` 订单会被拒绝，避免账实不符）；已付款订单如需退款，必须在支付渠道人工操作，再与买家协商处理。
- **上游 Key 吊销/补发仍需人工**：授权服务提供 `refundKeyOrder`（作废该订单的 Key）与 `redeliverKey`（换发新 Key）两条运维命令，但 TF-Router 上的 API Key 必须由人工另行吊销/新建，程序没有上游接口。
- 交付时限与客户支持流程（响应时效、纠纷处理、退款政策）仍需经营者确定并写入对外条款。
- 商城侧共享密钥泄露等于可任意下单；密钥只在服务器 `.env` 保存，需要定期轮换并同时更新两端。
- 正式发布前按商用审查清单完成签名、凭证存储与依赖复验。

参考：[七相PAY 接入（商城侧）](https://github.com/ZSCDumin/xiaodan-market)、[微信 Native](https://pay.wechatpay.cn/doc/v3/merchant/4012791877)、[支付宝开放平台](https://opendocs.alipay.com/open)。
