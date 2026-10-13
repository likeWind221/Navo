import { execFile } from "node:child_process";
import { chmod, lstat } from "node:fs/promises";
import { promisify } from "node:util";

import { ChatGPTAuthError } from "./error.js";

const execute = promisify(execFile);
let windowsSid: Promise<string> | undefined;

export async function protectDirectory(path: string): Promise<void> {
  if (process.platform !== "win32") {
    await chmod(path, 0o700);
    return;
  }
  const sid = await currentSid();
  await execute("icacls.exe", [path, "/inheritance:r", "/grant:r", `*${sid}:(OI)(CI)F`], { windowsHide: true });
  await checkPermissions(path, true);
}

export async function checkPermissions(path: string, directory: boolean): Promise<void> {
  const info = await lstat(path);
  if (info.isSymbolicLink() || (directory ? !info.isDirectory() : !info.isFile())) unsafe();
  if (process.platform !== "win32") {
    if ((info.mode & 0o077) !== 0 || info.uid !== process.getuid?.()) unsafe();
    return;
  }
  const sid = await currentSid();
  const literal = path.replaceAll("'", "''");
  const command = `$ErrorActionPreference = 'Stop'; $acl = [System.IO.${directory ? "Directory" : "File"}]::GetAccessControl('${literal}'); `
    + `[Console]::WriteLine($acl.GetOwner([System.Security.Principal.SecurityIdentifier]).Value); `
    + `foreach ($rule in $acl.Access) { if ($rule.AccessControlType -eq 'Allow') { [Console]::WriteLine($rule.IdentityReference.Translate([System.Security.Principal.SecurityIdentifier]).Value) } }`;
  const { stdout } = await execute("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", command], { windowsHide: true });
  const [owner, ...allowed] = stdout.trim().split(/\r?\n/);
  if (owner !== sid || !allowed.includes(sid)
    || allowed.some(identity => ![sid, "S-1-5-18", "S-1-5-32-544"].includes(identity))) unsafe();
}

function currentSid(): Promise<string> {
  windowsSid ??= execute("whoami.exe", ["/user", "/fo", "csv", "/nh"], { windowsHide: true }).then(({ stdout }) => {
    const sid = stdout.match(/S-1-5-[0-9-]+/)?.[0];
    if (!sid) unsafe();
    return sid;
  });
  return windowsSid;
}

function unsafe(): never {
  throw new ChatGPTAuthError("unsafe-store", "ChatGPT credentials require an owner-only local directory and file.");
}
