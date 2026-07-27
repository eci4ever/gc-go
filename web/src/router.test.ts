import { describe, expect, it } from 'vitest'

import { createAppRouter } from './router'

describe('application router', () => {
  it('renders unmatched nested URLs with the root not-found component', () => {
    const router = createAppRouter()

    expect(router.options.notFoundMode).toBe('root')
  })
})
