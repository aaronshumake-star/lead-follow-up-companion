import { z } from 'zod'
import type { WorkspaceSnapshot } from '../data/workspace.ts'
import { findDuplicateCandidates } from './duplicates.ts'

export const BACKUP_VERSION = 1

const backupSchema = z.object({
  version: z.literal(BACKUP_VERSION),
  exportedAt: z.string().datetime(),
  ownerId: z.string().min(1),
  data: z.object({
    customers: z.array(z.unknown()),
    contactMethods: z.array(z.unknown()),
    vehicleInterests: z.array(z.unknown()),
    activities: z.array(z.unknown()),
    followUps: z.array(z.unknown()),
    screenshots: z.array(z.unknown()),
    extractionFields: z.array(z.unknown()),
    notifications: z.array(z.unknown()),
    voiceRecords: z.array(z.unknown()),
    settings: z.record(z.string(), z.unknown()),
    auditEntries: z.array(z.unknown()),
  }),
})

export type BackupPackage = z.infer<typeof backupSchema>

/** Excludes provider secrets, raw audio, deleted screenshots and other users. */
export function createBackup(snapshot: WorkspaceSnapshot): BackupPackage {
  return {
    version: BACKUP_VERSION,
    exportedAt: new Date().toISOString(),
    ownerId: snapshot.profile.id,
    data: {
      customers: snapshot.customers.filter((item) => item.userId === snapshot.profile.id),
      contactMethods: snapshot.contactMethods,
      vehicleInterests: snapshot.vehicleInterests,
      activities: snapshot.activities.map(({ rawText: _raw, ...item }) => item),
      followUps: snapshot.followUps,
      screenshots: snapshot.screenshots
        .filter((item) => item.status !== 'discarded')
        .map(({ rawText: _raw, ...item }) => item),
      extractionFields: snapshot.extractionFields,
      notifications: snapshot.notifications,
      voiceRecords: snapshot.voiceRecords.map((item) => ({
        ...item,
        transcriptPreview: item.transcriptPreview,
        audioRetained: false,
      })),
      settings: { ...snapshot.profile, whatsappNumberE164: null },
      auditEntries: snapshot.auditEntries,
    },
  }
}

export interface RestoreDryRun {
  valid: boolean
  errors: string[]
  counts: Record<string, number>
  duplicateWarnings: Array<{ incomingName: string; candidates: string[] }>
  openFollowUpConflicts: number
}

/** Conservative validation only. Additive application stays behind explicit confirmation. */
export function dryRunRestore(raw: unknown, snapshot: WorkspaceSnapshot): RestoreDryRun {
  const parsed = backupSchema.safeParse(raw)
  if (!parsed.success) {
    return {
      valid: false,
      errors: parsed.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.code}`),
      counts: {},
      duplicateWarnings: [],
      openFollowUpConflicts: 0,
    }
  }
  if (parsed.data.ownerId !== snapshot.profile.id) {
    return {
      valid: false,
      errors: ['Backup belongs to a different user.'],
      counts: {},
      duplicateWarnings: [],
      openFollowUpConflicts: 0,
    }
  }

  const incoming = parsed.data.data.customers as Array<{
    fullName?: string
    primaryPhone?: string | null
    primaryEmail?: string | null
    dealershipCustomerId?: string | null
    city?: string | null
  }>
  const duplicateWarnings = incoming.flatMap((customer) => {
    if (typeof customer.fullName !== 'string') return []
    const matches = findDuplicateCandidates(
      {
        fullName: customer.fullName,
        primaryPhone: customer.primaryPhone,
        primaryEmail: customer.primaryEmail,
        dealershipCustomerId: customer.dealershipCustomerId,
        city: customer.city,
      },
      snapshot.customers,
    )
    return matches.length === 0
      ? []
      : [{ incomingName: customer.fullName, candidates: matches.map((item) => item.customer.fullName) }]
  })

  const data = parsed.data.data
  return {
    valid: true,
    errors: [],
    counts: Object.fromEntries(
      Object.entries(data)
        .filter(([, value]) => Array.isArray(value))
        .map(([key, value]) => [key, (value as unknown[]).length]),
    ),
    duplicateWarnings,
    // Application must resolve these against the one-open-follow-up rule.
    openFollowUpConflicts: duplicateWarnings.length,
  }
}

export function backupFilename(now = new Date()): string {
  return `lead-follow-up-backup-${now.toISOString().slice(0, 10)}.json`
}

export function customersCsv(snapshot: WorkspaceSnapshot): string {
  const headers = ['full_name', 'phone', 'email', 'dealership_customer_id', 'status', 'priority', 'created_at']
  const rows = snapshot.customers.map((item) => [
    item.fullName, item.primaryPhone, item.primaryEmail, item.dealershipCustomerId,
    item.leadStatus, item.leadPriority, item.createdAt,
  ])
  return [headers, ...rows].map((row) => row.map(csvCell).join(',')).join('\n')
}

/** Only customer rows safe for additive restore; everything else remains dry-run review. */
export function restorableCustomers(backup: BackupPackage): Array<{
  fullName: string
  primaryPhone: string | null
  primaryEmail: string | null
  dealershipCustomerId: string | null
  city: string | null
  state: string | null
}> {
  return (backup.data.customers as unknown[]).flatMap((row) => {
    if (typeof row !== 'object' || row === null) return []
    const value = row as Record<string, unknown>
    if (typeof value['fullName'] !== 'string' || value['fullName'].trim() === '') return []
    const optional = (key: string): string | null =>
      typeof value[key] === 'string' ? (value[key] as string) : null
    return [{
      fullName: value['fullName'] as string,
      primaryPhone: optional('primaryPhone'),
      primaryEmail: optional('primaryEmail'),
      dealershipCustomerId: optional('dealershipCustomerId'),
      city: optional('city'),
      state: optional('state'),
    }]
  })
}

export function parseBackup(raw: unknown): BackupPackage | null {
  const parsed = backupSchema.safeParse(raw)
  return parsed.success ? parsed.data : null
}

function csvCell(value: unknown): string {
  const text = value === null || value === undefined ? '' : String(value)
  return `"${text.replace(/"/g, '""')}"`
}
