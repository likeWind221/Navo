const { mkdir, rm, writeFile } = require("node:fs/promises");
const { tmpdir } = require("node:os");
const { join } = require("node:path");
const assert = require("node:assert/strict");
const { app, BrowserWindow } = require("electron");

const url = process.argv[2] ?? "http://127.0.0.1:5173/?preview=design";
const outputDirectory = join(process.cwd(), "qa-output");
app.setPath("userData", join(tmpdir(), `navo-f4-1-qa-${process.pid}`));

const expectedLabels = ["手册", "向导", "前往", "思考", "工具", "进行中", "成功", "失败", "展开"];

const readIcons = `(() => {
  const row = document.querySelector('[class*="iconSamples"]');
  row.scrollIntoView({ block: 'center' });
  const entries = [...row.querySelectorAll(':scope > span')].map((item) => {
    const svg = item.querySelector('svg');
    const box = svg.getBBox();
    return {
      label: item.textContent.trim(),
      box: [Number(svg.getAttribute('width')), Number(svg.getAttribute('height'))],
      painted: [Math.round(box.width * 10) / 10, Math.round(box.height * 10) / 10],
      spinning: !!item.querySelector('[class*="spinning"]'),
    };
  });
  return { entries, overflow: document.documentElement.scrollWidth > document.documentElement.clientWidth };
})()`;

(async () => {
  await app.whenReady();
  await mkdir(outputDirectory, { recursive: true });
  await rm(join(outputDirectory, "error.txt"), { force: true });
  const window = new BrowserWindow({
    width: 1280,
    height: 900,
    show: false,
    webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true },
  });
  await window.loadURL(url);
  window.show();
  const ready = await window.webContents.executeJavaScript(`new Promise((resolve) => {
    const timer = setInterval(() => {
      if (document.querySelector('[class*="iconSamples"]') !== null) { clearInterval(timer); resolve(true); }
    }, 50);
    setTimeout(() => { clearInterval(timer); resolve(false); }, 10000);
  })`);
  assert.equal(ready, true, "预览页未渲染图标样板");

  const desktop = await window.webContents.executeJavaScript(readIcons);
  assert.deepEqual(desktop.entries.map((entry) => entry.label), expectedLabels);
  assert.deepEqual([...new Set(desktop.entries.map((entry) => entry.box.join("x")))], ["20x20"]);
  assert.deepEqual(desktop.entries.filter((entry) => entry.spinning).map((entry) => entry.label), ["进行中"]);
  for (const entry of desktop.entries) {
    assert.ok(entry.painted[0] > 0 && entry.painted[1] > 0, `${entry.label} 未绘制出图形`);
  }

  await new Promise((resolve) => setTimeout(resolve, 200));
  await writeFile(join(outputDirectory, "icons.png"), (await window.webContents.capturePage()).toPNG());

  window.setSize(560, 720);
  await new Promise((resolve) => setTimeout(resolve, 200));
  const narrow = await window.webContents.executeJavaScript(readIcons);
  assert.equal(narrow.overflow, false);
  await writeFile(join(outputDirectory, "icons-narrow.png"), (await window.webContents.capturePage()).toPNG());

  const result = { desktop, narrow: { overflow: narrow.overflow } };
  await writeFile(join(outputDirectory, "icons.json"), JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result, null, 2));
  window.destroy();
  app.quit();
})().catch(async (error) => {
  await mkdir(outputDirectory, { recursive: true });
  await writeFile(join(outputDirectory, "error.txt"), String(error?.stack ?? error));
  process.exitCode = 1;
  app.quit();
});
