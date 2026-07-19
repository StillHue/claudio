import { feature } from 'bun:bundle'
import type {
  Base64ImageSource,
  ContentBlockParam,
  ImageBlockParam,
} from '@anthropic-ai/sdk/resources/messages.mjs'
import { randomUUID } from 'crypto'
import type { QuerySource } from 'src/constants/querySource.js'
import { logEvent } from 'src/services/analytics/index.js'
import type { AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS } from 'src/services/analytics/metadata.js'
import { getContentText } from 'src/utils/messages.js'
import {
  type Command,
  findCommand,
  getCommandName,
  isBridgeSafeCommand,
  type LocalJSXCommandContext,
} from '../../commands.js'
import type { CanUseToolFn } from '../../hooks/useCanUseTool.js'
import type { IDESelection } from '../../hooks/useIdeSelection.js'
import type { SetToolJSXFn, ToolUseContext } from '../../Tool.js'
import type {
  AssistantMessage,
  AttachmentMessage,
  Message,
  ProgressMessage,
  SystemMessage,
  UserMessage,
} from '../../types/message.js'
import type { PermissionMode } from '../../types/permissions.js'
import {
  isValidImagePaste,
  type PromptInputMode,
} from '../../types/textInputTypes.js'
import {
  type AgentMentionAttachment,
  createAttachmentMessage,
  getAttachmentMessages,
} from '../attachments.js'
import type { PastedContent } from '../config.js'
import type { EffortValue } from '../effort.js'
import { toArray } from '../generators.js'
import {
  executeUserPromptSubmitHooks,
  getUserPromptSubmitHookBlockingMessage,
} from '../hooks.js'
import {
  createImageMetadataText,
  maybeResizeAndDownsampleImageBlock,
} from '../imageResizer.js'
import { storeImages } from '../imageStore.js'
import {
  createCommandInputMessage,
  createUserMessage,
} from '../messages.js'
import { queryCheckpoint } from '../queryProfiler.js'
import { parseSlashCommand } from '../slashCommandParsing.js'
import {
  hasUltraplanKeyword,
  replaceUltraplanKeyword,
} from '../ultraplan/keyword.js'
import {
  buildVisionAugmentedMessage,
  describeImages,
  getVisionModelLabel,
  shouldRouteImagesThroughVisionDescribe,
  visionDescribeAvailable,
  writeTempImageFromBase64,
} from '../visionDescribe.js'
import { processTextPrompt } from './processTextPrompt.js'
export type ProcessUserInputContext = ToolUseContext & LocalJSXCommandContext

export type ProcessUserInputBaseResult = {
  messages: (
    | UserMessage
    | AssistantMessage
    | AttachmentMessage
    | SystemMessage
    | ProgressMessage
  )[]
  shouldQuery: boolean
  allowedTools?: string[]
  model?: string
  effort?: EffortValue
  // Output text for non-interactive mode (e.g., forked commands)
  // When set, this is used as the result in -p mode instead of empty string
  resultText?: string
  // When set, prefills or submits the next input after command completes
  // Used by /discover to chain into the selected feature's command
  nextInput?: string
  submitNextInput?: boolean
}

export async function processUserInput({
  input,
  preExpansionInput,
  mode,
  setToolJSX,
  context,
  pastedContents,
  ideSelection,
  messages,
  setUserInputOnProcessing,
  uuid,
  isAlreadyProcessing,
  querySource,
  canUseTool,
  skipSlashCommands,
  slashCommandOverride,
  bridgeOrigin,
  isMeta,
  skipAttachments,
}: {
  input: string | Array<ContentBlockParam>
  /**
   * Input before [Pasted text #N] expansion. Used for ultraplan keyword
   * detection so pasted content containing the word cannot trigger. Falls
   * back to the string `input` when unset.
   */
  preExpansionInput?: string
  mode: PromptInputMode
  setToolJSX: SetToolJSXFn
  context: ProcessUserInputContext
  pastedContents?: Record<number, PastedContent>
  ideSelection?: IDESelection
  messages?: Message[]
  setUserInputOnProcessing?: (prompt?: string) => void
  uuid?: string
  isAlreadyProcessing?: boolean
  querySource?: QuerySource
  canUseTool?: CanUseToolFn
  /**
   * When true, input starting with `/` is treated as plain text.
   * Used for remotely-received messages (bridge/CCR) that should not
   * trigger local slash commands or skills.
   */
  skipSlashCommands?: boolean
  slashCommandOverride?: Command
  /**
   * When true, slash commands matching isBridgeSafeCommand() execute even
   * though skipSlashCommands is set. See QueuedCommand.bridgeOrigin.
   */
  bridgeOrigin?: boolean
  /**
   * When true, the resulting UserMessage gets `isMeta: true` (user-hidden,
   * model-visible). Propagated from `QueuedCommand.isMeta` for queued
   * system-generated prompts.
   */
  isMeta?: boolean
  skipAttachments?: boolean
}): Promise<ProcessUserInputBaseResult> {
  const inputString = typeof input === 'string' ? input : null
  // Immediately show the user input prompt while we are still processing the input.
  // Skip for isMeta (system-generated prompts like scheduled tasks) — those
  // should run invisibly.
  if (mode === 'prompt' && inputString !== null && !isMeta) {
    setUserInputOnProcessing?.(inputString)
  }

  queryCheckpoint('query_process_user_input_base_start')

  const appState = context.getAppState()

  const result = await processUserInputBase(
    input,
    mode,
    setToolJSX,
    context,
    pastedContents,
    ideSelection,
    messages,
    uuid,
    isAlreadyProcessing,
    querySource,
    canUseTool,
    appState.toolPermissionContext.mode,
    skipSlashCommands,
    bridgeOrigin,
    isMeta,
    skipAttachments,
    preExpansionInput,
    slashCommandOverride,
  )
  queryCheckpoint('query_process_user_input_base_end')

  if (!result.shouldQuery) {
    return result
  }

  // Execute UserPromptSubmit hooks and handle blocking
  queryCheckpoint('query_hooks_start')
  const inputMessage = getContentText(input) || ''

  for await (const hookResult of executeUserPromptSubmitHooks(
    inputMessage,
    appState.toolPermissionContext.mode,
    context,
    context.requestPrompt,
  )) {
    // We only care about the result
    if (hookResult.message?.type === 'progress') {
      continue
    }

    // Return only a system-level error message, erasing the original user input
    if (hookResult.blockingError) {
      const blockingMessage = getUserPromptSubmitHookBlockingMessage(
        hookResult.blockingError,
      )
      return {
        messages: [
          // TODO: Make this an attachment message
          createSystemMessage(
            `${blockingMessage}\n\nOriginal prompt: ${input}`,
            'warning',
          ),
        ],
        shouldQuery: false,
        allowedTools: result.allowedTools,
      }
    }

    // If preventContinuation is set, stop processing but keep the original
    // prompt in context.
    if (hookResult.preventContinuation) {
      const message = hookResult.stopReason
        ? `Operation stopped by hook: ${hookResult.stopReason}`
        : 'Operation stopped by hook'
      result.messages.push(
        createUserMessage({
          content: message,
        }),
      )
      result.shouldQuery = false
      return result
    }

    // Collect additional contexts
    if (
      hookResult.additionalContexts &&
      hookResult.additionalContexts.length > 0
    ) {
      result.messages.push(
        createAttachmentMessage({
          type: 'hook_additional_context',
          content: hookResult.additionalContexts.map(applyTruncation),
          hookName: 'UserPromptSubmit',
          toolUseID: `hook-${randomUUID()}`,
          hookEvent: 'UserPromptSubmit',
        }),
      )
    }

    // TODO: Clean this up
    if (hookResult.message) {
      switch (hookResult.message.attachment.type) {
        case 'hook_success':
          if (!hookResult.message.attachment.content) {
            // Skip if there is no content
            break
          }
          result.messages.push({
            ...hookResult.message,
            attachment: {
              ...hookResult.message.attachment,
              content: applyTruncation(hookResult.message.attachment.content),
            },
          })
          break
        default:
          result.messages.push(hookResult.message)
          break
      }
    }
  }
  queryCheckpoint('query_hooks_end')

  // Happy path: onQuery will clear userInputOnProcessing via startTransition
  // so it resolves in the same frame as deferredMessages (no flicker gap).
  // Error paths are handled by handlePromptSubmit's finally block.
  return result
}

const MAX_HOOK_OUTPUT_LENGTH = 10000

function applyTruncation(content: string): string {
  if (content.length > MAX_HOOK_OUTPUT_LENGTH) {
    return `${content.substring(0, MAX_HOOK_OUTPUT_LENGTH)}… [output truncated - exceeded ${MAX_HOOK_OUTPUT_LENGTH} characters]`
  }
  return content
}

async function processUserInputBase(
  input: string | Array<ContentBlockParam>,
  mode: PromptInputMode,
  setToolJSX: SetToolJSXFn,
  context: ProcessUserInputContext,
  pastedContents?: Record<number, PastedContent>,
  ideSelection?: IDESelection,
  messages?: Message[],
  uuid?: string,
  isAlreadyProcessing?: boolean,
  querySource?: QuerySource,
  canUseTool?: CanUseToolFn,
  permissionMode?: PermissionMode,
  skipSlashCommands?: boolean,
  bridgeOrigin?: boolean,
  isMeta?: boolean,
  skipAttachments?: boolean,
  preExpansionInput?: string,
  slashCommandOverride?: Command,
): Promise<ProcessUserInputBaseResult> {
  let inputString: string | null = null
  let precedingInputBlocks: ContentBlockParam[] = []

  // Collect image metadata texts for isMeta message
  const imageMetadataTexts: string[] = []

  // Normalized view of `input` with image blocks resized. For string input
  // this is just `input`; for array input it's the processed blocks. We pass
  // this (not raw `input`) to processTextPrompt so resized/normalized image
  // blocks actually reach the API — otherwise the resize work above is
  // discarded for the regular prompt path. Also normalizes bridge inputs
  // where iOS may send `mediaType` instead of `media_type` (mobile-apps#5825).
  let normalizedInput: string | ContentBlockParam[] = input

  if (typeof input === 'string') {
    inputString = input
  } else if (input.length > 0) {
    queryCheckpoint('query_image_processing_start')
    const processedBlocks: ContentBlockParam[] = []
    for (const block of input) {
      if (block.type === 'image') {
        const resized = await maybeResizeAndDownsampleImageBlock(block)
        // Collect image metadata for isMeta message
        if (resized.dimensions) {
          const metadataText = createImageMetadataText(resized.dimensions)
          if (metadataText) {
            imageMetadataTexts.push(metadataText)
          }
        }
        processedBlocks.push(resized.block)
      } else {
        processedBlocks.push(block)
      }
    }
    normalizedInput = processedBlocks
    queryCheckpoint('query_image_processing_end')
    // Extract the input string from the last content block if it is text,
    // and keep track of the preceding content blocks
    const lastBlock = processedBlocks[processedBlocks.length - 1]
    if (lastBlock?.type === 'text') {
      inputString = lastBlock.text
      precedingInputBlocks = processedBlocks.slice(0, -1)
    } else {
      precedingInputBlocks = processedBlocks
    }
  }

  if (inputString === null && mode !== 'prompt') {
    throw new Error(`Mode: ${mode} requires a string input.`)
  }

  // Extract and convert image content to content blocks early
  // Keep track of IDs in order for message storage
  const imageContents = pastedContents
    ? Object.values(pastedContents).filter(isValidImagePaste)
    : []
  const imagePasteIds = imageContents.map(img => img.id)

  // Store images to disk so Claude can reference the path in context
  // (for manipulation with CLI tools, uploading to PRs, etc.)
  const storedImagePaths = pastedContents
    ? await storeImages(pastedContents)
    : new Map<number, string>()

  // Resize pasted images to ensure they fit within API limits (parallel processing)
  queryCheckpoint('query_pasted_image_processing_start')
  const imageProcessingResults = await Promise.all(
    imageContents.map(async pastedImage => {
      const imageBlock: ImageBlockParam = {
        type: 'image',
        source: {
          type: 'base64',
          media_type: (pastedImage.mediaType ||
            'image/png') as Base64ImageSource['media_type'],
          data: pastedImage.content,
        },
      }
      logEvent('tengu_pasted_image_resize_attempt', {
        original_size_bytes: pastedImage.content.length,
      })
      const resized = await maybeResizeAndDownsampleImageBlock(imageBlock)
      return {
        resized,
        originalDimensions: pastedImage.dimensions,
        sourcePath:
          pastedImage.sourcePath ?? storedImagePaths.get(pastedImage.id),
      }
    }),
  )
  // Collect results preserving order
  const imageContentBlocks: ContentBlockParam[] = []
  for (const {
    resized,
    originalDimensions,
    sourcePath,
  } of imageProcessingResults) {
    // Collect image metadata for isMeta message (prefer resized dimensions)
    if (resized.dimensions) {
      const metadataText = createImageMetadataText(
        resized.dimensions,
        sourcePath,
      )
      if (metadataText) {
        imageMetadataTexts.push(metadataText)
      }
    } else if (originalDimensions) {
      // Fall back to original dimensions if resize didn't provide them
      const metadataText = createImageMetadataText(
        originalDimensions,
        sourcePath,
      )
      if (metadataText) {
        imageMetadataTexts.push(metadataText)
      }
    } else if (sourcePath) {
      // If we have a source path but no dimensions, still add source info
      imageMetadataTexts.push(`[Image source: ${sourcePath}]`)
    }
    imageContentBlocks.push(resized.block)
  }
  queryCheckpoint('query_pasted_image_processing_end')

  // ── Vision routing (Maniac-style) ─────────────────────────────────────
  // Text-only main models (OpenCode Zen, Grok, etc.) cannot see images.
  // Describe via Groq (or CLAUDE_CODE_VISION_*) and inject text; strip
  // image blocks so the main model never receives image bytes.
  const imagesInPreceding = precedingInputBlocks.filter(
    (b): b is ImageBlockParam => b.type === 'image',
  )
  const needsVisionRoute =
    (imageContentBlocks.length > 0 || imagesInPreceding.length > 0) &&
    shouldRouteImagesThroughVisionDescribe()

  if (needsVisionRoute) {
    const paths: string[] = []
    for (const pastedImage of imageContents) {
      const stored = storedImagePaths.get(pastedImage.id)
      if (stored) {
        paths.push(stored)
        continue
      }
      if (pastedImage.sourcePath) {
        paths.push(pastedImage.sourcePath)
        continue
      }
      paths.push(
        writeTempImageFromBase64(
          pastedImage.content,
          pastedImage.mediaType || 'image/png',
        ),
      )
    }
    // IDE/SDK array inputs may carry image blocks without pastedContents
    for (const block of imagesInPreceding) {
      if (block.source.type === 'base64') {
        paths.push(
          writeTempImageFromBase64(
            block.source.data,
            block.source.media_type || 'image/png',
          ),
        )
      }
    }

    if (paths.length > 0) {
      logEvent('tengu_vision_route_start', {
        image_count: paths.length,
        vision_model: getVisionModelLabel() as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
      })
      try {
        const descriptions = await describeImages(
          paths,
          inputString ?? undefined,
        )
        const baseText = inputString ?? ''
        inputString = buildVisionAugmentedMessage(baseText, descriptions)
        normalizedInput = inputString
        // Main model must not receive image bytes
        imageContentBlocks.length = 0
        precedingInputBlocks = precedingInputBlocks.filter(b => b.type !== 'image')
        imageMetadataTexts.push(
          `[Vision] Described ${descriptions.length} image(s) via ${getVisionModelLabel()} (Looking → Looked). Main model receives text only.`,
        )
        logEvent('tengu_vision_route_ok', {
          image_count: descriptions.length,
        })
      } catch (e) {
        const msg = e instanceof Error ? e.message : 'unknown error'
        const safe =
          msg.startsWith('Vision model HTTP') ||
          msg.startsWith('Image too large') ||
          msg.startsWith('Unsupported image') ||
          msg.includes('Vision routing requires') ||
          msg.includes('empty description') ||
          msg.includes('base64 exceeds')
            ? msg
            : 'vision request failed'
        imageContentBlocks.length = 0
        precedingInputBlocks = precedingInputBlocks.filter(b => b.type !== 'image')
        inputString = `${inputString ?? ''}\n\n[NOTA: ${paths.length} imagem(ns) anexada(s), mas o modelo de visao falhou: ${safe}]`
        normalizedInput = inputString
        imageMetadataTexts.push(`[Vision] Failed: ${safe}`)
        logEvent('tengu_vision_route_error', {})
      }
    }
  } else if (
    (imageContentBlocks.length > 0 || imagesInPreceding.length > 0) &&
    !visionDescribeAvailable() &&
    (process.env.CLAUDE_CODE_USE_OPENAI === '1' ||
      process.env.CLAUDE_CODE_USE_OPENAI === 'true')
  ) {
    imageMetadataTexts.push(
      '[Vision] Images attached but GROQ_API_KEY (or CLAUDE_CODE_VISION_API_KEY) is not set — vision routing is off. Main model may reject images.',
    )
  }

  // Bridge-safe slash command override: mobile/web clients set bridgeOrigin
  // with skipSlashCommands still true (defense-in-depth against exit words and
  // immediate-command fast paths). Resolve the command here — if it passes
  // isBridgeSafeCommand, clear the skip so the gate below opens. If it's a
  // known-but-unsafe command (local-jsx UI or terminal-only), short-circuit
  // with a helpful message rather than letting the model see raw "/config".
  let effectiveSkipSlash = skipSlashCommands
  if (bridgeOrigin && inputString !== null && inputString.startsWith('/')) {
    const parsed = parseSlashCommand(inputString)
    const cmd = parsed
      ? findCommand(parsed.commandName, context.options.commands)
      : undefined
    if (cmd) {
      if (isBridgeSafeCommand(cmd)) {
        effectiveSkipSlash = false
      } else {
        const msg = `/${getCommandName(cmd)} isn't available over Remote Control.`
        return {
          messages: [
            createUserMessage({ content: inputString, uuid }),
            createCommandInputMessage(
              `<local-command-stdout>${msg}</local-command-stdout>`,
            ),
          ],
          shouldQuery: false,
          resultText: msg,
        }
      }
    }
    // Unknown /foo or unparseable — fall through to plain text, same as
    // pre-#19134. A mobile user typing "/shrug" shouldn't see "Unknown skill".
  }

  // Ultraplan keyword — route through /ultraplan. Detect on the
  // pre-expansion input so pasted content containing the word cannot
  // trigger a CCR session; replace with "plan" in the expanded input so
  // the CCR prompt receives paste contents and stays grammatical. See
  // keyword.ts for the quote/path exclusions. Interactive prompt mode +
  // non-slash-prefixed only:
  // headless/print mode filters local-jsx commands out of context.options,
  // so routing to /ultraplan there yields "Unknown skill" — and there's no
  // rainbow animation in print mode anyway.
  // Runs before attachment extraction so this path matches the slash-command
  // path below (no await between setUserInputOnProcessing and setAppState —
  // React batches both into one render, no flash).
  if (
    feature('ULTRAPLAN') &&
    mode === 'prompt' &&
    !context.options.isNonInteractiveSession &&
    inputString !== null &&
    !effectiveSkipSlash &&
    !inputString.startsWith('/') &&
    !context.getAppState().ultraplanSessionUrl &&
    !context.getAppState().ultraplanLaunching &&
    hasUltraplanKeyword(preExpansionInput ?? inputString)
  ) {
    logEvent('tengu_ultraplan_keyword', {})
    const rewritten = replaceUltraplanKeyword(inputString).trim()
    const { processSlashCommand } = await import('./processSlashCommand.js')
    const slashResult = await processSlashCommand(
      `/ultraplan ${rewritten}`,
      precedingInputBlocks,
      imageContentBlocks,
      [],
      context,
      setToolJSX,
      uuid,
      isAlreadyProcessing,
      canUseTool,
    )
    return addImageMetadataMessage(slashResult, imageMetadataTexts)
  }

  // For slash commands, attachments will be extracted within getMessagesForSlashCommand
  const shouldExtractAttachments =
    !skipAttachments &&
    inputString !== null &&
    (mode !== 'prompt' || effectiveSkipSlash || !inputString.startsWith('/'))

  queryCheckpoint('query_attachment_loading_start')
  const attachmentMessages = shouldExtractAttachments
    ? await toArray(
        getAttachmentMessages(
          inputString,
          context,
          ideSelection ?? null,
          [], // queuedCommands - handled by query.ts for mid-turn attachments
          messages,
          querySource,
        ),
      )
    : []
  queryCheckpoint('query_attachment_loading_end')

  // Bash commands
  if (inputString !== null && mode === 'bash') {
    const { processBashCommand } = await import('./processBashCommand.js')
    return addImageMetadataMessage(
      await processBashCommand(
        inputString,
        precedingInputBlocks,
        attachmentMessages,
        context,
        setToolJSX,
      ),
      imageMetadataTexts,
    )
  }

  // Slash commands
  // Skip for remote bridge messages — input from CCR clients is plain text
  if (
    inputString !== null &&
    !effectiveSkipSlash &&
    inputString.startsWith('/')
  ) {
    const { processSlashCommand } = await import('./processSlashCommand.js')
    const slashResult = await processSlashCommand(
      inputString,
      precedingInputBlocks,
      imageContentBlocks,
      attachmentMessages,
      context,
      setToolJSX,
      uuid,
      isAlreadyProcessing,
      canUseTool,
      slashCommandOverride,
    )
    return addImageMetadataMessage(slashResult, imageMetadataTexts)
  }

  // Log agent mention queries for analysis
  if (inputString !== null && mode === 'prompt') {
    const trimmedInput = inputString.trim()

    const agentMention = attachmentMessages.find(
      (m): m is AttachmentMessage<AgentMentionAttachment> =>
        m.attachment.type === 'agent_mention',
    )

    if (agentMention) {
      const agentMentionString = `@agent-${agentMention.attachment.agentType}`
      const isSubagentOnly = trimmedInput === agentMentionString
      const isPrefix =
        trimmedInput.startsWith(agentMentionString) && !isSubagentOnly

      // Log whenever users use @agent-<name> syntax
      logEvent('tengu_subagent_at_mention', {
        is_subagent_only: isSubagentOnly,
        is_prefix: isPrefix,
      })
    }
  }

  // Regular user prompt
  return addImageMetadataMessage(
    processTextPrompt(
      normalizedInput,
      imageContentBlocks,
      imagePasteIds,
      attachmentMessages,
      uuid,
      permissionMode,
      isMeta,
    ),
    imageMetadataTexts,
  )
}

// Adds image metadata texts as isMeta message to result
function addImageMetadataMessage(
  result: ProcessUserInputBaseResult,
  imageMetadataTexts: string[],
): ProcessUserInputBaseResult {
  if (imageMetadataTexts.length > 0) {
    result.messages.push(
      createUserMessage({
        content: imageMetadataTexts.map(text => ({ type: 'text', text })),
        isMeta: true,
      }),
    )
  }
  return result
}
