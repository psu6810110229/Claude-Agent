import { z } from "zod";

export const ConversationReferenceSourceSchema = z.enum([
  "google_drive",
  "gmail",
  "line_export",
  "google_calendar",
  "local_reminder",
  "google_contacts",
  "mixed",
]);

export type ConversationReferenceSource = z.infer<
  typeof ConversationReferenceSourceSchema
>;

export const ConversationReferenceBehaviorSchema = z.enum([
  "reuse_scope",
  "fresh_search",
  "clarify",
  "unsupported",
]);

export type ConversationReferenceBehavior = z.infer<
  typeof ConversationReferenceBehaviorSchema
>;

export const ConversationReferenceScopeSchema = z
  .object({
    id: z.string().min(1),
    source: ConversationReferenceSourceSchema,
    scope_type: z.enum([
      "result_set",
      "folder",
      "thread",
      "chat",
      "event_set",
      "reminder_set",
      "contact_set",
    ]),
    label: z.string().min(1).optional(),
    query: z.string().min(1).optional(),
    item_ids: z.array(z.string().min(1)).default([]),
    parent_ids: z.array(z.string().min(1)).default([]),
    preview_item_ids: z.array(z.string().min(1)).default([]),
    total_count: z.number().int().nonnegative().optional(),
    fetched_at: z.string().datetime(),
    confidence: z.enum(["low", "medium", "high"]),
    limitations: z.array(z.string().min(1)).default([]),
  })
  .strict();

export type ConversationReferenceScope = z.infer<
  typeof ConversationReferenceScopeSchema
>;

export const ConversationReferenceTurnSchema = z
  .object({
    role: z.enum(["user", "assistant"]),
    content: z.string().min(1),
    scope_ids: z.array(z.string().min(1)).default([]),
  })
  .strict();

export type ConversationReferenceTurn = z.infer<
  typeof ConversationReferenceTurnSchema
>;

export const ConversationReferenceExpectationSchema = z
  .object({
    behavior: ConversationReferenceBehaviorSchema,
    source: ConversationReferenceSourceSchema.optional(),
    scope_id: z.string().min(1).optional(),
    expected_count: z.number().int().nonnegative().optional(),
    expected_preview_item_ids: z.array(z.string().min(1)).default([]),
    expected_clarification: z.boolean().default(false),
    approval_required: z.boolean().default(false),
    must_not_call_live_provider: z.boolean().default(true),
    must_not_read_real_data: z.boolean().default(true),
    notes: z.string().min(1).optional(),
  })
  .strict()
  .superRefine((expectation, ctx) => {
    if (expectation.behavior === "reuse_scope" && !expectation.scope_id) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "reuse_scope expectations must name scope_id",
        path: ["scope_id"],
      });
    }

    if (
      expectation.behavior === "clarify" &&
      !expectation.expected_clarification
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "clarify expectations must set expected_clarification",
        path: ["expected_clarification"],
      });
    }
  });

export type ConversationReferenceExpectation = z.infer<
  typeof ConversationReferenceExpectationSchema
>;

export const ConversationReferenceCaseSchema = z
  .object({
    id: z.string().min(1),
    title: z.string().min(1),
    category: z.enum([
      "drive_followup",
      "gmail_followup",
      "line_followup",
      "mixed_source",
      "calendar_write",
      "reminder_write",
      "class_planner",
    ]),
    tags: z.array(z.string().min(1)).default([]),
    turns: z.array(ConversationReferenceTurnSchema).min(1),
    scopes: z.array(ConversationReferenceScopeSchema).default([]),
    expectation: ConversationReferenceExpectationSchema,
  })
  .strict()
  .superRefine((testCase, ctx) => {
    const scopeIds = new Set(testCase.scopes.map((scope) => scope.id));
    for (const [turnIndex, turn] of testCase.turns.entries()) {
      for (const scopeId of turn.scope_ids) {
        if (!scopeIds.has(scopeId)) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: `turn references unknown scope_id: ${scopeId}`,
            path: ["turns", turnIndex, "scope_ids"],
          });
        }
      }
    }

    const expectedScopeId = testCase.expectation.scope_id;
    if (expectedScopeId && !scopeIds.has(expectedScopeId)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `expectation references unknown scope_id: ${expectedScopeId}`,
        path: ["expectation", "scope_id"],
      });
    }
  });

export type ConversationReferenceCase = z.infer<
  typeof ConversationReferenceCaseSchema
>;

export const ConversationReferenceSuiteSchema = z
  .object({
    schema_version: z.literal(1),
    generated_at: z.string().datetime(),
    description: z.string().min(1),
    live_provider_allowed: z.boolean().default(false),
    cases: z.array(ConversationReferenceCaseSchema),
  })
  .strict()
  .superRefine((suite, ctx) => {
    if (suite.live_provider_allowed) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "baseline fixtures must not enable live providers",
        path: ["live_provider_allowed"],
      });
    }
  });

export type ConversationReferenceSuite = z.infer<
  typeof ConversationReferenceSuiteSchema
>;

export type ConversationReferenceActual = {
  behavior: ConversationReferenceBehavior;
  source?: ConversationReferenceSource;
  scope_id?: string;
  count?: number;
  preview_item_ids?: string[];
  clarification?: boolean;
  approval_required?: boolean;
};

export const ConversationReferenceActualSchema = z
  .object({
    behavior: ConversationReferenceBehaviorSchema,
    source: ConversationReferenceSourceSchema.optional(),
    scope_id: z.string().min(1).optional(),
    count: z.number().int().nonnegative().optional(),
    preview_item_ids: z.array(z.string().min(1)).default([]),
    clarification: z.boolean().optional(),
    approval_required: z.boolean().optional(),
  })
  .strict();

export type ConversationReferenceCaseResult = {
  id: string;
  passed: boolean;
  failures: string[];
};

export function validateConversationReferenceSuite(
  value: unknown,
): ConversationReferenceSuite {
  return ConversationReferenceSuiteSchema.parse(value);
}

export function evaluateConversationReferenceActual(
  testCase: ConversationReferenceCase,
  actual: ConversationReferenceActual,
): ConversationReferenceCaseResult {
  const failures: string[] = [];
  const expected = testCase.expectation;

  if (actual.behavior !== expected.behavior) {
    failures.push(
      `behavior expected ${expected.behavior} but got ${actual.behavior}`,
    );
  }

  if (expected.source && actual.source !== expected.source) {
    failures.push(`source expected ${expected.source} but got ${actual.source}`);
  }

  if (expected.scope_id && actual.scope_id !== expected.scope_id) {
    failures.push(
      `scope_id expected ${expected.scope_id} but got ${actual.scope_id}`,
    );
  }

  if (
    typeof expected.expected_count === "number" &&
    actual.count !== expected.expected_count
  ) {
    failures.push(
      `count expected ${expected.expected_count} but got ${actual.count}`,
    );
  }

  for (const previewId of expected.expected_preview_item_ids) {
    if (!(actual.preview_item_ids ?? []).includes(previewId)) {
      failures.push(`missing preview item ${previewId}`);
    }
  }

  if (
    expected.expected_clarification &&
    actual.clarification !== expected.expected_clarification
  ) {
    failures.push("expected a clarification response");
  }

  if (
    expected.approval_required &&
    actual.approval_required !== expected.approval_required
  ) {
    failures.push("expected approval-gated behavior");
  }

  return {
    id: testCase.id,
    passed: failures.length === 0,
    failures,
  };
}
