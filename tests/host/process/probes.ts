import fs from "node:fs";
import promises from "node:fs/promises";
import { syncBuiltinESMExports } from "node:module";
import { DatabaseSync } from "node:sqlite";
import type { SQLInputValue, StatementSync } from "node:sqlite";
import type { FileOperation } from "../../../src/storage/operations.js";
import { crashOperationId, type Checkpoint, type CrashPoint } from "./protocol.js";

export function installCrashProbe(point: CrashPoint): void {
  const operationId = crashOperationId(point);
  const prepare = DatabaseSync.prototype.prepare;
  const exec = DatabaseSync.prototype.exec;
  let database: DatabaseSync;

  function pause(): never {
    const operation = prepare.call(database, "SELECT * FROM resource_file_operations WHERE operation_id = ?")
      .get(operationId) as unknown as FileOperation;
    const events = prepare.call(database, "SELECT payload FROM events WHERE domain = 'resource'").all();
    const checkpoint: Checkpoint = {
      point, transaction: database.isTransaction, operation,
      matchingEvents: events.filter(row => (JSON.parse(String(row.payload)) as { data: { operationId?: string } }).data.operationId === operationId).length,
    };
    fs.writeSync(1, `${JSON.stringify(checkpoint)}\n`);
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0);
    throw new Error("Crash checkpoint unexpectedly resumed.");
  }

  DatabaseSync.prototype.exec = function (sql) {
    database = this;
    const result = exec.call(this, sql);
    if (sql === "COMMIT" && ["D1", "D5", "D7"].includes(point)) {
      const tables = prepare.call(this, "SELECT name FROM sqlite_schema WHERE name = 'resource_file_operations'").get();
      const operation = tables === undefined ? undefined : prepare.call(this,
        "SELECT * FROM resource_file_operations WHERE operation_id = ?").get(operationId);
      if ((point === "D1" && operation?.resource_id === null)
        || (point === "D5" && operation?.execution_state === "prepared")
        || (point === "D7" && operation?.execution_state === "committed")) pause();
    }
    return result;
  };

  DatabaseSync.prototype.prepare = function (sql) {
    const statement = prepare.call(this, sql);
    if (point === "D6" && sql.startsWith("INSERT INTO events")) {
      const run = statement.run;
      statement.run = function (this: StatementSync, ...values: (SQLInputValue | Record<string, SQLInputValue>)[]) {
        const result = Reflect.apply(run, this, values);
        if (values[0] === "resource" && String(values.at(-1)).includes(`"operationId":"${operationId}"`)) pause();
        return result;
      } as StatementSync["run"];
    }
    return statement;
  };

  if (point === "D2") {
    const createWriteStream = fs.createWriteStream;
    fs.createWriteStream = (path, options) => {
      if (!String(path).replace(/\\/g, "/").includes(`/staging/resource-intake/${operationId}/`)) {
        return createWriteStream(path, options);
      }
      const config = typeof options === "string" ? { encoding: options } : options;
      const io = {
        open: fs.open, close: fs.close, fsync: fs.fsync,
        write(fd: number, buffer: Buffer, offset: number, length: number, position: number | null,
          callback: (error: NodeJS.ErrnoException | null, bytes: number, buffer: Buffer) => void) {
          fs.write(fd, buffer, offset, length, position, (error, bytes, written) => {
            if (error === null && bytes > 0) {
              fs.fsyncSync(fd);
              pause();
            }
            callback(error, bytes, written);
          });
        },
      };
      return createWriteStream(path, { ...config, fs: io });
    };
  }

  const copyFile = promises.copyFile;
  promises.copyFile = async (source, target, mode) => {
    if (point === "D3" && isVersion(target, 2)) pause();
    await copyFile(source, target, mode);
  };

  const open = promises.open;
  promises.open = async (path, flags, mode) => {
    const handle = await open(path, flags, mode);
    if (point === "D4" && isVersion(path, 2)) {
      const close = handle.close.bind(handle);
      handle.close = async () => {
        await close();
        pause();
      };
    }
    return handle;
  };

  const rm = promises.rm;
  promises.rm = async (path, options) => {
    await rm(path, options);
    if (point === "D8" && isVersion(path, 1)) pause();
  };
  syncBuiltinESMExports();
}

function isVersion(path: fs.PathLike, generation: number): boolean {
  return String(path).replace(/\\/g, "/").endsWith(`/versions/${generation}/source.md`);
}
