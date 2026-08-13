import "server-only";

export type RequestCapacityClass = "exempt" | "read" | "mutation" | "upload" | "worker";

export type RequestCapacityPolicy = {
  capacityClass: RequestCapacityClass;
  maxConcurrent: number;
  edgeRequestsPerMinute: number | null;
};

export type RequestCapacityLease = {
  ok: true;
  policy: RequestCapacityPolicy;
  release: () => void;
};

export type RequestCapacityRejection = {
  ok: false;
  policy: RequestCapacityPolicy;
  retryAfterSeconds: number;
};

const mutationMethods = new Set(["POST", "PUT", "PATCH", "DELETE"]);

export class RequestGovernor {
  private readonly inFlight = new Map<RequestCapacityClass, number>();

  constructor(private readonly limits: Record<Exclude<RequestCapacityClass, "exempt">, number>) {}

  acquire(capacityClass: RequestCapacityClass): RequestCapacityLease | RequestCapacityRejection {
    const policy = getRequestCapacityPolicy("", "GET", this.limits, capacityClass);
    if (capacityClass === "exempt") {
      return { ok: true, policy, release: () => undefined };
    }

    const current = this.inFlight.get(capacityClass) ?? 0;
    if (current >= policy.maxConcurrent) {
      return { ok: false, policy, retryAfterSeconds: 1 };
    }

    this.inFlight.set(capacityClass, current + 1);
    let released = false;
    return {
      ok: true,
      policy,
      release: () => {
        if (released) return;
        released = true;
        const active = this.inFlight.get(capacityClass) ?? 1;
        if (active <= 1) this.inFlight.delete(capacityClass);
        else this.inFlight.set(capacityClass, active - 1);
      },
    };
  }
}

const configuredLimits = {
  read: boundedInteger("PIPELINE_MAX_CONCURRENT_READS", 100, 1, 500),
  mutation: boundedInteger("PIPELINE_MAX_CONCURRENT_MUTATIONS", 40, 1, 200),
  upload: boundedInteger("PIPELINE_MAX_CONCURRENT_UPLOADS", 4, 1, 50),
  worker: boundedInteger("PIPELINE_MAX_CONCURRENT_WORKERS", 8, 1, 100),
};

const sharedGovernor = new RequestGovernor(configuredLimits);

export function acquireRequestCapacity(route: string, method: string) {
  const policy = getRequestCapacityPolicy(route, method, configuredLimits);
  return sharedGovernor.acquire(policy.capacityClass);
}

export function getRequestCapacityPolicy(
  route: string,
  method: string,
  limits: Record<Exclude<RequestCapacityClass, "exempt">, number> = configuredLimits,
  forcedClass?: RequestCapacityClass,
): RequestCapacityPolicy {
  const normalizedMethod = method.toUpperCase();
  const capacityClass = forcedClass ?? classifyRequest(route, normalizedMethod);
  if (capacityClass === "exempt") {
    return { capacityClass, maxConcurrent: Number.POSITIVE_INFINITY, edgeRequestsPerMinute: null };
  }

  return {
    capacityClass,
    maxConcurrent: limits[capacityClass],
    edgeRequestsPerMinute: edgeRateFor(capacityClass),
  };
}

export function createOverloadResponse(rejection: RequestCapacityRejection, requestId: string) {
  return Response.json(
    {
      error: "Pipeline is handling unusually high activity. Retry this request shortly.",
      request_id: requestId,
    },
    {
      status: 429,
      headers: {
        "Cache-Control": "private, no-store, max-age=0",
        Pragma: "no-cache",
        "Retry-After": String(rejection.retryAfterSeconds),
        "X-Pipeline-Capacity-Class": rejection.policy.capacityClass,
      },
    },
  );
}

function classifyRequest(route: string, method: string): RequestCapacityClass {
  if (route === "/api/health") return "exempt";
  if (route.startsWith("/api/internal/")) return "worker";
  if (route.startsWith("/api/uploads/")) return "upload";
  return mutationMethods.has(method) ? "mutation" : "read";
}

function edgeRateFor(capacityClass: Exclude<RequestCapacityClass, "exempt">) {
  if (capacityClass === "upload") return 30;
  if (capacityClass === "worker") return 120;
  if (capacityClass === "mutation") return 180;
  return 600;
}

function boundedInteger(name: string, fallback: number, minimum: number, maximum: number) {
  const raw = typeof process === "undefined" ? "" : process.env[name] ?? "";
  const value = Number.parseInt(raw, 10);
  return Number.isInteger(value) ? Math.min(maximum, Math.max(minimum, value)) : fallback;
}
