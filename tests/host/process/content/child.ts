import { writeSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { acquireHostLock } from "../../../../src/host/lock.js";
import { createApp } from "../../../../src/app.js";

const path = process.argv[2]!;
const resourceId = process.argv[3]!;
const release = await acquireHostLock();
const exec = DatabaseSync.prototype.exec;
DatabaseSync.prototype.exec = function (sql) {
  const result = exec.call(this, sql);
  if (sql === "COMMIT" && this.prepare("SELECT name FROM sqlite_schema WHERE name = 'resource_content'").get()) {
    const row = this.prepare("SELECT * FROM resource_content WHERE resource_id = ? AND status = 'processing'").get(resourceId);
    if (row !== undefined) {
      writeSync(1, `${JSON.stringify(row)}\n`);
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0);
    }
  }
  return result;
};
try {
  const ctx = await createApp({ storage: { path }, node: { session: { model: { provider: "mock", model: "test" } } } });
  await ctx.content.idle();
  await ctx.fiber.dispose();
} finally {
  await release();
}
