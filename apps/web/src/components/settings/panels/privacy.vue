<template>
  <div class="privacy">
    <section class="settingSection">
      <h3>数据与隐私</h3>
      <p class="description">本版本不收集匿名使用统计。</p>
      <p class="description">模型请求会发送到你配置的服务商，请按需管理模型服务与 API Key。</p>
    </section>
  </div>
</template>

<style lang="scss" scoped>
.privacy {
  display: flex;
  flex-direction: column;
  gap: 24px;
  padding: 0 4px 8px;

  .settingSection {
    min-width: 0;

    h3 {
      margin: 0 0 12px;
      color: var(--el-text-color-primary);
      font-size: 14px;
      font-weight: 600;
    }

    .settingHeader {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 12px;

      h3 { margin: 0; }
    }

    .description {
      margin: 8px 0 0;
      color: var(--el-text-color-secondary);
      font-size: 13px;
      line-height: 1.6;
    }

    .metricList {
      display: flex;
      flex-direction: column;
      gap: 12px;
      margin: 0;

      .metricItem {
        display: grid;
        grid-template-columns: 88px minmax(0, 1fr);
        gap: 12px;
        font-size: 13px;
        line-height: 1.6;

        dt { color: var(--el-text-color-regular); }
        dd { margin: 0; color: var(--el-text-color-secondary); }
      }
    }

    .anonymousId {
      display: block;
      padding: 10px 12px;
      border-radius: var(--el-border-radius-base);
      background: var(--el-fill-color-light);
      color: var(--el-text-color-regular);
      overflow-wrap: anywhere;
      user-select: text;
      font-family: monospace;
      font-size: 12px;
    }
  }
}
</style>
