<template>
  <div class="licensePanel" v-loading="loading">
    <section class="statusCard" aria-live="polite">
      <div class="statusHeader">
        <h3>小丹AI漫剧授权</h3>
        <el-tag :type="licenseStatus?.canCreate ? 'success' : 'warning'">{{ licenseStatus?.canCreate ? "已激活" : "未获得有效授权" }}</el-tag>
      </div>
      <p>{{ licenseStatus?.message || "正在读取授权状态…" }}</p>
      <dl v-if="licenseStatus">
        <div><dt>本机设备编号</dt><dd>{{ licenseStatus.deviceId }}</dd></div>
        <div v-if="licenseStatus.plan"><dt>授权方案</dt><dd>{{ licenseStatus.plan }}</dd></div>
        <div v-if="licenseStatus.subscriptionExpiresAt"><dt>订阅有效期至</dt><dd>{{ formatDate(licenseStatus.subscriptionExpiresAt) }}</dd></div>
        <div v-if="licenseStatus.leaseExpiresAt"><dt>离线可用至</dt><dd>{{ formatDate(licenseStatus.leaseExpiresAt) }}</dd></div>
      </dl>
    </section>
    <el-form labelPosition="top" @submit.prevent="run('activate')">
      <el-form-item label="激活码">
        <el-input v-model="code" type="password" showPassword autocomplete="off" :maxlength="35" placeholder="输入购买后获得的激活码" aria-label="激活码" :disabled="working || licenseStatus?.canCreate" />
      </el-form-item>
      <div class="actions">
        <el-button type="primary" nativeType="submit" :loading="working" :disabled="loading || working || !code.trim() || !!licenseStatus?.canCreate">激活软件</el-button>
        <el-button :disabled="working || loading" @click="run('refresh')">刷新授权</el-button>
        <el-button :disabled="working || loading || !licenseStatus || licenseStatus.state === 'inactive'" @click="release">解除本机授权</el-button>
      </div>
    </el-form>
    <p v-if="message" class="result" :class="{ failed }" role="status">{{ message }}</p>
    <section class="notes">
      <p>软件授权与模型用量分别计费。模型 API Key 由你自行配置，授权服务不接收模型 Key 或项目内容。</p>
      <p>离线授权最长有效 24 小时；到期后仍可查看、备份和导出已有项目。续期后点击“刷新授权”。</p>
      <p>更换设备前请先解除本机授权。解除后将停止本机新的 AI 创作，并释放设备名额。</p>
    </section>
  </div>
</template>

<script setup lang="ts">
import { onMounted, ref, watch } from "vue";
import { ElMessageBox } from "element-plus";
import { changeLicense, licenseStatus, loadLicense } from "@/stores/license";

const code = ref("");
const props = defineProps<{ visible?: boolean }>();
const loading = ref(true);
const working = ref(false);
const message = ref("");
const failed = ref(false);
function formatDate(value: number) { return new Date(value).toLocaleString(); }

async function readStatus() {
  loading.value = true;
  try { await loadLicense(); }
  catch { message.value = "无法读取授权状态，请稍后重试"; failed.value = true; }
  finally { loading.value = false; }
}
onMounted(readStatus);
watch(() => props.visible, value => { if (value) void readStatus(); });

async function run(action: "activate" | "refresh" | "deactivate") {
  if (working.value) return;
  if (action === "activate" && !/^XD-[A-Za-z0-9_-]{32}$/.test(code.value.trim())) {
    message.value = "激活码格式不正确，请检查是否复制完整"; failed.value = true; return;
  }
  working.value = true; message.value = ""; failed.value = false;
  try {
    await changeLicense(action, code.value.trim());
    code.value = "";
    message.value = action === "activate" ? "激活成功，可以开始创作" : action === "deactivate" ? "已解除本机授权" : "授权状态已更新";
  } catch (error) {
    const response = (error as { response?: { data?: { message?: string } } }).response;
    message.value = response?.data?.message || "操作未成功，请检查授权服务连接后重试";
    failed.value = true;
  } finally { working.value = false; }
}

async function release() {
  try { await ElMessageBox.confirm("解除后将停止本机新的 AI 创作，并释放设备名额。已有项目仍可查看和导出。", "解除本机授权", { confirmButtonText: "解除授权", cancelButtonText: "取消", type: "warning" }); }
  catch { return; }
  await run("deactivate");
}
</script>

<style scoped lang="scss">
.licensePanel {
  display: grid; gap: 20px; max-width: 760px;
  .statusCard { padding: 20px; border: 1px solid var(--el-border-color-light); border-radius: var(--el-border-radius-base); }
  .statusHeader { display: flex; align-items: center; justify-content: space-between; gap: 12px; flex-wrap: wrap; }
  h3 { margin: 0; font-size: 16px; }
  p { font-size: 13px; line-height: 1.8; color: var(--el-text-color-secondary); }
  dl { display: grid; gap: 12px; font-size: 13px; }
  dl > div { display: grid; grid-template-columns: 110px minmax(0, 1fr); gap: 12px; }
  dt { color: var(--el-text-color-secondary); }
  dd { margin: 0; overflow-wrap: anywhere; user-select: text; }
  .actions { display: flex; gap: 12px; flex-wrap: wrap; :deep(.el-button) { margin: 0; } }
  .result { margin: 0; color: var(--el-color-success); &.failed { color: var(--el-color-danger); } }
  .notes { border-top: 1px solid var(--el-border-color-light); padding-top: 8px; }
}
</style>
