export interface StandaloneSearchDeps {
  tavilyKey?: string
  fetchFn?: typeof fetch
}

const TAVILY_ENDPOINT = 'https://api.tavily.com/search'

export async function searchStandalone(
  query: string,
  deps: StandaloneSearchDeps = {}
): Promise<string> {
  const trimmed = (query || '').trim()
  if (!trimmed) return 'Search query is empty.'
  if (!deps.tavilyKey) return 'Web search needs a Tavily key — add one in Settings or use provider search.'

  const fetchFn = deps.fetchFn ?? fetch
  const response = await fetchFn(TAVILY_ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      api_key: deps.tavilyKey,
      query: trimmed,
      include_answer: true,
      max_results: 3,
    }),
  }).catch(() => null)

  if (!response || !response.ok) return 'Search failed. Try again.'
  const data = await response.json().catch(() => null)
  if (!data) return 'Search failed. Try again.'

  if (typeof data.answer === 'string' && data.answer.trim()) return data.answer.trim()
  if (Array.isArray(data.results)) {
    const lines = data.results
      .filter((item: { title?: string; content?: string }) => item?.title || item?.content)
      .slice(0, 3)
      .map((item: { title?: string; content?: string }) => `- ${item.title || 'Result'}: ${item.content || ''}`.trim())
    if (lines.length > 0) return lines.join('\n')
  }
  return 'No results found.'
}
