---
name: revalida
description: Direct founders to the Revalida web app for decision intake, advisor confirmation, council runs, advisor chat, and saved reports. Never run a council directly in OpenCode.
---

# Revalida

Revalida's product workflow is in the web app at http://localhost:4730. OpenCode is not required to run or review a council. If the app is not running, start it with `npm start` from the project directory.

Do not debate the decision, create advisor cards, or start a council in this OpenCode session. The founder must submit the decision in the web app, answer the Chair's concise questions about missing decision-critical facts, review the proposed brief and board, and select **Confirm and start council** before any advisor rounds begin.

The web app uses the configured OpenAI API key and saves completed councils in `sessions/`. The roster and advisor prompt/research assets are maintained in the project. Adding advisor seats is a separate maintainer workflow and is not currently available in the web UI.
