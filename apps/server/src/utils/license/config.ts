// ACT: 固定的本机联调配置；正式发布前替换为自有 HTTPS 地址和对应公钥，不接受页面提供的信任根。
export const licenseConfig = {
  serviceUrl: "http://127.0.0.1:8092",
  publicKey: "-----BEGIN PUBLIC KEY-----\nMCowBQYDK2VwAyEASxwyzJArvuzQixTF4wD20kazrdN9+eEtKV0UyVJECWU=\n-----END PUBLIC KEY-----\n",
};
