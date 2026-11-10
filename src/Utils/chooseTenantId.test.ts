import { chooseTenantId } from "./chooseTenantId.js";

// Fabricated organisations only.
const DEMO_AU = { tenantId: "aaaaaaaa-1111-4111-8111-111111111111", tenantName: "Demo AU" };
const DEMO_NZ = { tenantId: "bbbbbbbb-2222-4222-8222-222222222222", tenantName: "Demo NZ" };

function choose(connections: { tenantId: string; tenantName?: string }[], chosen?: string) {
  jest.replaceProperty(process, "env", { XERO_TENANT_ID: chosen });
  const log = jest.spyOn(console, "error").mockImplementation(() => {});
  let tenantId = "";
  let refusal = "";
  try {
    tenantId = chooseTenantId(connections);
  } catch (error) {
    refusal = (error as Error).message;
  }
  return { tenantId, refusal, logged: log.mock.calls.flat().join(" ") };
}

afterEach(() => {
  jest.restoreAllMocks();
});

describe("chooseTenantId", () => {
  it("refuses 2 organisations with none chosen, and names them on stderr only", () => {
    const { tenantId, refusal, logged } = choose([DEMO_AU, DEMO_NZ]);

    expect(tenantId).toBe("");
    expect(refusal).toMatch(/2 Xero organisations.*XERO_TENANT_ID.*server log/);
    for (const organisation of [DEMO_AU, DEMO_NZ]) {
      expect(refusal).not.toContain(organisation.tenantId);
      expect(refusal).not.toContain(organisation.tenantName);
      expect(logged).toContain(`${organisation.tenantId} (${organisation.tenantName})`);
    }
  });

  it("refuses a chosen organisation the login cannot reach, without naming the one it can", () => {
    const { tenantId, refusal, logged } = choose([DEMO_AU], DEMO_NZ.tenantId);

    expect(tenantId).toBe("");
    expect(refusal).toContain(`XERO_TENANT_ID ${DEMO_NZ.tenantId} is not among the 1 Xero organisation`);
    expect(refusal).not.toContain(DEMO_AU.tenantId);
    expect(refusal).not.toContain(DEMO_AU.tenantName);
    expect(logged).toContain(`${DEMO_AU.tenantId} (${DEMO_AU.tenantName})`);
  });

  it("refuses when the login reaches no organisation", () => {
    expect(choose([]).refusal).toContain("reaches no organisation");
  });

  it("logs an organisation Xero gave no name as unnamed", () => {
    const { logged } = choose([DEMO_AU, { tenantId: DEMO_NZ.tenantId }]);

    expect(logged).toContain(`${DEMO_NZ.tenantId} (unnamed)`);
  });

  it.each([
    ["the chosen organisation, not the first listed", [DEMO_AU, DEMO_NZ], DEMO_NZ.tenantId],
    ["the chosen organisation whatever its letter case", [DEMO_AU, DEMO_NZ], DEMO_NZ.tenantId.toUpperCase()],
    ["the chosen organisation with spaces around its ID", [DEMO_AU, DEMO_NZ], ` ${DEMO_NZ.tenantId} `],
    ["the only organisation when none is chosen", [DEMO_NZ], undefined],
    ["the only organisation when the setting is blank", [DEMO_NZ], "  "],
  ])("uses %s, and logs nothing", (_, connections, chosen) => {
    const { tenantId, refusal, logged } = choose(connections, chosen);

    expect(refusal).toBe("");
    expect(tenantId).toBe(DEMO_NZ.tenantId);
    expect(logged).toBe("");
  });
});
