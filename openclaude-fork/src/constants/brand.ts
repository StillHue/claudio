/**
 * Brand identity — display name matches Claude Code so the agent
 * introduces itself as Claude. CLI package/binary may still be `claudio`.
 *
 * Accent matches Claude Code's terracotta so the startup / Clawd aesthetic
 * feels familiar. Theme entries MUST stay in `rgb(r,g,b)` form (never hex):
 * spinner shimmer/stall interpolation parses theme values with `parseRGB`,
 * which only matches `rgb(...)` strings.
 */

/** Product name shown in prompts, help, and chrome. */
export const BRAND_NAME = 'Claude'

/** Splash / welcome line only — matches Claude Code wording. */
export const WELCOME_NAME = 'Claude Code'

export const BRAND_TAGLINE = 'you already know me'

/** Claude Code terracotta (#D97757) in the rgb() form required by theme consumers. */
export const BRAND_ACCENT_RGB = 'rgb(217,119,87)'

/**
 * Two-row Unicode half-block wordmark, split so the two halves can be
 * rendered in different accent shades. Block characters (█ ▀ ▄) render
 * correctly in Apple Terminal. Rendered side by side with a 1-col gap:
 *
 *   █▀█ █▀█ █▀▀ █▄ █ █▀▀ █   ▄▀█ █ █ █▀▄ █▀▀
 *   █▄█ █▀▀ ██▄ █ ▀█ █▄▄ █▄▄ █▀█ █▄█ █▄▀ ██▄
 */
export const WORDMARK_OPEN = [
  '█▀█ █▀█ █▀▀ █▄ █',
  '█▄█ █▀▀ ██▄ █ ▀█',
] as const

export const WORDMARK_CLAUDE = [
  '█▀▀ █   ▄▀█ █ █ █▀▄ █▀▀',
  '█▄▄ █▄▄ █▀█ █▄█ █▄▀ ██▄',
] as const

/** Rendered width of the full wordmark: open half + 1-col gap + claude half. */
export const WORDMARK_WIDTH =
  WORDMARK_OPEN[0].length + 1 + WORDMARK_CLAUDE[0].length
