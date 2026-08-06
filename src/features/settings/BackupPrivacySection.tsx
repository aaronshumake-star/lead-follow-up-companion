import { useRef, useState } from 'react'
import { Card, CardTitle } from '../../components/ui/Card.tsx'
import { Button } from '../../components/ui/Button.tsx'
import { ConfirmDialog } from '../../components/ui/ConfirmDialog.tsx'
import { useWorkspace } from '../../data/useWorkspace.ts'
import { useToast } from '../../components/ui/useToast.ts'
import {
  backupFilename, createBackup, customersCsv, dryRunRestore, parseBackup,
  restorableCustomers, type BackupPackage, type RestoreDryRun,
} from '../../domain/backup.ts'

export function BackupPrivacySection() {
  const { snapshot, run } = useWorkspace()
  const { notify } = useToast()
  const picker = useRef<HTMLInputElement>(null)
  const [dryRun, setDryRun] = useState<RestoreDryRun | null>(null)
  const [backup, setBackup] = useState<BackupPackage | null>(null)
  const [confirmRestore, setConfirmRestore] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)

  if (snapshot === null) return null
  const currentSnapshot = snapshot

  function download(content: string, type: string, filename: string) {
    const url = URL.createObjectURL(new Blob([content], { type }))
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = filename
    anchor.click()
    URL.revokeObjectURL(url)
  }

  async function inspect(file: File) {
    try {
      const raw = JSON.parse(await file.text()) as unknown
      const result = dryRunRestore(raw, currentSnapshot)
      setBackup(result.valid ? parseBackup(raw) : null)
      setDryRun(result)
      notify(result.valid ? 'success' : 'error', result.valid ? 'Backup validated. Nothing was imported.' : 'Backup is invalid.')
    } catch {
      setDryRun({ valid: false, errors: ['File is not valid JSON.'], counts: {}, duplicateWarnings: [], openFollowUpConflicts: 0 })
    }
  }

  return (
    <>
      <Card>
        <CardTitle hint="Exports contain your data, never provider secrets or raw audio.">Export and Backup</CardTitle>
        <div className="flex flex-wrap gap-2">
          <Button
            variant="primary"
            onClick={() =>
              download(JSON.stringify(createBackup(currentSnapshot), null, 2), 'application/json', backupFilename())
            }
          >
            Download JSON backup
          </Button>
          <Button
            onClick={() =>
              download(customersCsv(currentSnapshot), 'text/csv', `lead-follow-up-customers-${new Date().toISOString().slice(0, 10)}.csv`)
            }
          >
            Download customer CSV
          </Button>
          <Button onClick={() => picker.current?.click()}>Validate backup for restore</Button>
          <input
            ref={picker}
            className="sr-only"
            type="file"
            accept="application/json,.json"
            aria-label="Choose backup for dry run"
            onChange={(event) => {
              const file = event.target.files?.[0]
              if (file !== undefined) void inspect(file)
            }}
          />
          {dryRun?.valid === true && backup !== null && (
            <Button variant="primary" onClick={() => setConfirmRestore(true)}>
              Apply safe additive restore
            </Button>
          )}
        </div>
        {dryRun !== null && (
          <div className="mt-3 rounded-lg border border-slate-800 p-3 text-sm">
            <p>{dryRun.valid ? 'Valid backup — dry run only; no data changed.' : dryRun.errors.join(' ')}</p>
            {dryRun.valid && (
              <p className="mt-1 text-slate-400">
                {Object.entries(dryRun.counts).map(([key, value]) => `${key}: ${value}`).join(' · ')}
                {` · duplicate warnings: ${dryRun.duplicateWarnings.length}`}
              </p>
            )}
          </div>
        )}
      </Card>

      <Card className="border-rose-900/60">
        <CardTitle hint="Cleanup keeps the account and settings; deleting all data does not delete the auth account.">
          Privacy and Data Deletion
        </CardTitle>
        <div className="flex flex-wrap gap-2">
          <Button
            onClick={() =>
              void run((repo) => repo.cleanupPrivateData?.(new Date(Date.now() - 30 * 86_400_000)) ?? Promise.resolve(0))
                .then((count) => notify('success', `Cleaned ${count} old private diagnostic record(s).`))
            }
          >
            Delete diagnostics older than 30 days
          </Button>
          <Button variant="danger" onClick={() => setConfirmDelete(true)}>Delete all application data</Button>
        </div>
      </Card>

      <ConfirmDialog
        open={confirmDelete}
        title="Delete all application data"
        message="This permanently removes every customer, activity, follow-up, screenshot, message, voice record and audit entry. Your login account remains. Export a backup first. This cannot be undone."
        confirmLabel="Delete all data permanently"
        onCancel={() => setConfirmDelete(false)}
        onConfirm={() => {
          setConfirmDelete(false)
          void run((repo) => repo.deleteAllUserData?.() ?? Promise.resolve()).then(() =>
            notify('success', 'All application data deleted. Your login account remains.'),
          )
        }}
      />
      <ConfirmDialog
        open={confirmRestore}
        title="Apply additive restore"
        message="Only customers with no duplicate warning will be added. Existing customers and verified phone/email values will not be overwritten. Follow-ups, provider secrets and raw media are not imported automatically."
        confirmLabel="Import safe new customers"
        destructive={false}
        onCancel={() => setConfirmRestore(false)}
        onConfirm={() => {
          setConfirmRestore(false)
          if (backup === null) return
          const duplicateNames = new Set(dryRun?.duplicateWarnings.map((item) => item.incomingName) ?? [])
          const safe = restorableCustomers(backup).filter((item) => !duplicateNames.has(item.fullName))
          void run(async (repo) => {
            for (const customer of safe) await repo.createCustomer(customer)
          }).then(() => notify('success', `Restored ${safe.length} new customer(s); duplicates were left for review.`))
        }}
      />
    </>
  )
}
