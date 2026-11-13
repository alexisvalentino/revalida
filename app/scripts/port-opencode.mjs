// One-time port: converts .claude/agents/council-*.md to OpenCode agents in .opencode/agents/.
// Original Claude Code files are left untouched. Run: node app/scripts/port-opencode.mjs
import fs from "node:fs";
import path from "node:path";

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1")), "..", "..");
const src = path.join(root, ".claude", "agents");
const dst = path.join(root, ".opencode", "agents");
fs.mkdirSync(dst, { recursive: true });

for (const file of fs.readdirSync(src).filter((f) => f.startsWith("council-") && f.endsWith(".md"))) {
  const raw = fs.readFileSync(path.join(src, file), "utf8");
  const m = raw.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/);
  if (!m) { console.error(`skip ${file}: no frontmatter`); continue; }
  const fm = m[1];
  const body = m[2];
  const desc = fm.match(/^description:\s*(.+)$/m)?.[1]?.trim() || `${file} seat`;
  const name = fm.match(/^name:\s*(.+)$/m)?.[1]?.trim() || file.replace(/\.md$/, "");
  const out = `---
description: ${desc}
mode: subagent
steps: 12
permissions:
  - action: read
    resource: "*"
    effect: allow
  - action: glob
    resource: "*"
    effect: allow
  - action: grep
    resource: "*"
    effect: allow
  - action: edit
    resource: "*"
    effect: deny
  - action: shell
    resource: "*"
    effect: deny
  - action: subagent
    resource: "*"
    effect: deny
---

${body}`;
  fs.writeFileSync(path.join(dst, file), out);
  console.log(`wrote .opencode/agents/${file}`);
}

// Reference docs are shared data: copy them from .claude on every run so the OpenCode skill
// never runs on a stale copy (an edited seats.md, a new natural-tension line). round-prompts.md
// is the one intentional difference: the fallback agent type and the agent path.
const refSrc = path.join(root, ".claude", "skills", "revalida", "references");
const refDst = path.join(root, ".opencode", "skills", "revalida", "references");
fs.mkdirSync(refDst, { recursive: true });
const CLAUDE_FALLBACK = "Agent type: `council-<seat>`. If that type is not registered in this session (agent files load at session start), spawn `general-purpose` and put these lines first: `Read .claude/agents/council-<seat>.md and follow it as your instructions for this whole task. Only read files; do not write anything.`";
const OPENCODE_FALLBACK = "Agent type: `council-<seat>`. If that agent is not registered in this session (agent files load at session start), spawn `general` and put these lines first: `Read .opencode/agents/council-<seat>.md and follow it as your instructions for this whole task. Only read files; do not write anything.`";
for (const file of fs.readdirSync(refSrc).filter((f) => f.endsWith(".md"))) {
  let text = fs.readFileSync(path.join(refSrc, file), "utf8");
  if (file === "round-prompts.md") {
    if (!text.includes(CLAUDE_FALLBACK)) console.error("warn: round-prompts.md fallback line changed; OpenCode copy may be wrong");
    text = text.replace(CLAUDE_FALLBACK, OPENCODE_FALLBACK);
  }
  fs.writeFileSync(path.join(refDst, file), text);
  console.log(`synced .opencode/skills/revalida/references/${file}`);
}
