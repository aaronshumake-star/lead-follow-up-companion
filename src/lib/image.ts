/**
 * Screenshot intake validation.
 *
 * Everything pasted or dropped here came from outside the application, so the
 * checks are deliberately paranoid: the declared MIME type is never trusted on
 * its own, the actual bytes are sniffed, and the filename is rebuilt from a
 * whitelist rather than cleaned. A filename is only ever shown to a person —
 * it never becomes a path.
 */

export const ALLOWED_MIME_TYPES = ['image/png', 'image/jpeg', 'image/webp'] as const
export type AllowedMimeType = (typeof ALLOWED_MIME_TYPES)[number]

/** Matches the screenshots_byte_size_range check constraint. */
export const MAX_IMAGE_BYTES = 10 * 1024 * 1024
export const MIN_IMAGE_BYTES = 64

export const MAX_IMAGE_DIMENSION = 20000
export const MIN_IMAGE_DIMENSION = 40

export type ImageRejectionCode =
  | 'empty_file'
  | 'too_large'
  | 'too_small'
  | 'unsupported_type'
  | 'type_mismatch'
  | 'corrupt_image'
  | 'dimensions_out_of_range'

export interface ValidatedImage {
  blob: Blob
  mimeType: AllowedMimeType
  byteSize: number
  width: number | null
  height: number | null
  /** Sanitised, safe to display. Null when the source had no name. */
  filename: string | null
  /** SHA-256 of the bytes; the duplicate-detection key. */
  fileHash: string
}

export type ImageValidation =
  | { ok: true; image: ValidatedImage }
  | { ok: false; code: ImageRejectionCode; message: string }

/**
 * Reads the file's magic bytes.
 *
 * A browser will happily report `image/png` for a renamed text file, so the
 * real type comes from the content. Anything that does not match a supported
 * signature is rejected rather than handed to OCR.
 */
export function sniffMimeType(bytes: Uint8Array): AllowedMimeType | null {
  if (bytes.length < 12) return null

  const startsWith = (signature: readonly number[], offset = 0): boolean =>
    signature.every((byte, index) => bytes[offset + index] === byte)

  // PNG: 89 50 4E 47 0D 0A 1A 0A
  if (startsWith([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return 'image/png'

  // JPEG: FF D8 FF
  if (startsWith([0xff, 0xd8, 0xff])) return 'image/jpeg'

  // WEBP: "RIFF" .... "WEBP"
  if (startsWith([0x52, 0x49, 0x46, 0x46]) && startsWith([0x57, 0x45, 0x42, 0x50], 8)) {
    return 'image/webp'
  }

  return null
}

/**
 * Rebuilds a filename from safe characters only.
 *
 * Built from a whitelist rather than by stripping dangerous sequences, because
 * a whitelist cannot be defeated by an encoding trick. Path separators, dots
 * that could form a traversal, and control characters simply cannot survive.
 */
export function sanitizeFilename(raw: string | null | undefined): string | null {
  if (typeof raw !== 'string') return null

  const base = raw.split(/[/\\]/).pop() ?? ''
  const cleaned = base
    .replace(/[^A-Za-z0-9 ._-]/g, '')
    .replace(/\.{2,}/g, '.')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 120)

  return cleaned === '' || cleaned === '.' ? null : cleaned
}

/** SHA-256 as lowercase hex, matching the screenshots_file_hash_format check. */
export async function hashImageBytes(bytes: ArrayBuffer): Promise<string> {
  const subtle = globalThis.crypto?.subtle
  if (subtle === undefined) {
    throw new Error('This browser cannot hash images, so duplicate detection is unavailable.')
  }

  const digest = await subtle.digest('SHA-256', bytes)

  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('')
}

export interface ValidateOptions {
  filename?: string | null
  /** Injected so tests can run without a DOM image decoder. */
  measure?: (blob: Blob) => Promise<{ width: number; height: number } | null>
}

/**
 * Validates a pasted or dropped image.
 *
 * Never throws: a bad paste is an ordinary event that should produce a clear
 * message, not an error boundary.
 */
export async function validateImage(blob: Blob, options: ValidateOptions = {}): Promise<ImageValidation> {
  const byteSize = blob.size

  if (byteSize === 0) {
    return { ok: false, code: 'empty_file', message: 'That file is empty.' }
  }
  if (byteSize < MIN_IMAGE_BYTES) {
    return { ok: false, code: 'too_small', message: 'That file is too small to be a screenshot.' }
  }
  if (byteSize > MAX_IMAGE_BYTES) {
    return {
      ok: false,
      code: 'too_large',
      message: `Screenshots must be under ${Math.floor(MAX_IMAGE_BYTES / 1024 / 1024)} MB.`,
    }
  }

  const declared = blob.type
  if (declared !== '' && !ALLOWED_MIME_TYPES.includes(declared as AllowedMimeType)) {
    return {
      ok: false,
      code: 'unsupported_type',
      message: 'Only PNG, JPEG and WEBP screenshots are supported.',
    }
  }

  const buffer = await blob.arrayBuffer()
  const sniffed = sniffMimeType(new Uint8Array(buffer))

  if (sniffed === null) {
    return {
      ok: false,
      code: 'corrupt_image',
      message: 'That file is not a readable PNG, JPEG or WEBP image.',
    }
  }

  // The declared type disagreeing with the content is worth refusing outright.
  if (declared !== '' && declared !== sniffed) {
    return {
      ok: false,
      code: 'type_mismatch',
      message: `That file claims to be ${declared} but its contents are ${sniffed}.`,
    }
  }

  const measured = options.measure === undefined ? null : await options.measure(blob)

  if (measured !== null) {
    const { width, height } = measured
    if (
      width < MIN_IMAGE_DIMENSION ||
      height < MIN_IMAGE_DIMENSION ||
      width > MAX_IMAGE_DIMENSION ||
      height > MAX_IMAGE_DIMENSION
    ) {
      return {
        ok: false,
        code: 'dimensions_out_of_range',
        message: 'That image is too small or too large to read.',
      }
    }
  }

  return {
    ok: true,
    image: {
      blob,
      mimeType: sniffed,
      byteSize,
      width: measured?.width ?? null,
      height: measured?.height ?? null,
      filename: sanitizeFilename(options.filename),
      fileHash: await hashImageBytes(buffer),
    },
  }
}

/** Measures an image in the browser. Returns null when it cannot be decoded. */
export async function measureImageInBrowser(blob: Blob): Promise<{ width: number; height: number } | null> {
  if (typeof globalThis.createImageBitmap === 'function') {
    try {
      const bitmap = await globalThis.createImageBitmap(blob)
      const size = { width: bitmap.width, height: bitmap.height }
      bitmap.close()
      return size
    } catch {
      return null
    }
  }

  return null
}
