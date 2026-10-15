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

export interface KeyShopStatus {
  packages: { id: string; label: string; priceFen: number; creditFen: number; description: string }[];
  channels: { wechat: boolean; alipay: boolean };
  orders: { id: string; label: string; description: string; amountFen: number; creditFen: number; state: "pending" | "paid" | "delivered"; maskedKey: string | null; createdAt: number }[];
}
