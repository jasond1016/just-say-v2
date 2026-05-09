import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { selectTranslatedPlainText, selectVisibleTimeline } from '../../core/transcript/transcript-selectors'
import type { AppRuntimeSnapshot, ExportFormat, ExportResult } from '../../shared/api-types'

type LiveSessionSnapshot = NonNullable<AppRuntimeSnapshot['liveSession']>

export class LiveSessionActionsService {
  private readonly now: () => number

  constructor(
    private readonly dependencies: {
      getRuntimeSnapshot(): AppRuntimeSnapshot
      clipboard: {
        writeText(text: string): Promise<void>
      }
      exportDir: string
      now?: () => number
    }
  ) {
    this.now = dependencies.now ?? Date.now
  }

  async copyPlainText(): Promise<void> {
    const liveSession = requireLiveSession(this.dependencies.getRuntimeSnapshot())
    const text = renderLiveSessionExportContent(liveSession, 'plain_text')

    if (!text.trim()) {
      throw new Error('Live session has no transcript content yet.')
    }

    await this.dependencies.clipboard.writeText(text)
  }

  async export(format: ExportFormat): Promise<ExportResult> {
    const liveSession = requireLiveSession(this.dependencies.getRuntimeSnapshot())
    const content = renderLiveSessionExportContent(liveSession, format, this.now())

    if (format !== 'json' && !content.trim()) {
      return {
        ok: false,
        error: 'Live session has no transcript content yet.'
      }
    }

    await mkdir(this.dependencies.exportDir, { recursive: true })

    const extension = format === 'json' ? 'json' : 'txt'
    const outputPath = path.join(
      this.dependencies.exportDir,
      `${sanitizeFileStem(`live-session-${liveSession.sessionId}`)}-${this.now()}.${extension}`
    )

    await writeFile(outputPath, content, 'utf8')

    return {
      ok: true,
      path: outputPath
    }
  }
}

export function renderLiveSessionExportContent(
  liveSession: LiveSessionSnapshot,
  format: ExportFormat,
  exportedAt: number = Date.now()
): string {
  const timeline = selectVisibleTimeline(liveSession.transcript)

  if (format === 'json') {
    return JSON.stringify(buildLiveSessionExportPayload(liveSession, exportedAt), null, 2)
  }

  if (format === 'bilingual_text') {
    return timeline
      .map((item) => [item.primaryText.trim(), item.secondaryText?.trim()].filter(Boolean).join('\n'))
      .filter(Boolean)
      .join('\n\n')
  }

  return timeline
    .map((item) => item.primaryText.trim())
    .filter(Boolean)
    .join('\n')
}

function buildLiveSessionExportPayload(liveSession: LiveSessionSnapshot, exportedAt: number) {
  const timeline = selectVisibleTimeline(liveSession.transcript)
  const plainText = timeline
    .map((item) => item.primaryText.trim())
    .filter(Boolean)
    .join('\n')

  return {
    sessionId: liveSession.sessionId,
    status: liveSession.status,
    startedAt: liveSession.startedAt,
    durationSec: liveSession.durationSec,
    engineProfileId: liveSession.engineProfileId,
    translationEnabled: liveSession.translationEnabled,
    exportedAt,
    plainText,
    ...(selectTranslatedPlainText(liveSession.transcript)
      ? { translatedPlainText: selectTranslatedPlainText(liveSession.transcript) }
      : {}),
    timeline,
    transcript: {
      committedBlocks: liveSession.transcript.committedBlocks.map((block) => ({
        ...block,
        ...(block.words ? { words: [...block.words] } : {})
      })),
      activeDrafts: Object.fromEntries(
        Object.entries(liveSession.transcript.activeDrafts).map(([source, draft]) => [
          source,
          draft
            ? {
                ...draft,
                ...(draft.words ? { words: [...draft.words] } : {})
              }
            : draft
        ])
      ),
      revision: liveSession.transcript.revision
    }
  }
}

function requireLiveSession(snapshot: AppRuntimeSnapshot): LiveSessionSnapshot {
  if (!snapshot.liveSession) {
    throw new Error('No active live session to copy or export.')
  }

  return snapshot.liveSession
}

function sanitizeFileStem(value: string): string {
  return value
    .trim()
    .replace(/[<>:"/\\|?*\x00-\x1f]/g, '-')
    .replace(/\s+/g, '-')
    .slice(0, 48) || 'live-session'
}
