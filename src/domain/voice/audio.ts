/** Privacy-first voice media validation. Audio is untrusted until this passes. */
export const SUPPORTED_AUDIO_MIME_TYPES = [
  'audio/ogg', 'audio/opus', 'audio/mpeg', 'audio/mp4', 'audio/aac',
  'audio/amr', 'audio/3gpp', 'audio/webm', 'audio/wav',
] as const

export interface AudioLimits {
  maxBytes: number
  maxSeconds: number
}

export type AudioValidation =
  | { ok: true; mimeType: string; size: number; durationSeconds: number | null }
  | { ok: false; classification: 'unsupported_media' | 'oversized' | 'duration_exceeded' | 'corrupt_media'; message: string }

/**
 * Meta describes Opus voice notes as `audio/ogg; codecs=opus`. MIME parameters
 * describe the codec, not a different media type, so validation and storage use
 * the normalized base type. Lowercasing also avoids rejecting a semantically
 * identical provider header because of casing.
 */
export function normalizeAudioMime(value: string): string {
  return value.split(';', 1)[0]?.trim().toLowerCase() ?? ''
}

export function validateAudio(
  bytes: Uint8Array,
  declaredMime: string,
  declaredDuration: number | null,
  limits: AudioLimits,
): AudioValidation {
  const mimeType = normalizeAudioMime(declaredMime)
  if (!SUPPORTED_AUDIO_MIME_TYPES.includes(mimeType as (typeof SUPPORTED_AUDIO_MIME_TYPES)[number])) {
    return { ok: false, classification: 'unsupported_media', message: 'That voice format is not supported.' }
  }
  if (bytes.length > limits.maxBytes) {
    return { ok: false, classification: 'oversized', message: 'That voice message is too large.' }
  }
  if (bytes.length === 0 || !hasPlausibleSignature(bytes, mimeType)) {
    return { ok: false, classification: 'corrupt_media', message: 'That voice message is empty or corrupt.' }
  }
  if (declaredDuration !== null && declaredDuration > limits.maxSeconds) {
    return { ok: false, classification: 'duration_exceeded', message: 'That voice message is too long.' }
  }
  return { ok: true, mimeType, size: bytes.length, durationSeconds: declaredDuration }
}

function hasPlausibleSignature(bytes: Uint8Array, mime: string): boolean {
  if (bytes.length < 4) return false
  const ascii = new TextDecoder().decode(bytes.slice(0, 12))
  if (mime === 'audio/ogg' || mime === 'audio/opus') return ascii.startsWith('OggS')
  if (mime === 'audio/wav') return ascii.startsWith('RIFF')
  if (mime === 'audio/webm') return bytes[0] === 0x1a && bytes[1] === 0x45
  if (mime === 'audio/mpeg') return ascii.startsWith('ID3') || bytes[0] === 0xff
  if (mime === 'audio/mp4' || mime === 'audio/aac' || mime === 'audio/3gpp') {
    return ascii.includes('ftyp') || bytes[0] === 0xff
  }
  // AMR
  return ascii.startsWith('#!AMR')
}

export async function hashSafeReference(value: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value))
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('')
}
