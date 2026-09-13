import { XeroClientSession } from "../XeroApiClient.js";
import { AuthenticateTool } from "../Tools/Authenticate.js";
import { IRequestMiddleware } from "./IRequestMiddleware.js";

export const XeroAuthMiddleware: IRequestMiddleware = async (request, next) => {
  const { name } = request.params;
  if (name === AuthenticateTool.requestSchema.name) {
    return await AuthenticateTool.requestHandler(request);
  }
  if (!XeroClientSession.isAuthenticated()) {
    return Promise.resolve({
      isError: true,
      content: [
        {
          type: "text",
          text:
            "You must authenticate with Xero first. Call the authenticate tool to open the Xero login page.",
        },
      ],
    });
  }
  const tenantId = XeroClientSession.activeTenantId();
  if (!tenantId) {
    throw new Error("No tenant selected. Please authenticate again.");
  }
  return next(request);
};
