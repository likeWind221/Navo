import { mkdir, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { resolve, dirname } from "node:path";
import { build } from "vite";
import react from "@vitejs/plugin-react";

const root = fileURLToPath(new URL("../../", import.meta.url));
const destination = resolve(process.argv[2] ?? resolve(root, "qa-output/visual.html"));
const result = await build({
  root, configFile: false, plugins: [react()],
  build: {
    write: false, assetsInlineLimit: Infinity, cssCodeSplit: false,
    rollupOptions: {
      input: resolve(root, "src/preview/visual.tsx"),
      output: { format: "iife", inlineDynamicImports: true },
    },
  },
});
const outputs = (Array.isArray(result) ? result : [result]).flatMap(item => item.output);
const script = outputs.filter(item => item.type === "chunk").map(item => item.code).join("\n");
const css = outputs.filter(item => item.type === "asset" && item.fileName.endsWith(".css")).map(item => item.source).join("\n");
const html = `<!doctype html>
<html lang="zh-CN"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data:; font-src data:; connect-src 'none'; base-uri 'none'; form-action 'none'">
<title>Navo · 三维工作区预览</title><link rel="icon" href="data:,">
<style>${css.replaceAll("</style", "<\\/style")}</style></head>
<body><div id="root"></div><script>${script.replaceAll("</script", "<\\/script")}</script></body></html>`;
await mkdir(dirname(destination), { recursive: true });
await writeFile(destination, html);
console.log(destination);
