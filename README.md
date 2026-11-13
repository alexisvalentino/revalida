# Revalida

Revalida helps founders evaluate consequential business decisions—not simply validate an idea. Bring a choice and its context to a live council of simulated advisors. Revalida clarifies decision-critical unknowns, prepares a brief for review, and waits for your explicit approval before the council starts. The council debates the decision, produces a scored verdict, saves a report, and can export it as a PDF.

![Revalida's decision council](docs/revalida-overview.png)

## Start

Requirements: Node.js 20 or newer and an OpenAI API key with billing enabled. No package installation is needed.

```sh
git clone https://github.com/alexisvalentino/revalida.git
cd revalida
```

1. Copy `.env.example` to `.env` and set `OPENAI_API_KEY`.
2. Keep `COUNCIL_RUNNER=api` for the web workflow.
3. Run `npm start` from the project directory.
4. Open [http://localhost:4730](http://localhost:4730).

The key powers council runs and the separate **Talk to them** advisor chat. Briefs and chat messages are sent to OpenAI for processing; reports are saved locally in `sessions/`. Keep `.env` private.

## Security and privacy

The server binds to `127.0.0.1` by default and is intended for local use. It has no user accounts or authentication. Do not expose it directly to the public internet; a hosted deployment needs a TLS-terminating reverse proxy with access controls and appropriate operational rate limits. Enable `TRUST_PROXY=true` only behind a proxy that overwrites `X-Real-IP`.

Decision briefs and advisor-chat messages are sent to the configured OpenAI API account. Saved reports, daily-limit records, and credentials are local runtime data: reports under `sessions/`, usage records in `app/.daily-limit.json`, and secrets in `.env`. These paths are ignored by Git (example sessions and `.env.example` are intentionally tracked). Review example or generated reports before sharing them; avoid sending confidential personal, customer, or company information unless you are authorized to do so.

Revalida allows one active AI sequence per public IP per UTC day, covering intake, advisor chat, and a new council start. The active draft is saved in that browser so it can be resumed; once the council starts, the same council can be rejoined but another sequence must wait until the next day. Daily usage records store keyed IP digests in `app/.daily-limit.json`; decision drafts stay in browser storage. Set a stable random `DAILY_LIMIT_SECRET` in production (otherwise the OpenAI key is used to derive the digest). Behind a reverse proxy, set `TRUST_PROXY=true` only when that proxy overwrites `X-Real-IP` with the visitor's actual address.

This is an IP-based limit, not device authentication: people sharing a public IP share one daily allowance, and changing networks or using a VPN changes the IP and can bypass it. Use account-based limits if individual identity enforcement is required.

## The council workflow

1. Enter the decision and options, plus the goal, deadline, numbers, current lean, and constraints.
2. Select **Review with the Chair**. This starts intake, not the council.
3. Answer the Chair's short follow-up questions with facts, estimates, or a clear explanation of what is unknown. The Chair asks only about gaps that could change the comparison.
4. Review the proposed brief, options, and any remaining uncertainties. Choose full or quick, then confirm or adjust the advisor board.
5. Select **Confirm and start council**. No advisor rounds run before this explicit confirmation.
6. Watch the council, review its verdict, download the PDF, or revisit it under **Past sessions**.

A full council runs three rounds. Quick mode runs two rounds and adds a final vote when positions have not converged or an advisor flags serious downside risk. Full mode allows 3–9 advisors; quick mode requires exactly four.

## What to include in a brief

State the choice, real options, relevant numbers, constraints, success measure, deadline, and current lean. Mark unknowns rather than guessing; the Chair will ask about missing facts that could change the decision.

## Advisors

Revalida includes thirteen advisor seats. The default board is Jeff Bezos (strategy), Paul Graham (product), Alex Hormozi (offers and sales), Gary Vaynerchuk (marketing), Dan Martell (people and founder time), Andre Yap (consequential bets), and Warren Buffett (money and capital). The Chair can recommend other seats from the full roster. Each seat is a simulation grounded in its subject's public work, not the person themselves.

Adding advisor seats is a maintainer workflow, not a web feature. Optional builder guidance is in `.claude/skills/advisor-builder/` and `.opencode/skills/advisor-builder/`.

## Reports and records

Web councils are saved in `sessions/` with their brief, round cards, and verdict. **Past sessions** replays saved councils. The browser-generated PDF includes the recommendation, scores, key arguments, dissent, and next steps. Finished example sessions are included in the repository.

## Configuration and development

- `OPENAI_API_KEY` is required for council runs and advisor chat.
- `COUNCIL_RUNNER=api` enables the normal web workflow. Viewer mode is for installations dedicated to replaying compatible sessions.
- `CHAT_MAX_TOKENS` optionally adjusts advisor-chat response length.
- `KIE_AI_API_KEY` is only needed by maintainers generating a new advisor portrait.
- `npm test` runs mocked API, intake, and council-flow tests without paid model calls.
- `npm run smoke` makes a live OpenAI request and may incur a small API charge.

The web app and council API are in `app/`. Advisor roster, research, scoring references, and report format are in `.claude/skills/revalida/`.

Advisor seats are simulations, not statements from or endorsements by the people represented. Attributed direct quotes should be verifiable against each seat's research and source list. The project is MIT licensed; bundled jsPDF and Montserrat licenses are included with their assets.
