<template>
  <div class="about">
    <div class="brand">
      <img class="brandLogo" :src="logoUrl" alt="小丹AI漫剧图标" />
      <div>
        <h3>小丹AI漫剧</h3>
        <p>v{{ currentVersion }}</p>
        <p>从故事灵感到分镜、角色与成片，在一个创作空间里完成。</p>
      </div>
    </div>
    <el-card v-if="isDesktop && !isRemoteConnection" shadow="never">
      <div class="updateHeader">
        <strong>版本更新</strong>
        <el-button size="small" type="primary" plain :loading="working" @click="update">
          {{ snapshot?.updateReady ? "重启并更新" : snapshot?.updateAvailable ? "下载更新" : "检查更新" }}
        </el-button>
      </div>
      <el-progress v-if="snapshot?.updating" :percentage="progress" />
      <p v-if="status" role="status">{{ status }}</p>
    </el-card>
    <el-card shadow="never">
      <p>© {{ new Date().getFullYear() }} ZSCDumin · 小丹AI漫剧品牌与定制部分。</p>
      <details>
        <summary>开源许可与版权声明</summary>
        <p>本产品保留第三方组件的许可与原作者署名。</p>
        <pre class="licenseText">{{ licenseText }}</pre>
      </details>
    </el-card>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import logoUrl from "@toonflow/assets/logo.png";
import licenseText from "@toonflow/assets/projectLicense.txt?raw";
import { isDesktop, isRemoteConnection } from "@/lib/platform";
import { desktopUpdateSnapshot as snapshot, desktopUpdateAction, runDesktopUpdate } from "@/stores/desktopUpdate";

const currentVersion = computed(() => snapshot.value?.version || import.meta.env.appVersion);
const working = computed(() => !!desktopUpdateAction.value);
const status = ref("");
const progress = computed(() => {
  const value = snapshot.value?.updateProgress;
  return value?.total ? Math.min(100, Math.floor(value.received / value.total * 100)) : 0;
});

onMounted(() => {
  if (isDesktop && !isRemoteConnection) void runDesktopUpdate("read").catch(() => {});
});

async function update() {
  if (working.value) return;
  status.value = "";
  try {
    await runDesktopUpdate(snapshot.value?.updateReady ? "apply" : snapshot.value?.updateAvailable ? "download" : "check");
    status.value = snapshot.value?.updateReady ? "更新已准备完成" : snapshot.value?.updateAvailable ? "发现新版本" : "当前已是最新版本";
  } catch {
    status.value = "更新服务暂时不可用，请稍后重试。";
  }
}
</script>

<style scoped lang="scss">
.about { display: grid; gap: 20px; }
.brand { display: flex; align-items: center; gap: 16px; }
.brandLogo { width: 64px; height: 64px; object-fit: contain; border-radius: 12px; }
h3 { margin: 0 0 8px; }
p { color: var(--el-text-color-secondary); font-size: 13px; line-height: 1.7; }
.updateHeader { display: flex; align-items: center; justify-content: space-between; gap: 12px; }
summary { cursor: pointer; font-size: 13px; }
.licenseText { white-space: pre-wrap; overflow-wrap: anywhere; font-size: 12px; line-height: 1.7; color: var(--el-text-color-secondary); }
</style>
