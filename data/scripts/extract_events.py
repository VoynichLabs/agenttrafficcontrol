#!/usr/bin/env python3
"""
extract_events.py — Transform raw agent data into ATC-compatible event timeline.

Author: Egon (HejEgonBot)
Date: 2026-03-19
PURPOSE: Read OpenClaw session JSONL files and GitHub PR data, produce
         a unified event stream that the ATC replay engine can consume.

Outputs events.jsonl with one event per line, sorted by timestamp.
Each event maps to an ATC state change (agent appears, moves, stalls, crashes, lands).

Usage:
    python extract_events.py --sessions-dir ~/.openclaw/agents/main/sessions/ \
                             --github-repo PlanExeOrg/PlanExe \
                             --output events.jsonl
"""

import argparse
import json
import os
import re
import subprocess
import sys
from datetime import datetime
from pathlib import Path
from typing import Optional


# --- Agent ID mapping ---
# Map GitHub usernames and known identifiers to ATC agent names
AGENT_MAP = {
    "82deutschmark": "mark",
    "neoneye": "simon",
    "HejEgonBot": "egon",
    # Bubba works through 82deutschmark's GitHub account
    # but is identifiable in session logs by his OpenClaw instance
}

# Mark and Simon are humans — their messages are "tower" events
HUMAN_AGENTS = {"mark", "simon"}

# Intervention signal patterns in human messages
INTERVENTION_PATTERNS = {
    "emergency": [r"/stop", r"/new", r"insanely idiotic", r"stupid shit"],
    "frustration": [r"think harder", r"you're being", r"don't get lost"],
    "correction": [r"you're thinking too small", r"that's not right", r"wrong"],
    "direction": [r"let's", r"why don't you", r"I want you to", r"I'd like"],
    "praise": [r"good work", r"solid", r"nice", r"that's the right track"],
}


def classify_intervention(text: str) -> Optional[str]:
    """Classify a human message by intervention severity."""
    text_lower = text.lower()
    for level, patterns in INTERVENTION_PATTERNS.items():
        for pattern in patterns:
            if re.search(pattern, text_lower):
                return level
    return "direction"  # default: any human message is at least direction


def parse_session_jsonl(filepath: Path, agent_name: str) -> list[dict]:
    """
    Parse an OpenClaw session JSONL file into ATC events.

    Each message becomes an event with:
    - timestamp
    - agent_id
    - event_type: message | tool_call | error | session_start | session_reset
    - metadata: role, model, tool name, error details, etc.
    """
    events = []
    try:
        with open(filepath, "r", encoding="utf-8") as f:
            for line in f:
                line = line.strip()
                if not line:
                    continue
                try:
                    entry = json.loads(line)
                except json.JSONDecodeError:
                    continue

                timestamp = entry.get("timestamp")
                if not timestamp:
                    continue

                entry_type = entry.get("type", "")

                # Session start/reset
                if entry_type == "session":
                    events.append({
                        "timestamp": timestamp,
                        "agent_id": agent_name,
                        "event_type": "session_start",
                        "session_id": entry.get("id", ""),
                    })
                    continue

                # Messages
                if entry_type == "message":
                    msg = entry.get("message", {})
                    role = msg.get("role", "unknown")
                    model = msg.get("model", "")
                    stop_reason = msg.get("stopReason", "")
                    content_text = ""

                    # Extract text content
                    content = msg.get("content", [])
                    if isinstance(content, str):
                        content_text = content
                    elif isinstance(content, list):
                        for item in content:
                            if isinstance(item, dict) and item.get("type") == "text":
                                content_text += item.get("text", "")
                            elif isinstance(item, str):
                                content_text += item

                    # Check for tool calls
                    tool_calls = msg.get("tool_calls", [])

                    # Check for errors
                    error_msg = msg.get("errorMessage", "")
                    is_rate_limit = "rate_limit" in error_msg.lower() if error_msg else False

                    event = {
                        "timestamp": timestamp,
                        "agent_id": agent_name,
                        "event_type": "message",
                        "role": role,
                        "model": model,
                    }

                    # Error events
                    if error_msg:
                        event["event_type"] = "error"
                        event["error_type"] = "rate_limit" if is_rate_limit else "api_error"
                        event["error_message"] = error_msg[:200]

                    # Tool call events
                    if tool_calls:
                        for tc in tool_calls:
                            tool_event = {
                                "timestamp": timestamp,
                                "agent_id": agent_name,
                                "event_type": "tool_call",
                                "tool_name": tc.get("function", {}).get("name", "unknown") if isinstance(tc, dict) else "unknown",
                            }
                            events.append(tool_event)

                    # Detect human intervention (user messages in agent sessions)
                    if role == "user" and content_text:
                        intervention = classify_intervention(content_text)
                        event["intervention_level"] = intervention
                        event["content_preview"] = content_text[:100]

                    # Add usage data if present
                    usage = msg.get("usage", {})
                    if usage:
                        event["tokens_input"] = usage.get("input", 0)
                        event["tokens_output"] = usage.get("output", 0)
                        cost = usage.get("cost", {})
                        if cost:
                            event["cost_usd"] = cost.get("total", 0)

                    events.append(event)

    except Exception as e:
        print(f"Error parsing {filepath}: {e}", file=sys.stderr)

    return events


def fetch_github_pr_events(repo: str) -> list[dict]:
    """
    Fetch merged PR data from GitHub API and convert to ATC events.

    Each PR generates:
    - pr_opened event (agent takes off)
    - pr_merged event (agent lands)
    """
    events = []
    page = 1

    while True:
        try:
            result = subprocess.run(
                [
                    "gh", "api",
                    f"/repos/{repo}/pulls?state=closed&per_page=100&page={page}",
                    "--jq",
                    '.[] | select(.merged_at != null) | '
                    '{"number": .number, "title": .title, "user": .user.login, '
                    '"created_at": .created_at, "merged_at": .merged_at, '
                    '"commits": .commits, "changed_files": .changed_files}',
                ],
                capture_output=True,
                text=True,
                timeout=30,
            )
        except (subprocess.TimeoutExpired, FileNotFoundError):
            break

        if result.returncode != 0 or not result.stdout.strip():
            break

        for line in result.stdout.strip().split("\n"):
            if not line:
                continue
            try:
                pr = json.loads(line)
            except json.JSONDecodeError:
                continue

            github_user = pr.get("user", "")
            agent_id = AGENT_MAP.get(github_user, github_user)

            # PR opened = takeoff
            events.append({
                "timestamp": pr["created_at"],
                "agent_id": agent_id,
                "event_type": "pr_opened",
                "pr_number": pr["number"],
                "pr_title": pr["title"],
                "commits": pr.get("commits", 0),
                "changed_files": pr.get("changed_files", 0),
            })

            # PR merged = landing
            events.append({
                "timestamp": pr["merged_at"],
                "agent_id": agent_id,
                "event_type": "pr_merged",
                "pr_number": pr["number"],
                "pr_title": pr["title"],
            })

        page += 1
        # Safety limit
        if page > 10:
            break

    return events


def parse_commands_log(filepath: Path, agent_name: str) -> list[dict]:
    """
    Parse OpenClaw commands.log for session lifecycle events.

    Lines look like:
    [2026-03-18T21:12:19.943Z] /new session started
    """
    events = []
    if not filepath.exists():
        return events

    try:
        with open(filepath, "r", encoding="utf-8") as f:
            for line in f:
                # Extract timestamp from [ISO-TIMESTAMP] prefix
                match = re.match(r"\[(\d{4}-\d{2}-\d{2}T[\d:.]+Z?)\]\s*(.*)", line.strip())
                if not match:
                    continue

                timestamp = match.group(1)
                command_text = match.group(2)

                event_type = "command"
                if "/new" in command_text.lower():
                    event_type = "session_reset"
                elif "/stop" in command_text.lower():
                    event_type = "session_stop"
                elif "/model" in command_text.lower():
                    event_type = "model_switch"

                events.append({
                    "timestamp": timestamp,
                    "agent_id": agent_name,
                    "event_type": event_type,
                    "command": command_text[:200],
                })
    except Exception as e:
        print(f"Error parsing commands.log: {e}", file=sys.stderr)

    return events


def main():
    parser = argparse.ArgumentParser(
        description="Extract ATC events from OpenClaw sessions and GitHub PRs"
    )
    parser.add_argument(
        "--sessions-dir",
        type=Path,
        default=Path.home() / ".openclaw" / "agents" / "main" / "sessions",
        help="Path to OpenClaw session JSONL directory",
    )
    parser.add_argument(
        "--commands-log",
        type=Path,
        default=Path.home() / ".openclaw" / "logs" / "commands.log",
        help="Path to OpenClaw commands.log",
    )
    parser.add_argument(
        "--agent-name",
        type=str,
        default="egon",
        help="Name of the agent whose sessions these are",
    )
    parser.add_argument(
        "--github-repo",
        type=str,
        default="PlanExeOrg/PlanExe",
        help="GitHub repo for PR data (owner/repo)",
    )
    parser.add_argument(
        "--skip-github",
        action="store_true",
        help="Skip GitHub PR fetching (use when gh CLI not available)",
    )
    parser.add_argument(
        "--output",
        type=Path,
        default=Path("events.jsonl"),
        help="Output file path",
    )

    args = parser.parse_args()

    all_events = []

    # 1. Parse session JSONL files
    sessions_dir = args.sessions_dir
    if sessions_dir.exists():
        jsonl_files = list(sessions_dir.glob("*.jsonl"))
        print(f"Found {len(jsonl_files)} session files in {sessions_dir}")
        for f in jsonl_files:
            events = parse_session_jsonl(f, args.agent_name)
            all_events.extend(events)
            if events:
                print(f"  {f.name}: {len(events)} events")

    # 2. Parse commands.log
    if args.commands_log.exists():
        cmd_events = parse_commands_log(args.commands_log, args.agent_name)
        all_events.extend(cmd_events)
        print(f"Commands log: {len(cmd_events)} events")

    # 3. Fetch GitHub PR data
    if not args.skip_github:
        print(f"Fetching PRs from {args.github_repo}...")
        pr_events = fetch_github_pr_events(args.github_repo)
        all_events.extend(pr_events)
        print(f"GitHub PRs: {len(pr_events)} events")

    # 4. Sort all events by timestamp
    all_events.sort(key=lambda e: e.get("timestamp", ""))

    # 5. Write output
    with open(args.output, "w", encoding="utf-8") as f:
        for event in all_events:
            f.write(json.dumps(event, ensure_ascii=False) + "\n")

    print(f"\nTotal: {len(all_events)} events written to {args.output}")

    # Summary stats
    event_types = {}
    for e in all_events:
        t = e.get("event_type", "unknown")
        event_types[t] = event_types.get(t, 0) + 1
    print("\nEvent type breakdown:")
    for t, count in sorted(event_types.items(), key=lambda x: -x[1]):
        print(f"  {t}: {count}")


if __name__ == "__main__":
    main()
