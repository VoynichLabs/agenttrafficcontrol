"use client";

// Author: Bubba (OpenClaw agent)
// Date: 2026-03-19
// PURPOSE: Master Control Panel bar with Play/Pause, speed selector, timeline scrubber,
// current date display, and SFX toggle. Wires to simClient for replay engine control.

import React, { useSyncExternalStore, useEffect, useState, useCallback, useRef } from 'react';
import { appStore } from '@/lib/store';
import { ensureConnected, postIntent } from '@/lib/simClient';

// Timeline dates for the dataset
const TIMELINE_START = new Date('2025-02-10T00:00:00Z');
const TIMELINE_END = new Date('2026-03-19T00:00:00Z');
const TOTAL_DAYS = Math.ceil(
  (TIMELINE_END.getTime() - TIMELINE_START.getTime()) / (1000 * 60 * 60 * 24)
);

const SPEED_OPTIONS = [
  { label: '1×', value: 1, ms: 1000 },
  { label: '2×', value: 2, ms: 500 },
  { label: '5×', value: 5, ms: 200 },
  { label: '10×', value: 10, ms: 100 },
];

function formatDate(d: Date): string {
  return d.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: '2-digit',
    timeZone: 'UTC',
  });
}

export default function ControlBar() {
  const pingEnabled = useSyncExternalStore(
    appStore.subscribe,
    () => appStore.getState().pingAudioEnabled,
    () => appStore.getState().pingAudioEnabled,
  );

  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState(1);
  const [currentDay, setCurrentDay] = useState(0); // 0..TOTAL_DAYS
  const [connected, setConnected] = useState(false);
  const tickRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Initialize connection on mount
  useEffect(() => {
    const bridge = ensureConnected();
    if (bridge) setConnected(true);
    return () => {
      // cleanup handled by destroyConnection
    };
  }, []);

  // Advance the scrubber during playback
  useEffect(() => {
    if (playing) {
      const speedOpt = SPEED_OPTIONS.find((s) => s.value === speed) ?? SPEED_OPTIONS[0];
      tickRef.current = setInterval(() => {
        setCurrentDay((d) => {
          if (d >= TOTAL_DAYS) {
            setPlaying(false);
            return d;
          }
          return d + 1;
        });
      }, speedOpt.ms);
    } else {
      if (tickRef.current) {
        clearInterval(tickRef.current);
        tickRef.current = null;
      }
    }
    return () => {
      if (tickRef.current) {
        clearInterval(tickRef.current);
        tickRef.current = null;
      }
    };
  }, [playing, speed]);

  const handlePlayPause = useCallback(() => {
    if (!connected) {
      const bridge = ensureConnected();
      if (bridge) setConnected(true);
    }
    const next = !playing;
    setPlaying(next);
    if (next) {
      // Reset to start and begin playback
      setCurrentDay(0);
      postIntent({ type: 'set_speed', speed });
      postIntent({ type: 'set_running', running: true });
    } else {
      postIntent({ type: 'set_running', running: false });
    }
  }, [playing, connected, speed]);

  const handleSpeedChange = useCallback((s: number) => {
    setSpeed(s);
    postIntent({ type: 'set_speed', speed: s });
  }, []);

  const handleScrub = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const day = parseInt(e.target.value, 10);
    setCurrentDay(day);
    // Pause on scrub
    if (playing) {
      setPlaying(false);
      postIntent({ type: 'set_running', running: false });
    }
  }, [playing]);

  // Current date based on scrubber position
  const currentDate = new Date(TIMELINE_START.getTime() + currentDay * 24 * 60 * 60 * 1000);
  const progress = TOTAL_DAYS > 0 ? (currentDay / TOTAL_DAYS) * 100 : 0;

  return (
    <div className="px-2 py-2 flex flex-col gap-2">
      {/* Row 1: Play + Speed + Date */}
      <div className="flex flex-wrap gap-2 items-center">
        {/* Play/Pause button */}
        <button
          type="button"
          onClick={handlePlayPause}
          title={playing ? 'Pause replay' : 'Play replay (real PlanExe events)'}
          className={`h-8 px-3 flex items-center gap-1 border text-xs font-mono ${
            playing
              ? 'border-amber-500/70 text-amber-400 bg-amber-950/30'
              : 'border-green-500/70 text-green-400 bg-green-950/30'
          } hover:bg-gray-900 select-none`}
          aria-pressed={playing}
        >
          {playing ? (
            <>
              <svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor">
                <rect x="6" y="5" width="4" height="14" rx="1" />
                <rect x="14" y="5" width="4" height="14" rx="1" />
              </svg>
              PAUSE
            </>
          ) : (
            <>
              <svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor">
                <polygon points="5,3 19,12 5,21" />
              </svg>
              PLAY
            </>
          )}
        </button>

        {/* Speed selector */}
        <div className="flex items-center gap-1">
          <span className="text-[10px] text-gray-500 font-mono">SPEED</span>
          {SPEED_OPTIONS.map((opt) => (
            <button
              key={opt.value}
              type="button"
              onClick={() => handleSpeedChange(opt.value)}
              className={`h-7 w-9 text-xs font-mono border ${
                speed === opt.value
                  ? 'border-amber-500/70 text-amber-300 bg-amber-950/20'
                  : 'border-gray-700 text-gray-400 hover:bg-gray-900'
              }`}
              title={`${opt.label} speed — ${opt.ms}ms per day`}
            >
              {opt.label}
            </button>
          ))}
        </div>

        {/* Current date display */}
        <div className="ml-auto flex items-center gap-2">
          <span className="text-[10px] text-gray-500 font-mono">DATE</span>
          <span className="text-xs font-mono text-amber-300 min-w-[80px] text-right">
            {formatDate(currentDate)}
          </span>
        </div>

        {/* SFX toggle */}
        <div className="flex flex-col items-end gap-1 text-sm">
          <div className="text-gray-300 text-[10px] select-none font-mono">SFX</div>
          <button
            type="button"
            onClick={() => appStore.getState().togglePingAudio()}
            title={pingEnabled ? 'Radar ping sound: ON' : 'Radar ping sound: OFF'}
            className={`h-8 w-8 grid place-items-center border ${
              pingEnabled ? 'border-green-500/70 text-green-400' : 'border-gray-600 text-gray-300'
            } bg-black hover:bg-gray-900`}
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

      {/* Row 2: Timeline scrubber */}
      <div className="flex flex-col gap-1">
        <div className="relative">
          <input
            type="range"
            min={0}
            max={TOTAL_DAYS}
            value={currentDay}
            onChange={handleScrub}
            className="w-full h-1 appearance-none cursor-pointer bg-gray-800 accent-amber-400"
            title={`Timeline: ${formatDate(currentDate)}`}
          />
          {/* Progress fill overlay (visual only) */}
          <div
            className="absolute top-0 left-0 h-1 bg-amber-500/50 pointer-events-none"
            style={{ width: `${progress}%` }}
          />
        </div>
        {/* Date labels */}
        <div className="flex justify-between text-[9px] text-gray-600 font-mono select-none">
          <span>{formatDate(TIMELINE_START)}</span>
          <span>{formatDate(TIMELINE_END)}</span>
        </div>
      </div>
    </div>
  );
}
