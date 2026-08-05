/**
 * Browser-local storage for demo mode.
 *
 * Demo records live in localStorage under a versioned key and never touch
 * Supabase. The two backends are selected exclusively — the app is in one mode
 * or the other — so a demo record can never be written to a real project, and a
 * real customer can never be edited by the demo repository.
 *
 * Falls back to an in-memory map when localStorage is unavailable (private
 * browsing, or a test environment without it), so the app still works and only
 * loses persistence across reloads.
 */

import type { WorkspaceSnapshot } from '../workspace.ts'
import {
  DEMO_ACTIVITIES,
  DEMO_CONTACT_METHODS,
  DEMO_CUSTOMERS,
  DEMO_FOLLOW_UPS,
  DEMO_PROFILE,
  DEMO_VEHICLE_INTERESTS,
} from '../fixtures.ts'

export const DEMO_STORAGE_KEY = 'lead-follow-up-companion.demo.v1'

const memoryFallback = new Map<string, string>()

function readRaw(key: string): string | null {
  try {
    return globalThis.localStorage?.getItem(key) ?? memoryFallback.get(key) ?? null
  } catch {
    return memoryFallback.get(key) ?? null
  }
}

function writeRaw(key: string, value: string): void {
  memoryFallback.set(key, value)
  try {
    globalThis.localStorage?.setItem(key, value)
  } catch {
    // Quota or a disabled store: the in-memory copy keeps the session working.
  }
}

function clearRaw(key: string): void {
  memoryFallback.delete(key)
  try {
    globalThis.localStorage?.removeItem(key)
  } catch {
    // Nothing to do; the in-memory copy is already gone.
  }
}

/**
 * A fresh copy of the fictional fixtures.
 *
 * Deep-cloned on every call so mutating demo data never reaches back into the
 * fixture module, which the unit tests also read from.
 */
export function createSeedSnapshot(): WorkspaceSnapshot {
  return {
    profile: structuredClone(DEMO_PROFILE),
    customers: structuredClone(DEMO_CUSTOMERS),
    contactMethods: structuredClone(DEMO_CONTACT_METHODS),
    vehicleInterests: structuredClone(DEMO_VEHICLE_INTERESTS),
    activities: structuredClone(DEMO_ACTIVITIES),
    followUps: structuredClone(DEMO_FOLLOW_UPS),
    auditEntries: [],
  }
}

/**
 * Reads the stored snapshot, seeding from fixtures on first use.
 *
 * Anything unparseable is replaced rather than repaired: demo data is
 * disposable by definition, and a half-read snapshot would be worse than a
 * fresh one.
 */
export function readSnapshot(): WorkspaceSnapshot {
  const raw = readRaw(DEMO_STORAGE_KEY)

  if (raw === null) {
    const seeded = createSeedSnapshot()
    writeSnapshot(seeded)
    return seeded
  }

  try {
    const parsed = JSON.parse(raw) as Partial<WorkspaceSnapshot>
    if (!Array.isArray(parsed.customers) || typeof parsed.profile !== 'object') {
      throw new Error('malformed demo snapshot')
    }

    return {
      profile: parsed.profile as WorkspaceSnapshot['profile'],
      customers: parsed.customers,
      contactMethods: parsed.contactMethods ?? [],
      vehicleInterests: parsed.vehicleInterests ?? [],
      activities: parsed.activities ?? [],
      followUps: parsed.followUps ?? [],
      auditEntries: parsed.auditEntries ?? [],
    }
  } catch {
    const seeded = createSeedSnapshot()
    writeSnapshot(seeded)
    return seeded
  }
}

export function writeSnapshot(snapshot: WorkspaceSnapshot): void {
  writeRaw(DEMO_STORAGE_KEY, JSON.stringify(snapshot))
}

/** Discards local demo records so the next read reseeds from the fixtures. */
export function clearSnapshot(): void {
  clearRaw(DEMO_STORAGE_KEY)
}

/** Collision-resistant enough for local records, with a fallback for old runtimes. */
export function newId(): string {
  const cryptoApi = globalThis.crypto
  if (typeof cryptoApi?.randomUUID === 'function') return cryptoApi.randomUUID()

  return `demo-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`
}
