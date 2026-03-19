"use client";

// simClient.ts — UI-side singleton for the data bridge.
// The synthetic Web Worker engine has been removed.
// Wire a real data source (WebSocket, SSE, file replay) here.

import { createSimBridge, type SimBridge } from '@/lib/simBridge';
import { attachBridgeToStore } from '@/lib/bridgeToStore';
import { appStore } from '@/lib/store';
import { debugLog } from '@/lib/debug';

let _bridge: SimBridge | null = null;
let _link: { destroy: () => void } | null = null;

export function isConnected() {
  return !!_bridge;
}

export function ensureConnected() {
  // TODO: replace with real data source (WebSocket, SSE, file replay)
  // The synthetic engine worker has been removed.
  debugLog('simClient', 'ensureConnected: no engine — awaiting real data source');
  return null;
}

export function setExternalBridge(bridge: SimBridge, link: { destroy: () => void }) {
  if (_bridge) return;
  _bridge = bridge;
  _link = link;
}

export function postIntent(intent: Parameters<SimBridge['postIntent']>[0]) {
  _bridge?.postIntent(intent);
}

export function destroyConnection() {
  _link?.destroy();
  _link = null;
  _bridge = null;
}
