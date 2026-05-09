import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import type { TranscriptExporter, TranscriptRepository } from '../../core/contracts/storage'
import type { ExportFormat, ExportResult } from '../../shared/api-types'

export class FileTranscriptExporter implements TranscriptExporter {
  constructor(
    private readonly repository: TranscriptRepository,
    private readonly exportDir: string
  ) {}

  async export(id: string, format: ExportFormat): Promise<ExportResult> {
    const transcript = await this.repository.getById(id)

    if (!transcript) {
      return {
        ok: false,
        error: `Transcript not found: ${id}`
      }
    }

    await mkdir(this.exportDir, { recursive: true })

    const extension = format === 'json' ? 'json' : 'txt'
    const filename = `${sanitizeFileStem(transcript.title || transcript.id)}-${id}.${extension}`
    const outputPath = path.join(this.exportDir, filename)
    const content =
      format === 'json'
        ? JSON.stringify(transcript, null, 2)
        : format === 'bilingual_text'
          ? [transcript.plainText, transcript.translatedPlainText ?? ''].filter(Boolean).join('\n\n')
          : transcript.plainText

    await writeFile(outputPath, content, 'utf8')

    return {
      ok: true,
      path: outputPath
    }
  }
}

function sanitizeFileStem(value: string): string {
  return value
    .trim()
    .replace(/[<>:"/\\|?*\x00-\x1f]/g, '-')
    .replace(/\s+/g, '-')
    .slice(0, 48) || 'transcript'
}
