---
name: revalida
description: Use when a founder wants help deciding a business question, asks to convene the advisor council, or wants to review or replay a Revalida decision. The actual council runs in the Revalida web app, where the founder reviews the brief and advisor board and explicitly starts the council.
---

# Revalida web workflow

Revalida is a web-first decision council. Do not simulate or start a council directly in chat or from this skill. Direct the founder to http://localhost:4730; if the local app is not running, start it from the project directory with `npm start`.

The founder must move through these steps in the web app:

1. Submit the decision, options, business context, success target, constraints, and current lean.
2. Ask the Chair to review the brief. The Chair may ask for decision-critical missing facts.
3. The founder answers those questions or explicitly chooses to proceed with clearly marked assumptions.
4. The founder reviews the proposed brief, options, assumptions, and recommended advisor board; they may change the seats and choose full or quick mode.
5. Only **Confirm and start council** begins advisor rounds. Never bypass or imply this approval.

Councils and advisor chat use the configured OpenAI API key. Reports are saved under `sessions/`, and completed sessions can be replayed or downloaded as PDFs from the web app. Archived session files are historical records and should not be renamed or rewritten as part of normal product changes.

The roster, advisor research, and council references are stored beside this file. Advisor seats are simulations based on public work, not the people themselves. Adding a new seat is currently a maintainer workflow, not a web feature.
