// ACT: 固定的正式服务地址与公钥；不接受页面提供的信任根。
// 服务端为 apps/licenseServer，部署在 https://www.xiaodukeji.online/license（nginx 转发到本机 8092）。
// 更换服务端私钥后必须同步替换 publicKey 并重新打包客户端，否则验签失败。
export const licenseConfig = {
  serviceUrl: "https://www.xiaodukeji.online/license",
  publicKey: "-----BEGIN PUBLIC KEY-----\nMCowBQYDK2VwAyEAwblkosms4xBtLzXcyZoIBe4BRcbkD22TzWXMh9Puv18=\n-----END PUBLIC KEY-----\n",
};
