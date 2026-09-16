const { app, BrowserWindow } = require("electron");
const assert = require("node:assert/strict");
const { writeFile } = require("node:fs/promises");
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
app.whenReady().then(async () => {
  const window = new BrowserWindow({ width: 1100, height: 800, show: false, webPreferences: { sandbox: true } });
  const run = source => window.webContents.executeJavaScript(source);
  try {
    await window.loadURL("http://127.0.0.1:4175/?preview=workspace");
    window.showInactive();
    for (let attempt = 0; attempt < 100; attempt++) {
      if (await run(`Boolean(document.querySelector("textarea"))`)) break;
      await pause(100);
    }
    await pause(350);
    const click = label => run(`Array.from(document.querySelectorAll('button')).find(b => b.textContent.trim() === ${JSON.stringify(label)}).click()`);
    await run(`document.querySelector('textarea').value = '保留草稿'`);
    await click("研究计划讨论与资料整理的长会话标题");
    await click("项目");
    await click("Research Workspace");
    assert.equal(await run(`document.querySelectorAll('nav[aria-label="已打开的标签页"] > div').length`), 3);
    await click("Research Workspace");
    assert.equal(await run(`document.querySelectorAll('nav[aria-label="已打开的标签页"] > div').length`), 3);
    await run(`document.querySelector('[aria-label="关闭 Research Workspace"]').click()`);
    assert.equal(await run(`document.querySelector('nav[aria-label="已打开的标签页"] [aria-current="page"]').textContent.trim()`), "研究计划讨论与资料整理的长会话标题");
    await click("消息展示验收");
    assert.equal(await run(`document.querySelector('textarea').value`), "保留草稿");
    await run(`document.querySelector('[aria-label="收起侧栏"]').click()`);
    await pause(80);
    const width = await run(`document.querySelector('aside').getBoundingClientRect().width`);
    assert(width > 0 && width < 232);
    await pause(350);
    assert.equal(await run(`document.querySelector('aside').getBoundingClientRect().width`), 0);
    await run(`document.querySelector('[aria-label="展开侧栏"]').click()`);
    await pause(350);
    await writeFile("qa-output/workspace.png", (await window.webContents.capturePage()).toPNG());
    window.setSize(420, 760);
    await pause(350);
    assert(await run(`document.documentElement.scrollWidth <= innerWidth`));
    await writeFile("qa-output/workspace-narrow.png", (await window.webContents.capturePage()).toPNG());
    assert.equal(await run(`document.querySelector('button[title="设置功能尚未接入"]').textContent.trim()`), "设置");
    assert.equal(await run(`document.querySelector('button[title="将在后续项目与会话接入中开放"]').textContent.trim()`), "新增项目");
    await window.loadURL("http://127.0.0.1:4175/");
    await pause(800);
    assert.equal(await run(`(() => { const input = document.querySelector('textarea'); input.focus(); return getComputedStyle(input).boxShadow; })()`), "none");
    assert.equal(await run(`getComputedStyle(document.querySelector('[aria-label="发送消息"] > svg > svg')).transform`), "none");
    await writeFile("qa-output/send.png", (await window.webContents.capturePage()).toPNG());
    console.log("Workspace QA passed: deduplication, activation, close, draft retention, animation, narrow layout.");
    app.exit(0);
  } catch (error) { console.error(error); app.exit(1); }
});

