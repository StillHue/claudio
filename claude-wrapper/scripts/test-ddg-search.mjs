#!/usr/bin/env node
/**
 * Smoke-test DuckDuckGo Instant Answer + HTML lite from this network.
 * Usage: node scripts/test-ddg-search.mjs [query]
 */
const query = process.argv[2] || 'Node.js official website'

function count(re, text) {
  return (text.match(re) || []).length
}

async function testInstantAnswer() {
  const url = new URL('https://api.duckduckgo.com/')
  url.searchParams.set('q', query)
  url.searchParams.set('format', 'json')
  url.searchParams.set('no_html', '1')
  url.searchParams.set('skip_disambig', '1')
  const res = await fetch(url, {
    headers: {
      Accept: 'application/json',
      'User-Agent': 'ClaudeCode-WebSearch/1.0',
    },
  })
  const data = await res.json()
  const related = Array.isArray(data.RelatedTopics) ? data.RelatedTopics.length : 0
  const results = Array.isArray(data.Results) ? data.Results.length : 0
  const hasAbstract = Boolean(data.AbstractURL)
  console.log(
    `[IA] status=${res.status} heading=${data.Heading || '(none)'} abstract=${hasAbstract} results=${results} related=${related}`,
  )
  return hasAbstract || results > 0 || related > 0
}

async function testHtmlLite() {
  const body = new URLSearchParams({ q: query })
  const res = await fetch('https://html.duckduckgo.com/html/', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Accept: 'text/html,application/xhtml+xml',
      'User-Agent':
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
      'Accept-Language': 'en-US,en;q=0.9',
    },
    body,
    redirect: 'follow',
  })
  const text = await res.text()
  const blocked = /anomaly in the request|too quickly/i.test(text)
  const links = count(/class="result__a"/g, text)
  console.log(`[HTML] status=${res.status} blocked=${blocked} result_links=${links}`)
  return !blocked && links > 0
}

const iaOk = await testInstantAnswer().catch(err => {
  console.error('[IA] error', err.message || err)
  return false
})
const htmlOk = await testHtmlLite().catch(err => {
  console.error('[HTML] error', err.message || err)
  return false
})

if (!iaOk && !htmlOk) {
  console.error('FAIL: DuckDuckGo returned no usable results from this network')
  process.exit(1)
}
console.log(iaOk || htmlOk ? 'OK: at least one DDG path works' : 'FAIL')
process.exit(iaOk || htmlOk ? 0 : 1)
