import { Auditor } from "../Auditor.js";
import { IRequestMiddleware } from "./IRequestMiddleware.js";

export const AuditMiddleware: IRequestMiddleware = async (request, next) => {
  const { name } = request.params;
  Auditor.record(`${name}_begin`);
  try {
    return await next(request);
  } finally {
    Auditor.record(`${name}_end`);
  }
};
