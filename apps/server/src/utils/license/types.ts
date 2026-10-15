export interface LicenseStatus {
  state: "inactive" | "active" | "expired" | "refreshRequired" | "blocked" | "clockError";
  message: string;
  canCreate: boolean;
  deviceId: string;
  licenseId?: string;
  plan?: string;
  subscriptionExpiresAt?: number;
  leaseExpiresAt?: number;
  lastCheckedAt: number;
  serviceUrl: string;
}
