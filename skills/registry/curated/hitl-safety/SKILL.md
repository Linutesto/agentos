---
name: hitl-safety
version: '1.0.0'
description: Human-in-the-loop safety controls — approval routing via human, LLM judge, or auto-approve with guardrail overrides.
author: Wunderland
namespace: wunderland
category: safety
tags: [hitl, approval, llm-judge, guardrails, safety, human-in-the-loop]
requires_secrets: []
requires_tools: []
metadata:
  agentos:
    emoji: "\U0001F6E1"
---

# HITL Safety Controls

You have access to AgentOS human-in-the-loop (HITL) safety controls. These gate dangerous or irreversible actions behind an approval step — either a human operator, an LLM judge, or a policy-based auto-decision — before execution proceeds.

## When to Use HITL

Request approval before any action that is:

- **Destructive** — deleting files, dropping database tables, revoking credentials
- **Irreversible** — sending emails, publishing posts, executing financial transactions
- **Expensive** — spawning large compute jobs, calling premium APIs with high token cost
- **Sensitive** — accessing PII, modifying security settings, changing permissions
- **External** — calling third-party APIs that have side effects (webhooks, payments)

If the agent's security tier is **paranoid**, every tool invocation goes through HITL. At **strict**, destructive and external actions require approval. At **balanced** and below, HITL is opt-in per tool or workflow.

## The Six HITL Handlers

Import handlers from the top-level namespace:

```typescript
import { hitl } from '@framers/agentos';
```

### hitl.autoApprove()
Always approves. Use only in development, testing, or when the security tier is **permissive/dangerous** and you trust all tool inputs.

### hitl.autoReject(reason?)
Always denies with an optional reason string. Useful for locking down specific tools entirely.

### hitl.cli()
Prompts the human operator in the terminal for a yes/no decision. Default handler when running `wunderland chat` interactively.

### hitl.webhook(url)
POSTs the approval request to an external URL and waits for a JSON response with `{ approved: boolean, reason?: string }`. Use for custom dashboards or external approval systems.

### hitl.slack({ channel, token })
Sends an approval request to a Slack channel and waits for a reaction or thread reply. In v1, defaults to auto-approve after notification.

### hitl.llmJudge({ model?, provider?, criteria?, confidenceThreshold?, fallback?, apiKey? })
Routes the approval decision through an LLM. The judge evaluates the pending action against the provided criteria string and returns approve/reject with a confidence score. When the confidence is below `confidenceThreshold` (default 0.7), the judge falls back to `fallback` (default: auto-reject).

**Usage in agency():**
```typescript
agency({
  hitl: {
    handler: hitl.llmJudge({
      model: 'gpt-4o-mini',
      criteria: 'Is this action safe and relevant to the user request?',
      confidenceThreshold: 0.7,
    }),
  },
});
```

**Usage in CLI:**
```bash
wunderland chat --llm-judge
```

**Usage in agent.config.json:**
```json
{
  "hitl": {
    "mode": "llm-judge"
  }
}
```

## Guardrail Overrides

When `guardrailOverride` is `true` (the default), guardrails run **after** HITL approval and can veto actions that passed the approval gate. This provides defense-in-depth: even if a human or LLM judge approves an action, built-in safety checks still apply.

Built-in post-approval guardrail checks:

- **code-safety** — detects destructive shell patterns (`rm -rf /`, `DROP TABLE`, `FORMAT C:`)
- **pii-redaction** — detects SSNs, credit card numbers, and other PII in tool arguments

Even auto-approved actions (via `hitl.autoApprove()`) are checked when `guardrailOverride` is enabled.

**Disable guardrail overrides:**
```typescript
// In API
agency({ hitl: { guardrailOverride: false } });
```
```bash
# In CLI
wunderland chat --no-guardrail-override
```
```json
// In agent.config.json
{ "hitl": { "guardrailOverride": false } }
```

## humanNode in Graph Orchestration

When building agent graphs with AgentOS orchestration, use `humanNode()` to insert approval gates:

```typescript
import { humanNode } from '@framers/agentos/orchestration';

humanNode({
  prompt: 'Deploy to production?',
  timeout: 300000,           // 5 minutes
  onTimeout: 'reject',       // what happens when timeout expires
});
```

### humanNode Options

| Option | Type | Description |
|--------|------|-------------|
| `prompt` | `string` | The question shown to the approver |
| `autoAccept` | `boolean` | Skip human, always approve |
| `autoReject` | `boolean` | Always deny (with optional `reason`) |
| `judge` | `{ model, criteria, confidenceThreshold }` | Delegate decision to an LLM judge |
| `onTimeout` | `'accept' \| 'reject' \| 'error'` | Behavior when timeout expires |
| `timeout` | `number` | Milliseconds before onTimeout fires |

**LLM judge in a graph node:**
```typescript
humanNode({
  prompt: 'Deploy to production?',
  judge: {
    model: 'gpt-4o-mini',
    criteria: 'Is this deployment safe given the current test results?',
    confidenceThreshold: 0.8,
  },
  onTimeout: 'reject',
  timeout: 300000,
});
```

## The Approval Flow

The full execution path for any HITL-gated action:

1. **Tool invocation requested** — the agent wants to call a tool
2. **HITL decision** — the configured handler (human, LLM judge, auto) evaluates the request
3. **Guardrail check** — if `guardrailOverride` is true, post-approval guardrails scan the action
4. **Execute or deny** — the tool runs only if both HITL and guardrails approve

If either step rejects, the agent receives a denial message with a reason and can adjust its approach.

## Choosing the Right Handler

| Scenario | Recommended Handler |
|----------|-------------------|
| Development / testing | `hitl.autoApprove()` |
| Interactive CLI session | `hitl.cli()` |
| Production with human oversight | `hitl.webhook(url)` or `hitl.slack(...)` |
| High-volume autonomous agent | `hitl.llmJudge(...)` |
| Locked-down tool | `hitl.autoReject('Tool disabled')` |

## Security Tier Interaction

- **Dangerous / Permissive** — HITL is opt-in; most tools auto-approve
- **Balanced** — HITL gates destructive tools (file delete, shell execute with dangerous patterns)
- **Strict** — HITL gates all external and write tools; only read-only tools skip approval
- **Paranoid** — every tool invocation goes through HITL, no exceptions

Set the security tier in `agent.config.json`:
```json
{
  "security": {
    "tier": "balanced"
  }
}
```

Or programmatically:
```typescript
import { SecurityTiers } from '@framers/agentos/safety/runtime';
agency({ security: { tier: SecurityTiers.BALANCED } });
```

## Best Practices

- **Default to guardrailOverride: true** — defense-in-depth catches what humans miss
- **Use LLM judge for high-volume flows** — humans cannot review hundreds of requests per minute
- **Set meaningful criteria** — vague criteria like "is this ok?" produce unreliable judge decisions
- **Always set onTimeout** — hanging approval gates block the entire agent pipeline
- **Combine with PII redaction** — ensure tool arguments are scanned for leaked secrets before execution
- **Log all decisions** — HITL decisions are audit-logged; review them periodically for pattern analysis
- **Escalate on low confidence** — configure the LLM judge fallback to escalate to a human when confidence is low rather than auto-rejecting
