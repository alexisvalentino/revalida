---
name: advisor-builder
description: Optional maintainer workflow for adding an advisor seat to Revalida from public work. It gathers sources, builds and checks the advisor research, writes prompt files, creates portrait assets, and registers the new seat. Not for running a council; founders use the Revalida web app at http://localhost:4730.
---

## What this does

Adds a seat to Revalida. A seat is four things, and this skill makes all four:

1. **A brain**: `.claude/skills/revalida/brains/<slug>/`, eight files compiled from the person's public work, every quote verbatim with a source id.
2. **An agent**: `.opencode/agents/council-<key>.md`, the OpenCode sub-agent that reasons and talks like them from that brain.
3. **A portrait**: four consistent cartoon frames in the council scene (`<key>-base`, `-open`, `-mid`, `-blink`), made from a real photo using Revalida's current portrait style.
4. **A roster entry**: one line in `.claude/skills/revalida/roster.json`, so Revalida's roster and web app know the seat exists.

The brain, roster, and web-app data are shared with Claude Code, so they stay in `.claude/`. Only the agent file is OpenCode-native. The raw sources stay in a local build folder that git ignores. Only the brain ships.

Build folder: `build/<slug>/` at the project root.

Read before the first run: `references/brain-spec.md` (the brain layout and its rules), `references/extract-prompt.md` (what each extraction agent gets), `references/writer-prompt.md` (what each brain writer gets), `references/agent-template.md` (the seat agent, OpenCode format).

The scripts are shared with the Claude Code skill and work unchanged here: `node .claude/skills/advisor-builder/scripts/<name>.mjs`.

## Who can be an advisor

- **Public figures with a real body of public work**: essays, letters, books as they teach them in talks, long interviews where they are the main speaker, keynotes, their own channel or podcast. Living or historical.
- **The user, or someone who gave consent**: built from material the user provides (their posts, transcripts, notes). Use `--add` in step 3.
- **Not**: fictional characters, private people without their consent, or anyone whose public work is too thin. Under about 15 usable sources or 60,000 words, say so and offer `--quick` with a warning, or a different person.

The seat is a simulation, not the person. The agent says so if asked, and only quotes what is in its brain.

## Depth

| Flag | Sources | Words | Extraction agents | Use it for |
|---|---|---|---|---|
| `--quick` | 12 to 20 | 80k+ | 2 to 3 | Trying someone out |
| default | 30 to 50 | 250k+ | 4 to 6 | A seat you will actually use |
| `--deep` | 80+ | 500k+ | 8 to 12, in waves | Building a thoroughly sourced advisor |

Quality beats count: one 90-minute keynote is worth ten 6-minute clips.

## Step 1: Who and what seat

From the user's message, get the person's full name. If anything below is missing, ask in one `question` tool batch (at most four questions), offering your best guess as the first option:

1. **The pillar and the question the seat owns.** Propose one from what the person is known for, worded like the existing seats in `roster.json` (pillar: a few words; question: one plain question a founder would face). If an existing seat already owns that pillar, propose a sharper angle so the two seats argue instead of repeating each other.
2. **Default board?** Put them at the table for every council, or keep them on call (`--seats` and `ask`). If the default board already has nine seats, ask who they replace.
3. **Depth**: quick, standard, or deep (default standard).

Then fix the names: `key` (short lowercase, letters only, unique in the roster, usually the surname: `naval`, `drucker`; the first name when another seat already has the surname: `leila`), `slug` (`first-last`), `short` (the council's label, such as "Naval" or "Leila"), and the scorecard `dimension` (a few words for what this seat scores, like "Leverage and long-term wealth").

Check the roster first: if the person already has a seat, stop and offer to refresh it instead (step 3 onward on the same slug; fetch skips sources already in `sources.json`).

## Step 2: Find sources

Use the `websearch` tool to build a source list, best first. Look for:

- Their own site, blog, essays, newsletter archive, or letters (the richest text, with dates).
- Long talks and keynotes where they are the speaker.
- Long interviews and podcasts where they are the main guest (their own podcast counts).
- Their books as they teach them in public: author talks, interviews about the book, chapters they posted free. Never fetch pirated or paywalled book text.
- Recent material (last two years) so `positions.md` reflects current views, and a spread of years so changes of mind show up.

Skip clips under about 10 minutes, fan compilations, reaction videos, and pieces where someone else does most of the talking. Write the URLs to `<build>/urls.txt`, one per line, with a `# heading` line per group. Aim for the source count of the chosen depth plus about 20 percent, since some will fail.

## Step 3: Fetch

```bash
node .claude/skills/advisor-builder/scripts/fetch.mjs <build> --list <build>/urls.txt
```

Each source becomes `<build>/corpus/S001-<title>.md`, logged in `<build>/sources.json`. It prints `ok`, `skip`, `thin` (paywall or a JavaScript page), or `fail` per URL, then a manifest. YouTube uses yt-dlp when installed, otherwise YouTube's own captions. For local material the user gave you:

```bash
node .claude/skills/advisor-builder/scripts/fetch.mjs <build> --add path/to/file.md --title "..." --date 2024-05-01
```

If a source came back thin or failed, find a different copy (a transcript page, an archive.org copy) or replace it. A PDF without `pdftotext` is saved as `pending-*.pdf`: read it with the Read tool, save the text as a `.md`, then `--add` it. Re-run until the manifest meets the depth target, then open two or three corpus files to confirm they are clean text by the right person. Write the manifest line counts into your notes for the final report.

## Step 4: Extract (map)

Split the sources into batches of about 50,000 words each (a 90-minute talk is about 13,000; a long essay 5,000). Spawn one extraction agent per batch, in **one message**, in parallel, foreground, using the `subagent` tool with `agent: general` and the prompt from `references/extract-prompt.md` (fill in the name, the seat's pillar and question, the batch's source ids and file paths, and the notes file to write). Run at most six at a time; for `--deep`, run them in waves.

Each agent writes `<build>/notes/batch-NN.md`. Wait until every agent has reported. When all are back, check every note quote:

```bash
node .claude/skills/advisor-builder/scripts/check_quotes.mjs <build> <build>/notes
```

Fix what it reports: correct a wrong source id, delete a quote it cannot find. Notes with no verifiable quote can stay as paraphrase, marked "inferred from S0xx".

## Step 5: Write the brain (reduce)

Create `.claude/skills/revalida/brains/<slug>/`. Write `sources.md` with the script:

```bash
node .claude/skills/advisor-builder/scripts/fetch.mjs <build> --sources-md .claude/skills/revalida/brains/<slug>/sources.md --name "Full Name"
```

Then spawn three writer agents in one message, in parallel (`subagent`, `agent: general`), with the prompt from `references/writer-prompt.md`. Each reads every notes file plus `references/brain-spec.md` and writes its files into the brain folder, following the spec's budgets and rules:

- Writer A: `frameworks.md`, `principles.md`, and `books.md`.
- Writer B: `positions.md` and `stories.md`.
- Writer C: `voice.md`.

Tell each writer the seat's pillar and question, the build folder (so it can open a corpus file to check a quote's context), and that every quote must be copied exactly from the notes with its source id. Writers write only their own files.

When they are back, write `_hot.md` yourself from the six finished files (the spec lists what goes in it, including "where this lens misfires"). Then check the whole brain:

```bash
node .claude/skills/advisor-builder/scripts/check_quotes.mjs <build> .claude/skills/revalida/brains/<slug>
```

Fix until it passes: every quote verbatim, every id right. Read `_hot.md` once more as the agent will: it should tell you how this person decides, in their words, in under 800 words.

## Step 6: Write the agent

Write `.opencode/agents/council-<key>.md` from `references/agent-template.md`. Fill every bracket from the brain: the lens (five or six questions this person asks of any decision), how they talk (from `voice.md`), how they debate (name their natural opponents among the seats in `roster.json` and what they concede, from "where this lens misfires"), and the never-list. The description names the pillar, the source count and what the brain is built from, and the trigger phrases ("what would [name] say").

The frontmatter shape matters. OpenCode reads `mode`, `steps`, and `permissions`, not the Claude Code `tools` and `maxTurns` keys. The template already has the right shape. Read an existing converted seat (`.opencode/agents/council-graham.md`) if you need a reference.

## Step 7: Register the seat

```bash
node .claude/skills/advisor-builder/scripts/add_seat.mjs --key <key> --name "<Full Name>" --short "<Short>" --slug <slug> --pillar "<pillar>" --question "<question>" --dimension "<dimension>" [--default] [--swap <key>]
```

It refuses if the agent file (in `.claude/agents/` or `.opencode/agents/`) or a brain file is missing. `--default` adds the seat to the default board; `--swap <key>` takes another seat off it in the same move. Then:

- Add one or two "natural tension" lines for the new seat to `.claude/skills/revalida/references/seats.md` (who they will clash with, and over what).

The web app picks the seat up on its next roster read. Reload the page to see the advisor.

## Step 8: Portrait

Every seat gets a real portrait. Never leave a new seat on the drawn placeholder bust and never draw a real person from a written description alone: the likeness comes from a photo. Follow the current prompts and style reference (`.claude/skills/advisor-builder/assets/style-reference.jpg`). Portrait folder: `<build>/portrait/` (ignored by git). Frames folder: `app/public/portraits/`.

1. **Find a photo.** One recent, clear, front-facing photo of the person alone, from an official source: their own YouTube channel avatar (`yt-dlp -J --flat-playlist --playlist-items 0 https://www.youtube.com/@handle` lists `avatar_uncropped`; swap its `=s0` for `=s900`), their own site, or their Wikipedia or Wikimedia Commons photo. Skip logos, group shots, and side profiles. For the user or a mentor built from their own material, use a photo they give you.
2. **Save it and look at it:** `node .claude/skills/advisor-builder/scripts/portrait.mjs photo <build>/portrait <url>`. Open `photo.jpg` with Read and confirm it is the right person and the face is clear.
3. **Two cartoon candidates:** `node .claude/skills/advisor-builder/scripts/portrait.mjs base <build>/portrait "<Full Name>. <hair, facial hair, eye color, skin, build, and the outfit they are known for>"`. Describe what the photo shows; name the signature outfit or accessory (a cap, glasses, a chain). The description steers the details; the photo carries the likeness.
4. **Pick by likeness:** `python .claude/skills/advisor-builder/scripts/build_portraits.py sheet <build>/portrait`, then open `candidates.jpg` (photo first, then each candidate). Pick the one closest to the photo (face shape, eyes, hair, signature details). If neither is close, run `base` again with a sharper description (eye color and hairline are the usual misses) and `--n 2`, then pick: `portrait.mjs pick <build>/portrait <n>`.
5. **Talking frames:** `node .claude/skills/advisor-builder/scripts/portrait.mjs frames <build>/portrait` (mouth open, mouth "oh", eyes closed, each an edit of the chosen base).
6. **Build:** `python .claude/skills/advisor-builder/scripts/build_portraits.py build <build>/portrait <key> --out app/public/portraits`. It aligns each edit onto the base, patches only the mouth or eyes, keys the green, and matches the current portrait set's scale. Open `<build>/portrait/review.jpg`: four frames, same face, no green fringe, the mouth and eyes the only change. If a head sits too small or too large next to the others, rebuild with `--zoom 0.9` or `--zoom 1.1`.

**Without a kie.ai key (OpenCode image tool fallback).** The script path needs `KIE_AI_API_KEY` (kie.ai, about 5 image jobs a seat) in `.env`. If there is no kie key, OpenCode's own image tool can do the same jobs. Use `experimental_image_generate` with the photo and `.claude/skills/advisor-builder/assets/style-reference.jpg` as the two reference images, and this prompt, keeping the green background exact so the build step can key it:

```
Turn the real person in the first image into a stylized 3D animated-film cartoon caricature drawn in exactly the same art style, rendering, lighting, and framing as the cartoon in the second image: head and upper chest bust, facing the camera straight on, centered, eyes looking at the viewer, mouth closed in a relaxed friendly smile. Keep the real person's likeness from the first image exactly: face shape, nose, eyes, eyebrows, hairline, and facial hair. Plain flat solid pure green (#00ff00) background, nothing else in the frame, no text except on the clothing.
```

Save it as `<build>/portrait/base.png`, then run the three frame edits the same way, each an edit of the base and changing only the mouth or the eyes (the prompts are in `scripts/portrait.mjs` under `EDITS`). Save them as `open.png`, `mid.png`, `blink.png`, then run step 6 to build the frames. This path is billed by the image model provider configured in OpenCode; check the selected model and estimate the cost before spending.

If neither a kie key nor credits are available, finish the seat anyway (the web app shows a drawn placeholder), tell the user in one line what to add (a kie.ai key at https://kie.ai/api-key, then `KIE_AI_API_KEY=` in `.env`), and that a later `advisor-builder portrait <name>` makes the portrait.

**Portrait only** (`advisor-builder portrait <name>`, or a seat that shows the placeholder): run this step alone for a seat already in `roster.json`, using its `key` and `slug`, then tell the user to reload Revalida.

## Step 9: Test the seat

New agent files load when OpenCode starts. In the session that built the seat, the `council-<key>` agent type may not exist yet, so test with the fallback the council itself uses: spawn `general` with `Read .opencode/agents/council-<key>.md and follow it as your instructions for this whole task. Only read files; do not write anything.` followed by the single-seat consult prompt from `.claude/skills/revalida/references/round-prompts.md`, on a short sample decision in the seat's pillar. Then check its answer:

- It sounds like the person (compare with `voice.md`), speaks in the first person, and never claims to be them.
- It names frameworks with source ids, and every quote passes `check_quotes.mjs` (save the answer to `<build>/test-consult.md` and run the checker on it).
- It owns its pillar instead of giving generic advice.

If it fails, fix the agent or `_hot.md` and test again, once.

## Step 10: Report

Tell the user, in under 150 words:

- Who was added, their pillar and question, and whether they are on the default board.
- The brain: sources, words, years covered, and the files written.
- How to use them now: `ask <key> ...` for one answer, `--seats <key>,buffett,...` to seat them, and `board` to change the default board.
- One line: restart OpenCode (or open a new session) so the seat loads as its own agent type; until then the council uses the fallback automatically.
- One line: their portrait is in the council scene (reload the page), or, when no kie key or credits were available, that it shows a placeholder until `advisor-builder portrait <name>` runs.

## Without sub-agents (a runtime that cannot spawn agents)

Run steps 4 and 5 yourself, one batch at a time: extract a batch into its notes file, then move to the next. Write the brain files one at a time from the notes. Everything else is the same.

## Rules

- Public and lawful sources only. The corpus stays in the build folder and is never committed or shared; the brain holds short quotes (under 45 words) and paraphrase, never book text.
- Every quote in the brain is verbatim and passes `check_quotes.mjs`. A line with no source is inference and says so.
- Do not touch the other seats' brains or agents. Only `roster.json`'s `"seats"` and `"default"` change, through `add_seat.mjs`.
- Plain English in everything you write yourself: short sentences, no em dashes, no filler.
- A portrait is part of every seat, made from a real photo with the current prompts and style reference. A written description alone never sets the likeness.
- Cost: a standard seat is about 8 to 10 sub-agent runs plus about 5 image jobs. Say which depth you used.
