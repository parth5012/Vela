import { searchStandalone } from '../utils/standaloneSearch'

describe('standaloneSearch', () => {
  it('rejects empty queries without fetching', async () => {
    const fetchFn = jest.fn()

    expect(await searchStandalone('', { tavilyKey: 'key', fetchFn: fetchFn as any })).toBe(
      'Search query is empty.'
    )
    expect(fetchFn).not.toHaveBeenCalled()
  })

  it('asks for a key when none is configured', async () => {
    const fetchFn = jest.fn()

    expect(await searchStandalone('vela', { fetchFn: fetchFn as any })).toContain('Tavily key')
    expect(fetchFn).not.toHaveBeenCalled()
  })

  it('returns the Tavily answer on success', async () => {
    const fetchFn = jest.fn(async () => ({
      ok: true,
      json: async () => ({ answer: 'Vela is a personal assistant.' }),
    }))

    expect(await searchStandalone('vela', { tavilyKey: 'key', fetchFn: fetchFn as any })).toBe(
      'Vela is a personal assistant.'
    )
  })

  it('handles search failure without leaking the key', async () => {
    const fetchFn = jest.fn(async () => ({ ok: false, json: async () => null }))

    const result = await searchStandalone('vela', { tavilyKey: 'secret-key', fetchFn: fetchFn as any })

    expect(result).toBe('Search failed. Try again.')
    expect(result).not.toContain('secret-key')
  })
})
