import { useId, type ReactNode, type SelectHTMLAttributes, type TextareaHTMLAttributes } from 'react'
import type { InputHTMLAttributes } from 'react'
import { cn } from '../../lib/cn.ts'

const CONTROL_CLASSES =
  'w-full rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-slate-100 placeholder:text-slate-600 disabled:opacity-60'

interface FieldShellProps {
  label: string
  hint?: string
  error?: string
  required?: boolean
  children: (controlId: string, describedBy: string | undefined) => ReactNode
}

/**
 * Shared label, hint and error wiring.
 *
 * The hint and error are bound with aria-describedby so a screen reader hears
 * why a field was rejected, rather than the error being visual only.
 */
function FieldShell({ label, hint, error, required, children }: FieldShellProps) {
  const controlId = useId()
  const hintId = `${controlId}-hint`
  const errorId = `${controlId}-error`
  const describedBy = [hint === undefined ? null : hintId, error === undefined ? null : errorId]
    .filter((id): id is string => id !== null)
    .join(' ')

  return (
    <div className="space-y-1">
      <label htmlFor={controlId} className="block text-sm font-medium text-slate-300">
        {label}
        {required === true && (
          <span className="ml-1 text-rose-400" aria-hidden>
            *
          </span>
        )}
      </label>

      {children(controlId, describedBy === '' ? undefined : describedBy)}

      {hint !== undefined && (
        <p id={hintId} className="text-xs text-slate-500">
          {hint}
        </p>
      )}
      {error !== undefined && (
        <p id={errorId} role="alert" className="text-xs text-rose-300">
          {error}
        </p>
      )}
    </div>
  )
}

type TextFieldProps = Omit<InputHTMLAttributes<HTMLInputElement>, 'id'> & {
  label: string
  hint?: string
  error?: string
}

export function TextField({ label, hint, error, className, ...rest }: TextFieldProps) {
  return (
    <FieldShell label={label} hint={hint} error={error} required={rest.required}>
      {(id, describedBy) => (
        <input
          id={id}
          aria-describedby={describedBy}
          aria-invalid={error === undefined ? undefined : true}
          className={cn(CONTROL_CLASSES, error !== undefined && 'border-rose-700', className)}
          {...rest}
        />
      )}
    </FieldShell>
  )
}

type SelectFieldProps = Omit<SelectHTMLAttributes<HTMLSelectElement>, 'id'> & {
  label: string
  hint?: string
  error?: string
  options: ReadonlyArray<{ value: string; label: string }>
}

export function SelectField({ label, hint, error, options, className, ...rest }: SelectFieldProps) {
  return (
    <FieldShell label={label} hint={hint} error={error} required={rest.required}>
      {(id, describedBy) => (
        <select
          id={id}
          aria-describedby={describedBy}
          className={cn(CONTROL_CLASSES, className)}
          {...rest}
        >
          {options.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      )}
    </FieldShell>
  )
}

type TextAreaFieldProps = Omit<TextareaHTMLAttributes<HTMLTextAreaElement>, 'id'> & {
  label: string
  hint?: string
  error?: string
}

export function TextAreaField({ label, hint, error, className, rows = 3, ...rest }: TextAreaFieldProps) {
  return (
    <FieldShell label={label} hint={hint} error={error} required={rest.required}>
      {(id, describedBy) => (
        <textarea
          id={id}
          rows={rows}
          aria-describedby={describedBy}
          className={cn(CONTROL_CLASSES, className)}
          {...rest}
        />
      )}
    </FieldShell>
  )
}

export function CheckboxField({
  label,
  hint,
  checked,
  onChange,
  disabled,
}: {
  label: string
  hint?: string
  checked: boolean
  onChange: (checked: boolean) => void
  disabled?: boolean
}) {
  const id = useId()

  return (
    <div className="flex items-start gap-2">
      <input
        id={id}
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={(event) => onChange(event.target.checked)}
        className="mt-1 size-4 rounded border-slate-600 bg-slate-900"
      />
      <div>
        <label htmlFor={id} className="text-sm font-medium text-slate-300">
          {label}
        </label>
        {hint !== undefined && <p className="text-xs text-slate-500">{hint}</p>}
      </div>
    </div>
  )
}
