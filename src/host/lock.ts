import { userInfo } from "node:os";
import { join } from "node:path";
import lockfile from "proper-lockfile";

export const HOST_LOCK_TARGET = join(userInfo().homedir, ".navo-host");

export async function acquireHostLock(): Promise<() => Promise<void>> {
  try {
    return await lockfile.lock(HOST_LOCK_TARGET, { realpath: false, retries: 0, stale: 10_000, update: 2_000 });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ELOCKED") {
      throw Object.assign(new Error("host-already-running: another Navo Host owns this OS user's asset lifecycle."), { code: "host-already-running" });
    }
    throw error;
  }
}
