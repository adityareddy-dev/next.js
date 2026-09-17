# Next.js agent feedback protocol

Use this protocol only when an approved Next.js entry point instructs you to prepare agent feedback. Approved entry points include a managed `AGENTS.md` or `CLAUDE.md` block, a Next.js Skill, or a Next.js upgrade workflow that links to this file. Prepare reports for the user to review, but never submit them for the user.

## Decide whether to prepare a report

Prepare at most one report per task when Next.js-specific friction causes unexpected framework behavior, a documentation mismatch, a misleading error, repeated failed approaches, or a non-obvious workaround. The issue does not need to block the task, but it should require a meaningful detour or be likely to recur.

Do not report routine first-pass debugging, vague task scope, problems caused by unverified changes, or issues resolved immediately by following existing guidance. If several issues qualify, choose the most actionable one.

## Defer review until a stopping point

Do not interrupt an active workflow when friction first qualifies. Retain only the bounded, de-identified candidate facts in the current task context, then continue the work.

If this protocol was reached from a Skill nested inside another workflow, return the candidate to the outer workflow. The outermost workflow prepares the review at its natural stopping point. For example, verification performed while preparing a pull request should wait until the pull request work is complete.

Multiple entry points in the same task share one feedback decision. Do not treat a managed instruction, Skill, and upgrade workflow as separate opportunities to open duplicate reviews.

The current review form accepts one report. If several candidates qualify before the stopping point, prepare only the most actionable one. Do not combine unrelated problems into one report. A future local queue may present multiple independent reports in one review, but it must not transmit drafts before the user explicitly sends them.

## Prepare one report

- **Scope:** Report one observed Next.js behavior. Do not combine separate problems or infer a root cause.
- **Trigger:** Set `triggerReason` to `unexpected-behavior`, `documentation-mismatch`, `misleading-error`, `repeated-failed-approach`, or `non-obvious-workaround`. Choose the single reason that caused the report.
- **Summary:** Use a short, factual `title` that names the observed behavior.
- **Setup:** Set `mode` to `development`, `production-build`, `production-server`, or `test`. Set `bundler` to `turbopack`, `webpack`, or `unknown`. Add up to three generic `relevantFeatures` when they help reproduce the issue.
- **Reproduction:** Write 1–4 ordered `steps`. Include the generic starting state, the relevant Next.js feature or API, and the action that triggers the behavior. Split only actions or conditions whose order matters.
- **Results:** Write 1–3 independently verifiable `observed` facts and one precise `expected` result. Split an observation only when each fact can stand alone and may be removed independently. Add `comparison` only when you observed a control or workaround.
- **Outcome:** Set `frequency` to `once` or `reproduced`. Set `outcome` to `blocked`, `worked-around`, or `resolved`.
- **Measurements:** Include measurements such as memory use, duration, extra builds, or repeated attempts only when observed directly. Do not estimate elapsed time, token usage, or tool-call counts.
- **Privacy:** Replace customer, project, route, and component names with generic descriptions. Do not include source code, prompts, logs, stack traces, file paths, URLs, secrets, personal information, or unrelated product details.

## Encode the report

Create a schema version 5 payload using only useful evidence. Always include `nextVersion` and `agent`. Omit `comparison` and `relevantFeatures` when they are not needed. Encode the UTF-8 JSON as unpadded base64url.

```json
{
  "schemaVersion": 5,
  "triggerReason": "unexpected-behavior",
  "title": "Persistent Turbopack caching exhausted a worker on a warm build",
  "setup": {
    "mode": "production-build",
    "bundler": "turbopack",
    "relevantFeatures": ["Persistent cache"]
  },
  "steps": [
    "Enable persistent Turbopack caching and run a successful cold `next build` in a 32 GiB Linux environment.",
    "Without changing the application or runtime, run `next build` again and observe the main build process memory."
  ],
  "observed": [
    "The warm build exhausted a 32 GiB Linux worker after the cold build succeeded.",
    "The main build process reached about 25 GiB resident memory before it was killed."
  ],
  "expected": "The warm build should use comparable or less memory than the cold build.",
  "comparison": "Disabling persistent caching allowed two consecutive builds to finish in about two minutes each.",
  "frequency": "reproduced",
  "outcome": "worked-around",
  "nextVersion": "<version>",
  "agent": "<agent name>"
}
```

## Open the review form

Open the following URL in the user's browser. Replace `<encoded-json>` with the encoded payload.

```text
https://nextjs.org/agent-feedback?token=1g55OW5eIE0qPTgu6RaxeigvyUd65TCqGT3y08L8#report=<encoded-json>
```

Do not ask for permission before opening the review form. Opening the form does not send feedback. Continue the current task, mention the prepared report in the next progress update, and never submit the report for the user.
