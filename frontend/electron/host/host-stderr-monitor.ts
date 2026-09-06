const DEFAULT_MAX_STDERR_LINE_CHARS = 8_192;

export interface HostStderrMonitorOptions {
  readonly readyMarker: string;
  readonly secrets?: readonly string[];
  readonly maxLineChars?: number;
  readonly onReady: () => void;
  readonly onLog: (line: string) => void;
}

export class HostStderrMonitor {
  private readonly decoder = new TextDecoder();
  private buffer = "";
  private oversized = false;

  constructor(private readonly options: HostStderrMonitorOptions) {}

  push(chunk: Uint8Array): void {
    this.buffer += this.decoder.decode(chunk, { stream: true });
    this.takeLines();
    const limit = this.options.maxLineChars ?? DEFAULT_MAX_STDERR_LINE_CHARS;
    if (this.buffer.length > limit) {
      this.buffer = "";
      this.oversized = true;
    }
  }

  finish(): void {
    this.buffer += this.decoder.decode();
    if (this.buffer.length > 0 || this.oversized) this.emit(this.buffer.replace(/\r$/, ""));
    this.buffer = "";
  }

  private takeLines(): void {
    let newline = this.buffer.indexOf("\n");
    while (newline >= 0) {
      const line = this.buffer.slice(0, newline).replace(/\r$/, "");
      this.buffer = this.buffer.slice(newline + 1);
      this.emit(line);
      newline = this.buffer.indexOf("\n");
    }
  }

  private emit(line: string): void {
    if (this.oversized) {
      this.oversized = false;
      this.options.onLog("[kernel-host] stderr line exceeded the safe log limit");
      return;
    }
    if (line.includes(this.options.readyMarker)) this.options.onReady();
    if (line.length > 0) this.options.onLog(redactHostLog(line, this.options.secrets));
  }
}

export function redactHostLog(line: string, secrets: readonly string[] = []): string {
  let safe = line
    .replace(/(Bearer\s+)[^\s]+/gi, "$1[REDACTED]")
    .replace(/((?:api[_-]?key|authorization)\s*[:=]\s*)[^\s,;]+/gi, "$1[REDACTED]");
  for (const secret of secrets) {
    if (secret.length > 0) safe = safe.replaceAll(secret, "[REDACTED]");
  }
  return safe;
}
