import axios from "axios";
import { ref } from "vue";
import type { LicenseStatus } from "@toonflow/server/license";

export const licenseStatus = ref<LicenseStatus | null>(null);
const client = axios.create({ baseURL: "/api/license", headers: { "x-toonflow-workspace": "1" } });

export async function loadLicense() {
  const response = await client.get("/status");
  licenseStatus.value = response.data.data;
  return licenseStatus.value;
}

export async function changeLicense(action: "activate" | "refresh" | "deactivate", code?: string) {
  try {
    const response = await client.post(`/${action}`, action === "activate" ? { code } : {});
    licenseStatus.value = response.data.data;
  } finally {
    // ACT: 即使联网刷新返回撤销，也要同步显示本机已失效的状态。
    await loadLicense().catch(() => {});
  }
}
