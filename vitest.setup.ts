import '@testing-library/jest-dom/vitest'
import { cleanup } from '@testing-library/react'
import { afterEach, beforeEach } from 'vitest'

/**
 * Demo records live in localStorage, so clearing it between tests gives each
 * one a freshly seeded copy of the fixtures. Without this, a test that creates
 * a customer would leak into the next one.
 */
beforeEach(() => {
  globalThis.localStorage?.clear()
})

afterEach(() => {
  cleanup()
})
