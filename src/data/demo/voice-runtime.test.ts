import { beforeEach, describe, expect, it } from 'vitest'
import { DemoRepository } from './demo-repository.ts'
import { clearSnapshot } from './storage.ts'
import { DEMO_APPROVED_NUMBER } from './import-runtime.ts'

describe('demo voice clarification', () => {
  beforeEach(clearSnapshot)

  it('persists a voice clarification for the normal text reply', async () => {
    const repo = new DemoRepository()
    const voice = await repo.simulateVoiceMessage('ambiguous_customer', DEMO_APPROVED_NUMBER)
    expect(voice.reply).toContain('Jesus Ayala')
    expect((await repo.load()).clarificationSessions).toHaveLength(1)
    const reply = await repo.simulateInboundMessage(DEMO_APPROVED_NUMBER, '1')
    expect(reply.reply).toContain('Updated Jesus Ayala')
  })
})
