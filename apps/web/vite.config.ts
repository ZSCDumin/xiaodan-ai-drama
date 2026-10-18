import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";
import type { Plugin } from "vite";
import vue from "@vitejs/plugin-vue";
import components from "unplugin-vue-components/vite";
import { ElementPlusResolver } from "unplugin-vue-components/resolvers";
import desktopConfig from "../../electrobun.config.ts";
import postcssConfig from "../../postcss.config.ts";
import { i18nPlugin } from "@toonflow/i18n/vite";

// 部署到子路径时（例如 nginx 的 /ai_drama/）用 XIAODAN_WEB_BASE 指定；
// 桌面端与本地开发仍默认根路径 "/"，行为不变。
const webBase = process.env.XIAODAN_WEB_BASE?.trim() || "/";
const apiPrefix = webBase.replace(/\/+$/, "");

// 前端有上百处以 /api/ 开头的根路径，挂到子路径后必须整体前移。
// 在转换阶段改字符串字面量，源码保持根路径写法，桌面端构建不受影响。
function rebaseApiPaths(prefix: string): Plugin {
  return {
    name: "xiaodan-rebase-api-paths",
    enforce: "pre",
    transform(code, id) {
      if (!prefix || !/\.(?:ts|tsx|js|jsx|vue)$/.test(id) || id.includes("node_modules")) return null;
      const next = code.replace(/(["'`])\/api\//g, `$1${prefix}/api/`);
      return next === code ? null : { code: next, map: null };
    },
  };
}

export default defineConfig({
  base: webBase,
  css: { postcss: postcssConfig },
  define: {
    "import.meta.env.appVersion": JSON.stringify(desktopConfig.app.version),
  },
  server: {
    proxy: {
      "/mcp": { target: "http://127.0.0.1:3000", changeOrigin: false },
      "/a2a": { target: "http://127.0.0.1:3000", changeOrigin: false },
      "/api": {
        target: "http://127.0.0.1:3000",
        changeOrigin: false,
        configure(proxy) {
          proxy.on("proxyReq", (request, incoming) => {
            request.setHeader("x-toonflow-local-client", ["127.0.0.1", "::1", "::ffff:127.0.0.1"].includes(incoming.socket.remoteAddress ?? "") ? "1" : "0");
          });
        },
      },
    },
  },
  resolve: {
    alias: [
      { find: "@", replacement: fileURLToPath(new URL("./src", import.meta.url)) },
      { find: /^shiki$/, replacement: fileURLToPath(new URL("./src/lib/shiki.ts", import.meta.url)) },
    ],
  },
  build: {
    outDir: "../../build/web",
    emptyOutDir: true,
  },
  plugins: [
    rebaseApiPaths(apiPrefix),
    i18nPlugin(),
    vue(),
    components({
      globsExclude: ["src/components/settings/panels/**/*Dialog.vue"],
      dts: "src/types/components.d.ts",
      resolvers: [
        ElementPlusResolver(),
        (name) => {
          if (name.startsWith("Icon")) return { name, from: "@tabler/icons-vue" };
        },
      ],
    }),
  ],
});
