const rules = [
  {
    type: "input",
    field: "apiKey" as const,
    title: "API Key",
    value: "",
    props: { type: "password", showPassword: true, autocomplete: "off" },
  },
];

export default {
  id: "tfRouter" as const,
  label: "TF-router",
  icon: "data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSI2NCIgaGVpZ2h0PSI2NCIgdmlld0JveD0iMCAwIDY0IDY0Ij48cmVjdCB3aWR0aD0iNjQiIGhlaWdodD0iNjQiIHJ4PSIxNCIgZmlsbD0iIzI1NjNlYiIvPjxnIGZpbGw9Im5vbmUiIHN0cm9rZT0id2hpdGUiIHN0cm9rZS13aWR0aD0iMyI+PGNpcmNsZSBjeD0iMzIiIGN5PSIzMiIgcj0iMTkiLz48ZWxsaXBzZSBjeD0iMzIiIGN5PSIzMiIgcng9IjgiIHJ5PSIxOSIvPjxwYXRoIGQ9Ik0xNCAyNWgzNk0xNCAzOWgzNiIvPjwvZz48L3N2Zz4=",
  version: "2.0.0",
  apiUrl: "https://api.toonflow.net/v1",
  protocol: "openai-completions",
  readme: "## TF-Router 第三方模型服务\n\n提供文本模型服务。\n\n[前往中转平台](https://api.toonflow.net/)",
  rules,
  models: [],
} satisfies ProviderDefinition<typeof rules>;
