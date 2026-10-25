import { describe, expect, it } from "vitest";

import { createNodeAgentProfile } from "../../src/node/profile.js";
import { createMainAgentProfile } from "../../src/project/profile.js";
import { SEND_TO_MAIN_TOOL_NAME } from "../../src/tools/builtins/mailbox/send.js";
import { DELETE_RESOURCE_TOOL_NAME } from "../../src/tools/builtins/resource/delete.js";
import { FETCH_RESOURCE_TOOL_NAME } from "../../src/tools/builtins/resource/fetch.js";
import { REGISTER_RESOURCE_TOOL_NAME } from "../../src/tools/builtins/resource/register.js";
import { UPDATE_RESOURCE_TOOL_NAME } from "../../src/tools/builtins/resource/update.js";
import { SET_RESOURCE_ACCESS_TOOL_NAME } from "../../src/tools/builtins/resource/access.js";

describe("Main Agent Resource profile", () => {
  it("gives Main, Main review and Node on-demand tools with optional discovery guidance", () => {
    for (const profile of [createMainAgentProfile(), createMainAgentProfile(true), createNodeAgentProfile()]) {
      expect(profile.toolNames).toEqual(expect.arrayContaining(["list_resources", "search_resources", "fetch_resource"]));
      expect(profile.systemPrompt).not.toContain("resource-catalog");
      expect(profile.systemPrompt).toContain("a known valid Resource ID may be fetched directly");
      expect(profile.systemPrompt).toContain("no retrieval is needed");
    }
  });
  it("exposes owner Resource CRUD but not Node-to-Main messaging", () => {
    const profile = createMainAgentProfile();

    expect(profile.toolNames).toEqual(expect.arrayContaining([
      REGISTER_RESOURCE_TOOL_NAME,
      "list_resources",
      "search_resources",
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
