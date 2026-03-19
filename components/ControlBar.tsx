"use client";

import React, { useSyncExternalStore } from 'react';
import { appStore } from '@/lib/store';

export default function ControlBar() {
  const pingEnabled = useSyncExternalStore(
    appStore.subscribe,
    () => appStore.getState().pingAudioEnabled,
    () => appStore.getState().pingAudioEnabled,
  );

  return (
    <div className="px-2 py-2 flex flex-wrap gap-2 items-center">
      {/* Plan selector and Execute button removed — real data source pending */}

      {/* Right-aligned: SFX ping toggle */}
      <div className="ml-auto flex items-end gap-6">
        <div className="flex flex-col items-end gap-1 text-sm">
          <div className="text-gray-300 select-none">SFX</div>
          <button
            type="button"
            onClick={() => appStore.getState().togglePingAudio()}
            title={pingEnabled ? 'Radar ping sound: ON' : 'Radar ping sound: OFF'}
            className={`h-8 w-8 grid place-items-center border ${pingEnabled ? 'border-green-500/70 text-green-400' : 'border-gray-600 text-gray-300'} bg-black hover:bg-gray-900`}
            aria-pressed={pingEnabled}
            aria-label={pingEnabled ? 'Disable radar ping sound' : 'Enable radar ping sound'}
          >
            {pingEnabled ? (
              <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
                <path d="M3 10h3l4-3v10l-4-3H3z" fill="currentColor" stroke="none" />
                <path d="M15 9c1.5 1.5 1.5 4.5 0 6" />
                <path d="M17.5 7c2.5 2.5 2.5 7.5 0 10" />
                <path d="M20 5c3.3 3.3 3.3 10.7 0 14" />
              </svg>
            ) : (
              <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
                <path d="M3 10h3l4-3v10l-4-3H3z" fill="currentColor" stroke="none" />
                <path d="M16 8l6 6" />
                <path d="M22 8l-6 6" />
              </svg>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
