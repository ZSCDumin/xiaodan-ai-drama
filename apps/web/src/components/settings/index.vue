<template>
  <el-dialog v-model="visible" title="设置" width="min(1080px, calc(100vw - 32px))" alignCenter appendToBody>
    <div class="settings">
      <aside class="sidebar" aria-label="设置分类">
        <div class="panelList">
          <template v-for="item in settingsPanels" :key="item.id">
            <h3 v-if="item.groupLabel" class="settingsGroupLabel">{{ item.groupLabel }}</h3>
            <button
              class="settingsItem"
              type="button"
              :aria-label="item.id === 'about' && hasDesktopUpdate ? `${item.label}，有新版本可用` : item.label"
              :aria-pressed="activePanel.id === item.id"
              @click="activePanel = item">
              <el-badge class="panelIcon" isDot :hidden="item.id !== 'about' || !hasDesktopUpdate">
                <component :is="item.icon" :size="18" aria-hidden="true" />
              </el-badge>
              <span>{{ item.label }}</span>
            </button>
          </template>
        </div>
        <div v-if="account" class="accountBox">
          <div class="accountName" :title="account.name">{{ account.name }}</div>
          <el-button size="small" plain :loading="loggingOut" @click="logout">退出登录</el-button>
        </div>
      </aside>
      <section class="content" :aria-label="activePanel.label" tabindex="0">
        <h2 class="panelTitle">{{ activePanel.label }}</h2>
        <div class="panelContent">
          <transition name="el-fade-in" mode="out-in">
            <keep-alive include="personalization">
              <component
                :is="activePanel.component"
                v-bind="
                  ['pluginMarket', 'languageModel', 'mediaModel', 'personalization', 'deviceLink', 'license', 'keyShop'].includes(activePanel.id) ? { visible } : {}
                " />
            </keep-alive>
          </transition>
        </div>
      </section>
    </div>
  </el-dialog>
</template>

<script setup lang="ts">
import { defineAsyncComponent, onMounted, ref, shallowRef } from "vue";
import { hasDesktopUpdate } from "@/stores/desktopUpdate";
import { isMobile } from "@/lib/platform";
import {
  IconPalette,
  IconSettings,
  IconPhotoVideo,
  IconBuildingStore,
  IconInfoCircle,
  IconShieldLock,
  IconPlugConnected,
  IconUserCog,
  IconSubtitlesAi,
  IconDevices,
} from "@tabler/icons-vue";

const settingsPanels = [
  { id: "ui", label: "界面设置", icon: IconPalette, component: defineAsyncComponent(() => import("./panels/ui.vue")) },
  { id: "general", label: "常规配置", icon: IconSettings, component: defineAsyncComponent(() => import("./panels/general/index.vue")) },
  {
    id: "languageModel",
    label: "文本模型",
    icon: IconSubtitlesAi,
    groupLabel: "模型",
    component: defineAsyncComponent(() => import("./panels/languageModel/index.vue")),
  },
  { id: "mediaModel", label: "媒体模型", icon: IconPhotoVideo, component: defineAsyncComponent(() => import("./panels/mediaModel/index.vue")) },
  {
    id: "pluginMarket",
    label: "插件管理",
    icon: IconBuildingStore,
    groupLabel: "扩展",
    component: defineAsyncComponent(() => import("./panels/pluginMarket/index.vue")),
  },
  { id: "mcp", label: "MCP", icon: IconPlugConnected, groupLabel: "通讯", component: defineAsyncComponent(() => import("./panels/mcp/index.vue")) },
  ...(!isMobile
    ? [{ id: "deviceLink", label: "设备互联", icon: IconDevices, component: defineAsyncComponent(() => import("./panels/deviceLink.vue")) }]
    : []),
  {
    id: "personalization",
    label: "个性化",
    icon: IconUserCog,
    groupLabel: "其他",
    component: defineAsyncComponent(() => import("./panels/personalization.vue")),
  },
  { id: "privacy", label: "隐私", icon: IconShieldLock, component: defineAsyncComponent(() => import("./panels/privacy.vue")) },
  { id: "license", label: "软件授权", icon: IconShieldLock, component: defineAsyncComponent(() => import("./panels/license.vue")) },
  { id: "keyShop", label: "购买 API Key", icon: IconBuildingStore, component: defineAsyncComponent(() => import("./panels/keyShop.vue")) },
  // 开发者选项在所有平台都不再展示（DevTools、供应商调试、强制安装插件、缓存导入导出）。
  { id: "about", label: "关于", icon: IconInfoCircle, component: defineAsyncComponent(() => import("./panels/about.vue")) },
];
const activePanel = shallowRef(settingsPanels[0]!);
// 商城账号信息与退出登录：会话由服务端维护，前端只展示名称并按需退出。
const account = ref<{ id: string; name: string; phone: string } | null>(null);
const loggingOut = ref(false);
async function loadAccount() {
  try {
    const response = await fetch("/api/mall/auth/me", { credentials: "same-origin" });
    const body = await response.json().catch(() => null);
    account.value = response.ok ? body?.data?.user ?? null : null;
  } catch {
    account.value = null;
  }
}
async function logout() {
  if (loggingOut.value) return;
  loggingOut.value = true;
  try {
    await fetch("/api/mall/auth/logout", { method: "POST", credentials: "same-origin" });
  } catch {
    // 网络失败也继续跳登录页，服务端会按未登录处理。
  }
  location.href = "login";
}
onMounted(loadAccount);
const visible = defineModel<boolean>({ default: false });
defineExpose({
  openLicense() { activePanel.value = settingsPanels.find(item => item.id === "license")!; visible.value = true; },
  openKeyShop() { activePanel.value = settingsPanels.find(item => item.id === "keyShop")!; visible.value = true; },
});
</script>

<style lang="scss" scoped>
.settings {
  display: grid;
  grid-template-columns: 160px minmax(0, 1fr);
  height: min(72vh, calc(100dvh - 140px));
  overflow: hidden;

  .sidebar {
    min-height: 0;
    display: flex;
    flex-direction: column;
    overflow: hidden;
    padding: 2px;

    .panelList {
      flex: 1;
      min-height: 0;
      overflow-y: auto;
    }

    .accountBox {
      flex: none;
      display: grid;
      gap: 8px;
      margin-top: 8px;
      padding: 10px 10px 2px;
      border-top: 1px solid var(--el-border-color-lighter);
    }

    .accountName {
      overflow: hidden;
      color: var(--el-text-color-secondary);
      font-size: 12px;
      line-height: 1.4;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .settingsGroupLabel {
      margin: 14px 12px 6px;
      color: var(--el-text-color-secondary);
      font-size: 12px;
      font-weight: 400;
      line-height: 1.5;
    }

    .settingsItem {
      display: flex;
      align-items: center;
      gap: 10px;
      width: 100%;
      padding: 10px 12px;
      margin-bottom: 4px;
      border: 0;
      border-radius: var(--el-border-radius-base);
      background: transparent;
      color: var(--el-text-color-regular);
      font: inherit;
      text-align: start;
      cursor: pointer;

      .panelIcon {
        display: inline-flex;
        flex-shrink: 0;
      }

      > span {
        min-width: 0;
        overflow-wrap: anywhere;
      }

      &:hover {
        background: var(--el-fill-color-light);
      }

      &[aria-pressed="true"] {
        background: var(--el-color-primary-light-9);
        color: var(--el-color-primary);
      }

      &:focus-visible {
        outline: 2px solid var(--el-color-primary);
      }
    }
  }

  .content {
    display: flex;
    flex-direction: column;
    min-height: 0;
    min-width: 0;
    padding: 0 20px;
    overflow: hidden;

    .panelTitle {
      flex-shrink: 0;
      margin: 0 0 20px;
      font-size: 18px;
    }

    .panelContent {
      flex: 1;
      min-height: 0;
      min-width: 0;
      container: settingsContent / inline-size;
      overflow-x: auto;
      overflow-y: auto;
      overscroll-behavior: contain;
      padding-left: 5px;
      padding-right: 5px;
      padding-bottom: 50px;

      > :deep(.el-fade-in-enter-active),
      > :deep(.el-fade-in-leave-active) {
        transition-duration: 100ms;
      }
    }
  }

  @media (max-width: 700px) {
    grid-template-columns: 44px minmax(0, 1fr);

    .sidebar {
      .accountBox {
        min-width: 0;
        padding: 8px 0 0;

        .el-button {
          width: 100%;
          height: auto;
          min-height: 32px;
          padding: 6px 2px;
          white-space: normal;

          :deep(span) { white-space: normal; line-height: 1.4; }
        }
      }

      .settingsGroupLabel {
        margin: 12px 0 6px;
        text-align: center;
      }

      .settingsItem {
        justify-content: center;
        padding: 12px;
        span {
          display: none;
        }
      }
    }

    .content {
      padding: 0 8px 0 16px;
    }
  }

  @media (max-height: 500px) {
    height: calc(100dvh - 100px);
    .content .panelTitle { margin-bottom: 10px; }
    .content .panelContent { padding-bottom: 16px; }
  }
}
</style>
