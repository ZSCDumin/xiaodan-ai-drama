// Key 交付 / 补发 / 退款作废的回归测试。
// 全程只使用临时数据目录，不接触生产库；运行：bun test src/keyShop.test.ts
import { expect, test } from "bun:test";
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// store.ts 在模块加载时就确定数据目录，必须先设好环境变量再动态导入。
const directory = mkdtempSync(join(tmpdir(), "xd-keyshop-"));
process.env.XIAODAN_LICENSE_DATA_DIR = directory;
process.env.XIAODAN_KEY_ENCRYPTION_KEY = "a".repeat(64);

const { initialize, openStore } = await import("./store");
const { createKeyShop } = await import("./keyShop");

writeFileSync(join(directory, "keyPackages.json"), JSON.stringify([
  { id: "recharge100", label: "API 额度 100 元", priceFen: 10000, creditFen: 10000, description: "测试套餐" }
]));
initialize();
const store = openStore();
const shop = createKeyShop(store);

const keyFile = join(directory, "key.txt");
const writeKey = (content: string) => { writeFileSync(keyFile, content); chmodSync(keyFile, 0o600); };
const paidMallOrder = (mallUserId: string, requestId: string, tradeId: string) => {
  const order = shop.mallOrder(mallUserId, requestId, "recharge100", "alipay");
  shop.paid({ orderId: order.id, channel: "alipay", tradeId, amountFen: 10000 });
  return order;
};

test("交付后可领取，密文加密存储且明文不落库", () => {
  const order = paidMallOrder("80", "11111111-1111-4111-8111-111111111111", "T-deliver");
  writeKey("sk-first-key-0123456789");
  shop.deliver(order.id, keyFile);
  expect(shop.get(order.id).state).toBe("delivered");
  expect(shop.reveal(order.id, "mall-80").apiKey).toBe("sk-first-key-0123456789");
  expect(shop.get(order.id).encryptedKey).not.toContain("sk-first");
});

test("补发会用新 Key 覆盖旧 Key", () => {
  const order = paidMallOrder("81", "22222222-2222-4222-8222-222222222222", "T-redeliver");
  writeKey("sk-old-key-0123456789");
  shop.deliver(order.id, keyFile);
  writeKey("sk-new-key-9876543210");
  shop.redeliver(order.id, keyFile);
  expect(shop.get(order.id).state).toBe("delivered");
  expect(shop.reveal(order.id, "mall-81").apiKey).toBe("sk-new-key-9876543210");
});

test("退款作废 Key：清空密文、不能再领取或补发，并留审计记录", () => {
  const order = paidMallOrder("82", "33333333-3333-4333-8333-333333333333", "T-refund");
  writeKey("sk-refund-target-key-01");
  shop.deliver(order.id, keyFile);

  expect(shop.refund(order.id).state).toBe("refunded");
  expect(shop.get(order.id).encryptedKey).toBeNull();
  expect(shop.get(order.id).maskedKey).toBeNull();
  expect(() => shop.reveal(order.id, "mall-82")).toThrow(/已退款|已作废/);
  expect(() => { writeKey("sk-after-refund-key-01"); shop.redeliver(order.id, keyFile); }).toThrow(/仅允许/);
  expect(shop.refund(order.id).state).toBe("refunded"); // 幂等

  const actions = store.db.query<{ action: string }, [string]>("SELECT action FROM events WHERE licenseId = ?").all("mall-82").map(row => row.action);
  expect(actions.some(action => action.startsWith("keyOrderRefunded:"))).toBe(true);
  expect(actions.some(action => action.startsWith("keyDelivered:"))).toBe(true);
});

test("真实激活码订单不能通过商城退款路径作废", () => {
  store.db.query("INSERT INTO licenses (id,codeHash,plan,createdAt,expiresAt,maxDevices) VALUES (?,?,?,?,?,?)")
    .run("11111111-2222-4333-8444-555555555555", "deadbeef".repeat(8), "standard", Date.now(), Date.now() + 86400000, 1);
  const order = shop.order("11111111-2222-4333-8444-555555555555", "44444444-4444-4444-8444-444444444444", "recharge100", "alipay");
  shop.paid({ orderId: order.id, channel: "alipay", tradeId: "T-direct", amountFen: 10000 });
  writeKey("sk-direct-license-key-1234");
  shop.deliver(order.id, keyFile);

  expect(() => shop.refund(order.id)).toThrow(/不属于商城充值/);
  expect(shop.get(order.id).state).toBe("delivered");
});

test("未付款订单不能交付 Key", () => {
  const order = shop.mallOrder("83", "55555555-5555-4555-8555-555555555555", "recharge100", "alipay");
  writeKey("sk-unpaid-key-00000000");
  expect(() => shop.deliver(order.id, keyFile)).toThrow(/仅允许交付已付款/);
});

test("Key 文件必须是权限 600 的私有文件", () => {
  const order = paidMallOrder("84", "66666666-6666-4666-8666-666666666666", "T-perm");
  writeFileSync(keyFile, "sk-too-open-key-0000");
  chmodSync(keyFile, 0o644);
  expect(() => shop.deliver(order.id, keyFile)).toThrow(/私有文件/);
});

process.on("exit", () => rmSync(directory, { recursive: true, force: true }));
