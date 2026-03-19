// Plan registry — synthetic plans removed.
// Wire real data sources here when ready.
export * from './types';
import type { PlanDefinition } from './types';

export const ALL_PLANS: readonly PlanDefinition[] = [] as const;

export const PLAN_NAMES: readonly string[] = [];

export const PLAN_REGISTRY: Record<string, PlanDefinition> = {};

export function getPlanByName(_name: string): PlanDefinition | undefined {
  return undefined;
}

export const DEFAULT_PLAN_NAME: string = '';
