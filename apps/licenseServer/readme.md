# 小丹AI漫剧本地授权服务

独立的 Bun + Express + SQLite 服务，支持激活码、设备数量限制、签名租约、续期与撤销。管理员通过本机命令操作，没有远程管理接口，不接收模型 API Key、项目或支付信息。

## 启动

安装项目依赖后，在仓库根目录执行：

```sh
bun run --cwd apps/licenseServer manage init
bun run --cwd apps/licenseServer start
```

默认地址 `http://127.0.0.1:8092`，数据位于已被 Git 忽略的 `data/licenseServer/`。init 只执行一次，重复执行报错并保留原私钥；后续直接 start。禁止删除私钥后重新初始化。

环境变量 `XIAODAN_LICENSE_DATA_DIR` 可指定绝对数据目录，`XIAODAN_LICENSE_PORT` 可指定端口。管理命令和服务必须使用同一目录。`bun run --cwd apps/licenseServer build` 输出 `build/licenseServer/index.js`，部署时应显式设置数据目录。

## 公网部署

APP 的本地服务在客户机器上运行，因此授权服务必须能从公网 HTTPS 访问。当前线上部署：

| 项 | 值 |
| --- | --- |
| 公网地址 | `https://www.xiaodukeji.online/license`（nginx 转发到 `127.0.0.1:8092`，并剥掉 `/license` 前缀） |
| systemd 单元 | `xiaodan-license.service`，专用系统用户 `xdlicense` |
| 数据目录 | `/var/lib/xiaodan-license`（0700，私钥与数据库 0600） |
| 配置文件 | `/etc/xiaodan-license.env`（0600，含商城共享密钥） |
| 密钥目录 | `/etc/xiaodan-license/`（`partner.key` 合作方共享密钥、`encryption.key` Key 交付加密密钥） |

反向代理部署新增两个环境变量：`XIAODAN_LICENSE_PUBLIC_HOSTS`（允许的 Host，英文逗号分隔）和
`XIAODAN_LICENSE_TRUST_PROXY=1`（按 `X-Forwarded-For` 而不是代理地址做限流分桶；不设置时
所有请求会被算作同一个来源，30 次/分钟的限流会误伤全部用户）。仍拒绝带浏览器 Origin 的请求。

## 管理

```sh
# 有效 30 天、最多 2 台设备、standard 方案；期限从签发时计算
bun run --cwd apps/licenseServer manage issue 30 2 standard
bun run --cwd apps/licenseServer manage list
bun run --cwd apps/licenseServer manage renew <许可ID> 30
bun run --cwd apps/licenseServer manage devices <许可ID>
bun run --cwd apps/licenseServer manage releaseDevice <许可ID> <设备ID>
bun run --cwd apps/licenseServer manage revoke <许可ID>
bun run --cwd apps/licenseServer manage publicKey
```

激活码使用随机 192 位值，仅签发时显示明文，数据库只存 SHA-256 哈希。安全交付，不要放入公开日志或截图。list 返回最近 200 个许可，不显示激活码或设备密钥。方案名仅支持 1–32 个字母或数字，目前是标签，尚未绑定客户端功能。

续期从原到期日和当前时间的较晚者增加天数；已撤销许可不能续期恢复。换许可时需先释放旧登记或使用独立设备凭证。

## HTTP 契约

响应格式 `{ code, data, message }`，HTTP 状态码同步表示成功与错误。

| 方法和路径 | 请求 / 返回 |
| --- | --- |
| GET /health | 服务状态 |
| GET /v1/publicKey | 公钥 keyId 与 PEM，仅供分发配置参考 |
| POST /v1/activate | `{ code, deviceId, deviceSecret }` → 签名租约 |
| POST /v1/refresh | `{ deviceId, deviceSecret }` → 签名租约 |
| POST /v1/deactivate | `{ deviceId, deviceSecret }` → 释放名额 |
| POST /v1/keyShop/status | `{ deviceId, deviceSecret }` → 套餐目录、可用收款渠道与订单列表 |
| POST /v1/keyShop/order | `{ requestId, channel, packageId, credentials }` → 订单与商城支付地址 |
| POST /v1/keyShop/orderStatus | `{ orderId, credentials }` → 主动查单后的订单状态 |
| POST /v1/keyShop/reveal | `{ orderId, credentials }` → 已交付的 API Key 明文 |
| POST /v1/payments/mall/notify | 商城支付成功回调；HMAC 验签后核销订单 |

deviceId 是客户端安装时生成并持久化的 UUID；deviceSecret 是安全随机 32 字节的 base64url 字符串（43 个字符），应存入系统密钥库。不要使用固定示例值或硬件序列号。相同 ID 与密钥重复激活不额外占名额，只有 ID 不能覆盖已有设备。服务器只保存密钥哈希。

凭证只放 JSON 请求体，不放 URL，日志不得记录请求体。每个 socket 地址每分钟最多 30 次 POST，不信任转发 IP；部署反向代理后需另明确限流策略。

签名租约格式 `{ keyId, payload, signature }`：

- payload 是 JSON 的 base64url 编码；Ed25519 对 **payload 编码字符串的 UTF-8 字节** 签名，signature 采用 base64url 编码。不能先解码 payload 再验签。
- JSON 包含 type、version、product、licenseId、deviceId、plan、revision、issuedAt、subscriptionExpiresAt、leaseExpiresAt，时间单位为 Unix 毫秒。
- 客户端必须使用可信安装包内固定公钥验签，核对产品、类型、版本、设备、有效期及时间回退。不能从同一不可信响应下载公钥就当作信任根，也不能只解码 JSON。
- 最长离线租约 24 小时，且不超过订阅期限。撤销/释放设备在下次刷新或租约到期后生效，不能即时废除已经签名的离线租约。
- 软件可被修改，安装凭证也可能被复制，不能宣传为不可破解或硬件级绑定。

未来客户端应定期刷新，到期保留查看、备份与导出已有项目能力。

## 私钥与备份

signingPrivate.pem 只放授权服务器，禁止提交仓库、打入桌面/APK、发送客户或写入日志。公钥可公开。数据库含设备凭证哈希和操作事件，也不可公开。

目录 0700、私钥与数据库 0600，进程 umask 077。Windows 仍需独立服务账号和 NTFS ACL，POSIX 权限不能替代 Windows 权限管理。

停止服务后完整复制数据目录（包括仍存在的 SQLite WAL/SHM 文件），备份原私钥并演练恢复。不要在运行中只复制主数据库。私钥轮换需要配套客户端公钥迁移，本版本未实现轮换。

## 本轮验证与交付边界

临时目录中的真实 HTTP 调用已验证激活、重复激活、设备上限、错误凭证、刷新、非法输入、签名与篡改、续期及撤销后拒绝刷新。类型检查与构建通过。

2.0.3 已接入 APP 软件授权面板、客户端验签和 AI 创作入口校验。2.0.4 已完成公网部署，并把
API Key 套餐收款改为调用「小丹科研AI商城」的合作方支付接口（详见 docs/keyShopIntegration.md）。
用户自助账户、退款与上游 Key 自动续充仍未实现，未完成正式生产验收，因此还不是可以直接售卖的完整订阅产品。

APP 的固定服务地址与公钥位于 apps/server/src/utils/license/config.ts，当前只用于本机联调。正式部署时需改为自有 HTTPS 服务与相应公钥后重新构建；不能让用户在页面替换信任根。客户端设备凭证目前与应用私有配置一同保存在权限为 0600 的文件中，尚未接入系统密钥库，是商用发布前的剩余工作。

实现参考：[Bun SQLite](https://bun.com/docs/runtime/sqlite)、[Node.js Crypto](https://nodejs.org/api/crypto.html)。
