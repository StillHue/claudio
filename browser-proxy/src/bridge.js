import { spawn } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import readline from 'node:readline'
import { fileURLToPath } from 'node:url'
import {
  anthropicJsonMessage,
  endAnthropicStream,
  newMessageId,
  startAnthropicStream,
  writeTextDelta,
} from './anthropic-sse.js'
import { extractTextFromStreamJsonLine, messagesToPrompt } from './translator.js'
import { bridgeMessagesToOpenAI } from './openai-bridge.js'

const HERE = path.dirname(fileURLToPath(import.meta.url))

/**
 * Prefer spawning `node …/cli/bin/claudio` so empty `--tools ""` works on Windows.
 * Also supports a `.mjs`/`.js` path as claudioBin (tests / wrappers).
 */
function resolveClaudioSpawn(bin) {
  const siblingCli = path.resolve(HERE, '..', '..', 'cli', 'bin', 'claudio')
  if ((!bin || bin === 'claudio') && fs.existsSync(siblingCli)) {
    return { command: process.execPath, argsPrefix: [siblingCli], shell: false }
  }
  if (bin && /\.(mjs|cjs|js)$/i.test(bin) && fs.existsSync(bin)) {
    return { command: process.execPath, argsPrefix: [bin], shell: false }
  }
  const useShell = process.platform === 'win32'
  return { command: bin || 'claudio', argsPrefix: [], shell: useShell }
}

/** Dispatch to OpenAI HTTP bridge (Fly) or Claudio CLI (local). */
export async function bridgeMessagesToClaudio(reqBody, res, config) {
  if (config.bridge === 'openai' || (!config.claudioBin && config.openaiApiKey)) {
    return bridgeMessagesToOpenAI(reqBody, res, config)
  }
  return bridgeMessagesToClaudioCli(reqBody, res, config)
}

/**
 * Run Claudio print mode and stream Anthropic-compatible SSE (or JSON).
 */
async function bridgeMessagesToClaudioCli(reqBody, res, config) {
  const model = config.model || reqBody.model || 'claudio-local'
  const messageId = newMessageId()
  const wantStream = reqBody.stream !== false
  const prompt = messagesToPrompt(reqBody)

  const args = [
    '-p',
    '--verbose',
    '--output-format',
    'stream-json',
    '--include-partial-messages',
  ]
  if (config.bare !== false) args.push('--bare')
  if (config.tools === '' || config.tools == null) {
    args.push('--tools', '')
  } else if (config.tools) {
    args.push('--tools', String(config.tools))
  }
  args.push('--permission-mode', 'bypassPermissions')
  if (config.model) args.push('--model', String(config.model))

  // Prefer system prompt from config override; conversation is in prompt body
  args.push(
    '--system-prompt',
    'You are Claude, a helpful AI assistant answering from the browser sidebar via Claudio.',
  )
  args.push(prompt)

  const { command, argsPrefix, shell } = resolveClaudioSpawn(config.claudioBin)
  const spawnArgs = [...argsPrefix, ...args]
  if (config.logRequests) {
    console.log(
      `[browser-proxy] local → ${command} ${argsPrefix[0] || ''} -p (prompt ${prompt.length} chars, stream=${wantStream})`,
    )
  }

  if (wantStream) {
    startAnthropicStream(res, { model, messageId })
  }

  let fullText = ''
  let sawPartial = false
  let childError = null

  await new Promise((resolve, reject) => {
    const child = spawn(command, spawnArgs, {
      shell,
      env: { ...process.env, CLAUDE_CODE_ENTRYPOINT: 'claudio-browser-proxy' },
      windowsHide: true,
    })

    const rl = readline.createInterface({ input: child.stdout })
    rl.on('line', line => {
      const chunk = extractTextFromStreamJsonLine(line)
      if (chunk == null) return
      // Prefer incremental deltas; if we only get full assistant blobs, emit once at end
      if (line.includes('content_block_delta') || line.includes('stream_event')) {
        sawPartial = true
        fullText += chunk
        if (wantStream) writeTextDelta(res, chunk)
      } else if (!sawPartial) {
        // Keep latest full text (assistant / result)
        fullText = chunk
      }
    })

    let stderr = ''
    child.stderr.on('data', d => {
      stderr += d.toString()
      if (stderr.length > 8000) stderr = stderr.slice(-8000)
    })

    child.on('error', err => {
      childError = err
      reject(err)
    })

    child.on('close', code => {
      if (childError) return
      if (code !== 0 && !fullText) {
        reject(
          new Error(
            `claudio exited ${code}${stderr ? `: ${stderr.trim().slice(0, 500)}` : ''}`,
          ),
        )
        return
      }
      resolve()
    })
  }).catch(err => {
    const msg = `Claudio bridge error: ${err.message}`
    console.error(`[browser-proxy] ${msg}`)
    if (wantStream) {
      writeTextDelta(res, `\n\n[${msg}]`)
      endAnthropicStream(res, { stopReason: 'end_turn' })
    } else if (!res.headersSent) {
      res.writeHead(502, { 'Content-Type': 'application/json' })
      res.end(
        JSON.stringify({
          type: 'error',
          error: { type: 'api_error', message: msg },
        }),
      )
    }
    return 'handled'
  })

  if (res.writableEnded) return

  if (!wantStream) {
    res.writeHead(200, {
      'Content-Type': 'application/json',
      'x-claudio-browser-proxy': 'local',
    })
    res.end(
      JSON.stringify(
        anthropicJsonMessage({
          model,
          messageId,
          text: fullText || '(empty response from Claudio)',
        }),
      ),
    )
    return
  }

  if (!sawPartial && fullText) {
    writeTextDelta(res, fullText)
  } else if (!fullText) {
    writeTextDelta(res, '(empty response from Claudio)')
  }
  endAnthropicStream(res)
}
