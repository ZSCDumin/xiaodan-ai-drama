// ACT: 定制版未配置自有统计服务，不向上游发送使用数据；保留现有业务调用接口。
const anonymousData = {
  track(_event: "onboarding.complete" | "onboarding.skip" | "workspace.canvas" | "workspace.document") {},
  startAgent() {
    return (_outcome: "success" | "failed" | "cancelled") => {};
  },
  observeCanvas(_read: () => { nodes: readonly { type?: string }[]; edgeCount: number } | undefined) {
    return () => {};
  },
};
export default anonymousData;
