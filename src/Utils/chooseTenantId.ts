type Connection = { tenantId: string; tenantName?: string };

// The tenant IDs and names go to the server log on stderr (stdout carries the
// MCP protocol), not into the refusal: for a practice login they are client
// names, and the model should not see them.
function logReachable(connections: Connection[]): void {
  const reachable = connections
    .map(({ tenantId, tenantName }) => `${tenantId} (${tenantName ?? "unnamed"})`)
    .join(", ");
  console.error(`Xero organisations this login reaches: ${reachable}`);
}

// A Xero login can reach several organisations. Taking the first one Xero
// lists would read whichever organisation happens to sort first, so with more
// than one the user must choose it with XERO_TENANT_ID.
export function chooseTenantId(connections: Connection[]): string {
  if (connections.length === 0) {
    throw new Error(
      "This Xero login reaches no organisation. Connect one to the app, then try again.",
    );
  }

  const count =
    connections.length === 1
      ? "1 Xero organisation"
      : `${connections.length} Xero organisations`;
  const chosenTenantId = process.env.XERO_TENANT_ID?.trim();

  if (chosenTenantId) {
    // Tenant IDs are GUIDs, so letter case carries no meaning.
    const chosen = connections.find(
      ({ tenantId }) => tenantId.toLowerCase() === chosenTenantId.toLowerCase(),
    );
    if (!chosen) {
      logReachable(connections);
      throw new Error(
        `XERO_TENANT_ID ${chosenTenantId} is not among the ${count} this login reaches. The server log lists their tenant IDs and names.`,
      );
    }
    return chosen.tenantId;
  }

  if (connections.length > 1) {
    logReachable(connections);
    throw new Error(
      `This login reaches ${count}. Set XERO_TENANT_ID to the one to use; the server log lists their tenant IDs and names.`,
    );
  }

  return connections[0].tenantId;
}
