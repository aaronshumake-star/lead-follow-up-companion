import { describe, expect, it } from 'vitest'
import { createSeedSnapshot } from '../data/demo/storage.ts'
import { BACKUP_VERSION, createBackup, customersCsv, dryRunRestore } from './backup.ts'

describe('backup and restore', () => {
  it('exports versioned JSON without secrets, raw audio or deleted screenshots', () => {
    const snapshot = createSeedSnapshot()
    snapshot.voiceRecords.push({
      id: 'v', customerId: null, providerMessageId: 'm', providerMediaIdHash: 'a'.repeat(64),
      provider: 'sim', transcriptionProvider: 'sim', mimeType: 'audio/ogg',
      actualSize: 100, durationSeconds: 5, detectedLanguage: 'en',
      transcriptPreview: 'safe preview', transcriptConfidence: 1, parsedIntent: 'x',
      status: 'applied', failureClassification: null, failureSummary: null,
      attemptCount: 1, nextAttemptAt: null, audioRetained: true, audioDeletedAt: null,
      simulated: true, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
    })
    const backup = createBackup(snapshot)
    expect(backup.version).toBe(BACKUP_VERSION)
    const serialized = JSON.stringify(backup)
    expect(serialized).not.toContain('service_role')
    expect(serialized).not.toContain('WHATSAPP_ACCESS_TOKEN')
    expect((backup.data.voiceRecords[0] as { audioRetained: boolean }).audioRetained).toBe(false)
  })

  it('dry-runs a valid backup, rejects an invalid version and wrong owner', () => {
    const snapshot = createSeedSnapshot()
    const backup = createBackup(snapshot)
    expect(dryRunRestore(backup, snapshot).valid).toBe(true)
    expect(dryRunRestore({ ...backup, version: 99 }, snapshot).valid).toBe(false)
    expect(dryRunRestore({ ...backup, ownerId: 'other' }, snapshot).errors).toContain(
      'Backup belongs to a different user.',
    )
  })

  it('warns about duplicate customers and produces CSV', () => {
    const snapshot = createSeedSnapshot()
    const backup = createBackup(snapshot)
    expect(dryRunRestore(backup, snapshot).duplicateWarnings.length).toBeGreaterThan(0)
    expect(customersCsv(snapshot)).toContain('Jesus Ayala')
  })
})
