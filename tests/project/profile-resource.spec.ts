import { describe, expect, it } from "vitest";

import { createProjectId, createSessionId } from "../../src/brand/ids.js";
import { createMainAgentProfile } from "../../src/project/profile.js";
import { SEND_TO_MAIN_TOOL_NAME } from "../../src/tools/builtins/mailbox/send.js";
import { DELETE_RESOURCE_TOOL_NAME } from "../../src/tools/builtins/resource/delete.js";
import { FETCH_RESOURCE_TOOL_NAME } from "../../src/tools/builtins/resource/fetch.js";
import { REGISTER_RESOURCE_TOOL_NAME } from "../../src/tools/builtins/resource/register.js";
import { UPDATE_RESOURCE_TOOL_NAME } from "../../src/tools/builtins/resource/update.js";
import { SET_RESOURCE_ACCESS_TOOL_NAME } from "../../src/tools/builtins/resource/access.js";

describe("Main Agent Resource profile", () => {
  it("exposes owner Resource CRUD but not Node-to-Main messaging", () => {
    const profile = createMainAgentProfile({
      id: createProjectId("project"),
      goal: "Coordinate the Project",
      mainSessionId: createSessionId("main"),
      status: "active",
      revision: 1,
    });

    expect(profile.toolNames).toEqual(expect.arrayContaining([
      REGISTER_RESOURCE_TOOL_NAME,
      FETCH_RESOURCE_TOOL_NAME,
      UPDATE_RESOURCE_TOOL_NAME,
      DELETE_RESOURCE_TOOL_NAME,
      SET_RESOURCE_ACCESS_TOOL_NAME,
    ]));
    expect(profile.toolNames).not.toContain(SEND_TO_MAIN_TOOL_NAME);
    expect(profile.systemPrompt).toContain("Resources owned by Nodes are read-only");
    expect(profile.systemPrompt).toContain("set_resource_access");
  });
});
