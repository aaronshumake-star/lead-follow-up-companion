#!/usr/bin/env node
/**
 * Renders the committed SVG app mark into the PNG sizes the web app manifest
 * needs. Run with `npm run generate:icons` after editing public/favicon.svg.
 */
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import sharp from 'sharp'

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const sourceSvg = resolve(projectRoot, 'public/favicon.svg')
const outputDir = resolve(projectRoot, 'public/icons')

/** Maskable icons need padding so the safe zone survives a circular mask. */
const targets = [
  { file: 'icon-192.png', size: 192, padding: 0 },
  { file: 'icon-512.png', size: 512, padding: 0 },
  { file: 'icon-maskable-512.png', size: 512, padding: 0.14 },
  { file: 'apple-touch-icon-180.png', size: 180, padding: 0.08 },
]

const svg = await readFile(sourceSvg)
await mkdir(outputDir, { recursive: true })

for (const { file, size, padding } of targets) {
  const inner = Math.round(size * (1 - padding * 2))
  const offset = Math.round((size - inner) / 2)

  const rendered = await sharp(svg, { density: 384 }).resize(inner, inner).png().toBuffer()

  const composed = await sharp({
    create: {
      width: size,
      height: size,
      channels: 4,
      background: { r: 15, g: 23, b: 42, alpha: 1 },
    },
  })
    .composite([{ input: rendered, top: offset, left: offset }])
    .png({ compressionLevel: 9 })
    .toBuffer()

  await writeFile(resolve(outputDir, file), composed)
  console.log(`generated public/icons/${file} (${size}x${size})`)
}
