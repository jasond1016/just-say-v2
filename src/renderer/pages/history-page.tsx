import { useEffect, useId, useMemo, useRef, useState } from 'react'

import type { ExportFormat, SavedTranscript } from '../../shared/api-types'
import type { CaptureSource } from '../../shared/primitive-types'
import { Button, TextInput } from '../ui/controls'
import { describeCaptureSource, describeProfileId, describeSessionMode, describeTranscriptSummary } from '../ui/copy'

type HistoryTimeFilter = 'all' | 'today' | 'last_7_days' | 'last_30_days'
type HistoryNotesState =
  | { status: 'idle' }
  | { status: 'generating' }
  | { status: 'failed'; message: string }
  | { status: 'ready'; generatedAt: number; notes: GeneratedNotes }

type GeneratedNotes = {
  overview: string
  decisions: string[]
  actionItems: string[]
}

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
  onOpenQuickDictation: () => void
  onOpenLiveSession: () => void
  onSearchQueryChange: (value: string) => void
  onModeChange: (value: 'all' | SavedTranscript['mode']) => void
  onSourceChange: (value: 'all' | CaptureSource) => void
  onTimeFilterChange: (value: HistoryTimeFilter) => void
  onOpen: (id: string) => void
  onCloseDetail: () => void
  onDelete: (id: string) => void
  onDeleteBulk?: (ids: string[]) => void
  onExportBulk?: (ids: string[], format: ExportFormat) => void
  onCopy: (id: string, format: ExportFormat) => void
  onExport: (id: string, format: ExportFormat) => void
}) {
  const headingId = useId()
  const [detailQuery, setDetailQuery] = useState('')
  const [detailView, setDetailView] = useState<'transcript' | 'notes'>('transcript')
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [notesStateById, setNotesStateById] = useState<Record<string, HistoryNotesState>>({})
  const [bulkMode, setBulkMode] = useState(false)
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const searchInputRef = useRef<HTMLInputElement | null>(null)
  const detailHeadingRef = useRef<HTMLDivElement | null>(null)
  const pendingNotesTimers = useRef<number[]>([])

  useEffect(() => {
    return () => {
      for (const timerId of pendingNotesTimers.current) {
        window.clearTimeout(timerId)
      }
    }
  }, [])

  useEffect(() => {
    setDetailQuery('')
    setDetailView('transcript')
    setConfirmDelete(false)
  }, [props.selectedTranscript?.id])

  useEffect(() => {
    if (!props.selectedTranscript) {
      return
    }

    detailHeadingRef.current?.focus()
  }, [props.selectedTranscript])

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'f') {
        event.preventDefault()

        if (props.selectedTranscript) {
          return
        }

        searchInputRef.current?.focus()
        searchInputRef.current?.select()
      }
    }

    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [props.selectedTranscript])

  const selectedTranscript = props.selectedTranscript
  const filteredBlocks = useMemo(() => {
    if (!selectedTranscript) return []
    const keyword = detailQuery.trim().toLowerCase()
    if (!keyword) return selectedTranscript.blocks

    return selectedTranscript.blocks.filter((block) =>
      [block.text, block.translatedText ?? '', block.speakerLabel ?? '']
        .some((value) => value.toLowerCase().includes(keyword))
    )
  }, [detailQuery, selectedTranscript])

  const notesState = selectedTranscript ? notesStateById[selectedTranscript.id] ?? { status: 'idle' as const } : null
  const hasActiveFilters =
    props.searchQuery.trim().length > 0 ||
    props.selectedMode !== 'all' ||
    props.selectedSource !== 'all' ||
    props.selectedTimeFilter !== 'all'

  const startGenerateNotes = (transcript: SavedTranscript) => {
    setNotesStateById((current) => ({
      ...current,
      [transcript.id]: { status: 'generating' }
    }))

    const timerId = window.setTimeout(() => {
      setNotesStateById((current) => ({
        ...current,
        [transcript.id]: buildNotesState(transcript)
      }))
    }, 900)

    pendingNotesTimers.current.push(timerId)
  }

  if (!selectedTranscript) {
    return (
      <div className="page page--wide">
        <header className="surface-header">
          <div className="surface-header__eyebrow">History</div>
          <div className="surface-header__row">
            <div className="surface-header__headline-group">
              <h1 className="surface-header__title">Archive</h1>
            </div>
            <div className="surface-header__meta">
              <span>{props.total} records</span>
              {props.items.length > 0 ? (
                <Button
                  label={bulkMode ? 'Done' : 'Select'}
                  variant="ghost"
                  size="small"
                  onClick={() => {
                    setBulkMode(!bulkMode)
                    setSelectedIds(new Set())
                  }}
                />
              ) : null}
            </div>
          </div>
          <p className="surface-header__body">
            Retrieve past dictation and meeting transcripts, then open one record as a document. The archive stays about finding and reopening, not monitoring.
          </p>
        </header>

        <section className="archive-controls" aria-labelledby={headingId}>
          <div className="archive-controls__search">
            <TextInput
              ref={searchInputRef}
              value={props.searchQuery}
              onChange={(event) => props.onSearchQueryChange(event.target.value)}
              placeholder="Search transcripts"
              ariaLabel="Search transcripts"
              className="field-input--full archive-search"
            />
          </div>

          <div className="archive-filter-row">
            <FilterGroup
              label="Mode"
              options={[
                { value: 'all', label: 'All' },
                { value: 'ptt', label: 'Quick Dictation' },
                { value: 'meeting', label: 'Live Session' }
              ]}
              selected={props.selectedMode}
              onSelect={(value) => props.onModeChange(value as 'all' | SavedTranscript['mode'])}
            />
            <FilterGroup
              label="Source"
              options={[
                { value: 'all', label: 'All sources' },
                { value: 'microphone', label: 'Microphone' },
                { value: 'system', label: 'System audio' }
              ]}
              selected={props.selectedSource}
              onSelect={(value) => props.onSourceChange(value as 'all' | CaptureSource)}
            />
            <FilterGroup
              label="Time"
              options={[
                { value: 'all', label: 'All time' },
                { value: 'today', label: 'Today' },
                { value: 'last_7_days', label: '7 days' },
                { value: 'last_30_days', label: '30 days' }
              ]}
              selected={props.selectedTimeFilter}
              onSelect={(value) => props.onTimeFilterChange(value as HistoryTimeFilter)}
            />
            {hasActiveFilters ? (
              <Button
                label="Clear filters"
                variant="ghost"
                size="small"
                onClick={() => {
                  props.onSearchQueryChange('')
                  props.onModeChange('all')
                  props.onSourceChange('all')
                  props.onTimeFilterChange('all')
                }}
              />
            ) : null}
          </div>
        </section>

        <section className="archive-list" aria-labelledby={headingId}>
          <div id={headingId} className="sr-only">Archive results</div>

          {bulkMode && selectedIds.size > 0 ? (
            <div className="archive-bulk-bar" role="toolbar" aria-label="Bulk actions">
              <div className="archive-bulk-bar__info">{selectedIds.size} selected</div>
              <div className="archive-bulk-bar__actions">
                <Button
                  label="Export selected"
                  size="small"
                  variant="secondary"
                  disabled={Boolean(props.busyAction)}
                  onClick={() => {
                    if (props.onExportBulk) {
                      props.onExportBulk([...selectedIds], 'plain_text')
                    }
                  }}
                />
                <Button
                  label="Delete selected"
                  size="small"
                  variant="secondary"
                  danger
                  disabled={Boolean(props.busyAction)}
                  onClick={() => {
                    if (props.onDeleteBulk) {
                      props.onDeleteBulk([...selectedIds])
                      setSelectedIds(new Set())
                    }
                  }}
                />
                <Button
                  label="Cancel"
                  size="small"
                  variant="ghost"
                  onClick={() => {
                    setBulkMode(false)
                    setSelectedIds(new Set())
                  }}
                />
              </div>
            </div>
          ) : null}

          {props.items.length === 0 ? (
            <div className="empty-state empty-state--archive" role="status" aria-live="polite">
              <div className="empty-state__title">
                {hasActiveFilters ? 'No transcripts match these filters.' : 'No transcripts yet.'}
              </div>
              <p className="empty-state__body">
                {hasActiveFilters
                  ? 'Clear filters or search for a broader phrase to see more of the archive again.'
                  : 'Finished dictation and live sessions will land here automatically after capture is done.'}
              </p>
              {!hasActiveFilters ? (
                <div className="empty-state__actions">
                  <Button label="Open quick dictation" size="small" onClick={props.onOpenQuickDictation} />
                  <Button label="Open live session" size="small" variant="secondary" onClick={props.onOpenLiveSession} />
                </div>
              ) : null}
            </div>
          ) : (
            props.items.map((item) => {
              const isSelected = selectedIds.has(item.id)
              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => {
                    if (bulkMode) {
                      setSelectedIds((prev) => {
                        const next = new Set(prev)
                        if (next.has(item.id)) {
                          next.delete(item.id)
                        } else {
                          next.add(item.id)
                        }
                        return next
                      })
                    } else {
                      props.onOpen(item.id)
                    }
                  }}
                  className={`archive-row ${bulkMode ? 'archive-row--selectable' : ''} ${isSelected ? 'archive-row--selected' : ''}`}
                >
                  {bulkMode ? (
                    <div className="archive-row__check">
                      <div className={`archive-row__checkbox ${isSelected ? 'archive-row__checkbox--checked' : ''}`} />
                    </div>
                  ) : null}
                  <div>
                    <div className="archive-row__head">
                      <div className="archive-row__title">{item.title}</div>
                      <div className="archive-row__time">{formatArchiveTime(item.startedAt)}</div>
                    </div>
                    <div className="archive-row__meta">
                      <span>{describeTranscriptSummary(item)}</span>
                      <span>{formatDurationMs(item.endedAt - item.startedAt)}</span>
                    </div>
                    <div className="archive-row__preview">{item.plainText}</div>
                  </div>
                </button>
              )
            })
          )}
        </section>
      </div>
    )
  }

  return (
    <div className="page page--wide">
      <header className="detail-header">
        <button type="button" className="detail-header__back" onClick={props.onCloseDetail}>
          Back to archive
        </button>
        <div className="surface-header__row">
          <div className="surface-header__headline-group">
            <div id={headingId} className="surface-header__title" ref={detailHeadingRef} tabIndex={-1}>
              {selectedTranscript.title}
            </div>
          </div>
          <div className="surface-header__meta">{formatArchiveTime(selectedTranscript.startedAt)}</div>
        </div>
        <div className="detail-header__meta">
          <span>{describeSessionMode(selectedTranscript.mode)}</span>
          <span>{describeTranscriptSources(selectedTranscript)}</span>
          <span>{formatDurationMs(selectedTranscript.endedAt - selectedTranscript.startedAt)}</span>
          <span>Preset: {describeProfileId(selectedTranscript.metadata.engineProfileId)}</span>
        </div>
        <p className="surface-header__body">
          The transcript is the source document. Notes are derived from it and stay in the same place without replacing the original record.
        </p>
      </header>

      <section className="session-span" aria-label="Transcript timing">
        <div className="session-span__button" aria-hidden="true">●</div>
        <div className="session-span__track">
          <div className="session-span__meta">
            <span>Session span</span>
            <span>{formatDurationMs(selectedTranscript.endedAt - selectedTranscript.startedAt)}</span>
          </div>
          <div className="session-span__bar" />
        </div>
      </section>

      <section className="detail-toolbar">
        <div className="detail-tabs" role="tablist" aria-label="Record views">
          <button
            type="button"
            className={`detail-tab ${detailView === 'transcript' ? 'detail-tab--active' : ''}`}
            aria-selected={detailView === 'transcript'}
            onClick={() => setDetailView('transcript')}
          >
            Transcript
          </button>
          <button
            type="button"
            className={`detail-tab ${detailView === 'notes' ? 'detail-tab--active' : ''}`}
            aria-selected={detailView === 'notes'}
            onClick={() => setDetailView('notes')}
          >
            Notes
          </button>
        </div>

        <div className="detail-toolbar__actions">
          {detailView === 'notes' && notesState?.status === 'ready' ? (
            <Button
              label="Regenerate notes"
              size="small"
              variant="secondary"
              disabled={Boolean(props.busyAction)}
              onClick={() => startGenerateNotes(selectedTranscript)}
            />
          ) : null}

          <details className="quiet-details">
            <summary className="quiet-details__summary">
              <span>More</span>
              <span>Copy, export, delete</span>
            </summary>
            <div className="quiet-details__body">
              <Button
                label="Copy text"
                disabled={Boolean(props.busyAction)}
                size="small"
                onClick={() => props.onCopy(selectedTranscript.id, 'plain_text')}
              />
              <Button
                label="Copy bilingual"
                disabled={Boolean(props.busyAction)}
                size="small"
                onClick={() => props.onCopy(selectedTranscript.id, 'bilingual_text')}
              />
              <Button
                label="Export text"
                disabled={Boolean(props.busyAction)}
                size="small"
                onClick={() => props.onExport(selectedTranscript.id, 'plain_text')}
              />
              <Button
                label="Export bilingual"
                disabled={Boolean(props.busyAction)}
                size="small"
                onClick={() => props.onExport(selectedTranscript.id, 'bilingual_text')}
              />
              <Button
                label="Export JSON"
                disabled={Boolean(props.busyAction)}
                size="small"
                onClick={() => props.onExport(selectedTranscript.id, 'json')}
              />
              <Button
                label="Delete record"
                danger
                disabled={Boolean(props.busyAction)}
                size="small"
                onClick={() => setConfirmDelete(true)}
              />
            </div>
          </details>
        </div>
      </section>

      {confirmDelete ? (
        <div className="inline-note inline-note--danger" role="alert">
          <div>Delete this record permanently? This cannot be undone.</div>
          <div className="inline-note__actions">
            <Button label="Keep record" size="small" variant="ghost" onClick={() => setConfirmDelete(false)} />
            <Button
              label="Delete now"
              size="small"
              danger
              onClick={() => {
                setConfirmDelete(false)
                props.onDelete(selectedTranscript.id)
              }}
            />
          </div>
        </div>
      ) : null}

      {props.exportMessage ? (
        <div className="inline-note inline-note--neutral" role="status" aria-live="polite">
          {props.exportMessage}
        </div>
      ) : null}

      {detailView === 'transcript' ? (
        <>
          <section className="detail-search">
            <TextInput
              value={detailQuery}
              onChange={(event) => setDetailQuery(event.target.value)}
              placeholder="Search within this transcript"
              ariaLabel="Search within this transcript"
              className="field-input--full detail-search__input"
            />
            <div className="detail-search__count">
              {filteredBlocks.length} of {selectedTranscript.blocks.length} lines
            </div>
          </section>

          <section className="transcript-canvas transcript-canvas--history">
            <div className="transcript-stack">
              {filteredBlocks.map((block) => (
                <article key={block.id} className="transcript-entry">
                  <div className="transcript-entry__time">{formatClockTime(block.startedAt)}</div>
                  <div className="transcript-entry__body">
                    <div className="transcript-entry__meta">
                      <span>{describeCaptureSource(block.source)}</span>
                      {block.speakerLabel ? <span>{block.speakerLabel}</span> : null}
                    </div>
                    <div className="transcript-entry__primary">{block.text}</div>
                    {block.translatedText ? (
                      <div className="transcript-entry__secondary">{block.translatedText}</div>
                    ) : null}
                  </div>
                </article>
              ))}
              {filteredBlocks.length === 0 ? (
                <div className="empty-inline" role="status" aria-live="polite">
                  No lines match that search.
                </div>
              ) : null}
            </div>
          </section>
        </>
      ) : (
        <section className="notes-canvas">
          {notesState?.status === 'idle' ? (
            <div className="notes-state">
              <div className="notes-state__eyebrow">Not generated yet</div>
              <div className="notes-state__title">No notes yet for this transcript.</div>
              <p className="notes-state__body">
                Generate one readable notes view that merges summary, decisions, and follow-up items while leaving the source transcript untouched.
              </p>
              <div className="notes-state__actions">
                <Button
                  label="Generate notes"
                  variant="primary"
                  size="small"
                  disabled={Boolean(props.busyAction)}
                  onClick={() => startGenerateNotes(selectedTranscript)}
                />
              </div>
            </div>
          ) : null}

          {notesState?.status === 'generating' ? (
            <div className="notes-state">
              <div className="notes-state__eyebrow">Generating</div>
              <div className="notes-state__title">Building notes from the transcript.</div>
              <p className="notes-state__body">
                The transcript stays available in the other tab while JustSay condenses the conversation into a lighter derived view.
              </p>
              <div className="notes-dots" aria-hidden="true">
                <span />
                <span />
                <span />
              </div>
            </div>
          ) : null}

          {notesState?.status === 'failed' ? (
            <div className="notes-state">
              <div className="notes-state__eyebrow">Generation failed</div>
              <div className="notes-state__title">Notes could not be generated this time.</div>
              <p className="notes-state__body">
                {notesState.message}
              </p>
              <div className="notes-state__actions">
                <Button
                  label="Try again"
                  variant="primary"
                  size="small"
                  disabled={Boolean(props.busyAction)}
                  onClick={() => startGenerateNotes(selectedTranscript)}
                />
                <Button
                  label="Back to transcript"
                  variant="ghost"
                  size="small"
                  onClick={() => setDetailView('transcript')}
                />
              </div>
            </div>
          ) : null}

          {notesState?.status === 'ready' ? (
            <div className="notes-stack">
              <div className="notes-state__eyebrow">Generated {formatRelativeTime(notesState.generatedAt)}</div>
              <section className="notes-card">
                <div className="notes-card__eyebrow">Overview</div>
                <div className="notes-card__title">{notesState.notes.overview}</div>
              </section>
              <section className="notes-card">
                <div className="notes-card__eyebrow">Decisions</div>
                <ul className="notes-list">
                  {notesState.notes.decisions.map((decision) => (
                    <li key={decision}>{decision}</li>
                  ))}
                </ul>
              </section>
              <section className="notes-card">
                <div className="notes-card__eyebrow">Action Items</div>
                <ul className="notes-list">
                  {notesState.notes.actionItems.map((action) => (
                    <li key={action}>{action}</li>
                  ))}
                </ul>
              </section>
            </div>
          ) : null}
        </section>
      )}
    </div>
  )
}

function FilterGroup(props: {
  label: string
  options: Array<{ value: string; label: string }>
  selected: string
  onSelect: (value: string) => void
}) {
  return (
    <div className="filter-group" aria-label={props.label}>
      <span className="filter-group__label">{props.label}</span>
      <div className="filter-group__chips">
        {props.options.map((option) => (
          <button
            key={option.value}
            type="button"
            className={`filter-chip ${props.selected === option.value ? 'filter-chip--active' : ''}`}
            onClick={() => props.onSelect(option.value)}
          >
            {option.label}
          </button>
        ))}
      </div>
    </div>
  )
}

function buildNotesState(transcript: SavedTranscript): HistoryNotesState {
  if (transcript.blocks.length < 2 || transcript.plainText.trim().length < 80) {
    return {
      status: 'failed',
      message: 'This transcript is too short to produce a useful notes view yet. Stay in Transcript or try again after capturing a longer session.'
    }
  }

  return {
    status: 'ready',
    generatedAt: Date.now(),
    notes: generateNotes(transcript)
  }
}

function generateNotes(transcript: SavedTranscript): GeneratedNotes {
  const lines = transcript.blocks
    .map((block) => block.text.trim())
    .filter(Boolean)
  const overviewSource = lines.slice(0, 2).join(' ').trim()
  const decisions = pickLines(lines, [/should/i, /need/i, /decid/i, /plan/i, /应该/, /需要/, /决定/, /改成/, /保留/, /去掉/], 3)
  const actionItems = pickLines(lines, [/next/i, /follow/i, /action/i, /send/i, /review/i, /安排/, /确认/, /处理/, /导出/, /生成/], 3)

  return {
    overview: overviewSource.length > 180 ? `${overviewSource.slice(0, 180).trim()}...` : overviewSource,
    decisions,
    actionItems
  }
}

function pickLines(lines: string[], patterns: RegExp[], limit: number): string[] {
  const preferred = lines.filter((line) => patterns.some((pattern) => pattern.test(line)))
  const fallback = lines.filter((line) => !preferred.includes(line))
  return [...preferred, ...fallback].slice(0, limit)
}

function describeTranscriptSources(transcript: SavedTranscript): string {
  const sources = [...new Set(transcript.blocks.map((block) => describeCaptureSource(block.source)))]
  return sources.length === 0 ? 'Unknown source' : sources.join(' + ')
}

function formatArchiveTime(timestamp: number): string {
  return new Date(timestamp).toLocaleString([], {
    month: 'short',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit'
  })
}

function formatClockTime(timestamp: number): string {
  return new Date(timestamp).toLocaleTimeString([], {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit'
  })
}

function formatDurationMs(durationMs: number): string {
  const totalSeconds = Math.max(0, Math.floor(durationMs / 1000))
  const hours = Math.floor(totalSeconds / 3600)
  const minutes = Math.floor((totalSeconds % 3600) / 60)
  const seconds = totalSeconds % 60

  if (hours > 0) {
    return `${hours}h ${minutes}m ${seconds}s`
  }

  return `${minutes}m ${seconds}s`
}

function formatRelativeTime(timestamp: number): string {
  const deltaSec = Math.max(0, Math.floor((Date.now() - timestamp) / 1000))

  if (deltaSec < 60) {
    return 'just now'
  }

  const minutes = Math.floor(deltaSec / 60)
  if (minutes < 60) {
    return `${minutes}m ago`
  }

  const hours = Math.floor(minutes / 60)
  return `${hours}h ago`
}
