# AGENTS.md

**Author:** Mark Barney (aka YOUR BOSS!!)
**Date:** 2026-03-19
**Purpose:** Guidance for AI agents working on the VoynichLabs Agent Traffic Control fork.

## Mission
Repurpose the agenttrafficcontrol UI to visualize real agent coordination data from the PlanExe project. Three views: radar replay, git graph productivity, incident log dashboard. All fed by real data — no synthetic/fake data.

## Coding Standards

### File Headers (REQUIRED)
Every TypeScript, JavaScript, or Python file must start with:
```
// Author: {Your Model Name}
// Date: {timestamp}
// PURPOSE: Verbose details about functionality, integration points, dependencies
// SRP/DRY check: Pass/Fail — did you verify existing functionality?
```
Update the header whenever you modify a file.

### Core Principles
- **SRP:** Every class/function/module should have exactly one reason to change.
- **DRY:** Reuse utilities/components; search before creating anything new.
- **No mocks/placeholders/fake data:** Ship only real implementations.
- **Comment the non-obvious:** Inline comments where logic could confuse.
- **No AI slop:** No default Inter-only typography, random purple gradients, uniform pill buttons, or over-rounded layouts.
- **Quality over speed:** Slow down, think, and get plan approval before editing.

### Workflow
1. **Deep analysis** — Study existing architecture for reuse opportunities.
2. **Plan** — Create `docs/plans/{date}-{goal}.md` with scope, objectives, TODOs.
3. **Implement** — Follow established patterns; keep components focused.
4. **Verify** — Test that the app builds and renders correctly.
5. **CHANGELOG** — Update CHANGELOG.md (SemVer) with what/why/how and author.

### Branch Convention
- `bubba/*` — Bubba's work (UI, engine, standards)
- `egon/*` — Egon's work (data pipeline, specs)
- PRs to main require cross-review from both agents.
- No direct commits to main.

### Prohibited Actions
- No time estimates or premature celebration.
- No shortcuts that compromise code quality.
- No mock data, simulated logic, or placeholder APIs.
- Never add headers to formats that don't support comments (JSON, SQL, etc.).

## Architecture Reference
See [atc-data-mapping-plan.md](https://github.com/VoynichLabs/swarm-coordination/blob/main/plans/atc-data-mapping-plan.md) for full data mapping plan.
See `research/atc-architecture-analysis.md` (in bubba-workspace) for codebase analysis.

## Data Sources
- GitHub PR API (308+ merged PRs)
- OpenClaw session JSONL transcripts
- Git commit history (1,395+ commits)
- commands.log + config-audit.jsonl
- Codex/Claude Code session logs
