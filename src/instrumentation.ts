import type { Instrumentation } from "next";

/** Writes one structured line per server error to the hosting platform's logs (no request bodies, no personal data). */
export const onRequestError: Instrumentation.onRequestError = async (err, request, context) => {
  const e = err as { message?: string; digest?: string };
  console.error(JSON.stringify({ level: "error", message: e.message, digest: e.digest, method: request.method, path: request.path.split("?")[0], route: context.routePath, type: context.routeType }));
};
