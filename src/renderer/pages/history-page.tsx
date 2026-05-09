import { useEffect, useMemo, useState } from 'react'
import type { ExportFormat, SavedTranscript } from '../../shared/api-types'
import type { CaptureSource } from '../../shared/primitive-types'

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
    if (!props.selectedTranscript) return []
    const keyword = detailQuery.trim().toLowerCase()
    if (!keyword) return props.selectedTranscript.blocks
    return props.selectedTranscript.blocks.filter((block) =>
      [block.text, block.translatedText ?? '', block.speakerLabel ?? '']
        .some((v) => v.toLowerCase().includes(keyword))
    )
  }, [detailQuery, props.selectedTranscript])

  const sel = props.selectedTranscript

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 12 }}>
        <h1 style={{ fontSize: 24, fontWeight: 600, margin: 0 }}>History</h1>
        <span style={{ fontSize: 13, color: 'var(--text-tertiary)' }}>{props.total} records</span>
      </div>

      <div style={{ marginTop: 16, display: 'flex', gap: 8 }}>
        <input
          value={props.searchQuery}
          onChange={(e) => props.onSearchQueryChange(e.target.value)}
          placeholder="Search transcripts"
          style={inputStyle()}
        />
        <select
          value={props.selectedMode}
          onChange={(e) => props.onModeChange(e.target.value as 'all' | SavedTranscript['mode'])}
          style={selectStyle()}
        >
          <option value="all">All modes</option>
          <option value="ptt">PTT</option>
          <option value="meeting">Meeting</option>
        </select>
        <select
          value={props.selectedSource}
          onChange={(e) => props.onSourceChange(e.target.value as 'all' | CaptureSource)}
          style={selectStyle()}
        >
          <option value="all">All sources</option>
          <option value="microphone">Microphone</option>
          <option value="system">System</option>
        </select>
        <select
          value={props.selectedTimeFilter}
          onChange={(e) => props.onTimeFilterChange(e.target.value as HistoryTimeFilter)}
          style={selectStyle()}
        >
          <option value="all">All time</option>
          <option value="today">Today</option>
          <option value="last_7_days">Last 7 days</option>
          <option value="last_30_days">Last 30 days</option>
        </select>
      </div>

      <div style={{
        marginTop: 20,
        display: 'grid',
        gridTemplateColumns: sel ? '1fr 1.2fr' : '1fr',
        gap: 1,
        background: 'var(--border-subtle)',
        border: '1px solid var(--border)',
        borderRadius: 'var(--radius)',
        overflow: 'hidden',
        minHeight: 400,
      }}>
        {/* List pane */}
        <div style={{ background: 'var(--bg-page)', overflow: 'auto', maxHeight: 'calc(100vh - 220px)' }}>
          {props.items.length === 0 ? (
            <div style={{ padding: 20, color: 'var(--text-tertiary)', fontSize: 14 }}>No matching transcripts.</div>
          ) : (
            props.items.map((item) => {
              const sources = describeTranscriptSources(item)
              const isSelected = sel?.id === item.id
              return (
                <div
                  key={item.id}
                  onClick={() => props.onOpen(item.id)}
                  role="button"
                  tabIndex={0}
                  onKeyDown={(e) => { if (e.key === 'Enter') props.onOpen(item.id) }}
                  style={{
                    padding: '12px 16px',
                    borderBottom: '1px solid var(--border-subtle)',
                    background: isSelected ? 'var(--accent-muted)' : 'transparent',
                    cursor: 'pointer',
                  }}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
                    <div style={{
                      fontSize: 14,
                      fontWeight: 500,
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                    }}>
                      {item.title}
                    </div>
                    <div style={{ fontSize: 11, color: 'var(--text-tertiary)', whiteSpace: 'nowrap' }}>
                      {formatDateTime(item.startedAt)}
                    </div>
                  </div>
                  <div style={{ marginTop: 4, fontSize: 12, color: 'var(--text-tertiary)' }}>
                    {item.mode} {'\u00B7'} {sources} {'\u00B7'} {formatDurationMs(item.endedAt - item.startedAt)}
                  </div>
                  <div style={{
                    marginTop: 4,
                    fontSize: 13,
                    color: 'var(--text-secondary)',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                  }}>
                    {item.plainText}
                  </div>
                </div>
              )
            })
          )}
        </div>

        {/* Detail pane */}
        {sel ? (
          <div style={{
            background: 'var(--bg-surface)',
            overflow: 'auto',
            maxHeight: 'calc(100vh - 220px)',
            padding: 20,
          }}>
            <div style={{ fontSize: 18, fontWeight: 600 }}>{sel.title}</div>
            <div style={{
              marginTop: 8,
              fontSize: 12,
              color: 'var(--text-tertiary)',
              display: 'flex',
              gap: 12,
            }}>
              <span>{sel.mode}</span>
              <span>{describeTranscriptSources(sel)}</span>
              <span>{formatDurationMs(sel.endedAt - sel.startedAt)}</span>
              <span>{sel.metadata.engineProfileId}</span>
            </div>

            <div style={{ marginTop: 12, display: 'flex', gap: 6, flexWrap: 'wrap' }}>
              <SmallButton
                label="Copy text"
                disabled={Boolean(props.busyAction)}
                onClick={() => props.onCopy(sel.id, 'plain_text')}
              />
              <SmallButton
                label="Copy bilingual"
                disabled={Boolean(props.busyAction)}
                onClick={() => props.onCopy(sel.id, 'bilingual_text')}
              />
              <SmallButton
                label="Export text"
                disabled={Boolean(props.busyAction)}
                onClick={() => props.onExport(sel.id, 'plain_text')}
              />
              <SmallButton
                label="Export bilingual"
                disabled={Boolean(props.busyAction)}
                onClick={() => props.onExport(sel.id, 'bilingual_text')}
              />
              <SmallButton
                label="Export JSON"
                disabled={Boolean(props.busyAction)}
                onClick={() => props.onExport(sel.id, 'json')}
              />
              <SmallButton
                label="Delete"
                disabled={Boolean(props.busyAction)}
                onClick={() => props.onDelete(sel.id)}
                danger
              />
            </div>

            {props.exportMessage ? (
              <div style={{ marginTop: 8, fontSize: 12, color: 'var(--text-tertiary)' }}>{props.exportMessage}</div>
            ) : null}

            <div style={{ marginTop: 16 }}>
              <input
                value={detailQuery}
                onChange={(e) => setDetailQuery(e.target.value)}
                placeholder="Search within blocks"
                style={inputStyle()}
              />
              <div style={{ marginTop: 6, fontSize: 12, color: 'var(--text-tertiary)' }}>
                {filteredBlocks.length} of {sel.blocks.length} blocks
              </div>
            </div>

            <div style={{ marginTop: 12 }}>
              {filteredBlocks.map((block) => (
                <div key={block.id} style={{
                  padding: '8px 0',
                  borderBottom: '1px solid var(--border-subtle)',
                }}>
                  <div style={{ fontSize: 11, color: 'var(--text-tertiary)' }}>
                    {block.source} {'\u00B7'} {formatTimeRange(block.startedAt, block.endedAt)}
                  </div>
                  <div style={{ marginTop: 4, fontSize: 14, lineHeight: 1.55 }}>{block.text}</div>
                  {block.translatedText ? (
                    <div style={{ marginTop: 2, fontSize: 13, lineHeight: 1.5, color: 'var(--text-secondary)' }}>
                      {block.translatedText}
                    </div>
                  ) : null}
                </div>
              ))}
              {filteredBlocks.length === 0 ? (
                <div style={{ padding: '12px 0', color: 'var(--text-tertiary)', fontSize: 13 }}>No blocks match.</div>
              ) : null}
            </div>
          </div>
        ) : null}
      </div>
    </div>
  )
}

function SmallButton(props: { label: string; disabled?: boolean; danger?: boolean; onClick: () => void }) {
  return (
    <button type="button" onClick={props.onClick} disabled={props.disabled} style={{
      border: '1px solid var(--border)',
      borderRadius: 'var(--radius)',
      padding: '5px 10px',
      background: 'transparent',
      color: props.danger ? 'var(--danger)' : 'var(--text-secondary)',
      fontSize: 12,
      cursor: props.disabled ? 'not-allowed' : 'pointer',
      fontFamily: 'inherit',
      opacity: props.disabled ? 0.5 : 1,
    }}>
      {props.label}
    </button>
  )
}

function inputStyle() {
  return {
    flex: 1,
    minWidth: 0,
    border: '1px solid var(--border)',
    borderRadius: 'var(--radius)',
    padding: '7px 10px',
    background: 'var(--bg-surface)',
    color: 'var(--text-primary)',
    fontSize: 13,
    fontFamily: 'inherit',
  } as const
}

function selectStyle() {
  return {
    border: '1px solid var(--border)',
    borderRadius: 'var(--radius)',
    padding: '7px 10px',
    background: 'var(--bg-surface)',
    color: 'var(--text-primary)',
    fontSize: 13,
    fontFamily: 'inherit',
  } as const
}

function describeTranscriptSources(transcript: SavedTranscript): string {
  const sources = [...new Set(transcript.blocks.map((b) => b.source))]
  return sources.length === 0 ? 'unknown' : sources.join(' + ')
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
