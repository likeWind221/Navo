import { describe, expect, it } from "vitest";

import { createNodeAgentProfile } from "../../src/node/profile.js";
import { SEND_TO_MAIN_TOOL_NAME } from "../../src/tools/builtins/mailbox/send.js";
import { DELETE_RESOURCE_TOOL_NAME } from "../../src/tools/builtins/resource/delete.js";
import { FETCH_RESOURCE_TOOL_NAME } from "../../src/tools/builtins/resource/fetch.js";
import { REGISTER_RESOURCE_TOOL_NAME } from "../../src/tools/builtins/resource/register.js";
import { UPDATE_RESOURCE_TOOL_NAME } from "../../src/tools/builtins/resource/update.js";
import { SET_RESOURCE_ACCESS_TOOL_NAME } from "../../src/tools/builtins/resource/access.js";

describe("NodeAgent file capability", () => {
  it("adds only read when the host file capability is available", async () => {
    const withoutFiles = createNodeAgentProfile();
    const withRead = createNodeAgentProfile({ allowFileRead: true });

    expect(withoutFiles.toolNames).not.toContain("read");
    expect(withRead.toolNames).toContain("read");
    expect(withRead.toolNames).toEqual(expect.arrayContaining([
      REGISTER_RESOURCE_TOOL_NAME,
      FETCH_RESOURCE_TOOL_NAME,
      UPDATE_RESOURCE_TOOL_NAME,
      DELETE_RESOURCE_TOOL_NAME,
      SEND_TO_MAIN_TOOL_NAME,
    ]));
    expect(withRead.toolNames).not.toContain(SET_RESOURCE_ACCESS_TOOL_NAME);
    expect(withRead.toolNames).not.toEqual(
      expect.arrayContaining(["shell", "edit", "write"]),
    );
    expect(withRead.systemPrompt).toContain("file_path");
    expect(withRead.systemPrompt).toContain("read");
  });
});
