import { jsonError, readJsonBody } from "@/lib/extraction/contracts";
import { requirePipelineUser } from "@/lib/auth/pipeline-auth";
import { requireSameOriginMutation } from "@/lib/auth/request-security";
import {
  createReferral,
  DuplicateReferralPacketError,
  listReferrals,
  requireReferralStore,
  type ReferralCreateInput,
} from "@/lib/pipeline/referral-store";
import { validateReferralCreateInput } from "@/lib/pipeline/referral-validation";
import { parseReferralListQuery } from "@/lib/pipeline/referral-query";
import { getReferralProgress } from "@/lib/pipeline/referral-progress";
import { getReferralWorkflowContexts } from "@/lib/pipeline/workflow-store";
import { withApiLogging } from "@/lib/observability/api-logging";
import { assignedOwnerForCreate, scopeReferralListOptions } from "@/lib/pipeline/referral-access";

export const runtime = "nodejs";

type CreateReferralBody = {
  referral?: ReferralCreateInput;
  client_mutation_id?: string;
};

export async function GET(request: Request) {
  return withApiLogging(request, "/api/referrals", async () => {
    const auth = await requirePipelineUser(request);
    if (!auth.ok) return auth.response;
    const store = requireReferralStore();
    if (!store.ok) return store.response;

    const url = new URL(request.url);
    const query = parseReferralListQuery(url.searchParams);
    if (!query.ok) return jsonError(query.message);
    const requestedOptions = query.value.queue === "my_work"
      ? { ...query.value, queue: undefined, activeOnly: true }
      : query.value;
    const options = scopeReferralListOptions(auth.user, requestedOptions);
    const result = await listReferrals(options);
    const contexts = await getReferralWorkflowContexts(result.referrals);
    const progress = Object.fromEntries(result.referrals.map((referral) => [
      referral.id,
      getReferralProgress(referral, contexts.get(referral.id)),
    ]));

    return Response.json({ ...result, progress }, {
      headers: {
        "Cache-Control": "no-store, max-age=0",
      },
    });
  });
}

export async function POST(request: Request) {
  return withApiLogging(request, "/api/referrals", async () => {
    const auth = await requirePipelineUser(request, [
      "admin",
      "assessment_coordinator",
      "reviewer",
    ]);
    if (!auth.ok) return auth.response;
    const originFailure = requireSameOriginMutation(request);
    if (originFailure) return originFailure;
    const store = requireReferralStore();
    if (!store.ok) return store.response;

    const body = await readJsonBody<CreateReferralBody>(request);
    if (!body.ok) return jsonError(body.message, body.status);

    if (!body.value || typeof body.value !== "object" || Array.isArray(body.value)) {
      return jsonError("The request body must be an object.");
    }

    const referralResult = validateReferralCreateInput(body.value.referral);
    if (!referralResult.ok) return jsonError(referralResult.message, referralResult.status);
    const assignment = assignedOwnerForCreate(auth.user, referralResult.value.owner);
    const referral = { ...referralResult.value, ...assignment };

    if (
      body.value.client_mutation_id !== undefined &&
      (typeof body.value.client_mutation_id !== "string" || !isSafeMutationId(body.value.client_mutation_id))
    ) {
      return jsonError("client_mutation_id is invalid.");
    }

    try {
      const result = await createReferral(
        referral,
        body.value.client_mutation_id,
        { id: auth.user.id, name: auth.user.name },
      );

      return Response.json(result, {
        status: 201,
        headers: {
          "Cache-Control": "no-store, max-age=0",
        },
      });
    } catch (error) {
      if (error instanceof DuplicateReferralPacketError) {
        return Response.json(
          {
            error: "This exact packet is already attached to a referral. Open the existing referral instead.",
            duplicate: true,
            referral_id: error.referralId,
          },
          { status: 409 },
        );
      }
      return jsonError(
        error instanceof Error ? error.message : "Could not create referral.",
        507,
      );
    }
  });
}

function isSafeMutationId(value: string) {
  return value.length > 0 && value.length <= 128 && /^[a-zA-Z0-9_.:-]+$/.test(value);
}
