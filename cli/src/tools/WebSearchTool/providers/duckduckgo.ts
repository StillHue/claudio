import type { SearchInput, SearchProvider } from './types.js'
import { applyDomainFilters, type ProviderOutput, type SearchHit } from './types.js'
import {
  isWebSearchTimeoutError,
  toAbortError,
  withWebSearchTimeout,
} from './timeout.js'

// DuckDuckGo's HTML scraper aggressively blocks datacenter / repeat IPs with
// an "anomaly in the request" response. Prefer Instant Answer API first, then
// scrape with retries. When scrape is blocked, Instant Answer often still works.
const DDG_ANOMALY_HINT =
  'DuckDuckGo scraping is rate-limited from this network. ' +
  'Configure a search backend with one of: ' +
  'FIRECRAWL_API_KEY, TAVILY_API_KEY, EXA_API_KEY, YOU_API_KEY, ' +
  'JINA_API_KEY, BING_API_KEY, MOJEEK_API_KEY, LINKUP_API_KEY — ' +
  'or use an Anthropic / Vertex / Foundry provider for native web search.'

const MAX_RETRIES = 3
const INITIAL_BACKOFF_MS = 1000
const DDG_IA_URL = 'https://api.duckduckgo.com/'
const DDG_HTML_URL = 'https://html.duckduckgo.com/html/'

function isAnomalyError(message: string): boolean {
  return /anomaly in the request|likely making requests too quickly/i.test(
    message,
  )
}

function isRetryableDDGError(err: unknown): boolean {
  if (!(err instanceof Error)) return false
  if (isWebSearchTimeoutError(err)) return false
  const msg = err.message.toLowerCase()
  return (
    msg.includes('anomaly') ||
    msg.includes('too quickly') ||
    msg.includes('rate limit') ||
    msg.includes('timeout') ||
    msg.includes('econnreset') ||
    msg.includes('etimedout') ||
    msg.includes('econnaborted')
  )
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  if (signal?.aborted) {
    return Promise.reject(toAbortError(signal.reason))
  }

  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      cleanup()
      resolve()
    }, ms)
    const onAbort = () => {
      cleanup()
      reject(toAbortError(signal?.reason))
    }
    const cleanup = () => {
      clearTimeout(timer)
      signal?.removeEventListener('abort', onAbort)
    }

    signal?.addEventListener('abort', onAbort, { once: true })
  })
}

function pushHit(hits: SearchHit[], title: string, url: string, description?: string) {
  if (!url || !/^https?:\/\//i.test(url)) return
  if (hits.some(h => h.url === url)) return
  hits.push({
    title: title || url,
    url,
    description,
  })
}

/** Official JSON Instant Answer API — less likely to trip HTML scraper blocks. */
async function searchInstantAnswer(
  query: string,
  signal?: AbortSignal,
): Promise<SearchHit[]> {
  const url = new URL(DDG_IA_URL)
  url.searchParams.set('q', query)
  url.searchParams.set('format', 'json')
  url.searchParams.set('no_html', '1')
  url.searchParams.set('skip_disambig', '1')

  const res = await fetch(url, {
    method: 'GET',
    headers: {
      Accept: 'application/json',
      'User-Agent': 'ClaudeCode-WebSearch/1.0',
    },
    signal,
  })
  if (!res.ok) {
    throw new Error(`DuckDuckGo Instant Answer HTTP ${res.status}`)
  }
  const data = (await res.json()) as {
    Abstract?: string
    AbstractText?: string
    AbstractURL?: string
    AbstractSource?: string
    Heading?: string
    Results?: Array<{ Text?: string; FirstURL?: string }>
    RelatedTopics?: Array<{
      Text?: string
      FirstURL?: string
      Topics?: Array<{ Text?: string; FirstURL?: string }>
    }>
  }

  const hits: SearchHit[] = []
  if (data.AbstractURL) {
    pushHit(
      hits,
      data.Heading || data.AbstractSource || data.AbstractURL,
      data.AbstractURL,
      data.AbstractText || data.Abstract,
    )
  }
  for (const r of data.Results || []) {
    if (r.FirstURL) pushHit(hits, r.Text || r.FirstURL, r.FirstURL, r.Text)
  }
  for (const topic of data.RelatedTopics || []) {
    if (topic.FirstURL) {
      pushHit(hits, topic.Text || topic.FirstURL, topic.FirstURL, topic.Text)
    }
    for (const nested of topic.Topics || []) {
      if (nested.FirstURL) {
        pushHit(hits, nested.Text || nested.FirstURL, nested.FirstURL, nested.Text)
      }
    }
  }
  return hits
}

/** HTML lite form — secondary scrape path with browser-like headers. */
async function searchHtmlLite(
  query: string,
  signal?: AbortSignal,
): Promise<SearchHit[]> {
  const body = new URLSearchParams({ q: query })
  const res = await fetch(DDG_HTML_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Accept: 'text/html,application/xhtml+xml',
      'User-Agent':
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
      'Accept-Language': 'en-US,en;q=0.9',
    },
    body,
    signal,
    redirect: 'follow',
  })
  const html = await res.text()
  if (!res.ok) {
    throw new Error(`DuckDuckGo HTML HTTP ${res.status}`)
  }
  if (isAnomalyError(html)) {
    throw new Error(DDG_ANOMALY_HINT)
  }

  const hits: SearchHit[] = []
  // uddg= is the decoded destination URL param used by DDG HTML results
  const re =
    /uddg=([^&"]+)[^>]*>[\s\S]*?class="result__a"[^>]*>([\s\S]*?)<\/a>[\s\S]*?class="result__snippet"[^>]*>([\s\S]*?)<\/(?:a|td)/gi
  let m: RegExpExecArray | null
  while ((m = re.exec(html)) !== null && hits.length < 10) {
    let dest = m[1]
    try {
      dest = decodeURIComponent(dest)
    } catch {
      /* keep raw */
    }
    const title = m[2].replace(/<[^>]+>/g, '').trim()
    const snippet = m[3].replace(/<[^>]+>/g, '').trim()
    pushHit(hits, title, dest, snippet)
  }

  // Broader fallback: any result__a links
  if (!hits.length) {
    const linkRe = /class="result__a"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi
    while ((m = linkRe.exec(html)) !== null && hits.length < 10) {
      let href = m[1]
      const title = m[2].replace(/<[^>]+>/g, '').trim()
      try {
        const u = new URL(href, DDG_HTML_URL)
        const uddg = u.searchParams.get('uddg')
        if (uddg) href = uddg
      } catch {
        /* keep */
      }
      pushHit(hits, title, href)
    }
  }

  if (!hits.length) {
    throw new Error('DuckDuckGo HTML returned 0 parseable results')
  }
  return hits
}

async function searchScrape(
  query: string,
  signal?: AbortSignal,
): Promise<SearchHit[]> {
  let search: typeof import('duck-duck-scrape').search
  let SafeSearchType: typeof import('duck-duck-scrape').SafeSearchType
  try {
    ;({ search, SafeSearchType } = await import('duck-duck-scrape'))
  } catch {
    throw new Error(
      'duck-duck-scrape package not installed. Run: npm install duck-duck-scrape',
    )
  }

  let lastErr: unknown
  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    if (signal?.aborted) throw new DOMException('Aborted', 'AbortError')
    try {
      const response = await withWebSearchTimeout(
        combinedSignal =>
          search(
            query,
            { safeSearch: SafeSearchType.MODERATE },
            { signal: combinedSignal } as Parameters<typeof search>[2],
          ),
        signal,
        { providerName: 'DuckDuckGo' },
      )

      return response.results.map(r => ({
        title: r.title || r.url,
        url: r.url,
        description: r.description ?? undefined,
      }))
    } catch (err) {
      lastErr = err
      const msg = err instanceof Error ? err.message : String(err)
      if (isAnomalyError(msg)) {
        throw new Error(DDG_ANOMALY_HINT)
      }
      if (!isRetryableDDGError(err) || attempt === MAX_RETRIES - 1) {
        throw err
      }
      const baseDelay = INITIAL_BACKOFF_MS * Math.pow(2, attempt)
      const jitter = baseDelay * 0.2 * (Math.random() * 2 - 1)
      await sleep(baseDelay + jitter, signal)
    }
  }
  throw lastErr
}

export const duckduckgoProvider: SearchProvider = {
  name: 'duckduckgo',

  isConfigured() {
    // DDG is the default fallback — always available
    return true
  },

  async search(input: SearchInput, signal?: AbortSignal): Promise<ProviderOutput> {
    const start = performance.now()
    if (signal?.aborted) throw new DOMException('Aborted', 'AbortError')

    const errors: string[] = []
    let hits: SearchHit[] = []

    // 1) Instant Answer API (official JSON — preferred)
    try {
      hits = await withWebSearchTimeout(
        combined => searchInstantAnswer(input.query, combined),
        signal,
        { providerName: 'DuckDuckGo-IA' },
      )
    } catch (err) {
      errors.push(`ia: ${err instanceof Error ? err.message : String(err)}`)
    }

    // 2) duck-duck-scrape if IA was empty
    if (!hits.length) {
      try {
        hits = await searchScrape(input.query, signal)
      } catch (err) {
        errors.push(`scrape: ${err instanceof Error ? err.message : String(err)}`)
      }
    }

    // 3) HTML lite form as last scrape fallback
    if (!hits.length) {
      try {
        hits = await withWebSearchTimeout(
          combined => searchHtmlLite(input.query, combined),
          signal,
          { providerName: 'DuckDuckGo-HTML' },
        )
      } catch (err) {
        errors.push(`html: ${err instanceof Error ? err.message : String(err)}`)
      }
    }

    hits = applyDomainFilters(hits, input)

    if (!hits.length) {
      const joined = errors.join(' | ')
      if (errors.some(e => /rate-limited|anomaly/i.test(e))) {
        throw new Error(DDG_ANOMALY_HINT)
      }
      throw new Error(
        joined
          ? `DuckDuckGo returned no results (${joined})`
          : 'DuckDuckGo returned no results',
      )
    }

    return {
      hits,
      providerName: 'duckduckgo',
      durationSeconds: (performance.now() - start) / 1000,
    }
  },
}
