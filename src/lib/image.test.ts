import { describe, expect, it } from 'vitest'
import {
  isAllowedDeclaredMime,
  normalizeDeclaredMime,
  sniffMimeType,
  validateImage,
} from './image.ts'

function jpegBytes(): Uint8Array {
  const bytes = new Uint8Array(128)
  bytes[0] = 0xff
  bytes[1] = 0xd8
  bytes[2] = 0xff
  bytes[3] = 0xe0
  bytes[4] = 0x00
  bytes[5] = 0x10
  bytes[6] = 0x4a
  bytes[7] = 0x46
  bytes[8] = 0x49
  bytes[9] = 0x46
  return bytes
}

describe('normalizeDeclaredMime', () => {
  it('maps image/jpg to image/jpeg', () => {
    expect(normalizeDeclaredMime('image/jpg')).toBe('image/jpeg')
    expect(normalizeDeclaredMime('image/JPG')).toBe('image/jpeg')
  })

  it('treats an empty declaration as unknown rather than unsupported', () => {
    expect(normalizeDeclaredMime('')).toBe('')
    expect(isAllowedDeclaredMime('')).toBe(true)
    expect(isAllowedDeclaredMime('image/jpg')).toBe(true)
    expect(isAllowedDeclaredMime('image/heic')).toBe(false)
  })
})

describe('validateImage', () => {
  it('accepts a JPEG declared as image/jpg', async () => {
    const bytes = jpegBytes()
    expect(sniffMimeType(bytes)).toBe('image/jpeg')

    const result = await validateImage(new Blob([bytes], { type: 'image/jpg' }), {
      filename: 'lead.jpg',
      measure: async () => ({ width: 200, height: 200 }),
    })

    expect(result.ok).toBe(true)
    if (result.ok) expect(result.image.mimeType).toBe('image/jpeg')
  })

  it('accepts a JPEG with an empty declared MIME type', async () => {
    const bytes = jpegBytes()
    const result = await validateImage(new Blob([bytes], { type: '' }), {
      filename: 'lead.jpg',
      measure: async () => ({ width: 200, height: 200 }),
    })

    expect(result.ok).toBe(true)
  })
})
