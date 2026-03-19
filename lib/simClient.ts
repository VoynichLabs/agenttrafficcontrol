"use client";

// Author: Bubba (OpenClaw agent)
// Date: 2026-03-19
// PURPOSE: UI-side singleton for the data bridge. Initializes the replay engine
// Web Worker and wires it through simBridge → bridgeToStore → appStore.
// Exposes ensureConnected(), postIntent(), isConnected(), destroyConnection().

import { createSimBridge, type SimBridge } from '@/lib/simBridge';
import { attachBridgeToStore } from '@/lib/bridgeToStore';
import { appStore } from '@/lib/store';
import { debugLog } from '@/lib/debug';

let _bridge: SimBridge | null = null;
let _link: { destroy: () => void } | null = null;
let _worker: Worker | null = null;

export function isConnected() {
  return !!_bridge;
}

export function ensureConnected() {
  if (_bridge) return _bridge;

  // Only run in browser
  if (typeof window === 'undefined') {
    debugLog('simClient', 'ensureConnected: SSR — skip worker init');
    return null;
  }

  try {
    // Create the replay engine worker
    _worker = new Worker(new URL('../workers/engine.ts', import.meta.url), {
      type: 'module',
    });

    // Wrap in simBridge (PortLike adapter)
    const port = {
      postMessage: (msg: unknown) => _worker!.postMessage(msg),
      addEventListener: (event: 'message', handler: (e: { data: unknown }) => void) => {
        _worker!.addEventListener(event, handler as unknown as EventListener);
      },
      removeEventListener: (event: 'message', handler: (e: { data: unknown }) => void) => {
        _worker!.removeEventListener(event, handler as unknown as EventListener);
      },
    };

    _bridge = createSimBridge(port);
    _link = attachBridgeToStore(_bridge, { getState: () => appStore.getState() });

    debugLog('simClient', 'ensureConnected: replay engine worker started');
    return _bridge;
  } catch (err) {
    debugLog('simClient', 'ensureConnected: failed to start worker', err);
    return null;
  }
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
  if (_worker) {
    _worker.terminate();
    _worker = null;
  }
}
