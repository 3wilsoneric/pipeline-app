#!/usr/bin/env node

import { loadTypeScriptModule } from "./ts-module-loader.mjs";

const root = process.cwd();

const contracts = loadTypeScriptModule(root, "lib/extraction/contracts.ts");
const assessmentSchema = loadTypeScriptModule(root, "lib/assessment/assessment-tool-schema.ts");
const assessmentValidation = loadTypeScriptModule(root, "lib/assessment/assessment-validation.ts");
const referralExtractionSchema = loadTypeScriptModule(root, "lib/extraction/referral-intake-schema.ts");
const referralValidation = loadTypeScriptModule(root, "lib/pipeline/referral-validation.ts");
const referralQuery = loadTypeScriptModule(root, "lib/pipeline/referral-query.ts");
const residentLinkValidation = loadTypeScriptModule(root, "lib/pipeline/resident-link-validation.ts");
const requestSecurity = loadRequestSecurityModule({});
const workspaceStateTypes = loadTypeScriptModule(root, "lib/pipeline/user-workspace-state-types.ts");

const results = [
  run("create upload rejects missing body", () => {
    const result = contracts.validateCreateUploadUrlRequest(null);
    assertInvalid(result, "Invalid JSON body.");
  }),
  run("create upload rejects invalid source type", () => {
    const result = contracts.validateCreateUploadUrlRequest({
      referral_id: "ref_001",
      submitting_facility: "County General ED",
      source_type: "sms",
      files: [validFile()],
    });
    assertInvalid(result, "source_type must be fax, email, portal, or manual.");
  }),
  run("create upload rejects empty files", () => {
    const result = contracts.validateCreateUploadUrlRequest({
      referral_id: "ref_001",
      submitting_facility: "County General ED",
      source_type: "fax",
      files: [],
    });
    assertInvalid(result, "At least one file descriptor is required.");
  }),
  run("create upload rejects oversized files", () => {
    const result = contracts.validateCreateUploadUrlRequest({
      referral_id: "ref_001",
      submitting_facility: "County General ED",
      source_type: "fax",
      files: [{ ...validFile(), size: 101 * 1024 * 1024 }],
    });
    assertInvalid(result, "Each file must be 100 MB or smaller.", 413);
  }),
  run("create upload rejects too many files and duplicate file ids", () => {
    assertInvalid(
      contracts.validateCreateUploadUrlRequest({
        referral_id: "ref_001",
        submitting_facility: "County General ED",
        source_type: "fax",
        files: Array.from({ length: 26 }, (_, index) => ({
          ...validFile(),
          file_id: `file_${index}`,
        })),
      }),
      "At most 25 files can be requested at once.",
      413,
    );
    assertInvalid(
      contracts.validateCreateUploadUrlRequest({
        referral_id: "ref_001",
        submitting_facility: "County General ED",
        source_type: "fax",
        files: [validFile(), validFile()],
      }),
      "file_id values must be unique within the request.",
    );
  }),
  run("create upload rejects unsupported file types and huge reservations", () => {
    assertInvalid(
      contracts.validateCreateUploadUrlRequest({
        referral_id: "ref_001",
        submitting_facility: "County General ED",
        source_type: "fax",
        files: [{ ...validFile(), content_type: "text/plain" }],
      }),
      "Unsupported file type. Upload PDF, JPEG, PNG, TIFF, or HEIC packets only.",
      415,
    );
    assertInvalid(
      contracts.validateCreateUploadUrlRequest({
        referral_id: "ref_001",
        submitting_facility: "County General ED",
        source_type: "fax",
        files: Array.from({ length: 11 }, (_, index) => ({
          ...validFile(),
          file_id: `large_${index}`,
          size: 100 * 1024 * 1024,
        })),
      }),
      "Upload requests can reserve at most 1 GB at a time.",
      413,
    );
  }),
  run("create upload accepts valid descriptors", () => {
    const result = contracts.validateCreateUploadUrlRequest({
      referral_id: "ref_001",
      submitting_facility: "County General ED",
      source_type: "fax",
      files: [validFile()],
    });
    assertValid(result);
    assert(result.value.files.length === 1, "Expected one validated file");
  }),
  run("complete upload requires packet and file ids", () => {
    assertInvalid(
      contracts.validateCompleteUploadRequest({ packet_id: "", uploaded_file_ids: [] }),
      "packet_id is required.",
    );
    assertInvalid(
      contracts.validateCompleteUploadRequest({ packet_id: "pkt_001", uploaded_file_ids: [""] }),
      "uploaded_file_ids must include at least one file id.",
    );
    assertInvalid(
      contracts.validateCompleteUploadRequest({
        packet_id: "pkt_001",
        uploaded_file_ids: ["file_001", "file_001"],
      }),
      "uploaded_file_ids must not contain duplicates.",
    );
  }),
  run("review field validates action and edit value", () => {
    assertInvalid(
      contracts.validateReviewFieldRequest({ if_match: 1, action: "approve" }),
      "action must be accept, edit, or reject.",
    );
    assertInvalid(
      contracts.validateReviewFieldRequest({ if_match: 1, action: "edit" }),
      "value is required when action is edit.",
    );
    assertInvalid(
      contracts.validateReviewFieldRequest({ action: "accept" }),
      "if_match must be a positive field version number.",
    );
    assertValid(contracts.validateReviewFieldRequest({ if_match: 1, action: "accept" }));
    assertValid(contracts.validateReviewFieldRequest({ if_match: 2, action: "edit", value: "San Pablo" }));
  }),
  run("retry field validates force flag", () => {
    assertInvalid(
      contracts.validateRetryFieldRequest({ force_claude: "yes" }),
      "force_claude must be true or false.",
    );
    assertValid(contracts.validateRetryFieldRequest({}));
    assertValid(contracts.validateRetryFieldRequest({ force_claude: true }));
  }),
  run("route params decode safely", () => {
    assert(
      contracts.decodeRouteParam("clinical%20summary") === "clinical summary",
      "Expected decoded field key",
    );
    assert(contracts.decodeRouteParam("%E0%A4%A") === "", "Bad escapes should downshift safely");
  }),
  run("referral list query accepts bounded server filters", () => {
    const result = referralQuery.parseReferralListQuery(new URLSearchParams({
      q: "San Pablo",
      community: "San Pablo",
      stage: "Assessment",
      priority: "high",
      month: "2026-08",
      active: "true",
      limit: "100",
    }));
    assertValid(result);
    assert(result.value.activeOnly === true, "Expected active-only filter");
    assert(result.value.community === "San Pablo", "Expected community filter");
  }),
  run("referral list query rejects unsafe pagination and filters", () => {
    assertInvalid(referralQuery.parseReferralListQuery(new URLSearchParams({ cursor: "-1" })), "cursor is invalid.");
    assertInvalid(referralQuery.parseReferralListQuery(new URLSearchParams({ limit: "500" })), "limit must be a whole number between 1 and 200.");
    assertInvalid(referralQuery.parseReferralListQuery(new URLSearchParams({ stage: "Anything" })), "stage is invalid.");
  }),
  ...authBehaviorResults(),
  ...backendBehaviorResults(),
  ...mockStoreBehaviorResults(),
  ...referralHardeningResults(),
  ...assessmentSchemaResults(),
  ...assessmentValidationResults(),
  ...residentLinkValidationResults(),
  ...workspaceStateValidationResults(),
];

const failed = results.filter((result) => !result.ok);

console.log(
  JSON.stringify(
    {
      ok: failed.length === 0,
      checked_at: new Date().toISOString(),
      checks: results,
    },
    null,
    2,
  ),
);

if (failed.length > 0) {
  process.exit(1);
}

function authBehaviorResults() {
  return [
    run("auth defaults to mock in local development", () => {
      const auth = loadAuthModule({ NODE_ENV: "development" });
      const user = auth.getPipelineUserFromHeaders(new Headers());
      assert(user?.email === "demo@pipeline.local", "Expected local mock user");
      assert(
        user.roles.includes("assessment_coordinator"),
        "Expected local mock user to support intake uploads",
      );
    }),
    run("auth defaults to Entra JWT in production", () => {
      const auth = loadAuthModule({ NODE_ENV: "production" });
      assert(auth.getPipelineAuthMode() === "entra_jwt", "Expected production Entra JWT mode");
      assert(auth.getPipelineUserFromHeaders(new Headers()) === null, "No header should be anonymous");
    }),
    run("auth refuses disabled mode in production", () => {
      const auth = loadAuthModule({
        NODE_ENV: "production",
        PIPELINE_AUTH_MODE: "disabled",
      });
      assert(auth.getPipelineAuthMode() === "entra_jwt", "Production disabled mode must fail closed through Entra JWT");
    }),
    run("auth parses gateway email and roles", () => {
      const auth = loadAuthModule({
        NODE_ENV: "production",
        PIPELINE_AUTH_MODE: "headers",
        PIPELINE_TRUSTED_GATEWAY: "true",
        PIPELINE_ALLOW_UNVERIFIED_AUTH_HEADERS: "true",
        PIPELINE_ALLOWED_EMAILS: "reviewer@example.com",
        PIPELINE_REVIEWER_EMAILS: "reviewer@example.com",
      });
      const user = auth.getPipelineUserFromHeaders(
        new Headers({ "x-pipeline-user-email": "Reviewer@Example.com" }),
      );
      assert(user?.email === "Reviewer@Example.com", "Expected header email to pass through");
      assert(user.roles.includes("reviewer"), "Expected reviewer role");
    }),
    run("auth rejects missing production identity", () => {
      const auth = loadAuthModule({
        NODE_ENV: "production",
        PIPELINE_AUTH_MODE: "headers",
        PIPELINE_TRUSTED_GATEWAY: "true",
      });
      const result = auth.requirePipelineUser(new Request("https://pipeline.local/referrals"));
      assert(!result.ok, "Missing identity should fail");
      assert(result.response.status === 401, "Missing identity should return 401");
    }),
    run("auth rejects users outside allowlist", () => {
      const auth = loadAuthModule({
        NODE_ENV: "production",
        PIPELINE_AUTH_MODE: "headers",
        PIPELINE_TRUSTED_GATEWAY: "true",
        PIPELINE_ALLOW_UNVERIFIED_AUTH_HEADERS: "true",
        PIPELINE_ALLOWED_EMAILS: "allowed@example.com",
      });
      const result = auth.requirePipelineUser(
        new Request("https://pipeline.local/referrals", {
          headers: { "x-pipeline-user-email": "blocked@example.com" },
        }),
      );
      assert(!result.ok, "Unallowed user should fail");
      assert(result.response.status === 403, "Unallowed user should return 403");
    }),
    run("auth accepts an assigned Entra object across email aliases", () => {
      const auth = loadAuthModule({
        NODE_ENV: "production",
        PIPELINE_AUTH_MODE: "headers",
        PIPELINE_TRUSTED_GATEWAY: "true",
        PIPELINE_ALLOWED_ENTRA_OBJECT_IDS: "entra-user-stable",
      });
      const principal = btoa(JSON.stringify({
        userId: "ENTRA-USER-STABLE",
        userDetails: "unexpected-alias@example.com",
        claims: [{ typ: "roles", val: "Pipeline.Admin" }],
      }));
      const result = auth.requirePipelineUser(new Request("https://pipeline.local/referrals", {
        headers: { "x-ms-client-principal": principal },
      }));
      assert(result.ok, "Stable Entra object ID should authorize independent of the email alias");
    }),
    run("auth accepts an assigned Entra app role without a duplicate local identity match", () => {
      const auth = loadAuthModule({
        NODE_ENV: "production",
        PIPELINE_AUTH_MODE: "headers",
        PIPELINE_TRUSTED_GATEWAY: "true",
      });
      const principal = btoa(JSON.stringify({
        userId: "entra-assigned-user",
        userDetails: "changed-alias@example.com",
        claims: [{ typ: "roles", val: "Pipeline.Admin" }],
      }));
      const result = auth.requirePipelineUser(new Request("https://pipeline.local/referrals", {
        headers: { "x-ms-client-principal": principal },
      }));
      assert(result.ok, "A governed Entra app-role assignment should be sufficient authorization");
    }),
    run("auth enforces role gates", () => {
      const auth = loadAuthModule({
        NODE_ENV: "production",
        PIPELINE_AUTH_MODE: "headers",
        PIPELINE_TRUSTED_GATEWAY: "true",
        PIPELINE_ALLOW_UNVERIFIED_AUTH_HEADERS: "true",
        PIPELINE_ALLOWED_EMAILS: "viewer@example.com",
      });
      const result = auth.requirePipelineUser(
        new Request("https://pipeline.local/api/uploads/create-url", {
          headers: { "x-pipeline-user-email": "viewer@example.com" },
        }),
        ["admin"],
      );
      assert(!result.ok, "Viewer should fail admin-only action");
      assert(result.response.status === 403, "Role denial should return 403");
    }),
    run("auth decodes EasyAuth principal claims", () => {
      const auth = loadAuthModule({
        NODE_ENV: "production",
        PIPELINE_AUTH_MODE: "headers",
        PIPELINE_ADMIN_EMAILS: "admin@example.com",
        PIPELINE_ALLOWED_EMAILS: "admin@example.com",
      });
      const principal = btoa(
        JSON.stringify({
          userId: "entra-user-1",
          userDetails: "admin@example.com",
          claims: [{ typ: "name", val: "Admin User" }],
        }),
      );
      const user = auth.getPipelineUserFromHeaders(
        new Headers({ "x-ms-client-principal": principal }),
      );
      assert(user?.id === "entra-user-1", "Expected EasyAuth user id");
      assert(user?.name === "Admin User", "Expected EasyAuth display name");
      assert(user?.roles.includes("admin"), "Expected admin role");
    }),
    run("auth maps Entra role claims", () => {
      const auth = loadAuthModule({
        NODE_ENV: "production",
        PIPELINE_AUTH_MODE: "headers",
        PIPELINE_ALLOWED_EMAILS: "assessor@example.com",
      });
      const principal = btoa(
        JSON.stringify({
          userId: "entra-assessor-1",
          userDetails: "assessor@example.com",
          claims: [
            { typ: "name", val: "Assessor User" },
            { typ: "roles", val: "Pipeline.Assessor" },
          ],
        }),
      );
      const user = auth.getPipelineUserFromHeaders(new Headers({ "x-ms-client-principal": principal }));
      assert(user?.roles.includes("assessment_coordinator"), "Expected assessor role mapping");
    }),
    run("auth fails closed without trusted principal or allowlist", () => {
      const auth = loadAuthModule({
        NODE_ENV: "production",
        PIPELINE_AUTH_MODE: "headers",
      });
      assert(auth.getPipelineUserFromHeaders(new Headers({ "x-pipeline-user-email": "spoof@example.com" })) === null, "Unverified production headers must not authenticate");
    }),
    run("auth readiness reports missing names without secret values", () => {
      const auth = loadAuthModule({
        NODE_ENV: "production",
        PIPELINE_AUTH_MODE: "entra_jwt",
        PIPELINE_ENTRA_SESSION_SECRET: "this-value-must-never-be-returned",
      });
      const readiness = auth.getPipelineAuthReadiness();
      const serialized = JSON.stringify(readiness);
      assert(readiness.ready === false, "Incomplete Entra configuration must not be ready");
      assert(readiness.missing_env.includes("PIPELINE_ENTRA_TENANT_ID"), "Expected tenant configuration to be reported missing");
      assert(!serialized.includes("this-value-must-never-be-returned"), "Readiness must never expose secret values");
    }),
    run("production Entra readiness has no duplicate local identity-list dependency", () => {
      const auth = loadAuthModule({
        NODE_ENV: "production",
        PIPELINE_AUTH_MODE: "entra_jwt",
        NEXT_PUBLIC_ENTRA_TENANT_ID: "tenant-id",
        NEXT_PUBLIC_ENTRA_CLIENT_ID: "client-id",
        NEXT_PUBLIC_PIPELINE_API_SCOPE: "api://client-id/access_as_user",
        NEXT_PUBLIC_PIPELINE_AUTH_REQUIRED: "true",
        PIPELINE_ENTRA_TENANT_ID: "tenant-id",
        PIPELINE_ENTRA_API_AUDIENCE: "client-id",
        PIPELINE_ENTRA_API_SCOPE: "access_as_user",
        PIPELINE_ENTRA_SESSION_SECRET: "a-secure-session-secret-of-sufficient-length",
      });
      const readiness = auth.getPipelineAuthReadiness();
      assert(readiness.ready, "A complete Entra JWT configuration should not require local identity lists");
    }),
  ];
}

function backendBehaviorResults() {
  return [
    run("extraction backend defaults to mock in local development", () => {
      const backend = loadBackendModule({ NODE_ENV: "development" });
      const readiness = backend.getExtractionBackendReadiness();
      assert(readiness.mode === "mock", "Expected local mock extraction backend");
      assert(readiness.ready, "Local mock extraction backend should be ready");
    }),
    run("extraction backend blocks production mock by default", () => {
      const backend = loadBackendModule({
        NODE_ENV: "production",
        PIPELINE_EXTRACTION_BACKEND: "mock",
      });
      const readiness = backend.getExtractionBackendReadiness();
      assert(readiness.mode === "azure_databricks", "Production mock should be upgraded to Azure/Databricks");
      assert(readiness.production_mock_blocked, "Expected production mock to be blocked");
      assert(!readiness.ready, "Missing Azure/Databricks env should not be ready");
    }),
    run("extraction backend reports missing Azure/Databricks env", () => {
      const backend = loadBackendModule({
        NODE_ENV: "production",
        PIPELINE_EXTRACTION_BACKEND: "azure_databricks",
        AZURE_STORAGE_ACCOUNT: "storageacct",
      });
      const readiness = backend.getExtractionBackendReadiness();
      assert(readiness.mode === "azure_databricks", "Expected Azure/Databricks mode");
      assert(readiness.missing_env.includes("DATABRICKS_HOST"), "Expected missing Databricks host");
      assert(readiness.missing_env.includes("DATABRICKS_JOB_ID"), "Expected missing Databricks job id");
      assert(readiness.missing_env.includes("DATABRICKS_CLIENT_SECRET"), "Expected missing Databricks OAuth secret");
    }),
    run("production manual extraction requires only durable upload infrastructure", () => {
      const backend = loadBackendModule({
        NODE_ENV: "production",
        PIPELINE_EXTRACTION_BACKEND: "manual",
        AZURE_STORAGE_ACCOUNT: "storageacct",
        AZURE_STORAGE_CONTAINER_RAW: "raw",
        PIPELINE_DATABASE_URL: "postgresql://configured",
      });
      const readiness = backend.getExtractionBackendReadiness();
      assert(readiness.mode === "manual", "Expected explicit manual extraction mode");
      assert(readiness.ready, "Manual mode should be ready with durable Blob and database configuration");
      assert(!readiness.missing_env.includes("DATABRICKS_HOST"), "Manual mode must not require a fake Databricks job");
    }),
  ];
}

function mockStoreBehaviorResults() {
  return [
    run("mock upload store is idempotent by packet id", () => {
      const store = loadMockStoreModule();
      const input = {
        packet_id: "pkt_idempotent",
        referral_id: "ref_001",
        submitting_facility: "County General ED",
        source_type: "fax",
        files: [validFile()],
      };
      const first = store.createUploadTargets(input);
      const second = store.createUploadTargets(input);
      assert(first.packet_id === second.packet_id, "Expected same packet id");
      assert(first.uploads[0].blob_path === second.uploads[0].blob_path, "Expected stable upload target");
    }),
    run("mock upload completion rejects unknown packets", () => {
      const store = loadMockStoreModule();
      assert(
        store.completeUpload({ packet_id: "missing_packet", uploaded_file_ids: ["file_001"] }) === null,
        "Unknown packet completion should return null",
      );
      assert(store.getPacketStatus("missing_packet") === null, "Unknown packet status should return null");
      assert(store.getPacketFields("missing_packet") === null, "Unknown packet fields should return null");
    }),
  ];
}

function referralHardeningResults() {
  return [
    run("referral create rejects invalid workflow stage", () => {
      assertInvalid(
        referralValidation.validateReferralCreateInput({ ...validReferral(), stage: "Assessment-ish" }),
        "stage is invalid.",
      );
    }),
    run("referral create cannot skip the workflow", () => {
      assertInvalid(
        referralValidation.validateReferralCreateInput({ ...validReferral(), stage: "Accepted / Admitted" }),
        "New referrals must start in the New stage.",
      );
    }),
    run("referral create rejects server-owned workflow records", () => {
      assertInvalid(
        referralValidation.validateReferralCreateInput({ ...validReferral(), assessment: {} }),
        "Referral ids and workflow records are assigned by the server.",
      );
    }),
    run("referral create rejects oversized free text", () => {
      assertInvalid(
        referralValidation.validateReferralCreateInput({ ...validReferral(), note: "x".repeat(20_001) }),
        "note must be 20,000 characters or fewer.",
      );
    }),
    run("referral create rejects malformed requirements", () => {
      assertInvalid(
        referralValidation.validateReferralCreateInput({ ...validReferral(), requirements: [{ id: "tb" }] }),
        "requirements.label is required.",
      );
    }),
    run("referral patch rejects server-owned fields", () => {
      assertInvalid(
        referralValidation.validateReferralPatch({ version: 9 }),
        "version cannot be changed through a referral patch.",
      );
    }),
    run("referral patch accepts a bounded owner update", () => {
      const result = referralValidation.validateReferralPatch({ owner: "Eric Wilson", tags: ["priority"] });
      assertValid(result);
    }),
    run("mutation origin accepts same-origin and service requests", () => {
      assert(requestSecurity.requireSameOriginMutation(new Request("https://pipeline.local/api/referrals", { method: "POST", headers: { Origin: "https://pipeline.local" } })) === null, "Same-origin mutation should pass");
      assert(requestSecurity.requireSameOriginMutation(new Request("https://pipeline.local/api/referrals", { method: "POST" })) === null, "Headerless service mutation should pass");
    }),
    run("mutation origin accepts configured custom domains behind a reverse proxy", () => {
      const requestSecurity = loadRequestSecurityModule({
        PIPELINE_ALLOWED_MUTATION_ORIGINS: "https://alamo-pipeline.com,https://www.alamo-pipeline.com",
      });
      const request = new Request("https://pipeline-prod.internal/api/auth/session", {
        method: "POST",
        headers: {
          Origin: "https://www.alamo-pipeline.com",
          "Sec-Fetch-Site": "same-origin",
        },
      });
      assert(requestSecurity.requireSameOriginMutation(request) === null, "Configured custom origin should pass through the Azure proxy");
    }),
    run("mutation origin still rejects unconfigured domains behind a reverse proxy", () => {
      const requestSecurity = loadRequestSecurityModule({
        PIPELINE_ALLOWED_MUTATION_ORIGINS: "https://www.alamo-pipeline.com",
      });
      const request = new Request("https://pipeline-prod.internal/api/auth/session", {
        method: "POST",
        headers: { Origin: "https://evil.example" },
      });
      const response = requestSecurity.requireSameOriginMutation(request);
      assert(response?.status === 403, "Unconfigured proxy origin should remain blocked");
    }),
    run("mutation origin rejects cross-site requests", () => {
      const response = requestSecurity.requireSameOriginMutation(new Request("https://pipeline.local/api/referrals", { method: "POST", headers: { Origin: "https://evil.example" } }));
      assert(response?.status === 403, "Cross-site mutation should return 403");
    }),
  ];
}

function assessmentSchemaResults() {
  return [
    run("assessment schema exposes all 52 governed fields", () => {
      assert(assessmentSchema.assessmentToolFieldDefinitions.length === 52, "Expected 52 assessment fields");
      assert(
        referralExtractionSchema.assessmentWorkbookExtractionTargets.length === 49,
        "Expected 49 model targets plus three job-supplied provenance fields",
      );
      assert(
        referralExtractionSchema.referralPacketExtractionTargets.every((field) => field.field_key.startsWith("referral.")),
        "Initial referral extraction must not include the later assessment job",
      );
    }),
    run("assessment extraction maps known values and banks unknown values", () => {
      const result = assessmentSchema.mapExtractedAssessmentFields(
        [
          extractedAssessmentField("referral.first_name", "Avery"),
          extractedAssessmentField("referral.last_name", "Example"),
          extractedAssessmentField("referral.date_of_birth", "1982-05-14"),
          extractedAssessmentField("assessment.mobility", "Independent with walker"),
          extractedAssessmentField("assessment.presenting_needs", "Medication stabilization"),
          extractedAssessmentField("assessment.level_of_care", "Residential"),
          extractedAssessmentField("assessment_tool.medications_at_intake", '["Olanzapine 10 mg", "Metformin 500 mg"]'),
        ],
        {
          source_file: "assessment.xlsx",
          extraction_date: "2026-08-08T18:00:00.000Z",
          match_confidence: 0.94,
        },
      );

      assert(result.data.resident_name === "Avery Example", "Expected first and last name composition");
      assert(result.data.date_of_birth === "1982-05-14", "Expected date of birth mapping");
      assert(result.data.mobility === "Independent with walker", "Expected legacy mobility mapping");
      assert(result.data.medications_at_intake.length === 2, "Expected medications to remain a list");
      assert(result.data.source_file === "assessment.xlsx", "Expected source filename from job context");
      assert(result.data.match_confidence === 0.94, "Expected job-level match confidence");
      assert(result.data.assessment_notes.includes("Presenting needs: Medication stabilization"), "Expected rich legacy text in notes");
      assert(
        result.unmapped_fields.some((field) => field.source_field_key === "assessment.level_of_care"),
        "Semantically ambiguous legacy fields must be banked",
      );
      assert(
        result.field_provenance.mobility?.[0]?.source_file === "assessment.xlsx",
        "Expected field-level source provenance",
      );
    }),
    run("assessment list extraction never comma-splits clinical text", () => {
      const result = assessmentSchema.mapExtractedAssessmentFields([
        extractedAssessmentField("assessment_tool.substances", "Alcohol, occasional use"),
      ]);
      assert(result.data.substances.length === 1, "Expected one source list item");
      assert(result.data.substances[0] === "Alcohol, occasional use", "Expected punctuation preserved");
    }),
    run("assessment validation rejects malformed structured values without throwing", () => {
      const invalid = {
        ...assessmentSchema.createEmptyAssessmentToolData(),
        assessment_date: "2026-99-99",
        medications_at_intake: "Olanzapine, Metformin",
        prior_hospitalizations_count: -1,
        match_confidence: 1.4,
        invented_field: "must remain visible",
      };
      const issues = assessmentSchema.validateAssessmentToolData(invalid);
      assert(issues.some((issue) => issue.field === "assessment_date"), "Expected invalid date issue");
      assert(issues.some((issue) => issue.field === "medications_at_intake"), "Expected list shape issue");
      assert(issues.some((issue) => issue.field === "prior_hospitalizations_count"), "Expected count issue");
      assert(issues.some((issue) => issue.field === "match_confidence"), "Expected confidence issue");
      assert(issues.some((issue) => issue.message.includes("invented_field")), "Expected unknown field issue");
    }),
    run("assessment completeness is derived from required identity fields", () => {
      const empty = assessmentSchema.createEmptyAssessmentToolData();
      const initial = assessmentSchema.getAssessmentToolCompleteness(empty);
      assert(initial.required_total === 6 && initial.required_ready === 0, "Expected six required identity fields");

      const ready = assessmentSchema.getAssessmentToolCompleteness({
        ...empty,
        resident_number: "EM-1001",
        resident_name: "Avery Example",
        date_of_birth: "1982-05-14",
        community: "San Pablo",
        assessment_date: "2026-08-08",
        assessor: "Eric Wilson",
      });
      assert(ready.percent === 100 && ready.missing_fields.length === 0, "Expected complete identity join");
    }),
  ];
}

function assessmentValidationResults() {
  return [
    run("assessment create protects extraction-owned provenance fields", () => {
      const result = assessmentValidation.validateAssessmentCreateRequest({
        data: { resident_number: "EM-1001", source_file: "browser-supplied.xlsx" },
      });
      assertInvalid(result, "source_file is supplied by the extraction job.");
    }),
    run("assessment patch requires optimistic versions and known fields", () => {
      assertInvalid(
        assessmentValidation.validateAssessmentPatchRequest({ if_match: 0, patch: { data: {} } }),
        "if_match must be a positive version number.",
      );
      assertInvalid(
        assessmentValidation.validateAssessmentPatchRequest({ patch: { data: {} } }),
        "if_match must be a positive version number.",
      );
      assertInvalid(
        assessmentValidation.validateAssessmentPatchRequest({ if_match: 1, patch: { invented: true } }),
        "Unknown assessment patch field: invented.",
      );
      assertValid(assessmentValidation.validateAssessmentPatchRequest({
        if_match: 2,
        patch: { data: { resident_number: "EM-1001" }, status: "draft" },
      }));
    }),
    run("assessment import forces extracted values into pending review", () => {
      const result = assessmentValidation.validateAssessmentImportRequest({
        assessment_id: "asm_1001",
        if_match: 1,
        fields: [{
          field_key: "assessment_tool.primary_diagnosis",
          proposed_value: "Example diagnosis",
          confidence: 0.91,
          review_status: "accepted",
        }],
        context: { source_file: "assessment.csv", match_confidence: 0.91 },
        client_mutation_id: "import-1001",
      });
      assertValid(result);
      assert(result.value.fields[0].review_status === "pending", "Browser imports must require review");
    }),
  ];
}

function residentLinkValidationResults() {
  const validCandidate = {
    pipeline_client_id: "client-1001",
    display_name: "Avery Example",
    date_of_birth: "1982-05-14",
    referral_id: 42,
    resident_key: "resident-1001",
    resident_number: "EM-1001",
    community_id: "san-pablo",
    match_method: "resident_number_exact",
    match_confidence: 1,
    client_mutation_id: "link-1001",
  };

  return [
    run("resident-link candidates require explicit governed identities", () => {
      assertValid(residentLinkValidation.validateResidentLinkCreate(validCandidate));
      assertInvalid(
        residentLinkValidation.validateResidentLinkCreate({ ...validCandidate, resident_key: "" }),
        "resident_key must be between 1 and 256 characters.",
      );
      assertInvalid(
        residentLinkValidation.validateResidentLinkCreate({ ...validCandidate, resident_number: null }),
        "resident_number is required for an exact resident-number candidate.",
      );
    }),
    run("resident-link review requires an optimistic version and rejection reason", () => {
      assertValid(residentLinkValidation.validateResidentLinkReview({ action: "confirm", if_match: 1 }));
      assertInvalid(
        residentLinkValidation.validateResidentLinkReview({ action: "confirm", if_match: 0 }),
        "if_match must be a positive resident-link version.",
      );
      assertInvalid(
        residentLinkValidation.validateResidentLinkReview({ action: "reject", if_match: 1 }),
        "A review note is required when rejecting a resident link.",
      );
    }),
  ];
}

function workspaceStateValidationResults() {
  const fieldKeys = [
    "name", "gender", "age", "dob", "ssn", "owner", "referralReceived",
    "admissionDate", "county", "referent", "responsiblePerson", "summary", "interview",
  ];
  const validDraft = {
    schema: 1,
    savedAt: "2026-08-12T12:00:00.000Z",
    baseVersion: 4,
    dirtyKeys: ["summary"],
    fields: Object.fromEntries(fieldKeys.map((key) => [key, { value: key === "summary" ? "Synthetic recovery note" : "" }])),
    conserved: "",
    tagsInput: "synthetic",
    documents: {},
  };

  return [
    run("desktop recovery drafts require the complete bounded schema", () => {
      assert(workspaceStateTypes.parsePipelineReferralDraft(validDraft)?.fields.summary.value === "Synthetic recovery note", "Expected a valid recovery draft");
      assert(workspaceStateTypes.parsePipelineReferralDraft({ ...validDraft, fields: { summary: { value: "Partial" } } }) === null, "Partial field maps must fail");
      assert(workspaceStateTypes.parsePipelineReferralDraft({ ...validDraft, dirtyKeys: ["invented"] }) === null, "Unknown dirty keys must fail");
      assert(workspaceStateTypes.parsePipelineReferralDraft({ ...validDraft, fields: { ...validDraft.fields, summary: { value: "x".repeat(40_001) } } }) === null, "Oversized draft fields must fail");
    }),
    run("desktop recents accept only typed bounded destinations", () => {
      assert(workspaceStateTypes.isPipelineRecentDestination({
        id: "page:referrals",
        kind: "page",
        screen: "referrals",
        title: "Referrals",
        detail: "Synthetic navigation",
        visitedAt: "2026-08-12T12:00:00.000Z",
      }), "Expected a valid recent destination");
      assert(!workspaceStateTypes.isPipelineRecentDestination({
        id: "page:unknown",
        kind: "page",
        screen: "unknown",
        title: "Unknown",
        detail: "Synthetic navigation",
        visitedAt: "2026-08-12T12:00:00.000Z",
      }), "Unknown screens must fail");
    }),
  ];
}

function loadAuthModule(env) {
  return loadTypeScriptModule(root, "lib/auth/pipeline-auth.ts", {
    process: {
      env,
    },
  });
}

function loadBackendModule(env) {
  return loadTypeScriptModule(root, "lib/extraction/backend-config.ts", {
    process: {
      env,
    },
  });
}

function loadRequestSecurityModule(env) {
  return loadTypeScriptModule(root, "lib/auth/request-security.ts", {
    process: {
      env,
    },
  });
}

function loadMockStoreModule() {
  return loadTypeScriptModule(root, "lib/extraction/mock-store.ts");
}

function validFile() {
  return {
    file_id: "file_001",
    filename: "packet.pdf",
    content_type: "application/pdf",
    size: 1024,
  };
}

function extractedAssessmentField(fieldKey, proposedValue) {
  return {
    field_key: fieldKey,
    proposed_value: proposedValue,
    confidence: 0.9,
    review_status: "accepted",
    source_page_no: 3,
    evidence_url: "evidence://page/3",
  };
}

function validReferral() {
  return {
    name: "Test Client",
    date: "8/7/2026",
    stage: "New",
    community: "San Pablo",
    source: "County intake",
    priority: "standard",
    tags: [],
    documentName: "packet.pdf",
    documentStatus: "Uploaded",
    owner: "Eric Wilson",
    note: "Referral summary",
    createdAt: "2026-08-07T12:00:00.000Z",
    dob: "1/1/1980",
    phone: "",
    email: "",
    payer: "",
    requirements: [],
  };
}

function run(name, fn) {
  try {
    fn();
    return { name, ok: true };
  } catch (error) {
    return {
      name,
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

function assertValid(result) {
  assert(result.ok, `Expected valid result, got ${JSON.stringify(result)}`);
}

function assertInvalid(result, message, status) {
  assert(!result.ok, "Expected invalid result");
  assert(result.message === message, `Expected "${message}", got "${result.message}"`);
  if (status !== undefined) {
    assert(result.status === status, `Expected status ${status}, got ${result.status}`);
  }
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}
