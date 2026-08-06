export interface AuthLinkError {
  kind: 'expired' | 'invalid'
  message: string
}

/**
 * Supabase returns link failures in either the query string or URL fragment.
 * Keep the provider's raw description out of the UI because it may change and
 * is less useful than an actionable message.
 */
export function getAuthLinkError(search: string, hash: string): AuthLinkError | null {
  const queryParameters = new URLSearchParams(search)
  const hashParameters = new URLSearchParams(hash.replace(/^#/, ''))
  const errorCode = hashParameters.get('error_code') ?? queryParameters.get('error_code')
  const hasError = hashParameters.has('error') || queryParameters.has('error')

  if (errorCode === 'otp_expired') {
    return {
      kind: 'expired',
      message: 'This email link has expired. Request a new link and try again.',
    }
  }

  if (hasError || errorCode !== null) {
    return {
      kind: 'invalid',
      message: 'This email link is invalid or has already been used. Request a new link and try again.',
    }
  }

  return null
}
