import "server-only";

import { recordPipelineMetric } from "@/lib/observability/pipeline-metrics";
import {
  acquireRequestCapacity,
  createOverloadResponse,
} from "@/lib/reliability/request-governor";

type ApiLogLevel = "info" | "warn" | "error";

type ApiLogContext = {
  route: string;
  requestId: string;
  method?: string;
  status?: number;
  ms?: number;
  msg: string;
  error?: string;
};

export type ApiHandlerContext = {
  requestId: string;
};

export function getRequestId(request: Request) {
  // Generate IDs server-side so user-controlled headers never reach logs.
  void request;
  return crypto.randomUUID();
}

export async function withApiLogging(
  request: Request,
  route: string,
  handler: (context: ApiHandlerContext) => Promise<Response> | Response,
) {
  const startedAt = Date.now();
  const requestId = getRequestId(request);
  const capacity = acquireRequestCapacity(route, request.method);

  if (!capacity.ok) {
    logApi("warn", {
      route,
      requestId,
      method: request.method,
      status: 429,
      ms: 0,
      msg: "overloaded",
    });
    recordPipelineMetric("pipeline.api.overload_rejections", 1, "count", {
      route,
      method: request.method,
      operation: capacity.policy.capacityClass,
      result: "rejected",
    });
    const response = createOverloadResponse(capacity, requestId);
    response.headers.set("x-request-id", requestId);
    return response;
  }

  logApi("info", {
    route,
    requestId,
    method: request.method,
    msg: "start",
  });

  try {
    const response = await handler({ requestId });
    response.headers.set("x-request-id", requestId);
    response.headers.set("Cache-Control", "private, no-store, max-age=0");
    response.headers.set("Pragma", "no-cache");

    logApi(response.status >= 500 ? "error" : "info", {
      route,
      requestId,
      method: request.method,
      status: response.status,
      ms: Date.now() - startedAt,
      msg: "done",
    });
    recordPipelineMetric("pipeline.api.requests", 1, "count", {
      route,
      method: request.method,
      status_class: `${Math.floor(response.status / 100)}xx`,
    });
    recordPipelineMetric("pipeline.api.duration", Date.now() - startedAt, "milliseconds", {
      route,
      method: request.method,
      status_class: `${Math.floor(response.status / 100)}xx`,
    });

    return response;
  } catch {
    const elapsed = Date.now() - startedAt;
    logApi("error", {
      route,
      requestId,
      method: request.method,
      status: 500,
      ms: elapsed,
      msg: "failed",
      error: "request_failed",
    });
    recordPipelineMetric("pipeline.api.requests", 1, "count", {
      route,
      method: request.method,
      status_class: "5xx",
    });
    recordPipelineMetric("pipeline.api.duration", elapsed, "milliseconds", {
      route,
      method: request.method,
      status_class: "5xx",
    });

    return Response.json(
      { error: "Internal server error", request_id: requestId },
      {
        status: 500,
        headers: {
          "x-request-id": requestId,
          "Cache-Control": "private, no-store, max-age=0",
          "Pragma": "no-cache",
        },
      },
    );
  } finally {
    capacity.release();
  }
}

export function logApi(level: ApiLogLevel, context: ApiLogContext) {
  const payload = {
    level,
    service: "pipeline-app",
    checked_at: new Date().toISOString(),
    ...context,
  };

  if (level === "error") {
    console.error(JSON.stringify(payload));
    return;
  }

  if (level === "warn") {
    console.warn(JSON.stringify(payload));
    return;
  }

  console.log(JSON.stringify(payload));
}
