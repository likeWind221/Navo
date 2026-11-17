import { writeFileSync } from "node:fs";

export default class RunStatus {
  onTestRunEnd(_modules, errors, reason) {
    writeFileSync(process.env.NAVO_CI_STATUS, JSON.stringify({ errors: errors.length, reason }));
  }
}
