import { useEffect, useMemo, useState } from 'react'
import type { ExportFormat, SavedTranscript } from '../../shared/api-types'
import type { CaptureSource } from '../../shared/primitive-types'

type Palette = {
  panel: string
  panelSoft: string
  text: string
  muted: string
  border: string
}

type HistoryTimeFilter = 'all' | 'today' | 'last_7_days' | 'last_30_days'

export function HistoryPage(props: {
  items: SavedTranscript[]
  total: number
  searchQuery: string
  selectedMode: 'all' | SavedTranscript['mode']
  selectedSource: 'all' | CaptureSource
  selectedTimeFilter: HistoryTimeFilter
  selectedTranscript: SavedTranscript | null
  exportMessage: string | null
  busyAction: string | null
  palette: Palette
  onSearchQueryChange: (value: string) => void
  onModeChange: (value: 'all' | SavedTranscript['mode']) => void
  onSourceChange: (value: 'all' | CaptureSource) => void
  onTimeFilterChange: (value: HistoryTimeFilter) => void
  onOpen: (id: string) => void
  onDelete: (id: string) => void
  onCopy: (id: string, format: ExportFormat) => void
  onExport: (id: string, format: ExportFormat) => void
}) {
  const [detailQuery, setDetailQuery] = useState('')

  useEffect(() => {
    setDetailQuery('')
  }, [props.selectedTranscript?.id])

  const filteredBlocks = useMemo(() => {
    if (!props.selectedTranscript) {
      return []
    }

    const keyword = detailQuery.trim().toLowerCase()
    if (!keyword) {
      return props.selectedTranscript.blocks
    }

    return props.selectedTranscript.blocks.filter((block) =>
      [block.text, block.translatedText ?? '', block.speakerLabel ?? '']
        .some((value) => value.toLowerCase().includes(keyword))
    )
  }, [detailQuery, props.selectedTranscript])

  return (
    <section
      style={{
        border: `1px solid ${props.palette.border}`,
        background: props.palette.panel,
        borderRadius: 28,
        padding: 24
      }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 16, flexWrap: 'wrap' }}>
        <div>
          <div style={{ fontSize: 12, letterSpacing: '0.16em', textTransform: 'uppercase', color: props.palette.muted }}>
            History
          </div>
          <h2 style={{ margin: '10px 0 0', fontSize: 32 }}>Search your transcript assets.</h2>
        </div>
        <div style={{ color: props.palette.muted }}>{props.total} records</div>
      </div>

      <div style={{ marginTop: 20, display: 'grid', gridTemplateColumns: 'minmax(220px, 1.2fr) repeat(3, minmax(160px, 0.4fr))', gap: 12 }}>
        <input
          value={props.searchQuery}
          onChange={(event) => {
            props.onSearchQueryChange(event.target.value)
          }}
          placeholder="Search transcript text"
          style={inputStyle(props.palette)}
        />
        <select
          value={props.selectedMode}
          onChange={(event) => {
            props.onModeChange(event.target.value as 'all' | SavedTranscript['mode'])
          }}
          style={inputStyle(props.palette)}
        >
          <option value="all">All Modes</option>
          <option value="ptt">PTT</option>
          <option value="meeting">Meeting</option>
        </select>
        <select
          value={props.selectedSource}
          onChange={(event) => {
            props.onSourceChange(event.target.value as 'all' | CaptureSource)
          }}
          style={inputStyle(props.palette)}
        >
          <option value="all">All Sources</option>
          <option value="microphone">Microphone</option>
          <option value="system">System Audio</option>
        </select>
        <select
          value={props.selectedTimeFilter}
          onChange={(event) => {
            props.onTimeFilterChange(event.target.value as HistoryTimeFilter)
          }}
          style={inputStyle(props.palette)}
        >
          <option value="all">All Time</option>
          <option value="today">Today</option>
          <option value="last_7_days">Last 7 Days</option>
          <option value="last_30_days">Last 30 Days</option>
        </select>
      </div>

      <div style={{ marginTop: 20, display: 'grid', gap: 12 }}>
        {props.items.length === 0 ? (
          <div style={{ color: props.palette.muted }}>No matching transcripts.</div>
        ) : (
          props.items.map((item) => {
            const sources = describeTranscriptSources(item)

            return (
              <article
                key={item.id}
                style={{
                  border: `1px solid ${props.palette.border}`,
                  borderRadius: 18,
                  padding: 16,
                  background: props.palette.panelSoft
                }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
                  <div>
                    <div style={{ fontSize: 12, letterSpacing: '0.12em', textTransform: 'uppercase', color: props.palette.muted }}>
                      {item.mode} • {sources}
                    </div>
                    <div style={{ marginTop: 8, fontSize: 20, fontWeight: 700 }}>{item.title}</div>
                    <div style={{ marginTop: 8, color: props.palette.muted }}>
                      {formatDateTime(item.startedAt)} • {formatDurationMs(item.endedAt - item.startedAt)}
                    </div>
                  </div>
                  <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
                    <button
                      type="button"
                      disabled={Boolean(props.busyAction)}
                      onClick={() => {
                        props.onOpen(item.id)
                      }}
                      style={pillButtonStyle(Boolean(props.busyAction))}
                    >
                      {props.busyAction === `open:${item.id}` ? 'Opening...' : 'Open'}
                    </button>
                    <button
                      type="button"
                      disabled={Boolean(props.busyAction)}
                      onClick={() => {
                        props.onDelete(item.id)
                      }}
                      style={pillButtonStyle(Boolean(props.busyAction))}
                    >
                      {props.busyAction === `delete:${item.id}` ? 'Deleting...' : 'Delete'}
                    </button>
                  </div>
                </div>
                <div style={{ marginTop: 10, lineHeight: 1.5 }}>{item.plainText}</div>
                {item.translatedPlainText ? (
                  <div style={{ marginTop: 8, color: props.palette.muted, lineHeight: 1.5 }}>{item.translatedPlainText}</div>
                ) : null}
              </article>
            )
          })
        )}
      </div>

      {props.selectedTranscript ? (
        <section
          style={{
            marginTop: 24,
            border: `1px solid ${props.palette.border}`,
            background: props.palette.panelSoft,
            borderRadius: 22,
            padding: 20
          }}
        >
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
            <div>
              <div style={{ fontSize: 12, letterSpacing: '0.12em', textTransform: 'uppercase', color: props.palette.muted }}>
                Selected Transcript
              </div>
              <h3 style={{ margin: '10px 0 0', fontSize: 24 }}>{props.selectedTranscript.title}</h3>
            </div>
            <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
              <button
                type="button"
                disabled={Boolean(props.busyAction)}
                onClick={() => {
                  props.onCopy(props.selectedTranscript!.id, 'plain_text')
                }}
                style={pillButtonStyle(Boolean(props.busyAction))}
              >
                {props.busyAction === `copy:${props.selectedTranscript.id}:plain_text` ? 'Copying...' : 'Copy Text'}
              </button>
              <button
                type="button"
                disabled={Boolean(props.busyAction)}
                onClick={() => {
                  props.onCopy(props.selectedTranscript!.id, 'bilingual_text')
                }}
                style={pillButtonStyle(Boolean(props.busyAction))}
              >
                {props.busyAction === `copy:${props.selectedTranscript.id}:bilingual_text` ? 'Copying...' : 'Copy Bilingual'}
              </button>
              <button
                type="button"
                disabled={Boolean(props.busyAction)}
                onClick={() => {
                  props.onExport(props.selectedTranscript!.id, 'plain_text')
                }}
                style={pillButtonStyle(Boolean(props.busyAction))}
              >
                {props.busyAction === `export:${props.selectedTranscript.id}:plain_text` ? 'Exporting...' : 'Export Text'}
              </button>
              <button
                type="button"
                disabled={Boolean(props.busyAction)}
                onClick={() => {
                  props.onExport(props.selectedTranscript!.id, 'bilingual_text')
                }}
                style={pillButtonStyle(Boolean(props.busyAction))}
              >
                {props.busyAction === `export:${props.selectedTranscript.id}:bilingual_text`
                  ? 'Exporting...'
                  : 'Export Bilingual'}
              </button>
              <button
                type="button"
                disabled={Boolean(props.busyAction)}
                onClick={() => {
                  props.onExport(props.selectedTranscript!.id, 'json')
                }}
                style={pillButtonStyle(Boolean(props.busyAction))}
              >
                {props.busyAction === `export:${props.selectedTranscript.id}:json` ? 'Exporting...' : 'Export JSON'}
              </button>
            </div>
          </div>

          <div
            style={{
              marginTop: 16,
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
              gap: 12
            }}
          >
            <DetailStat label="Mode" value={props.selectedTranscript.mode} palette={props.palette} />
            <DetailStat
              label="Sources"
              value={describeTranscriptSources(props.selectedTranscript)}
              palette={props.palette}
            />
            <DetailStat
              label="Duration"
              value={formatDurationMs(props.selectedTranscript.endedAt - props.selectedTranscript.startedAt)}
              palette={props.palette}
            />
            <DetailStat
              label="Engine"
              value={props.selectedTranscript.metadata.engineProfileId}
              palette={props.palette}
            />
          </div>

          <div style={{ marginTop: 18, display: 'grid', gap: 12 }}>
            <input
              value={detailQuery}
              onChange={(event) => {
                setDetailQuery(event.target.value)
              }}
              placeholder="Search within this transcript"
              style={inputStyle(props.palette)}
            />
            <div style={{ color: props.palette.muted }}>
              {filteredBlocks.length} of {props.selectedTranscript.blocks.length} blocks shown • {formatDateTime(props.selectedTranscript.startedAt)}
            </div>
          </div>

          <div style={{ marginTop: 18, display: 'grid', gap: 12 }}>
            {filteredBlocks.map((block) => (
              <article
                key={block.id}
                style={{
                  border: `1px solid ${props.palette.border}`,
                  borderRadius: 18,
                  padding: 16,
                  background: props.palette.panel
                }}
              >
                <div style={{ fontSize: 12, letterSpacing: '0.12em', textTransform: 'uppercase', color: props.palette.muted }}>
                  {block.source} • {formatTimeRange(block.startedAt, block.endedAt)}
                </div>
                <div style={{ marginTop: 10, lineHeight: 1.6 }}>{block.text}</div>
                {block.translatedText ? (
                  <div style={{ marginTop: 8, lineHeight: 1.6, color: props.palette.muted }}>{block.translatedText}</div>
                ) : null}
              </article>
            ))}
            {filteredBlocks.length === 0 ? (
              <div style={{ color: props.palette.muted }}>No blocks match the current detail search.</div>
            ) : null}
          </div>

          {props.exportMessage ? (
            <div style={{ marginTop: 16, color: props.palette.muted }}>{props.exportMessage}</div>
          ) : null}
        </section>
      ) : null}
    </section>
  )
}

function DetailStat(props: { label: string; value: string; palette: Palette }) {
  return (
    <div
      style={{
        border: `1px solid ${props.palette.border}`,
        borderRadius: 18,
        padding: 14,
        background: props.palette.panel
      }}
    >
      <div style={{ fontSize: 12, textTransform: 'uppercase', letterSpacing: '0.12em', color: props.palette.muted }}>
        {props.label}
      </div>
      <div style={{ marginTop: 8, fontWeight: 700 }}>{props.value}</div>
    </div>
  )
}

function describeTranscriptSources(transcript: SavedTranscript): string {
  const sources = [...new Set(transcript.blocks.map((block) => block.source))]

  if (sources.length === 0) {
    return 'unknown'
  }

  return sources.join(' + ')
}

function inputStyle(palette: Palette) {
  return {
    borderRadius: 16,
    border: `1px solid ${palette.border}`,
    background: palette.panelSoft,
    color: palette.text,
    padding: '12px 14px'
  } as const
}

function pillButtonStyle(disabled: boolean) {
  return {
    border: '1px solid rgba(255, 255, 255, 0.12)',
    borderRadius: 999,
    padding: '10px 14px',
    background: 'transparent',
    color: 'inherit',
    cursor: disabled ? 'not-allowed' : 'pointer'
  } as const
}

function formatDateTime(timestamp: number): string {
  return new Date(timestamp).toLocaleString()
}

function formatTimeRange(startedAt: number, endedAt: number): string {
  return `${new Date(startedAt).toLocaleTimeString()} - ${new Date(endedAt).toLocaleTimeString()}`
}

function formatDurationMs(durationMs: number): string {
  const totalSeconds = Math.max(0, Math.floor(durationMs / 1000))
  const minutes = Math.floor(totalSeconds / 60)
  const seconds = totalSeconds % 60
  return `${minutes}m ${seconds}s`
}
