import { XeroClientSession } from "../XeroApiClient.js";
import { IMcpServerTool } from "./IMcpServerTool.js";
import http from "http";
import { randomBytes } from "node:crypto";
import open from "open";
import { CallToolResult } from "@modelcontextprotocol/sdk/types.js";

if (!process.env.XERO_REDIRECT_URI) {
  throw Error(
    "XERO_REDIRECT_URI environment variable not set - please add the required environment variables to your config file.",
  );
}

const REDIRECT_URI = new URL(process.env.XERO_REDIRECT_URI);

const REDIRECT_PORT = REDIRECT_URI.port || undefined;
if (!REDIRECT_PORT) {
  throw new Error(
    "XERO_REDIRECT_URI must include an explicit port, e.g. http://localhost:5000/callback",
  );
}
const REDIRECT_PATH = REDIRECT_URI.pathname;
if (REDIRECT_URI.protocol !== "http:" || !["localhost", "127.0.0.1", "[::1]"].includes(REDIRECT_URI.hostname)) {
  throw new Error("XERO_REDIRECT_URI must use HTTP on a loopback host.");
}
const REDIRECT_HOSTS = REDIRECT_URI.hostname === "localhost"
  ? ["127.0.0.1", "::1"]
  : [REDIRECT_URI.hostname === "[::1]" ? "::1" : "127.0.0.1"];
let authenticationPending = false;

const AUTH_SUCCESS_HTML = `<!doctype html><html><head><meta charset="utf-8"><title>Xero MCP authenticated</title>
<style>body{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;max-width:32rem;margin:4rem auto;padding:0 1rem;color:#111}</style>
</head><body><h1>Xero MCP Authenticated</h1><p style="font-size:1.2rem">You can close this tab and return to your agent.</p></body></html>`;

const HTML_ESCAPES: Record<string, string> = {
  "<": "&lt;",
  ">": "&gt;",
  "&": "&amp;",
};

const escapeHtml = (s: string) => s.replace(/[<>&]/g, (c) => HTML_ESCAPES[c]);

const AUTH_ERROR_HTML = (msg: string) =>
  `<!doctype html><html><head><meta charset="utf-8"><title>Xero MCP error</title></head>
<body><h1>Authentication failed</h1><pre>${escapeHtml(msg)}</pre></body></html>`;

export const AuthenticateTool: IMcpServerTool = {
  requestSchema: {
    name: "authenticate",
    description: "Authenticate with Xero using OAuth2",
    inputSchema: { type: "object", properties: {} },
  },
  requestHandler: async () => {
    if (authenticationPending) throw new Error("Xero authentication is already in progress.");
    const servers = REDIRECT_HOSTS.map(() => http.createServer());
    authenticationPending = true;
    let oauth2Process: Awaited<ReturnType<typeof open>> | undefined;
    let timeout: ReturnType<typeof setTimeout> | undefined;
    let acceptingCallback = true;
    try {
      const state = randomBytes(32).toString("hex");
      XeroClientSession.xeroClient.config!.state = state;
      const consentUrl = await XeroClientSession.xeroClient.buildConsentUrl();
      return await new Promise<CallToolResult>((resolve, reject) => {
        timeout = setTimeout(() => {
          acceptingCallback = false;
          reject(new Error("Xero authentication timed out after 2 minutes."));
        }, 120_000);
        const handleRequest: http.RequestListener = async (req, res) => {
          let url: URL;
          try {
            url = new URL(req.url ?? "/", REDIRECT_URI);
          } catch {
            res.writeHead(400);
            res.end("Invalid callback URL.");
            return;
          }
          if (url.pathname !== REDIRECT_PATH) {
            res.writeHead(404);
            res.end("Not found");
            return;
          }
          if (!acceptingCallback || url.searchParams.get("state") !== state) {
            res.writeHead(400, { "Content-Type": "text/plain; charset=utf-8" });
            res.end("Invalid OAuth state.");
            return;
          }
          acceptingCallback = false;
          clearTimeout(timeout);
          try {
            const tokenSet = await XeroClientSession.xeroClient.apiCallback(
              req.url!,
            );
            XeroClientSession.xeroClient.setTokenSet(tokenSet);
            await XeroClientSession.xeroClient.updateTenants();
            XeroClientSession.setActiveTenantId(
              XeroClientSession.xeroClient.tenants[0].tenantId,
            );
            XeroClientSession.scheduleTokenRefresh(tokenSet);

            res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
            res.end(AUTH_SUCCESS_HTML);

            resolve({
              content: [
                {
                  type: "text",
                  text: "Authenticated successfully",
                },
              ],
            });
          } catch (error: any) {
            try {
              res.writeHead(500, {
                "Content-Type": "text/html; charset=utf-8",
              });
              res.end(AUTH_ERROR_HTML(error?.message ?? "unknown error"));
            } catch (error) {
              // response may have been closed already
              console.error(
                "Error sending authentication error response:",
                error,
              );
            }
            reject(
              new Error(
                `Error authenticating user: ${error?.message ?? String(error)}`,
              ),
            );
          }
        };
        const bindings = servers.map((server, index) => new Promise<void>((bound, failed) => {
          let listening = false;
          server.once("error", (error) => {
            if (listening) reject(error); else failed(error);
          });
          server.on("request", handleRequest);
          server.listen(Number(REDIRECT_PORT), REDIRECT_HOSTS[index], () => {
            listening = true;
            bound();
          });
        }));
        Promise.allSettled(bindings).then(async (results) => {
          if (!acceptingCallback) {
            servers.forEach(server => server.close());
            return;
          }
          const failures = results.filter(result => result.status === "rejected");
          const fatal = failures.find(result => !["EAFNOSUPPORT", "EPROTONOSUPPORT", "EADDRNOTAVAIL"].includes(result.reason.code));
          if (fatal) throw fatal.reason;
          if (failures.length === servers.length) throw failures[0].reason;
          oauth2Process = await open(consentUrl);
        }).catch(reject);
      });
    } finally {
      acceptingCallback = false;
      if (timeout) clearTimeout(timeout);
      servers.forEach(server => server.close());
      XeroClientSession.xeroClient.config!.state = undefined;
      authenticationPending = false;
      try {
        oauth2Process?.kill();
      } catch {
        // The browser process may already be detached.
      }
    }
  },
};
