# Test Plan

## Future Test Track: Multi-Provider Agents

Do not add these tests before the 00-09 foundation is implemented.

When the post-09 Gemini/provider work starts, add focused tests for:

- provider abstraction returns the same proposal schema for Claude and Gemini
- Manual mode uses only the selected provider
- Auto mode records the selected provider/model and reason
- Auto fallback never happens silently; it either records a user-visible reason or asks the user
- AgentRun/AgentStep budgets stop runaway loops
- invalid step plans and invalid action proposals fail closed
- provider rate-limit errors do not create false success activity
- write actions still require approval regardless of provider

These tests should use stubbed providers only. Do not call live Claude, live Gemini, or real Google APIs from automated tests.

## Testing Philosophy

โปรเจกต์นี้ควรทดสอบจุดที่เสี่ยงต่อความจริงของข้อมูลและ safety boundary มากกว่าไล่ test ทุก UI pixel

Automated tests ควรเน้น:

- API behavior
- Backend execution
- Data state
- Approval boundary
- Prompt/action contract ที่เสี่ยงต่อ false success

Visual tests ให้ Fran manual test เองเท่านั้น

## Build Rule

ก่อน commit ทุก sprint:

- Backend changed: `npm run build`
- Dashboard changed: `npm run build:dashboard`
- Both changed: run both

ถ้า Next dashboard build เจออาการ worker/page-data แปลกๆ ให้ rerun แบบ worker เดียวก่อนสรุปว่า fail:

```powershell
$env:NEXT_PRIVATE_BUILD_WORKER='1'; npm run build:dashboard
```

## Existing Useful Scripts

จาก package scripts ปัจจุบัน:

- `npm run build`
- `npm run build:dashboard`
- `npm run smoke`
- `npm run ai-smoke`
- `npm run brief-smoke`
- `npm run smoke:step9`
- `npm run smoke:step10`
- `npm run smoke:step11`

Backend มี `smoke:step12` ใน workspace package แต่ root ยังไม่มี shortcut ถ้าจะใช้จาก root ให้เพิ่ม script หรือรัน:

```bash
npm run smoke:step12 -w @claude-agent/backend
```

## Sprint Risk Matrix

### Domain State

Automated:

- create reminder
- mark done
- verify DB status
- verify overdue excludes done
- verify archived is not treated as done

Manual:

- Tasks/Reminders UI scan

### Action Registry

Automated:

- build backend/dashboard
- registry covers action schema
- unknown action still rejected

Manual:

- wording in inline approval/toast/approval card

### Approval Execution State

Automated:

- approve success
- approve execute failure
- approval status and execution status correct
- activity log generated
- chat context includes recent outcome

Manual:

- inline state change after approve/reject

### Approvals Board

Automated:

- dashboard build
- API filter test only if API filter added

Manual:

- board columns
- card expand
- mobile/desktop scan

### Chat Fallbacks

Automated:

- invalid Claude response fallback
- no false approval on failed parse
- failed action does not persist as success
- clarification path does not execute action

Manual:

- tone feels helpful and honest

### Conversation Polish

Automated:

- dashboard build
- markdown helper edge cases only if helper is pure and easy to test

Manual:

- visual only: grouping, markdown, loading, thinking, source icons

### Activity Humanization

Automated:

- build
- mapping helper returns fallback for unknown event type

Manual:

- activity page reads like human language

## Things We Should Not Automate Now

- Full visual regression
- Browser/MCP testing
- Live Claude calls
- Real Google API calls
- Broad database dump assertions
- Snapshot tests of long Thai text unless there is a specific regression

## Commit Rule

Each sprint commit should include:

- build command result
- focused smoke/test command result if applicable
- manual visual checklist owner if UI changed
- lesson note update if any bug was found
