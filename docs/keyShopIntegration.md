# API Key 套餐购买与交付

版本：2.0.4，日期：2026-10-15。收款已接入「小丹科研AI商城」，尚未完成真实付款验收。

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

## 授权服务环境变量

| 变量 | 说明 |
| --- | --- |
| `XIAODAN_MALL_BASE_URL` | 商城地址，必须 HTTPS，例如 `https://www.xiaodukeji.online` |
| `XIAODAN_MALL_PARTNER_KEY` | 与商城共享的 HMAC 密钥，至少 32 位；与商城的 `PARTNER_API_KEY` 相同 |
| `XIAODAN_PAYMENT_PUBLIC_URL` | 本服务的 HTTPS 地址，用于生成商城回调地址，例如 `https://www.xiaodukeji.online/license` |
| `XIAODAN_KEY_ENCRYPTION_KEY` | 64 个十六进制字符（32 字节），AES-256-GCM 加密交付的 Key |
| `XIAODAN_LICENSE_DATA_DIR` / `XIAODAN_LICENSE_PORT` | 数据目录与端口 |
| `XIAODAN_LICENSE_PUBLIC_HOSTS` / `XIAODAN_LICENSE_TRUST_PROXY` | 反向代理部署时的 Host 白名单与限流分桶 |

商城侧需要 `PARTNER_API_KEY`（同值）与 `PARTNER_NOTIFY_ALLOWED_HOSTS`（允许回调的主机名）。
缺套餐、加密密钥或商城配置时禁用下单，客户端看到“套餐购买尚未开放”。

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
bun run --cwd apps/licenseServer manage keyOrders
bun run --cwd apps/licenseServer manage deliverKey <订单ID> <私有Key文件路径>
```

先在 TF-Router 创建仅供该用户使用的、额度与套餐相符的 Key。不得使用经营者主 Key、无限额 Key 或把同一个 Key 交给多个用户。请核对 Key 的权限、额度和有效期；程序没有上游接口核实这些信息。

将 Key 写入权限 600 的私有文件，文件中仅包含 Key，再运行交付命令。命令不会打印 Key，只允许交付已付款订单；相同 Key 同一订单重复交付幂等，禁止覆盖已交付 Key，数据库防止跨订单重复使用同一个 Key。安全删除临时文件，日志中不记录 Key。

用户在“购买 API Key”刷新订单并点击“领取 Key”，复制到对应服务商的模型设置。列表仅显示脱敏 Key，关闭面板清除页面中已领取的明文。领取记录写入审计事件；持有同一软件许可的已绑定设备共享订单。

## 部署位置

| 项 | 值 |
| --- | --- |
| 授权服务 | `https://www.xiaodukeji.online/license` → nginx → `127.0.0.1:8092` |
| 单元 / 用户 | `xiaodan-license.service` / `xdlicense` |
| 数据目录 | `/var/lib/xiaodan-license` |
| 配置 | `/etc/xiaodan-license.env`、`/etc/xiaodan-license/` |

## 发布前条件

- 真实付款尚未走过一遍：本次只验证了签名下单拿到七相PAY 收银台地址，以及模拟支付成功后的回调核销。
- 退款、关闭未付款订单、上游 Key 撤销/补发、交付时限和客户支持流程仍需经营者确定并接入，当前没有自动退款接口。
- 商城侧共享密钥泄露等于可任意下单；密钥只在服务器 `.env` 保存，需要定期轮换并同时更新两端。
- 正式发布前按商用审查清单完成签名、凭证存储与依赖复验。

参考：[七相PAY 接入（商城侧）](https://github.com/ZSCDumin/xiaodan-market)、[微信 Native](https://pay.wechatpay.cn/doc/v3/merchant/4012791877)、[支付宝开放平台](https://opendocs.alipay.com/open)。
