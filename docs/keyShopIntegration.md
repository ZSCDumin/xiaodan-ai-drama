# API Key 套餐购买与交付

版本：2.0.4，日期：2026-10-15。本地开发功能，尚未开放真实收款。

## 当前业务规则

根据经营者最新确认，采用购买额度套餐后交付独立 API Key 的模式。原自建钱包、按请求实际成本乘 1.2 扣费的开发方案已停止并移除。API 用量与额度由 TF-Router 处理；APP 不伪造余额，不按估算 Token 再收费。用户也可自行购买 Key，在模型设置中使用。

第一版由管理员在上游创建独立、有对应额度限制的 Key，核对后手动交付。没有接入 TF-Router 自动创建 Key 的接口，也没有自动向已交付 Key 续充额度。软件授权与 Key 套餐是两类商品，Key 额度不会自动延长软件授权。

## 开通套餐

服务器数据目录（默认 data/licenseServer）创建 keyPackages.json，内容为 JSON 数组，每项包含：

| 字段 | 含义 |
| --- | --- |
| id | 唯一套餐编号，1–32 个英文字母或数字 |
| label | 套餐名称，最多 80 字 |
| priceFen | 实际售价，人民币整数分，1–10000000 |
| creditFen | 交付 Key 的承诺额度，人民币整数分 |
| description | 有效期、服务范围、交付时间和其他套餐说明，最多 500 字 |

没有预填套餐或价格。原 1.2 倍比例可以用于经营者制定套餐售价，程序不会擅自生成售价。下单时从服务端套餐目录锁定金额和说明，客户端不能指定支付金额。请确认 API Key 转售权限和上游额度单位，按实际可交付的额度上架。

设置服务器环境变量 XIAODAN_KEY_ENCRYPTION_KEY，值为 64 个十六进制字符（32 字节随机密钥）。请由密钥管理工具生成、注入并离线备份，禁止放入客户端、Git 或聊天。Key 使用 AES-256-GCM 加密，订单编号绑定到认证附加数据；丢失或更换此密钥会导致历史 Key 无法解密，当前不提供自动轮换。

缺套餐、加密密钥或商户配置时禁用下单。

## 支付配置

仅服务器配置 XIAODAN_PAYMENT_PUBLIC_URL，必须是公网 HTTPS 地址。服务默认仅监听 127.0.0.1:8092，需要反向代理；代理转发本机 Host，保留微信原始通知字节与签名头，不转发浏览器 Origin。

微信 Native：WECHAT_APP_ID、WECHAT_MCH_ID、WECHAT_MCH_SERIAL、WECHAT_PRIVATE_KEY_PATH、WECHAT_PAY_PUBLIC_KEY_ID、WECHAT_PAY_PUBLIC_KEY_PATH、WECHAT_API_V3_KEY（32 字节）。使用微信支付公钥模式，轮换时同步更新公钥 ID 和文件。

支付宝：ALIPAY_APP_ID、ALIPAY_SELLER_ID、ALIPAY_PRIVATE_KEY_PATH（PKCS8）、ALIPAY_PUBLIC_KEY_PATH。使用普通公钥模式，尚未接入证书模式。

私钥文件权限限制为仅运行账号可读，关闭 SDK 调试日志。通知地址为 /v1/payments/wechat/notify 和 /v1/payments/alipay/notify。验签、商户、订单、金额均匹配才标记付款；重复同笔通知不会重复入账。客户端主动查询也通过支付平台核实，不信任页面自报成功。

订单状态：pending 待支付 → paid 已付款待交付 → delivered 已交付。付款不会生成虚假 API Key，也不会增加 APP 钱包余额。

## 管理员交付

```sh
bun run --cwd apps/licenseServer manage keyOrders
bun run --cwd apps/licenseServer manage deliverKey <订单ID> <私有Key文件路径>
```

先在 TF-Router 创建仅供该用户使用的、额度与套餐相符的 Key。不得使用经营者主 Key、无限额 Key 或把同一个 Key 交给多个用户。请核对 Key 的权限、额度和有效期；程序没有上游接口核实这些信息。

将 Key 写入权限 600 的私有文件，文件中仅包含 Key，再运行交付命令。命令不会打印 Key，只允许交付已付款订单；相同 Key 同一订单重复交付幂等，禁止覆盖已交付 Key，数据库防止跨订单重复使用同一个 Key。安全删除临时文件，日志中不记录 Key。

用户在“购买 API Key”刷新订单并点击“领取 Key”，复制到对应服务商的模型设置。列表仅显示脱敏 Key，关闭面板清除页面中已领取的明文。领取记录写入审计事件；持有同一软件许可的已绑定设备共享订单。用户解绑定后需重新激活该许可才可访问订单，不能将激活码当作公开共享账号。

## 发布前条件

- 尚无商户真实配置，未验证真实下单、支付通知、付款查单或真实 Key 交付使用。
- 退款、关闭未付款订单、上游 Key 撤销/补发、交付时限和客户支持流程仍需经营者确定并接入，当前没有自动退款接口。
- 正式部署前更换客户端固定的本地授权服务地址为 HTTPS，保管授权签名密钥、支付私钥和 Key 加密密钥。
- 本轮新增支付宝官方 SDK，之前的依赖盘点不能作为本版本完整复验。现有商用审查中的签名、凭证存储等事项仍需完成。

参考：[支付宝官方 SDK](https://github.com/alipay/alipay-sdk-nodejs-all)、[微信 Native](https://pay.wechatpay.cn/doc/v3/merchant/4012791877)、[微信验签](https://pay.wechatpay.cn/doc/v3/merchant/4013053420)。

## 本轮验证记录

授权服务、APP 服务端和前端的现有类型检查、生产构建已执行通过。使用隔离的 APP 数据目录读取套餐及订单，返回空目录、空订单和关闭的支付渠道；未配置下单被拒绝，管理员订单查询为空，没有产生支付记录。无应用来源凭证的访问被拒绝。浏览器已确认购买面板和未开放提示，预览见 images/keyShopPanel.png。

以上不包含真实支付、真实 Key 交付或真实模型扣费验收。
