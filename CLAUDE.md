# Revalida project guidance

Revalida is a web-first decision council that evaluates choices rather than simply validating ideas. The web app uses `OPENAI_API_KEY` for intake review, advisor calls, scoring, advisor chat, and saved reports. The normal flow is: founder submits a brief, the Chair asks only concise questions about missing decision-critical facts, the founder reviews the proposed brief and advisor board, and only an explicit **Confirm and start council** begins the rounds. Do not provide an assumptions-based bypass, and never start a council automatically.

- Direct business decisions to http://localhost:4730 or start the app with `npm start`. The web app is the product workflow; OpenCode is not required to run or review councils.
- Keep `.env` private. Councils and advisor chat use the configured OpenAI key and model.
- The roster and advisor research live in `.claude/skills/revalida/`; agent prompt files are in `.claude/agents/`. Treat advisor voices as simulations, never as statements from the real people.
- Councils are saved under `sessions/<date>-<decision>/`. Preserve the three-round council, weighted scoring, intake approval boundary, and live event/report formats in `app/lib/`.
- Historical session folders are archived records. Preserve their decision analysis and source text; change visible title branding only when explicitly requested.
- Run `npm test` for mocked workflow checks. `npm run smoke` calls the live API and may incur a charge.
- Adding advisor seats is a maintainer-only workflow today; it is not available in the web UI. Optional advisor-building materials remain under `.claude/skills/advisor-builder/` and `.opencode/skills/advisor-builder/`.
