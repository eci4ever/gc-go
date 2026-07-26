import '@testing-library/jest-dom/vitest'
import { afterAll, afterEach, beforeAll } from 'vitest'

import { server } from './server'

const nativeFetch = globalThis.fetch

globalThis.fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
  const request =
    typeof input === 'string' && input.startsWith('/')
      ? new URL(input, window.location.origin)
      : input
  return nativeFetch(request, init)
}) as typeof fetch

beforeAll(() => server.listen({ onUnhandledRequest: 'error' }))
afterEach(() => server.resetHandlers())
afterAll(() => server.close())
