import { useEffect, useMemo, useState } from 'react'
import type { ExportFormat, SavedTranscript } from '../../shared/api-types'
import type { CaptureSource } from '../../shared/primitive-types'
import { Button, SelectField, TextInput } from '../ui/controls'

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
      <div className="page-header">
        <h1 className="page-title">History</h1>
        <span className="page-meta">{props.total} records</span>
      </div>

      <div className="toolbar stack-16">
        <TextInput
          value={props.searchQuery}
          onChange={(e) => props.onSearchQueryChange(e.target.value)}
          placeholder="Search transcripts"
          className="field-input--full"
        />
        <SelectField
          value={props.selectedMode}
          onChange={(e) => props.onModeChange(e.target.value as 'all' | SavedTranscript['mode'])}
          className="field-select"
        >
          <option value="all">All modes</option>
          <option value="ptt">PTT</option>
          <option value="meeting">Meeting</option>
        </SelectField>
        <SelectField
          value={props.selectedSource}
          onChange={(e) => props.onSourceChange(e.target.value as 'all' | CaptureSource)}
          className="field-select"
        >
          <option value="all">All sources</option>
          <option value="microphone">Microphone</option>
          <option value="system">System</option>
        </SelectField>
        <SelectField
          value={props.selectedTimeFilter}
          onChange={(e) => props.onTimeFilterChange(e.target.value as HistoryTimeFilter)}
          className="field-select"
        >
          <option value="all">All time</option>
          <option value="today">Today</option>
          <option value="last_7_days">Last 7 days</option>
          <option value="last_30_days">Last 30 days</option>
        </SelectField>
      </div>

      <div
        className={`panel panel--split two-pane stack-20 ${sel ? 'two-pane--detail-open' : 'two-pane--list-only'}`}
      >
        <div className="record-list">
          {props.items.length === 0 ? (
            <div className="empty-copy">No matching transcripts.</div>
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
                  className={`list-row list-row--interactive ${isSelected ? 'list-row--selected' : ''}`}
                >
                  <div className="list-row__head">
                    <div className="list-row__title">{item.title}</div>
                    <div className="timeline-row__eyebrow">
                      {formatDateTime(item.startedAt)}
                    </div>
                  </div>
                  <div className="list-row__meta">
                    {item.mode} {'\u00B7'} {sources} {'\u00B7'} {formatDurationMs(item.endedAt - item.startedAt)}
                  </div>
                  <div className="list-row__preview">{item.plainText}</div>
                </div>
              )
            })
          )}
        </div>

        {sel ? (
          <div className="record-detail">
            <div className="detail-title">{sel.title}</div>
            <div className="detail-meta">
              <span>{sel.mode}</span>
              <span>{describeTranscriptSources(sel)}</span>
              <span>{formatDurationMs(sel.endedAt - sel.startedAt)}</span>
              <span>{sel.metadata.engineProfileId}</span>
            </div>

            <div className="inline-actions stack-12">
              <Button
                label="Copy text"
                disabled={Boolean(props.busyAction)}
                size="small"
                onClick={() => props.onCopy(sel.id, 'plain_text')}
              />
              <Button
                label="Copy bilingual"
                disabled={Boolean(props.busyAction)}
                size="small"
                onClick={() => props.onCopy(sel.id, 'bilingual_text')}
              />
              <Button
                label="Export text"
                disabled={Boolean(props.busyAction)}
                size="small"
                onClick={() => props.onExport(sel.id, 'plain_text')}
              />
              <Button
                label="Export bilingual"
                disabled={Boolean(props.busyAction)}
                size="small"
                onClick={() => props.onExport(sel.id, 'bilingual_text')}
              />
              <Button
                label="Export JSON"
                disabled={Boolean(props.busyAction)}
                size="small"
                onClick={() => props.onExport(sel.id, 'json')}
              />
              <Button
                label="Delete"
                disabled={Boolean(props.busyAction)}
                size="small"
                danger
                onClick={() => props.onDelete(sel.id)}
              />
            </div>

            {props.exportMessage ? (
              <div className="caption-text stack-8">{props.exportMessage}</div>
            ) : null}

            <div className="stack-16">
              <TextInput
                value={detailQuery}
                onChange={(e) => setDetailQuery(e.target.value)}
                placeholder="Search within blocks"
                className="field-input--full"
              />
              <div className="caption-text caption-text--spaced">
                {filteredBlocks.length} of {sel.blocks.length} blocks
              </div>
            </div>

            <div className="stack-12">
              {filteredBlocks.map((block) => (
                <div key={block.id} className="timeline-row">
                  <div className="timeline-row__eyebrow">
                    {block.source} {'\u00B7'} {formatTimeRange(block.startedAt, block.endedAt)}
                  </div>
                  <div className="timeline-row__body timeline-row__body--committed">{block.text}</div>
                  {block.translatedText ? (
                    <div className="timeline-row__secondary text-secondary">
                      {block.translatedText}
                    </div>
                  ) : null}
                </div>
              ))}
              {filteredBlocks.length === 0 ? (
                <div className="caption-text caption-text--padded">No blocks match.</div>
              ) : null}
            </div>
          </div>
        ) : null}
      </div>
    </div>
  )
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
