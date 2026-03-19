// Author: Bubba (OpenClaw agent)
// Date: 2026-03-19
// PURPOSE: Web Worker replay engine for ATC. Reads 7,169 real PlanExe events from
// /full-events.jsonl, groups them by calendar day, and plays them back through the
// simBridge SimMsg protocol. 1 second per day (default), 44 days = ~44s movie.
// Event → ATC mapping: pr_opened → WorkItem, pr_merged → done, session_start → Agent,
// message(assistant) → agent velocity, error → blocked, message(user) → interventions.

/// <reference lib="webworker" />

// ─── Event types from full-events.jsonl ───────────────────────────────────────

interface RawEvent {
  timestamp: string;
  agent_id: string;
  event_type:
    | 'session_start'
    | 'message'
    | 'error'
    | 'pr_opened'
    | 'pr_merged'
    | string;
  // session_start fields
  session_id?: string;
  // message fields
  role?: 'user' | 'assistant';
  model?: string;
  intervention_level?: string;
  content_preview?: string;
  tokens_input?: number;
  tokens_output?: number;
  cost_usd?: number;
  // error fields
  error_type?: string;
  error_message?: string;
  // pr fields
  pr_number?: number;
  pr_title?: string;
}

// ─── SimMsg types (inline to avoid cross-context imports) ────────────────────

interface WorkItemPatch {
  id: string;
  group?: string;
  sector?: string;
  depends_on?: string[];
  desc?: string;
  estimate_ms?: number;
  started_at?: number;
  eta_ms?: number;
  tps_min?: number;
  tps_max?: number;
  tps?: number;
  tokens_done?: number;
  est_tokens?: number;
  status?: 'queued' | 'assigned' | 'in_progress' | 'blocked' | 'done';
  agent_id?: string;
}

interface AgentPatch {
  id: string;
  work_item_id?: string;
  x?: number;
  y?: number;
  v?: number;
  curve_phase?: number;
}

interface ProjectMetricsPatch {
  active_agents?: number;
  total_tokens?: number;
  total_spend_usd?: number;
  live_tps?: number;
  live_spend_per_s?: number;
  completion_rate?: number;
}

interface AppState {
  items: Record<string, WorkItemPatch>;
  agents: Record<string, AgentPatch>;
  metrics: ProjectMetricsPatch;
  seed: string;
  running: boolean;
}

type SimMsg =
  | { type: 'snapshot'; state: AppState }
  | {
      type: 'tick';
      tick_id: number;
      items?: WorkItemPatch[];
      agents?: AgentPatch[];
      metrics?: ProjectMetricsPatch;
      agents_remove?: string[];
    };

type SimIntent =
  | { type: 'set_running'; running: boolean }
  | { type: 'set_speed'; speed: number }
  | { type: 'request_snapshot' }
  | { type: 'set_plan'; plan: string }
  | { type: 'set_seed'; seed: string };

// ─── Internal state ───────────────────────────────────────────────────────────

/** Live agents: id → mutable state */
const agents = new Map<string, AgentPatch>();
/** Live work items: id → mutable state */
const items = new Map<string, WorkItemPatch>();

/** Running metrics accumulator */
let metrics: Required<ProjectMetricsPatch> = {
  active_agents: 0,
  total_tokens: 0,
  total_spend_usd: 0,
  live_tps: 0,
  live_spend_per_s: 0,
  completion_rate: 0,
};

let tickId = 0;
let playbackSpeed = 1; // multiplier (1x = 1000ms/day, 2x = 500ms/day, 5x = 200ms/day)
let running = false;
let playbackTimer: ReturnType<typeof setTimeout> | null = null;
let currentDayIndex = 0;
let days: string[] = [];
let eventsByDay = new Map<string, RawEvent[]>();

// ─── Deterministic RNG (seeded) ───────────────────────────────────────────────

function mulberry32(seed: number) {
  return function () {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Seed based on agent_id for deterministic positioning
function seedFromString(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = (h * 0x01000193) >>> 0;
  }
  return h;
}

function agentInitPos(agent_id: string): { x: number; y: number } {
  const rng = mulberry32(seedFromString(agent_id));
  // Place agents on the outer ring of the radar (radius ~0.85–0.95)
  const angle = rng() * Math.PI * 2;
  const radius = 0.80 + rng() * 0.15;
  return {
    x: Math.cos(angle) * radius,
    y: Math.sin(angle) * radius,
  };
}

// ─── Event loading ────────────────────────────────────────────────────────────

async function loadEvents(): Promise<void> {
  const url = '/full-events.jsonl';
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Failed to load events: ${response.status} ${response.statusText}`);
  }
  const text = await response.text();
  const lines = text.split('\n').filter((l) => l.trim().length > 0);

  for (const line of lines) {
    try {
      const ev = JSON.parse(line) as RawEvent;
      const day = ev.timestamp.slice(0, 10); // YYYY-MM-DD
      if (!eventsByDay.has(day)) eventsByDay.set(day, []);
      eventsByDay.get(day)!.push(ev);
    } catch {
      // skip malformed lines
    }
  }

  days = Array.from(eventsByDay.keys()).sort();
  postMessage({ type: 'ready', dayCount: days.length, eventCount: lines.length } as unknown as SimMsg);
}

// ─── State helpers ────────────────────────────────────────────────────────────

function getOrCreateAgent(agent_id: string): AgentPatch {
  if (!agents.has(agent_id)) {
    const pos = agentInitPos(agent_id);
    const agent: AgentPatch = {
      id: agent_id,
      work_item_id: '',
      x: pos.x,
      y: pos.y,
      v: 0,
      curve_phase: 0,
    };
    agents.set(agent_id, agent);
  }
  return agents.get(agent_id)!;
}

function agentMoveInward(agent: AgentPatch, fraction: number): void {
  // Move agent toward center proportional to tokens/progress
  // fraction 0..1: how far to move this tick
  const maxMove = 0.015;
  const dist = Math.sqrt((agent.x ?? 0) ** 2 + (agent.y ?? 0) ** 2);
  if (dist < 0.05) return; // already near center
  const move = Math.min(maxMove, dist * fraction * 0.1);
  const nx = (agent.x ?? 0) - (agent.x ?? 0) * (move / dist);
  const ny = (agent.y ?? 0) - (agent.y ?? 0) * (move / dist);
  agent.x = nx;
  agent.y = ny;
}

function computeCompletionRate(): number {
  let total = 0;
  let done = 0;
  for (const item of items.values()) {
    total++;
    if (item.status === 'done') done++;
  }
  return total > 0 ? done / total : 0;
}

// ─── Day processing ───────────────────────────────────────────────────────────

/**
 * Process all events for a single day, returning the SimMsg tick (or snapshot).
 */
function processDay(day: string): SimMsg[] {
  const dayEvents = eventsByDay.get(day) ?? [];
  const msgs: SimMsg[] = [];

  const changedItems: WorkItemPatch[] = [];
  const changedAgents: AgentPatch[] = [];
  const removedAgents: string[] = [];

  const activeAgentIds = new Set<string>();
  let dayTokens = 0;

  for (const ev of dayEvents) {
    const { agent_id, event_type } = ev;

    switch (event_type) {
      case 'session_start': {
        const agent = getOrCreateAgent(agent_id);
        agent.work_item_id = ev.session_id ?? '';
        changedAgents.push({ ...agent });
        break;
      }

      case 'message': {
        if (ev.role === 'assistant') {
          const agent = getOrCreateAgent(agent_id);
          const tokOut = ev.tokens_output ?? 0;
          const tokIn = ev.tokens_input ?? 0;
          const totalTok = tokOut + tokIn;
          dayTokens += totalTok;

          metrics.total_tokens += totalTok;
          metrics.total_spend_usd += ev.cost_usd ?? 0;

          // Velocity proportional to tokens output (capped)
          const v = Math.min(0.05, (tokOut / 5000) * 0.05);
          agent.v = v;
          agentMoveInward(agent, tokOut / 2000);
          activeAgentIds.add(agent_id);

          // Update live_tps: approximate as tokens_output / 60 seconds (1 day = 60s sim)
          metrics.live_tps = Math.min(999, dayTokens / 60);

          changedAgents.push({ ...agent });
        } else if (ev.role === 'user') {
          // Human intervention
          const level = ev.intervention_level;
          const agent = getOrCreateAgent(agent_id);

          if (level === 'emergency') {
            // Sharp trajectory deviation — wobble strongly
            agent.curve_phase = ((agent.curve_phase ?? 0) + 0.4) % 1;
            agent.v = 0; // stop
          } else if (level === 'frustration') {
            agent.curve_phase = ((agent.curve_phase ?? 0) + 0.2) % 1;
          } else if (level === 'correction') {
            agent.curve_phase = ((agent.curve_phase ?? 0) + 0.1) % 1;
          }
          changedAgents.push({ ...agent });
        }
        break;
      }

      case 'error': {
        const agent = getOrCreateAgent(agent_id);
        agent.v = 0;
        agent.curve_phase = ((agent.curve_phase ?? 0) + 0.3) % 1;
        changedAgents.push({ ...agent });

        // Mark any in-progress items for this agent as blocked
        for (const item of items.values()) {
          if (item.agent_id === agent_id && item.status === 'in_progress') {
            item.status = 'blocked';
            changedItems.push({ ...item });
          }
        }
        break;
      }

      case 'pr_opened': {
        const prId = `PR-${ev.pr_number}`;
        if (!items.has(prId)) {
          const item: WorkItemPatch = {
            id: prId,
            group: agent_id,
            sector: 'BUILD',
            depends_on: [],
            desc: ev.pr_title ?? prId,
            estimate_ms: 3600000, // 1 hour default
            started_at: new Date(ev.timestamp).getTime(),
            eta_ms: 3600000,
            tps_min: 1,
            tps_max: 100,
            tps: 10,
            tokens_done: 0,
            est_tokens: 1000,
            status: 'in_progress',
            agent_id: agent_id,
          };
          items.set(prId, item);
          changedItems.push({ ...item });

          // Associate agent with this PR
          const agent = getOrCreateAgent(agent_id);
          agent.work_item_id = prId;
          changedAgents.push({ ...agent });
        }
        break;
      }

      case 'pr_merged': {
        const prId = `PR-${ev.pr_number}`;
        if (items.has(prId)) {
          const item = items.get(prId)!;
          item.status = 'done';
          item.eta_ms = 0;
          changedItems.push({ ...item });

          // Agent "lands" — move toward center
          const agent = getOrCreateAgent(agent_id);
          const dist = Math.sqrt((agent.x ?? 0) ** 2 + (agent.y ?? 0) ** 2);
          if (dist > 0.1) {
            agent.x = (agent.x ?? 0) * 0.3;
            agent.y = (agent.y ?? 0) * 0.3;
          } else {
            agent.x = 0;
            agent.y = 0;
          }
          agent.v = 0;
          changedAgents.push({ ...agent });
        }
        break;
      }

      default:
        break;
    }
  }

  // Update active agent count
  metrics.active_agents = activeAgentIds.size;
  metrics.completion_rate = computeCompletionRate();
  metrics.live_spend_per_s = metrics.live_tps * 0.000003; // approx $3/M tokens

  tickId++;

  // Deduplicate changed agents (last patch wins)
  const agentIndex = new Map<string, AgentPatch>();
  for (const a of changedAgents) agentIndex.set(a.id, a);

  // Deduplicate changed items
  const itemIndex = new Map<string, WorkItemPatch>();
  for (const i of changedItems) itemIndex.set(i.id, i);

  const tick: SimMsg = {
    type: 'tick',
    tick_id: tickId,
    items: itemIndex.size > 0 ? Array.from(itemIndex.values()) : undefined,
    agents: agentIndex.size > 0 ? Array.from(agentIndex.values()) : undefined,
    metrics: { ...metrics },
    agents_remove: removedAgents.length > 0 ? removedAgents : undefined,
  };

  msgs.push(tick);
  return msgs;
}

// ─── Playback control ─────────────────────────────────────────────────────────

function buildInitialSnapshot(): SimMsg {
  return {
    type: 'snapshot',
    state: {
      items: {},
      agents: {},
      metrics: { ...metrics },
      seed: 'replay',
      running: true,
    },
  };
}

function msPerDay(): number {
  return Math.round(1000 / playbackSpeed);
}

function scheduleNextDay(): void {
  if (!running || currentDayIndex >= days.length) {
    running = false;
    return;
  }
  playbackTimer = setTimeout(() => {
    if (!running) return;
    const day = days[currentDayIndex];
    currentDayIndex++;
    const msgs = processDay(day);
    for (const msg of msgs) {
      postMessage(msg);
    }
    scheduleNextDay();
  }, msPerDay());
}

function startPlayback(): void {
  if (running) return;
  running = true;

  // Reset state
  agents.clear();
  items.clear();
  tickId = 0;
  currentDayIndex = 0;
  metrics = {
    active_agents: 0,
    total_tokens: 0,
    total_spend_usd: 0,
    live_tps: 0,
    live_spend_per_s: 0,
    completion_rate: 0,
  };

  // Send initial empty snapshot
  postMessage(buildInitialSnapshot());

  // Begin day-by-day playback
  scheduleNextDay();
}

function stopPlayback(): void {
  running = false;
  if (playbackTimer) {
    clearTimeout(playbackTimer);
    playbackTimer = null;
  }
}

// ─── Message handler ──────────────────────────────────────────────────────────

self.addEventListener('message', (e: MessageEvent<SimIntent>) => {
  const intent = e.data;
  if (!intent || typeof intent !== 'object') return;

  switch (intent.type) {
    case 'set_running':
      if (intent.running) {
        startPlayback();
      } else {
        stopPlayback();
      }
      break;
    case 'set_speed':
      playbackSpeed = intent.speed;
      break;
    case 'request_snapshot': {
      // Return current state snapshot
      const snap: SimMsg = {
        type: 'snapshot',
        state: {
          items: Object.fromEntries(items.entries()),
          agents: Object.fromEntries(agents.entries()),
          metrics: { ...metrics },
          seed: 'replay',
          running,
        },
      };
      postMessage(snap);
      break;
    }
    default:
      break;
  }
});

// ─── Init: load events immediately ───────────────────────────────────────────

loadEvents().catch((err) => {
  postMessage({ type: 'error', message: String(err) } as unknown as SimMsg);
});

// Keep this flag export to satisfy existing smoke test (imports.test.ts)
export const ENGINE_WORKER_MODULE_LOADED = true;
