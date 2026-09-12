import { XeroClientSession } from "../../XeroApiClient.js";
import { IMcpServerTool } from "../IMcpServerTool.js";

export const GetBalanceSheetTool: IMcpServerTool = {
  requestSchema: {
    name: "get_balance_sheet",
    description: "Returns the Xero API's default balance sheet report. This tool does not accept a report date or comparison options.",
    inputSchema: { type: "object", properties: {} },
  },
  requestHandler: async () => {
    const response =
      await XeroClientSession.xeroClient.accountingApi.getReportBalanceSheet(
        XeroClientSession.activeTenantId()!!
      );
    const reports = response.body.reports || [];
    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(reports),
        },
      ],
    };
  },
};
