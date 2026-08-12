# MiMo Direct Vision Implementation Plan

> **For agentic workers:** Implement inline with TDD.

**Goal:** Send Anthropic image blocks directly to `mimo-v2.5-free`, while retaining the external vision fallback for text-only models.

**Architecture:** Add a small model-capability predicate in the bridge translation module. `handleMessages` consults it before invoking `routeImagesInBody`; MiMo continues through the existing Anthropic-to-OpenAI `image_url` conversion unchanged.

**Tech Stack:** CommonJS, Node.js Web Streams, Bun compiled wrapper.

## Global Constraints

- Direct vision applies only to `mimo-v2.5-free`.
- Text-only models keep the existing external vision route.
- No provider credentials or user configuration are changed.

### Task 1: Direct MiMo image routing

**Files:**
- Modify: `claude-wrapper/lib/bridge/translate.js`
- Modify: `claude-wrapper/lib/bridge/messages.js`
- Create: `claude-wrapper/scripts/test-mimo-direct-vision.js`

**Interfaces:**
- Produces: `supportsDirectVision(upstreamModel): boolean`
- Consumes: the resolved upstream model in `handleMessages`

- [ ] Write a failing test asserting MiMo supports direct vision and DeepSeek does not.
- [ ] Run the test and verify it fails because the predicate is missing.
- [ ] Add the predicate and bypass external image routing only when it returns true.
- [ ] Run the regression test and existing stream regression test.
- [ ] Build the next native wrapper and point Cursor/shims to it.
