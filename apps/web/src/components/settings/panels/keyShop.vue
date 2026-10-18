<template>
  <div class="keyShopPanel" v-loading="loading">
    <header><h3>购买 API Key</h3><el-button :disabled="loading || busy" @click="load">刷新订单</el-button></header>
    <p>购买额度套餐，付款后由管理员交付独立 API Key。使用费用由模型服务商从该 Key 的额度中扣除。也可以自行购买 Key，在模型设置中配置。</p>
    <el-alert v-if="status && !status.channels.wechat && !status.channels.alipay" title="套餐购买暂未开放，请联系管理员。已有 Key 可直接在模型设置中使用。" type="info" :closable="false" />
    <section v-for="item in status?.packages" :key="item.id" class="packageCard">
      <h4>{{ item.label }}</h4><p>{{ item.description }}</p>
      <div>API 额度 ¥{{ money(item.creditFen) }} · 售价 ¥{{ money(item.priceFen) }}</div>
      <div class="actions"><el-button :disabled="busy || !status?.channels.wechat" @click="buy(item.id, 'wechat')">微信支付</el-button><el-button :disabled="busy || !status?.channels.alipay" @click="buy(item.id, 'alipay')">支付宝</el-button></div>
    </section>
    <section v-if="checkout?.qrCode && checkout.state === 'pending'" class="checkout">
      <QRCode :value="checkout.qrCode" :size="200" />
      <p>请使用{{ checkout.channel === 'wechat' ? '微信' : '支付宝' }}扫码支付 ¥{{ money(checkout.amountFen) }}</p>
      <p>付款后等待管理员交付 Key。请勿重复付款。</p>
      <div class="actions">
        <el-button :disabled="busy" @click="check(checkout.orderId)">查询付款结果</el-button>
        <el-link type="primary" :href="checkout.qrCode" target="_blank" rel="noopener noreferrer">在新窗口打开支付页面</el-link>
      </div>
    </section>
    <p v-if="message" role="status">{{ message }}</p>
    <section><h4>我的订单</h4>
      <el-table :data="status?.orders || []" emptyText="暂无购买订单">
        <el-table-column prop="label" label="套餐" minWidth="120" />
        <el-table-column label="实付"><template #default="{ row }">¥{{ money(row.amountFen) }}</template></el-table-column>
        <el-table-column label="状态" minWidth="120"><template #default="{ row }">{{ stateLabel(row.state) }}</template></el-table-column>
        <el-table-column prop="maskedKey" label="Key" minWidth="120" />
        <el-table-column label="操作" minWidth="120"><template #default="{ row }"><el-button text :disabled="busy" @click="row.state === 'delivered' ? reveal(row.id) : check(row.id)">{{ row.state === 'delivered' ? '领取 Key' : '查询' }}</el-button></template></el-table-column>
      </el-table>
    </section>
    <section v-if="apiKey" class="keyReveal"><h4>已领取的 API Key</h4><el-input :modelValue="apiKey" type="password" showPassword readonly aria-label="已交付 API Key" /><div class="actions"><el-button @click="copy">复制 Key</el-button><el-button @click="apiKey = ''">隐藏并清除</el-button></div><p>请将 Key 填入对应服务商的模型设置。不要分享给他人。</p></section>
  </div>
</template>

<script setup lang="ts">
import axios from "axios";
import { ref, onMounted, watch } from "vue";
import { QRCode } from "tdesign-vue-next";
import type { KeyShopStatus } from "@toonflow/server/license";

const props = defineProps<{ visible?: boolean }>();
const client = axios.create({ baseURL: "/api/keyShop", headers: { "x-toonflow-workspace": "1" } });
const status = ref<KeyShopStatus>();
const loading = ref(false), busy = ref(false), message = ref(""), apiKey = ref("");
const checkout = ref<{ orderId: string; state: string; qrCode?: string; channel: string; amountFen: number }>();
let request: { id: string; packageId: string; channel: string } | undefined;
function money(fen: number) { return (fen / 100).toFixed(2); }
function stateLabel(state: string) { return state === "delivered" ? "已交付" : state === "paid" ? "已付款，待交付" : "待支付"; }
function showError(error: unknown) { message.value = (error as { response?: { data?: { message?: string } } }).response?.data?.message || "订单服务暂时不可用，请稍后重试"; }
async function load() {
  loading.value = true;
  try { status.value = (await client.get("/status")).data.data; }
  catch (error) { showError(error); }
  finally { loading.value = false; }
}
async function buy(packageId: string, channel: "wechat" | "alipay") {
  if (busy.value) return;
  if (!request || request.packageId !== packageId || request.channel !== channel) request = { id: crypto.randomUUID(), packageId, channel };
  busy.value = true; message.value = "";
  try { checkout.value = (await client.post("/order", { requestId: request.id, packageId, channel })).data.data; await load(); }
  catch (error) { showError(error); }
  finally { busy.value = false; }
}
async function check(orderId: string) {
  if (busy.value) return;
  busy.value = true;
  try {
    const order = (await client.post("/orderStatus", { orderId })).data.data;
    if (checkout.value?.orderId === orderId) checkout.value.state = order.state;
    message.value = stateLabel(order.state);
    if (order.state !== "pending") request = undefined;
    await load();
  } catch (error) { showError(error); }
  finally { busy.value = false; }
}
async function reveal(orderId: string) {
  if (busy.value) return;
  busy.value = true; apiKey.value = "";
  try { const result = await client.post("/reveal", { orderId }); if (props.visible) apiKey.value = result.data.data.apiKey; }
  catch (error) { showError(error); }
  finally { busy.value = false; }
}
async function copy() {
  try { await navigator.clipboard.writeText(apiKey.value); message.value = "Key 已复制，请妥善保管"; }
  catch { message.value = "复制失败，请手动选择并复制 Key"; }
}
onMounted(load);
watch(() => props.visible, visible => { apiKey.value = ""; if (visible) void load(); });
</script>

<style scoped lang="scss">
.keyShopPanel {
  display: grid; gap: 20px; min-width: 0;
  > section { min-width: 0; }
  header { display: flex; justify-content: space-between; align-items: center; gap: 12px; flex-wrap: wrap; }
  h3, h4 { margin: 0; }
  p { color: var(--el-text-color-secondary); font-size: 13px; line-height: 1.8; margin: 0; overflow-wrap: anywhere; }
  .packageCard, .keyReveal { border: 1px solid var(--el-border-color-light); border-radius: 10px; padding: 16px; display: grid; gap: 12px; }
  .actions { display: flex; gap: 10px; flex-wrap: wrap; :deep(.el-button) { margin: 0; } }
  .checkout { display: grid; justify-items: center; gap: 12px; text-align: center; }
  section > h4 { margin-bottom: 12px; }
  .checkout :deep(.t-qrcode) { max-width: 100%; }
  .checkout :deep(canvas), .checkout :deep(svg) { max-width: 100%; height: auto !important; }
}
</style>
