import { credentialsSchema, hash } from "./store";
import type { LicenseRow, LicenseStore } from "./store";

export function authenticate(store: LicenseStore, credentials: unknown, active = true) {
  const input = credentialsSchema.parse(credentials);
  const license = store.db.query<LicenseRow, [string, string]>("SELECT l.* FROM licenses l JOIN devices d ON d.licenseId = l.id WHERE d.deviceId = ? AND d.secretHash = ?").get(input.deviceId, hash(input.deviceSecret));
  if (!license || (active && (license.revokedAt !== null || license.expiresAt <= Date.now()))) throw Object.assign(new Error("设备凭证无效或授权已到期"), { status: 403 });
  return license;
}
