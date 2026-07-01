# Phase 06 Model Performance Eval Report

Generated: 2026-06-30T15:53:46.809Z

## Facts

- Deterministic eval suite: 9 cases.
- Deterministic contract pass rate: 9/9 (100%).
- Live provider eval: skipped in this report; this script does not read .env or call providers.
- Provider eval command remains opt-in: `CONVERSATION_REFERENCE_LIVE_EVAL=1 npm run eval:conversation-reference-providers`.
- Compact provider evidence pack budget: 4 scopes, 8 preview ids per scope, 3 limitations per scope.

| Category | Cases |
| --- | --- |
| calendar_write | 1 |
| class_planner | 1 |
| drive_followup | 2 |
| gmail_followup | 2 |
| line_followup | 1 |
| mixed_source | 1 |
| reminder_write | 1 |

## Provider Comparison

| Provider | Model | Status | Cases | Passed | p50 | p95 | Tokens | Reason |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Gemini | gemini-3.1-flash-lite | skipped | 0 | 0 | n/a | n/a | n/a | live provider eval skipped by default; export env vars and set CONVERSATION_REFERENCE_LIVE_EVAL=1 to run |
| Qwen | qwen/qwen3.7-plus | skipped | 0 | 0 | n/a | n/a | n/a | live provider eval skipped by default; export env vars and set CONVERSATION_REFERENCE_LIVE_EVAL=1 to run |

## Failure Classes

- None in deterministic fixture validation.

## Recommendations

- Keep Gemini as the default for schedule and standard deep turns because it fits the 20-30s budget better.
- Use Qwen only for hard deep turns with implication, deep-search, root-cause, or multi-source comparison signals.
- Treat the compact evidence pack as the provider source of truth for counts, ids, source binding, and clarify gates.
- Run live provider comparison only from an explicitly prepared shell environment; do not rely on .env for eval keys.
