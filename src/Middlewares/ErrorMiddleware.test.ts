import { CallToolRequest } from "@modelcontextprotocol/sdk/types.js";
import { ErrorMiddleware } from "./ErrorMiddleware.js";

const request = {
  method: "tools/call",
  params: { name: "list_accounts", arguments: {} },
} as CallToolRequest;

describe("ErrorMiddleware", () => {
  // F109: a tool execution failure must carry the MCP error flag.
  it("flags a provider failure as a tool error", async () => {
    const result = await ErrorMiddleware(request, async () => {
      throw new Error("Simulated Xero failure");
    });

    expect(result.isError).toBe(true);
    expect(String((result.content as any)[0].text)).toContain("Simulated Xero failure");
  });

  it("leaves a successful result unflagged", async () => {
    const result = await ErrorMiddleware(request, async () => ({
      content: [{ type: "text" as const, text: "ok" }],
    }));

    expect(result.isError).toBeUndefined();
  });
});
