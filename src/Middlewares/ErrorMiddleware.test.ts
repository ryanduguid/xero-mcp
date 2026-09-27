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

  // xero-node 13 and later reject with JSON.stringify({ response, body }), and
  // response.request.headers carries the caller's bearer token.
  it("describes a JSON string rejection without the access token", async () => {
    const token = "SYNTHETIC-ACCESS-TOKEN-0000";
    const rejection = JSON.stringify({
      response: {
        statusCode: 400,
        statusMessage: "Bad Request",
        request: { headers: { authorization: `Bearer ${token}` } },
        body: { Type: "ValidationException", Message: "A validation exception occurred" },
      },
      body: { Message: "A validation exception occurred" },
    });

    const result = await ErrorMiddleware(request, async () => {
      throw rejection;
    });
    const text = String((result.content as any)[0].text);

    expect(result.isError).toBe(true);
    expect(text).toBe("Unexpected error occurred: Xero API 400 Bad Request: A validation exception occurred");
    expect(text).not.toContain(token);
  });

  it("leaves a successful result unflagged", async () => {
    const result = await ErrorMiddleware(request, async () => ({
      content: [{ type: "text" as const, text: "ok" }],
    }));

    expect(result.isError).toBeUndefined();
  });
});
