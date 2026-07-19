import { describe, expect, test } from 'bun:test'
import {
  buildVisionAugmentedMessage,
  visionDescribeAvailable,
} from './visionDescribe.js'

test('buildVisionAugmentedMessage injects description blocks', () => {
  const out = buildVisionAugmentedMessage('o que tem nessa imagem?', [
    { path: 'C:/tmp/shot.png', description: 'Tela escura com erro em vermelho.' },
  ])
  expect(out).toContain('o que tem nessa imagem?')
  expect(out).toContain('[image1] (shot.png):')
  expect(out).toContain('Tela escura com erro em vermelho.')
  expect(out).toContain('=== FIM DAS IMAGENS ===')
})

test('visionDescribeAvailable reflects GROQ_API_KEY', () => {
  const prev = process.env.GROQ_API_KEY
  delete process.env.GROQ_API_KEY
  delete process.env.CLAUDE_CODE_VISION_API_KEY
  delete process.env.MANIAC_VISION_API_KEY
  expect(visionDescribeAvailable()).toBe(false)
  process.env.GROQ_API_KEY = 'test-key'
  expect(visionDescribeAvailable()).toBe(true)
  if (prev === undefined) delete process.env.GROQ_API_KEY
  else process.env.GROQ_API_KEY = prev
})
