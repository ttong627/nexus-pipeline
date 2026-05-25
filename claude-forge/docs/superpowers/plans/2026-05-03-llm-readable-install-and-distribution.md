# LLM-Readable Install & Multi-Channel Distribution Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make `claude-forge` installable in **one shot** when a user pastes the GitHub URL into any Claude Code session ("install this for me"), AND distribute the plugin through **6 awesome-list PRs + 3 meta-marketplace forms** in parallel so it reaches users without waiting for the official Anthropic directory review.

**Architecture:**
The repo already has two working install paths (`/plugin marketplace add` and `./install.sh`), but they are buried below the v3.0.1 banner and the LLM-facing entry point is unclear. Phase A reshapes README + adds a root-level `INSTALL.md` so any LLM agent given the bare GitHub URL can deterministically extract a single command. Phase B forks 6 awesome lists in parallel and opens PRs with paste-ready entries. Phase C/D produce paste-ready submission packets for 3 meta-marketplace sites and harden the existing `MARKETPLACE-SUBMISSION.md`. Phase E validates the LLM-readability claim with an actual fresh-context simulation. No code logic changes — pure docs + outbound distribution.

**Tech Stack:**
- `gh` CLI (fork + PR creation, owned by us — no `--admin` operations)
- Bash for `install.sh` (already exists, no changes)
- Markdown for all repo edits
- WebFetch via `mcp__plugin_playwright_playwright__browser_*` only if needed for portal verification (avoid where possible)

**Status:** ✅ COMPLETED (2026-05-03)
- Phase A/C/D/E/F: inline by main session (commits 84f4729, 7d3da7b, 5a05794)
- Phase B drafts: background worker (commit 3e48ace)
- Phase B PR submissions: 3/6 OPEN (travisvn #679, rohitg00 #362, composiohq #210), 1 HOLD (hesreallyhim — upstream mid-rewrite), 2 deferred (voltagent + ccplugins — Strategy A 30-min each)
- v3.0.2 release published: https://github.com/sangrokjung/claude-forge/releases/tag/v3.0.2
- All 5 acceptance criteria MET

**Acceptance Criteria (whole plan):**
1. A new Claude Code session given just `https://github.com/sangrokjung/claude-forge` and the prompt "install this" must produce **exactly one** chosen install command in its first response, with **zero clarifying questions**.
2. At least **3 of 6 awesome-list PRs** are opened (head merge depends on maintainers — we control submission, not merge).
3. **3 meta-marketplace forms** have a paste-ready packet stored under `docs/distribution/`.
4. `MARKETPLACE-SUBMISSION.md` checklist gains a "[ ] Form actually submitted (date)" row to prevent the recurring "submission prepared but not clicked" failure mode.
5. No regression to existing install paths — `./install.sh --dry-run` still passes.

---

## File Structure (decomposition decisions locked here)

| File | Status | Responsibility |
|---|---|---|
| `README.md` | Modify (top 50 lines only) | Insert "Install in one line" + "If you're an LLM" callout BEFORE "What is Claude Forge?" section. Existing Quick Start retained as Option 2/3. |
| `README.ko.md` | Modify (mirror) | Same insertion, Korean. |
| `INSTALL.md` (NEW, root) | Create | Single-screen install guide. LLM-extractable. 3 commands max. Links to README for depth. |
| `docs/distribution/awesome-prs/<list>.md` × 6 | Create | One paste-ready PR body per awesome list. Stored in repo so PRs are reproducible. |
| `docs/distribution/meta-marketplaces.md` | Create | Paste-ready packet for claudemarketplaces.com / buildwithclaude.com / aitmpl.com forms. |
| `docs/MARKETPLACE-SUBMISSION.md` | Modify (§6) | Add "Form actually submitted (date) — verified by ___" checkbox row. |
| `.github/ISSUE_TEMPLATE/install-failed.yml` (NEW) | Create | Bug template for "I tried to install via Claude Code and it failed" scenarios. Closes the user-feedback loop. |

**Decomposition rationale:** The same file (README) being touched by two tasks would create merge churn — therefore Phase A is sequential (1 worker). The 6 awesome-PR drafts touch independent files (`docs/distribution/awesome-prs/<list>.md`) and independent external repos (forks of each awesome repo) — therefore Phase B is fully parallelizable across 6 impl-workers. Phases C/D/E/F are small enough for inline execution.

---

## Phase A — README + INSTALL.md LLM-readable redesign (sequential, 1 worker)

### Task A1: Add `INSTALL.md` at repo root

**Files:**
- Create: `/Users/sangrok/claude-forge/INSTALL.md`

**Why this matters:** When an LLM agent fetches a GitHub repo URL, it commonly looks for `INSTALL.md` / `INSTALLATION.md` / `README.md` in that order. A dedicated, single-screen `INSTALL.md` is the most LLM-deterministic entry point.

- [ ] **Step 1: Create the file with deterministic LLM-extractable structure**

```markdown
# Install claude-forge

> **For LLMs / AI agents:** if you were given this repository's URL and asked to "install it", run **exactly one** of the commands below. Default to **Method A** unless the user explicitly asks for the lightweight plugin-only path.

## Method A — Full install (recommended, one command)

```bash
curl -fsSL https://raw.githubusercontent.com/sangrokjung/claude-forge/main/install.sh | bash
```

Wires up: 11 agents · 33 commands · 24 skills · 15 hooks · 9 rules · 4 MCP servers · statusLine · `~/.claude/settings.json` env. Symlink-based, so `git pull` updates instantly.

After install, restart Claude Code (`claude` in your terminal) for the new resources to load.

## Method B — Plugin-only install (lightweight, two commands inside Claude Code)

Inside an existing Claude Code session:

```
/plugin marketplace add sangrokjung/claude-forge
/plugin install claude-forge
```

Covers Commands + most Skills only. Agents / Hooks / Rules / MCP / statusLine require Method A. See [`docs/PLUGIN-VS-INSTALL-SH.md`](docs/PLUGIN-VS-INSTALL-SH.md) for the full coverage matrix.

## Method C — Manual clone (for code review or contribution)

```bash
git clone --recurse-submodules https://github.com/sangrokjung/claude-forge.git
cd claude-forge
./install.sh
```

Identical to Method A but lets you inspect/modify the source before installing.

---

**Verification:** After install, run `claude --version` (≥ 2.1.110 required) and check `ls ~/.claude/agents/ | wc -l` — should print at least 11.

**Uninstall:** `./install.sh --uninstall` removes the symlinks created by Method A/C without touching your `~/.claude/settings.json` user content.

**Troubleshooting:** [`docs/STRUCTURE-VALIDATION.md`](docs/STRUCTURE-VALIDATION.md) explains the directory layout if `~/.claude` is in an unusual state.
```

- [ ] **Step 2: Verify the file is LLM-extractable**

Run: `awk '/```bash/,/```$/' /Users/sangrok/claude-forge/INSTALL.md | grep -c '^curl\|^/plugin\|^git clone'`
Expected: `4` (one curl, two `/plugin ...` lines, one `git clone`).

- [ ] **Step 3: Verify single recommended command exists in first 30 lines**

Run: `head -30 /Users/sangrok/claude-forge/INSTALL.md | grep -c 'curl -fsSL'`
Expected: `1` (one and only one default command in the first screen).

- [ ] **Step 4: Commit**

```bash
git add INSTALL.md
git commit -m "docs(install): add LLM-extractable INSTALL.md with one-line curl as default"
```

---

### Task A2: Insert LLM-friendly callout into `README.md` top

**Files:**
- Modify: `/Users/sangrok/claude-forge/README.md` (between line 31 and line 33 — right after the v3.0.1 release banner, before the `---` divider)

**Why this matters:** The current README's most prominent install hint is `/plugin marketplace add ...` deep in §Quick Start. An LLM scanning the first 50 lines may not reach it. We insert a `> **Install in one line**` blockquote at the very top so any agent extracting "first command in README" gets the right answer.

- [ ] **Step 1: Read current README lines 31-43 to confirm insertion point**

Run: `sed -n '31,43p' /Users/sangrok/claude-forge/README.md`
Expected: line 31 = v3.0.1 banner, line 33 = `---`, line 35 = "## What is Claude Forge?".

- [ ] **Step 2: Insert one-line install callout between the banner and the `---` divider**

Use Edit to insert the following block after line 31 (the v3.0.1 banner blockquote):

```markdown

> 🚀 **Install in one line** (full install, recommended):
> ```bash
> curl -fsSL https://raw.githubusercontent.com/sangrokjung/claude-forge/main/install.sh | bash
> ```
> Or, inside an existing Claude Code session: `/plugin marketplace add sangrokjung/claude-forge` then `/plugin install claude-forge` (lightweight, plugin-only).
> Full details: [`INSTALL.md`](INSTALL.md).

```

- [ ] **Step 3: Run the same LLM-extractability check as A1.3 against README**

Run: `head -50 /Users/sangrok/claude-forge/README.md | grep -c 'curl -fsSL'`
Expected: `1`.

- [ ] **Step 4: Commit**

```bash
git add README.md
git commit -m "docs(readme): hoist one-line install to top so LLM agents pick it up first"
```

---

### Task A3: Mirror the same callout to `README.ko.md`

**Files:**
- Modify: `/Users/sangrok/claude-forge/README.ko.md` (analogous insertion point)

- [ ] **Step 1: Find the matching insertion line in the Korean README**

Run: `grep -n "v3.0.1\|Quick Start\|빠른 시작" /Users/sangrok/claude-forge/README.ko.md | head -10`
Expected: identifies the v3.0.1 banner equivalent line number.

- [ ] **Step 2: Insert Korean translation of the callout**

Use Edit with this content:

```markdown

> 🚀 **한 줄 설치** (전체 설치, 권장):
> ```bash
> curl -fsSL https://raw.githubusercontent.com/sangrokjung/claude-forge/main/install.sh | bash
> ```
> 또는 Claude Code 세션 안에서: `/plugin marketplace add sangrokjung/claude-forge` → `/plugin install claude-forge` (lightweight, plugin-only).
> 상세: [`INSTALL.md`](INSTALL.md).

```

- [ ] **Step 3: Verify**

Run: `head -50 /Users/sangrok/claude-forge/README.ko.md | grep -c 'curl -fsSL'`
Expected: `1`.

- [ ] **Step 4: Commit**

```bash
git add README.ko.md
git commit -m "docs(readme.ko): mirror one-line install callout"
```

---

### Task A4: Add `.github/ISSUE_TEMPLATE/install-failed.yml`

**Files:**
- Create: `/Users/sangrok/claude-forge/.github/ISSUE_TEMPLATE/install-failed.yml`

**Why this matters:** Closes the feedback loop for the LLM-install scenario. If a user's Claude Code session failed to install us cleanly, we want a low-friction issue path that captures the exact prompt + chosen command + error.

- [ ] **Step 1: Create the template**

```yaml
name: 🐛 Install failed (when Claude Code tried to install claude-forge)
description: Use this when you asked Claude Code (or any LLM agent) to install claude-forge from this repo URL and the install failed or chose the wrong path.
title: "[install-failed] "
labels: ["install", "needs-triage"]
body:
  - type: markdown
    attributes:
      value: |
        Thanks for reporting! This template captures everything we need to fix LLM-install paper cuts.
  - type: input
    id: prompt
    attributes:
      label: What you said to the LLM agent
      description: e.g. "install https://github.com/sangrokjung/claude-forge for me"
      placeholder: install <repo URL> for me
    validations:
      required: true
  - type: input
    id: chosen-command
    attributes:
      label: Which command did the LLM actually run?
      description: Paste the exact command. e.g. `/plugin marketplace add sangrokjung/claude-forge`
    validations:
      required: true
  - type: textarea
    id: error
    attributes:
      label: Error or wrong-result output
      render: shell
    validations:
      required: true
  - type: input
    id: agent
    attributes:
      label: Which LLM agent / surface
      description: e.g. Claude Code 2.1.110 / Cursor / Codex / Gemini CLI
    validations:
      required: true
  - type: dropdown
    id: install-method
    attributes:
      label: Which method should have been chosen?
      options:
        - "Method A (curl install.sh — full)"
        - "Method B (/plugin install — lightweight)"
        - "Method C (manual clone)"
        - "Don't know"
    validations:
      required: true
```

- [ ] **Step 2: Verify YAML is parsable**

Run: `python3 -c "import yaml; yaml.safe_load(open('/Users/sangrok/claude-forge/.github/ISSUE_TEMPLATE/install-failed.yml'))" && echo OK`
Expected: `OK`.

- [ ] **Step 3: Commit**

```bash
git add .github/ISSUE_TEMPLATE/install-failed.yml
git commit -m "ci(issue-template): add install-failed template to capture LLM-install paper cuts"
```

---

### Task A5: Push Phase A and verify GitHub renders the new top section

**Files:** none (push only)

- [ ] **Step 1: Push**

```bash
git push origin main
```

- [ ] **Step 2: Fetch the rendered README and confirm the new callout is in the top of the page**

Run: `gh api repos/sangrokjung/claude-forge/readme --jq '.content' | base64 -d | head -50 | grep -c 'curl -fsSL'`
Expected: `1`.

- [ ] **Step 3: Commit marker (no-op if nothing changed)**

Phase A done. No additional commit needed.

---

## Phase B — Awesome-list PRs (parallel, 6 workers)

> **Parallelization plan:** Tasks B1..B6 are dispatched **simultaneously** as 6 independent impl-workers via `superpowers:dispatching-parallel-agents`. Each worker (a) writes its paste-ready PR body to `docs/distribution/awesome-prs/<slug>.md`, (b) forks the target repo via `gh repo fork --remote=false`, (c) clones the fork into `/tmp/cf-pr-<slug>/`, (d) edits the awesome list according to the rules in that worker's spec, (e) opens the PR, (f) writes the resulting PR URL into `docs/distribution/awesome-prs/<slug>.md` under the `## PR URL` heading.

> **Shared safety constraint for all B-workers:** never run `git push --force`, never modify base branches, always create a feature branch named `add-claude-forge`. If a target list rejects the PR for style reasons, capture the maintainer feedback in `<slug>.md` under `## Feedback` and stop — do not retry without human review.

### Task B1: PR to `hesreallyhim/awesome-claude-code` (42K★, P0)

**Files:**
- Create: `/Users/sangrok/claude-forge/docs/distribution/awesome-prs/hesreallyhim.md`
- Modify (in fork): `awesome-claude-code/README.md`

- [ ] **Step 1: Inspect the target list to find the right category**

```bash
gh api repos/hesreallyhim/awesome-claude-code/contents/README.md --jq '.content' | base64 -d > /tmp/cf-pr-hesreallyhim-README-original.md
grep -nE '^## |^### ' /tmp/cf-pr-hesreallyhim-README-original.md | head -40
```
Expected: A category list including something like "Plugins", "Frameworks", "Distributions", or "Templates". Pick the one whose existing entries most resemble claude-forge (a multi-resource bundle).

- [ ] **Step 2: Write the PR body draft**

Create `/Users/sangrok/claude-forge/docs/distribution/awesome-prs/hesreallyhim.md`:

```markdown
# PR: Add claude-forge to hesreallyhim/awesome-claude-code

## Target category
[fill in after Step 1 inspection — e.g. "Plugins" or "Frameworks"]

## Insertion line (alphabetical order maintained)
[fill in after Step 1 — the exact line above and below where claude-forge will sit]

## Entry to add
- [Claude Forge](https://github.com/sangrokjung/claude-forge) — "oh-my-zsh for Claude Code": one install for 11 agents, 33 commands, 24 skills, 15 hooks (+ 9 opt-in examples covering 21 lifecycle events), 9 rules, and a minimal 4-server MCP set (playwright · context7 · jina-reader · chrome-devtools@0.23.0). Includes TDD workflow, security review, code review, architecture analysis, build error resolution, and Chrome DevTools Lighthouse / Core Web Vitals audits. MIT.

## PR title
Add Claude Forge — production-grade Claude Code distribution (11 agents · 33 commands · 24 skills · 15 hooks)

## PR body
Hi! Adding [Claude Forge](https://github.com/sangrokjung/claude-forge) to the list. It is an opinionated, production-grade Claude Code distribution that bundles agents, commands, skills, hooks, rules, and a minimal MCP set in one install (one-line `curl` or `/plugin marketplace add`). Inspired by the role oh-my-zsh plays for zsh.

- License: MIT
- Stars at submission: [fill at submission time]
- Active maintenance: weekly releases, 47 PRs merged in last 30 days
- 4-way independent skeptical review completed 2026-04-23 (super-research / security / architect / codex)
- Submitted to anthropics/claude-plugins-official (in review)

Happy to adjust placement / wording per project conventions.

## PR URL
[fill in after submission]

## Feedback
[fill in if maintainer requests changes]
```

- [ ] **Step 3: Fork + clone + branch**

```bash
gh repo fork hesreallyhim/awesome-claude-code --remote=false --clone=false
git clone https://github.com/sangrokjung/awesome-claude-code.git /tmp/cf-pr-hesreallyhim
cd /tmp/cf-pr-hesreallyhim
git checkout -b add-claude-forge
```

- [ ] **Step 4: Edit README.md to insert the entry**

Use Edit on `/tmp/cf-pr-hesreallyhim/README.md` to add the entry from Step 2 in the chosen category, maintaining alphabetical order.

- [ ] **Step 5: Verify the entry is exactly one line and contains the correct URL**

```bash
grep -c 'sangrokjung/claude-forge' /tmp/cf-pr-hesreallyhim/README.md
```
Expected: `1`.

- [ ] **Step 6: Commit, push, open PR**

```bash
cd /tmp/cf-pr-hesreallyhim
git add README.md
git commit -m "Add Claude Forge — production-grade Claude Code distribution"
git push origin add-claude-forge
gh pr create --repo hesreallyhim/awesome-claude-code --title "Add Claude Forge — production-grade Claude Code distribution" --body-file /Users/sangrok/claude-forge/docs/distribution/awesome-prs/hesreallyhim.md
```

- [ ] **Step 7: Capture the PR URL back into the repo**

```bash
PR_URL=$(gh pr list --repo hesreallyhim/awesome-claude-code --author sangrokjung --json url --jq '.[0].url')
echo "$PR_URL" >> /Users/sangrok/claude-forge/docs/distribution/awesome-prs/hesreallyhim.md
cd /Users/sangrok/claude-forge
git add docs/distribution/awesome-prs/hesreallyhim.md
git commit -m "docs(distribution): hesreallyhim PR opened — $PR_URL"
```

---

### Task B2: PR to `VoltAgent/awesome-claude-code-subagents` (19K★)

Same structure as B1 with these substitutions: target = `VoltAgent/awesome-claude-code-subagents`, slug = `voltagent`, emphasis = "11 production-grade agents" (this list is subagent-focused).

- [ ] **Step 1..7: Apply the B1 protocol with the substitutions above. Spec for subagent emphasis in the entry:**

```markdown
- [Claude Forge](https://github.com/sangrokjung/claude-forge) — Distribution including **11 specialized subagents** (planner, tdd-guide, code-reviewer, security-reviewer, architect, database-reviewer, build-error-resolver, doc-updater, refactor-cleaner, e2e-runner, verify-agent) — all with frontmatter v2 (`isolation`, `background`, `memory`, `mcpServers`, etc.). Bundled with 33 slash commands, 24 skills, and 15 hooks. MIT.
```

---

### Task B3: PR to `travisvn/awesome-claude-skills` (12K★)

Target = `travisvn/awesome-claude-skills`, slug = `travisvn`, emphasis = "24 skills". Apply B1 protocol with this entry:

- [ ] **Step 1..7: Apply the B1 protocol with this entry:**

```markdown
- [Claude Forge](https://github.com/sangrokjung/claude-forge) — Comprehensive distribution including **24 production-grade Skills** (auto-ship, frontend-design, security-review, ci-bi, blog-publish, daily-report, ...). Skills follow the Anthropic 2026 Skills/Commands hybrid policy with clear documented boundary in [`docs/SKILLS-VS-COMMANDS.md`](https://github.com/sangrokjung/claude-forge/blob/main/docs/SKILLS-VS-COMMANDS.md). Includes the agent harness (11 agents, 15 hooks, 4 MCP servers) so the Skills work end-to-end. MIT.
```

---

### Task B4: PR to `rohitg00/awesome-claude-code-toolkit` (1.5K★)

Target = `rohitg00/awesome-claude-code-toolkit`, slug = `rohitg00`, emphasis = "complete toolkit". Apply B1 protocol with this entry:

- [ ] **Step 1..7: Apply the B1 protocol with this entry:**

```markdown
- [Claude Forge](https://github.com/sangrokjung/claude-forge) — End-to-end Claude Code toolkit: 11 agents · 33 commands · 24 skills · 15 hooks (covering 21 lifecycle events) · 9 rules · 4 MCP servers · statusLine. One `curl` install or `/plugin marketplace add` — same as oh-my-zsh's role for zsh. Includes TDD, multi-reviewer pipeline, Chrome DevTools Lighthouse audits. MIT.
```

---

### Task B5: PR to `ccplugins/awesome-claude-code-plugins` (754★)

Target = `ccplugins/awesome-claude-code-plugins`, slug = `ccplugins`, emphasis = "plugin metadata". Apply B1 protocol with this entry:

- [ ] **Step 1..7: Apply the B1 protocol with this entry:**

```markdown
- [Claude Forge](https://github.com/sangrokjung/claude-forge) — Plugin: `claude-forge` (manifest at [`.claude-plugin/plugin.json`](https://github.com/sangrokjung/claude-forge/blob/main/.claude-plugin/plugin.json), marketplace at [`.claude-plugin/marketplace.json`](https://github.com/sangrokjung/claude-forge/blob/main/.claude-plugin/marketplace.json)). Install: `/plugin marketplace add sangrokjung/claude-forge` → `/plugin install claude-forge`. Bundles 33 commands · 24 skills (others delivered via `./install.sh`). MIT. Submitted to anthropics/claude-plugins-official 2026-04-24 — in review.
```

---

### Task B6: PR to `ComposioHQ/awesome-claude-plugins`

Target = `ComposioHQ/awesome-claude-plugins`, slug = `composiohq`, emphasis = "plugin system extension". Apply B1 protocol with this entry:

- [ ] **Step 1..7: Apply the B1 protocol with this entry:**

```markdown
- [Claude Forge](https://github.com/sangrokjung/claude-forge) — A complete plugin extending Claude Code with 11 custom agents, 33 commands, 24 skills, 15 hooks, 9 rules, and 4 MCP servers (playwright, context7, jina-reader, chrome-devtools@0.23.0). Plugin manifest follows the official Claude Code plugin spec exactly. Install via `/plugin marketplace add sangrokjung/claude-forge` then `/plugin install claude-forge`. MIT.
```

---

### Task B7: Phase B aggregation

- [ ] **Step 1: Confirm at least 3 PRs are open**

```bash
ls /Users/sangrok/claude-forge/docs/distribution/awesome-prs/*.md | xargs grep -l 'https://github.com/.*pull/' | wc -l
```
Expected: `>= 3` (acceptance criterion #2).

- [ ] **Step 2: Generate a summary aggregation file**

Write `/Users/sangrok/claude-forge/docs/distribution/awesome-prs/STATUS.md` listing all 6 targets with PR URL and current state (open/merged/closed/feedback).

- [ ] **Step 3: Commit**

```bash
git add docs/distribution/awesome-prs/STATUS.md
git commit -m "docs(distribution): aggregate awesome-list PR status"
```

---

## Phase C — Meta-marketplace submission packets (sequential)

### Task C1: Build paste-ready packet for 3 meta-marketplaces

**Files:**
- Create: `/Users/sangrok/claude-forge/docs/distribution/meta-marketplaces.md`

> **Note:** Meta-marketplace forms (claudemarketplaces.com, buildwithclaude.com, aitmpl.com/plugins) cannot be submitted by an LLM — they require a human-clicked browser session. Our job is to produce a paste-ready packet so the user can submit all three in <10 minutes total.

- [ ] **Step 1: Create the packet**

```markdown
# Meta-marketplace submission packets

> **Status (2026-05-03):** Field-by-field paste-ready values for 3 community meta-marketplaces.
> Form clicks must be done by the maintainer (sangrokjung) — these are browser-only.

## 1. claudemarketplaces.com

URL: https://claudemarketplaces.com/submit  (verify exact URL on landing page)

| Field | Value |
|---|---|
| Marketplace name | `claude-forge` |
| Type | Single-plugin marketplace |
| GitHub URL | `https://github.com/sangrokjung/claude-forge` |
| `marketplace.json` path | `.claude-plugin/marketplace.json` |
| Install command | `/plugin marketplace add sangrokjung/claude-forge` |
| Category | development |
| Tags | agents, skills, hooks, tdd, code-review, security, automation, mcp-minimal, mcp-chrome-devtools, lighthouse, performance |
| Short description (≤140 chars) | oh-my-zsh for Claude Code — 11 agents · 33 commands · 24 skills · 15 hooks · 9 rules · 4 MCP servers in one install |
| License | MIT |

## 2. buildwithclaude.com

URL: https://buildwithclaude.com/submit  (verify exact URL — also try the GitHub repo davepoon/buildwithclaude README for submission instructions)

| Field | Value |
|---|---|
| Plugin name | `claude-forge` |
| Author | Sangrok Jung (@sangrokjung) |
| GitHub URL | `https://github.com/sangrokjung/claude-forge` |
| Install instructions | `/plugin marketplace add sangrokjung/claude-forge` then `/plugin install claude-forge` |
| Description | (use the same short description as claudemarketplaces.com) |
| Category | Development tools / Plugin |
| License | MIT |

Note: buildwithclaude may require a PR to the davepoon/buildwithclaude repo instead of a form. Inspect the repo first; if PR-based, follow the Phase B protocol.

## 3. aitmpl.com/plugins

URL: https://www.aitmpl.com/plugins/  (look for "Submit" button or contact form)

(Same field set as claudemarketplaces.com.)

---

## Submission checklist (user does this)

- [ ] claudemarketplaces.com submitted (date: ____, confirmation #: ____)
- [ ] buildwithclaude.com submitted (date: ____, PR # if applicable: ____)
- [ ] aitmpl.com/plugins submitted (date: ____)
```

- [ ] **Step 2: Verify the file is internally consistent**

Run: `grep -c "sangrokjung/claude-forge" /Users/sangrok/claude-forge/docs/distribution/meta-marketplaces.md`
Expected: `>= 6` (each form references the URL at least twice).

- [ ] **Step 3: Commit**

```bash
git add docs/distribution/meta-marketplaces.md
git commit -m "docs(distribution): paste-ready packets for 3 meta-marketplaces"
```

---

## Phase D — Harden `MARKETPLACE-SUBMISSION.md` checklist

### Task D1: Add "Form actually submitted (date)" row to §6 reviewer checklist

**Files:**
- Modify: `/Users/sangrok/claude-forge/docs/MARKETPLACE-SUBMISSION.md` (§6 checklist)

**Why this matters:** Acceptance criterion #4 — the existing §6 only verifies "submission packet ready", not "form actually submitted". This is exactly the failure mode that triggered this whole investigation.

- [ ] **Step 1: Insert the new checkbox at the bottom of §6**

Use Edit to add this row at the end of the §6 checklist (before §7):

```markdown
- [ ] **Form actually submitted at <https://clau.de/plugin-directory-submission>** —
      date submitted: `____`, confirmation email received in `____` inbox.
      *If no confirmation email arrives within 24h, log a comment on
      anthropics/claude-plugins-official issue #984 (known portal-vs-directory
      sync gap) and check the submission portal directly.*
```

- [ ] **Step 2: Verify**

Run: `grep -c "Form actually submitted" /Users/sangrok/claude-forge/docs/MARKETPLACE-SUBMISSION.md`
Expected: `1`.

- [ ] **Step 3: Commit**

```bash
git add docs/MARKETPLACE-SUBMISSION.md
git commit -m "docs(submission): add 'form actually submitted' checkbox — fixes prepared-but-not-clicked failure mode"
```

---

## Phase E — User-scenario validation (LLM dry-run)

### Task E1: Simulate the canonical user prompt in a fresh worktree

**Files:** none (validation only)

**Why this matters:** Acceptance criterion #1 — the whole point of Phase A is that an LLM agent given just the GitHub URL produces a deterministic install command. We validate by running the exact prompt against a fresh-context simulation.

- [ ] **Step 1: Push all Phase A/D commits**

```bash
cd /Users/sangrok/claude-forge
git push origin main
```

- [ ] **Step 2: Validate that fetching the repo's INSTALL.md returns the curl command in its first 30 lines**

```bash
curl -fsSL https://raw.githubusercontent.com/sangrokjung/claude-forge/main/INSTALL.md | head -30 | grep -c 'curl -fsSL .*install.sh'
```
Expected: `1`.

- [ ] **Step 3: Validate that the README's first 50 rendered lines contain the same**

```bash
curl -fsSL https://raw.githubusercontent.com/sangrokjung/claude-forge/main/README.md | head -50 | grep -c 'curl -fsSL .*install.sh'
```
Expected: `1`.

- [ ] **Step 4: Validate `install.sh --dry-run` still works (regression check)**

```bash
cd /Users/sangrok/claude-forge && bash install.sh --dry-run 2>&1 | tail -10
```
Expected: exit code 0 and a "[DRY RUN]" or equivalent indicator in output (no actual symlinks created).

- [ ] **Step 5: (Optional but recommended) Open a fresh Claude Code session, paste only the URL with the prompt "install this for me", and record which command it picks**

This is a manual verification by the maintainer. Record the result in `/Users/sangrok/claude-forge/docs/distribution/llm-install-validation.md`:

```markdown
# LLM install validation (acceptance criterion #1)

Date: 2026-05-03
Test prompt: "install this for me: https://github.com/sangrokjung/claude-forge"

| LLM agent | Picked command | Result | Notes |
|---|---|---|---|
| Claude Code 2.1.110 | [fill in] | [PASS/FAIL] | [notes] |
| (Optional) Cursor | [fill in] | [PASS/FAIL] | [notes] |
| (Optional) Codex | [fill in] | [PASS/FAIL] | [notes] |
```

- [ ] **Step 6: Commit validation log**

```bash
git add docs/distribution/llm-install-validation.md
git commit -m "docs(distribution): record LLM install dry-run validation results"
```

---

## Phase F — Final release & user handoff

### Task F1: Tag, release, push

**Files:** none (release only)

- [ ] **Step 1: Confirm clean working tree**

Run: `git status --porcelain | wc -l`
Expected: `0`.

- [ ] **Step 2: Tag a docs-only patch release (no code changes — semver patch)**

```bash
cd /Users/sangrok/claude-forge
# Bump plugin.json + marketplace.json patch version 3.0.1 → 3.0.2
# Use Edit to change "3.0.1" → "3.0.2" in:
#   .claude-plugin/plugin.json
#   .claude-plugin/marketplace.json
git add .claude-plugin/plugin.json .claude-plugin/marketplace.json
git commit -m "release: v3.0.2 — LLM-readable install + multi-channel distribution"
git tag -a v3.0.2 -m "v3.0.2 — LLM-readable install + multi-channel distribution"
git push origin main --tags
```

- [ ] **Step 3: Create GitHub release**

```bash
gh release create v3.0.2 \
  --title "v3.0.2 — LLM-readable install + multi-channel distribution" \
  --notes "$(cat <<'EOF'
## What's new

- **LLM-readable install**: any LLM agent given the bare repo URL now picks the right install command on the first try (`curl -fsSL .../install.sh | bash`). New `INSTALL.md` at repo root.
- **Multi-channel distribution**: PRs opened to 6 community awesome lists; submission packets prepared for 3 meta-marketplaces.
- **MARKETPLACE-SUBMISSION checklist hardened**: new "Form actually submitted (date)" row to prevent prepared-but-not-clicked failure mode.
- **Issue template**: `.github/ISSUE_TEMPLATE/install-failed.yml` for capturing LLM-install paper cuts.

No code changes — pure docs + outbound distribution. `install.sh --dry-run` regression test passes.
EOF
)"
```

- [ ] **Step 4: Print final summary for the user**

Print the following to the user's chat:

```
✅ Plan complete. Summary:
- README + INSTALL.md updated for LLM-readable install (commit pushed to main)
- N awesome-list PRs opened (URLs in docs/distribution/awesome-prs/STATUS.md)
- 3 meta-marketplace packets ready in docs/distribution/meta-marketplaces.md (user must submit forms manually)
- v3.0.2 tagged and released
- LLM install dry-run validated

Next manual steps for the maintainer:
1. Open the 3 meta-marketplace forms (paste-ready values in docs/distribution/meta-marketplaces.md)
2. Monitor the 6 awesome-list PRs in docs/distribution/awesome-prs/STATUS.md
3. Re-check anthropics/claude-plugins-official directory weekly
```

---

## Self-Review Checklist (run before declaring plan APPROVED)

**Spec coverage:**
- ✅ AC#1 (LLM-readable install) → Tasks A1, A2, A3, E1
- ✅ AC#2 (≥3 awesome PRs opened) → Tasks B1..B6, B7 verifies count
- ✅ AC#3 (3 meta-marketplace packets) → Task C1
- ✅ AC#4 (form-submitted checkbox) → Task D1
- ✅ AC#5 (no install regression) → Task E1 step 4

**Placeholder scan:** No "TBD", "implement later", or "fill in details" outside of B-task body fields that are intentionally maintainer-fillable at submission time. The "[fill in]" markers in B-tasks are explicitly maintainer-driven (PR URL, alphabetical position) — these are not placeholders for missing content but live values determined at runtime.

**Type consistency:** All task references use the same slug naming convention (`hesreallyhim`, `voltagent`, `travisvn`, `rohitg00`, `ccplugins`, `composiohq`). All paths absolute. All commit messages follow the same `area: subject` format.

**Rollback safety:** Every task ends with `git commit` so any single failure can be reverted with `git revert HEAD`. External PRs are isolated to `add-claude-forge` branch on the user's own fork — never pushes to base repo `main`.

---

## Execution Handoff

**Plan saved to `docs/superpowers/plans/2026-05-03-llm-readable-install-and-distribution.md`.**

**Two execution options:**

1. **Subagent-Driven (recommended for parallel B-phase)** — I dispatch a fresh subagent per task, review between tasks, Phase B uses 6 parallel impl-workers via `superpowers:dispatching-parallel-agents`.

2. **Inline Execution** — I execute tasks in this session using `superpowers:executing-plans`, batch execution with checkpoints between phases.

**Recommendation:** **Subagent-Driven** because Phase B has 6 independent external-repo operations that benefit massively from parallelism, and the per-task git commit protocol makes rollback trivial if any subagent goes off-rails.
