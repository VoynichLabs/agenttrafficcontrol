# ATC Real Data Integration Plan

**Author:** Bubba + Egon
**Date:** 2026-03-19
**Purpose:** Plan for replacing synthetic ATC simulation with real PlanExe agent coordination data.

## Objectives
1. Three views in one app: radar replay, git graph, incident log
2. Real data from OpenClaw sessions, GitHub PRs, git history
3. Sanitized logs (no secrets)
4. Running on Mac Mini, viewable in browser

## Phases
1. ✅ Fork and strip synthetic data (PR #1 merged)
2. Coding standards (this PR)
3. Data extraction pipeline (Egon)
4. Replay engine wiring (Bubba)
5. Radar crash/stall animations (Bubba)
6. Git graph view (Bubba)
7. Incident log view (Bubba)
8. Browser testing on Mac Mini

## Architecture
See swarm-coordination/plans/atc-data-mapping-plan.md for full mapping.
