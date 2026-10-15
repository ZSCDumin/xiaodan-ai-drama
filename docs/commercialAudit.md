# 小丹AI漫剧商用检查报告

版本：2.0.2；日期：2026-10-15。

## 结论

当前版本可继续内部验收，尚不满足正式收费发布条件。品牌定制和构建通过不等于商业授权、安全、许可和签名验收完成。

销售模式：订阅或激活码授权，用户自行配置模型 API Key（BYOK）。已新增本地授权服务，尚未部署公网、接入 APP 或实现支付系统。

## 已修复

- 清理界面的 TF-Router、账号充值、云端市场、GitHub/Star/仓库跳转。保留本地插件管理、通用模型接入、FFmpeg 管理和更新能力。
- 新安装不再加入 TF-Router。旧配置保留在本机私有 retiredProviders 中，旧脚本移出活动目录，其他模型和项目保留。
- 关于页显示小丹AI漫剧品牌及离线许可。保留原作者合法版权通知。
- 独立服务主端口只监听 127.0.0.1，校验 Host，拒绝不同源浏览器 Origin。设备互联另用令牌鉴权入口。
- MCP client、proxy-addr、source-map-js、DOMPurify、fast-uri、undici 升级到兼容主版本内的修复版本，记录在根 package.json overrides。

## 收费发布前必须解决

| 优先级 | 问题及证据 | 需要完成的工作 |
| --- | --- | --- |
| P0 | 已有本地授权服务，尚无 APP 激活、功能门控与支付闭环 | 接入客户端验签、到期和离线流程，完成部署与业务验收；详见 apps/licenseServer/readme.md |
| P0 | apps/mobile/native/build.gradle.kts 的 release 使用公开 defaultSigning.keystore 和默认密码 | 改用独立保管的正式密钥，经 CI Secret 注入；先制定旧安装升级与数据迁移方案 |
| P1 | apps/server/src/utils/conf/index.ts 的配置权限虽为 0600，模型 Key 仍明文落盘 | 接入各系统密钥库，迁移旧 Key，核对备份、导出与日志脱敏 |
| P1 | 私有 GitHub 仓库充当更新来源，普通客户下载不可依赖开发者账号；签名链未齐备 | 配置客户更新分发、完整性校验、Apple Developer ID/公证及 Windows 代码签名 |
| P1 | lamejs 为 LGPL-3.0，FFmpeg、GeckoView、Bun/JSC 等有独立许可 | 核对实际分发二进制、源码与替换义务，生成完整第三方通知包 |
| P1 | 依赖仍有 9 条公告版本匹配，包含高危级别 | 继续定位调用链、兼容升级或证明不可达性，不能视为安全扫描通过 |
| P1 | 本地插件/供应商可执行代码，node:vm/SourceTextModule 不构成可靠安全边界 | 限定可信扩展，说明能力，按需进程隔离、签名验证，不能宣传为安全沙箱 |
| P1 | 尚无按实际经营主体和销售地区确定的订阅协议、隐私、退款与取消流程 | 明确软件费与模型费、输出权利及数据责任，正式条款需专业复核 |

P0 表示收费发布阻断，P1 表示发布前需处置的重要风险。本报告不是法律认证或完整渗透测试。

## 建议授权架构

- 服务端签发和撤销授权，管理订阅与设备数量。私钥仅放服务端，客户端仅内置验签公钥。
- 签名授权包含产品、许可编号、期限、功能和设备绑定。离线宽限、换机及退款规则需与实际销售方案一致。
- 模型 Key 保存在用户设备，发给用户选定的模型服务；授权服务无需收集模型 Key 或项目。
- 到期仍保留查看、备份和导出已有项目的能力，按约定限制新增收费功能。客户端可被修改，单纯本地布尔值不能形成可靠商业授权。
- 支付回调需验签、幂等并留必要审计记录。当前本地授权服务已实现签发、刷新、续期和撤销，支付组件尚未实现。

## 依赖检查

使用官方 npm bulk advisory API 匹配当前锁文件版本。bun audit 注册表端点返回 404，未将它当成无漏洞结论。

- 盘点 902 个活动依赖版本，包含开发依赖，并非最终安装包完整 SBOM。
- 初始 25 条公告匹配，经 6 个包升级后剩余 9 条，涉及 brace-expansion 1.1.18/5.0.9、braces 3.0.3、decode-uri-component 0.2.2、katex 0.16.47。
- 9 是公告匹配数，不是 9 个已证实可利用漏洞。尚未完成各平台运行时可达性分析，不能全部归为开发依赖或忽略。
- dependencyAudit.json 保存公告链接、版本、等级和范围；dependencyLicenses.json 是元数据许可清单。部分包缺少 license 字段，但实际 LICENSE 是 MIT；元数据不足不代表无授权。
- 未跨主版本强制替换旧 CJS 等依赖，剩余项仍是未完成工作。

## 版权与分发边界

MIT 允许商业使用和销售，要求保留版权与许可通知。品牌和新增定制可归 ZSCDumin，上游与第三方代码不能声称为小丹独占版权。当前根 LICENSE 为 MIT，分发此代码也会授予相应权利；专有新增模块和 EULA 需另确定分层授权方案并保留原许可义务。

apps/server/src/utils/media/audioProcessor.ts 使用 @breezystack/lamejs 1.2.7（LGPL-3.0）。FFmpeg 的实际编译配置、分发源码及通知，Mozilla MPL 组件等需要分别核对。只附根 MIT 不覆盖全部组件。BYOK 也不保证所有模型输出均有同样的商用权利，仍需核对具体模型条款与输入素材权利。

官方参考：

- [MIT 许可](https://opensource.org/license/mit)
- [FFmpeg 法律说明](https://www.ffmpeg.org/legal.html)
- [FFmpeg 许可组成](https://ffmpeg.org/doxygen/trunk/md_LICENSE.html)
- [ffmpeg-static 仓库](https://github.com/eugeneware/ffmpeg-static)
- [Mozilla MPL FAQ](https://www.mozilla.org/en-US/MPL/2.0/FAQ/)

## 验证范围

前后端生产构建与类型检查通过。使用临时数据检查首页、模型设置、插件管理、关于页及 HTTP Host/Origin 拒绝行为。未发起真实付费模型调用，未验收支付闭环、Android ARM 真机或正式签名公证。

Android 包名 com.toonflow.mobile、内部 @toonflow 包名、协议和文件标记为旧安装兼容保留，独立商业包名应另做迁移。合法署名不属于品牌残留。

本轮扫描未发现已提交的真实模型 Key，但不能保证历史提交、CI Secret 或所有外部环境无泄露。公开 Android 默认签名密钥已列为阻断项。
