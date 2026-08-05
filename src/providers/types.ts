/**
 * Shared shape for every external-service provider.
 *
 * All four capabilities (screenshot extraction, WhatsApp messaging, voice
 * transcription, command parsing) sit behind an interface so the implementation
 * can be swapped without touching feature code — the brief explicitly requires
 * being able to change the WhatsApp provider later, and the same reasoning
 * applies to anything that could cost money.
 *
 * Providers never throw for expected conditions. They return a discriminated
 * result, which forces call sites to handle "not configured" and "over budget"
 * as ordinary outcomes rather than as crashes.
 */

export interface ProviderInfo {
  /** Stable identifier stored alongside records, e.g. 'tesseract'. */
  readonly id: string
  readonly displayName: string
  /** False until credentials and settings are in place. */
  readonly isConfigured: boolean
  /** True when the provider can incur charges, for the cost surfaces. */
  readonly isBillable: boolean
}

export const PROVIDER_ERROR_CODES = [
  'not_configured',
  'disabled',
  'not_implemented',
  'unauthorized_sender',
  'budget_exceeded',
  'rate_limited',
  'invalid_input',
  'provider_error',
  'timeout',
] as const
export type ProviderErrorCode = (typeof PROVIDER_ERROR_CODES)[number]

export interface ProviderError {
  code: ProviderErrorCode
  /** Safe to show and to log: must never contain customer data. */
  message: string
  retryable: boolean
}

export type ProviderResult<T> = { ok: true; value: T } | { ok: false; error: ProviderError }

export function providerOk<T>(value: T): ProviderResult<T> {
  return { ok: true, value }
}

export function providerFailure<T>(
  code: ProviderErrorCode,
  message: string,
  retryable = false,
): ProviderResult<T> {
  return { ok: false, error: { code, message, retryable } }
}

/** Standard result for a capability that exists but has not been switched on. */
export function notConfigured<T>(capability: string): ProviderResult<T> {
  return providerFailure<T>(
    'not_configured',
    `${capability} is not configured. Enable it in Settings once credentials are in place.`,
  )
}
