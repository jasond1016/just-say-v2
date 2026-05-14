import { useEffect, useId, useMemo, useRef, useState } from 'react'

import type {
  ExportFormat,
  HistoryAudioPlayback,
  HistoryNotesGenerateOptions,
  SavedTranscript,
  TranscriptNoteSourceRef,
  TranscriptNotes
} from '../../shared/api-types'
import type { CaptureSource } from '../../shared/primitive-types'
import { Button, TextInput } from '../ui/controls'
import { describeCaptureSource, describeProfileId, describeSessionMode, describeTranscriptSummary } from '../ui/copy'

type HistoryTimeFilter = 'all' | 'today' | 'last_7_days' | 'last_30_days'
type HistoryNotesState =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'generating' }
  | { status: 'failed'; message: string }
  | { status: 'ready'; notes: TranscriptNotes }

type ArchivePreview = {
  kind: 'opening' | 'match'
  text: string
}

type HistoryDetailActionId =
  | 'copy-text'
  | 'copy-bilingual'
  | 'export-text'
  | 'export-bilingual'
  | 'export-json'
  | 'delete-record'

type HistoryDetailActionGroup = {
  label: string
  items: Array<{
    id: HistoryDetailActionId
    label: string
    danger?: boolean
  }>
}

const ARCHIVE_PREVIEW_MAX_CHARS = 220
const ARCHIVE_PREVIEW_CONTEXT_BEFORE = 48
const ARCHIVE_PREVIEW_CONTEXT_AFTER = 128

export function HistoryPage(props: {
  items: SavedTranscript[]
  total: number
  searchQuery: string
  selectedMode: 'all' | SavedTranscript['mode']
  selectedSource: 'all' | CaptureSource
  selectedTimeFilter: HistoryTimeFilter
  selectedTranscript: SavedTranscript | null
  selectedAudio: HistoryAudioPlayback | null
  notesState: HistoryNotesState
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
  onDeleteBulk?: (ids: string[]) => Promise<void> | void
  onExportBulk?: (ids: string[], format: ExportFormat) => void
  onCopy: (id: string, format: ExportFormat) => void
  onExport: (id: string, format: ExportFormat) => void
  onGenerateNotes: (id: string, options?: HistoryNotesGenerateOptions) => void
}) {
  const headingId = useId()
  const actionMenuId = useId()
  const [detailQuery, setDetailQuery] = useState('')
  const [detailView, setDetailView] = useState<'transcript' | 'notes'>('transcript')
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [actionMenuOpen, setActionMenuOpen] = useState(false)
  const [bulkMode, setBulkMode] = useState(false)
  const [confirmBulkDelete, setConfirmBulkDelete] = useState(false)
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const searchInputRef = useRef<HTMLInputElement | null>(null)
  const detailHeadingRef = useRef<HTMLDivElement | null>(null)
  const actionMenuRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    setDetailQuery('')
    setDetailView('transcript')
    setConfirmDelete(false)
    setActionMenuOpen(false)
  }, [props.selectedTranscript?.id])

  useEffect(() => {
    if (!bulkMode || selectedIds.size === 0) {
      setConfirmBulkDelete(false)
    }
  }, [bulkMode, selectedIds])

  useEffect(() => {
    if (!props.selectedTranscript) {
      return
    }

    detailHeadingRef.current?.focus()
  }, [props.selectedTranscript])

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setActionMenuOpen(false)
        setConfirmDelete(false)
        setConfirmBulkDelete(false)
      }

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

  useEffect(() => {
    if (!actionMenuOpen) {
      return
    }

    const onPointerDown = (event: PointerEvent) => {
      const menu = actionMenuRef.current

      if (!menu || !(event.target instanceof Node) || menu.contains(event.target)) {
        return
      }

      setActionMenuOpen(false)
    }

    window.addEventListener('pointerdown', onPointerDown)
    return () => window.removeEventListener('pointerdown', onPointerDown)
  }, [actionMenuOpen])

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

  const notesState = selectedTranscript ? props.notesState : null
  const selectedCount = selectedIds.size
  const hasActiveFilters =
    props.searchQuery.trim().length > 0 ||
    props.selectedMode !== 'all' ||
    props.selectedSource !== 'all' ||
    props.selectedTimeFilter !== 'all'

  const closeActionMenu = () => setActionMenuOpen(false)
  const activeDeleteDialog =
    confirmDelete && selectedTranscript
      ? {
          title: formatDeleteDialogTitle(1),
          body: formatDeleteDialogBody(1, selectedTranscript.title),
          confirmLabel: formatDeleteConfirmationLabel(1),
          onConfirm: async () => {
            setConfirmDelete(false)
            props.onDelete(selectedTranscript.id)
          },
          onCancel: () => setConfirmDelete(false)
        }
      : confirmBulkDelete && selectedCount > 0
        ? {
            title: formatDeleteDialogTitle(selectedCount),
            body: formatDeleteDialogBody(selectedCount),
            confirmLabel: formatDeleteConfirmationLabel(selectedCount),
            onConfirm: async () => {
              setConfirmBulkDelete(false)

              if (!props.onDeleteBulk) {
                return
              }

              await props.onDeleteBulk([...selectedIds])
              setSelectedIds(new Set())
              setBulkMode(false)
            },
            onCancel: () => setConfirmBulkDelete(false)
          }
        : null
  const deleteDialog = activeDeleteDialog ? (
    <DeleteConfirmDialog
      title={activeDeleteDialog.title}
      body={activeDeleteDialog.body}
      confirmLabel={activeDeleteDialog.confirmLabel}
      busy={Boolean(props.busyAction)}
      onConfirm={() => { void activeDeleteDialog.onConfirm() }}
      onCancel={activeDeleteDialog.onCancel}
    />
  ) : null

  if (!selectedTranscript) {
    return (
      <>
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
                      setConfirmBulkDelete(false)
                    }}
                  />
                ) : null}
              </div>
            </div>

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

            {bulkMode ? (
              <div className="archive-bulk-bar" role="toolbar" aria-label="Bulk actions">
                <div className="archive-bulk-bar__info">
                  <div>{formatBulkSelectionSummary(selectedCount)}</div>
                  <div className="archive-bulk-bar__hint">
                    {selectedCount > 0
                      ? 'Pick an action for the selected records.'
                      : 'Select records from the list below to delete them together.'}
                  </div>
                </div>
                <div className="archive-bulk-bar__actions">
                  {props.onExportBulk ? (
                    <Button
                      label={selectedCount > 0 ? `Export ${selectedCount}` : 'Export selected'}
                      size="small"
                      variant="secondary"
                      disabled={Boolean(props.busyAction) || selectedCount === 0}
                      onClick={() => {
                        if (props.onExportBulk) {
                          props.onExportBulk([...selectedIds], 'plain_text')
                        }
                      }}
                    />
                  ) : null}
                  {props.onDeleteBulk ? (
                    <Button
                      label={formatBulkDeleteLabel(selectedCount)}
                      size="small"
                      variant="secondary"
                      danger
                      disabled={Boolean(props.busyAction) || selectedCount === 0}
                      onClick={() => setConfirmBulkDelete(true)}
                    />
                  ) : null}
                  <Button
                    label="Cancel"
                    size="small"
                    variant="ghost"
                    onClick={() => {
                      setBulkMode(false)
                      setSelectedIds(new Set())
                      setConfirmBulkDelete(false)
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
                const preview = getArchivePreview(item, props.searchQuery)
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
                    <div className="archive-row__content">
                      <div className="archive-row__head">
                        <div className="archive-row__title">{item.title}</div>
                        <div className="archive-row__time">{formatArchiveTime(item.startedAt)}</div>
                      </div>
                      <div className="archive-row__meta">
                        <span>{describeTranscriptSummary(item)}</span>
                        <span>{formatDurationMs(item.endedAt - item.startedAt)}</span>
                      </div>
                      {preview.kind === 'match' ? (
                        <div className="archive-row__preview-kicker">Search hit</div>
                      ) : null}
                      <div className="archive-row__preview">{preview.text}</div>
                    </div>
                  </button>
                )
              })
            )}
          </section>
        </div>
        {deleteDialog}
      </>
    )
  }

  return (
    <>
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

      {selectedTranscript.mode === 'meeting' && selectedTranscript.metadata.audio ? (
        <section className="history-audio" aria-label="Meeting audio">
          <div className="history-audio__meta">
            <div className="history-audio__eyebrow">Meeting audio</div>
            <div className="history-audio__row">
              <span className={`status-pill ${props.selectedAudio ? 'status-pill--saved' : 'status-pill--warning'}`}>
                {props.selectedAudio
                  ? selectedTranscript.metadata.audio.status === 'partial'
                    ? 'Partial audio'
                    : 'Complete audio'
                  : 'Audio unavailable'}
              </span>
              <span>{formatDurationMs(selectedTranscript.metadata.audio.durationMs)}</span>
              <span>{formatAudioSpec(selectedTranscript.metadata.audio.sampleRate, selectedTranscript.metadata.audio.channels)}</span>
            </div>
          </div>

          {props.selectedAudio ? (
            <audio
              className="history-audio__player"
              controls
              preload="metadata"
              src={props.selectedAudio.url}
            />
          ) : (
            <p className="history-audio__body">
              The transcript record still exists, but the saved meeting audio file is no longer available on disk.
            </p>
          )}
        </section>
      ) : null}

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
              onClick={() => props.onGenerateNotes(selectedTranscript.id, { force: true })}
            />
          ) : null}

          <div
            ref={actionMenuRef}
            className={`detail-actions-menu ${actionMenuOpen ? 'detail-actions-menu--open' : ''}`}
          >
            <button
              type="button"
              className="detail-actions-menu__trigger"
              aria-haspopup="true"
              aria-expanded={actionMenuOpen}
              aria-controls={actionMenuOpen ? actionMenuId : undefined}
              onClick={() => setActionMenuOpen((current) => !current)}
            >
              <span>Actions</span>
              <span aria-hidden="true" className="detail-actions-menu__chevron">v</span>
            </button>

            {actionMenuOpen ? (
              <div id={actionMenuId} className="detail-actions-menu__popover">
                {getHistoryDetailActionGroups().map((group) => (
                  <section key={group.label} className="detail-actions-menu__section" aria-label={group.label}>
                    <div className="detail-actions-menu__section-label">{group.label}</div>
                    <div className="detail-actions-menu__items">
                      {group.items.map((item) => (
                        <button
                          key={item.id}
                          type="button"
                          className={`detail-actions-menu__item ${item.danger ? 'detail-actions-menu__item--danger' : ''}`}
                          disabled={Boolean(props.busyAction)}
                          onClick={() => {
                            closeActionMenu()
                            runHistoryDetailAction(item.id, {
                              onCopy: (format) => props.onCopy(selectedTranscript.id, format),
                              onExport: (format) => props.onExport(selectedTranscript.id, format),
                              onDelete: () => setConfirmDelete(true)
                            })
                          }}
                        >
                          {item.label}
                        </button>
                      ))}
                    </div>
                  </section>
                ))}
              </div>
            ) : null}
          </div>
        </div>
      </section>

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
                  onClick={() => props.onGenerateNotes(selectedTranscript.id)}
                />
              </div>
            </div>
          ) : null}

          {notesState?.status === 'loading' || notesState?.status === 'generating' ? (
            <div className="notes-state">
              <div className="notes-state__eyebrow">
                {notesState.status === 'loading' ? 'Loading' : 'Generating'}
              </div>
              <div className="notes-state__title">
                {notesState.status === 'loading' ? 'Loading saved notes for this transcript.' : 'Building notes from the transcript.'}
              </div>
              <p className="notes-state__body">
                {notesState.status === 'loading'
                  ? 'If a notes snapshot already exists, it will appear here without changing the underlying transcript.'
                  : 'The transcript stays available in the other tab while JustSay condenses the conversation into a lighter derived view.'}
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
                  onClick={() => props.onGenerateNotes(selectedTranscript.id, { force: true })}
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
              <div className="notes-state__eyebrow">
                Generated {formatRelativeTime(notesState.notes.generatedAt)} · {notesState.notes.model}
              </div>
              <section className="notes-card">
                <div className="notes-card__eyebrow">Overview</div>
                <div className="notes-overview">
                  {formatNotesOverview(notesState.notes.overview).map((paragraph, index) => (
                    <p key={`${paragraph}-${index}`}>{paragraph}</p>
                  ))}
                </div>
              </section>
              <section className="notes-card">
                <div className="notes-card__eyebrow">Decisions</div>
                <ul className="notes-list">
                  {notesState.notes.decisions.map((decision, index) => (
                    <li key={`${decision.summary}-${index}`}>
                      <div>{decision.summary}</div>
                      {decision.sourceRefs.length > 0 ? (
                        <div className="notes-list__meta">{formatNotesSourceRefs(decision.sourceRefs)}</div>
                      ) : null}
                    </li>
                  ))}
                </ul>
              </section>
              <section className="notes-card">
                <div className="notes-card__eyebrow">Action Items</div>
                <ul className="notes-list">
                  {notesState.notes.actionItems.map((action, index) => (
                    <li key={`${action.task}-${index}`}>
                      <div>{action.task}</div>
                      <div className="notes-list__meta">
                        {buildActionItemMeta(action.owner, action.due, action.sourceRefs)}
                      </div>
                    </li>
                  ))}
                </ul>
              </section>
              {notesState.notes.openQuestions.length > 0 ? (
                <section className="notes-card">
                  <div className="notes-card__eyebrow">Open Questions</div>
                  <ul className="notes-list">
                    {notesState.notes.openQuestions.map((question, index) => (
                      <li key={`${question.question}-${index}`}>
                        <div>{question.question}</div>
                        {question.sourceRefs.length > 0 ? (
                          <div className="notes-list__meta">{formatNotesSourceRefs(question.sourceRefs)}</div>
                        ) : null}
                      </li>
                    ))}
                  </ul>
                </section>
              ) : null}
            </div>
          ) : null}
        </section>
      )}
      </div>
      {deleteDialog}
    </>
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

export function getArchivePreview(transcript: SavedTranscript, query: string): ArchivePreview {
  const normalizedQuery = normalizeWhitespace(query).toLowerCase()

  if (normalizedQuery) {
    for (const candidate of getArchivePreviewCandidates(transcript)) {
      const normalizedCandidate = normalizeWhitespace(candidate)
      const matchIndex = normalizedCandidate.toLowerCase().indexOf(normalizedQuery)

      if (matchIndex >= 0) {
        return {
          kind: 'match',
          text: buildContextSnippet(normalizedCandidate, matchIndex, normalizedQuery.length)
        }
      }
    }
  }

  return {
    kind: 'opening',
    text: buildOpeningPreview(transcript)
  }
}

export function getHistoryDetailActionGroups(): HistoryDetailActionGroup[] {
  return [
    {
      label: 'Copy',
      items: [
        { id: 'copy-text', label: 'Copy text' },
        { id: 'copy-bilingual', label: 'Copy bilingual' }
      ]
    },
    {
      label: 'Export',
      items: [
        { id: 'export-text', label: 'Export text' },
        { id: 'export-bilingual', label: 'Export bilingual' },
        { id: 'export-json', label: 'Export JSON' }
      ]
    },
    {
      label: 'Danger',
      items: [
        { id: 'delete-record', label: 'Delete record', danger: true }
      ]
    }
  ]
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

function formatAudioSpec(sampleRate: number, channels: number): string {
  const channelLabel = channels === 1 ? 'Mono' : `${channels}ch`
  return `${sampleRate / 1000} kHz · ${channelLabel}`
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

export function formatNotesOverview(overview: string): string[] {
  const explicitParagraphs = overview
    .split(/\r?\n+/)
    .map((paragraph) => paragraph.trim())
    .filter(Boolean)

  if (explicitParagraphs.length > 1) {
    return explicitParagraphs
  }

  const normalized = overview.replace(/\s+/g, ' ').trim()

  if (!normalized) {
    return []
  }

  const sentences = splitOverviewSentences(normalized)

  if (sentences.length <= 1) {
    return [normalized]
  }

  const paragraphs: string[] = []
  let current = ''
  let sentenceCount = 0

  for (const sentence of sentences) {
    const next = current ? joinOverviewSentences(current, sentence) : sentence

    if (current && (next.length > 72 || sentenceCount >= 2)) {
      paragraphs.push(current)
      current = sentence
      sentenceCount = 1
      continue
    }

    current = next
    sentenceCount += 1
  }

  if (current) {
    paragraphs.push(current)
  }

  return paragraphs
}

export function formatBulkSelectionSummary(selectedCount: number): string {
  return selectedCount === 0 ? 'Select records' : `${selectedCount} selected`
}

export function formatBulkDeleteLabel(selectedCount: number): string {
  if (selectedCount === 0) {
    return 'Delete selected'
  }

  return selectedCount === 1 ? 'Delete record' : `Delete ${selectedCount} records`
}

export function formatDeleteDialogTitle(selectedCount: number): string {
  return selectedCount === 1 ? 'Delete record?' : `Delete ${selectedCount} records?`
}

export function formatDeleteDialogBody(selectedCount: number, recordTitle?: string): string {
  if (selectedCount === 1) {
    return recordTitle
      ? `"${recordTitle}" will be removed from history permanently. This cannot be undone.`
      : 'This record will be removed from history permanently. This cannot be undone.'
  }

  return 'These records will be removed from history permanently. This cannot be undone.'
}

export function formatDeleteConfirmationLabel(selectedCount: number): string {
  return selectedCount === 1 ? 'Delete record' : `Delete ${selectedCount} records`
}

function DeleteConfirmDialog(props: {
  title: string
  body: string
  confirmLabel: string
  busy: boolean
  onConfirm: () => void
  onCancel: () => void
}) {
  const titleId = useId()

  return (
    <div className="confirm-modal" role="presentation">
      <button
        type="button"
        className="confirm-modal__backdrop"
        aria-label="Close delete confirmation"
        onClick={props.onCancel}
      />
      <div className="confirm-modal__dialog" role="dialog" aria-modal="true" aria-labelledby={titleId}>
        <div className="confirm-modal__eyebrow">Delete</div>
        <div id={titleId} className="confirm-modal__title">{props.title}</div>
        <div className="confirm-modal__body">{props.body}</div>
        <div className="confirm-modal__actions">
          <Button label="Cancel" size="small" variant="ghost" disabled={props.busy} onClick={props.onCancel} />
          <Button label={props.confirmLabel} size="small" danger disabled={props.busy} onClick={props.onConfirm} />
        </div>
      </div>
    </div>
  )
}

function splitOverviewSentences(text: string): string[] {
  const sentences: string[] = []
  let current = ''

  for (const character of text) {
    current += character

    if (/[。！？!?；;]/.test(character)) {
      const trimmed = current.trim()

      if (trimmed) {
        sentences.push(trimmed)
      }

      current = ''
    }
  }

  const trailing = current.trim()

  if (trailing) {
    sentences.push(trailing)
  }

  return sentences
}

function joinOverviewSentences(current: string, next: string): string {
  const needsSpace = /[A-Za-z0-9]$/.test(current) && /^[A-Za-z0-9]/.test(next)
  return `${current}${needsSpace ? ' ' : ''}${next}`
}

function buildActionItemMeta(
  owner: string | undefined,
  due: string | undefined,
  sourceRefs: TranscriptNoteSourceRef[]
): string {
  return [
    owner ? `Owner: ${owner}` : null,
    due ? `Due: ${due}` : null,
    sourceRefs.length > 0 ? formatNotesSourceRefs(sourceRefs) : null
  ]
    .filter(Boolean)
    .join(' · ')
}

function formatNotesSourceRefs(sourceRefs: TranscriptNoteSourceRef[]): string {
  return `Source: ${sourceRefs.map((sourceRef) => formatClockTime(sourceRef.startedAt)).join(', ')}`
}

function getArchivePreviewCandidates(transcript: SavedTranscript): string[] {
  const blockCandidates = transcript.blocks.flatMap((block) => [
    block.text,
    block.translatedText ?? '',
    block.speakerLabel ?? ''
  ])

  return [...blockCandidates, transcript.plainText]
    .map((value) => normalizeWhitespace(value))
    .filter(Boolean)
}

function buildOpeningPreview(transcript: SavedTranscript): string {
  const openingSource = transcript.blocks
    .map((block) => normalizeWhitespace(block.text))
    .filter(Boolean)
    .slice(0, 3)
    .join(' ')

  return truncateArchivePreview(openingSource || normalizeWhitespace(transcript.plainText) || 'Open this transcript to read it in full.')
}

function buildContextSnippet(source: string, matchIndex: number, queryLength: number): string {
  const start = Math.max(0, matchIndex - ARCHIVE_PREVIEW_CONTEXT_BEFORE)
  const end = Math.min(source.length, matchIndex + queryLength + ARCHIVE_PREVIEW_CONTEXT_AFTER)
  const prefix = start > 0 ? '...' : ''
  const suffix = end < source.length ? '...' : ''

  return truncateArchivePreview(`${prefix}${source.slice(start, end).trim()}${suffix}`)
}

function truncateArchivePreview(text: string): string {
  if (text.length <= ARCHIVE_PREVIEW_MAX_CHARS) {
    return text
  }

  return `${text.slice(0, ARCHIVE_PREVIEW_MAX_CHARS).trim()}...`
}

function normalizeWhitespace(value: string): string {
  return value.replace(/\s+/g, ' ').trim()
}

function runHistoryDetailAction(
  actionId: HistoryDetailActionId,
  handlers: {
    onCopy: (format: ExportFormat) => void
    onExport: (format: ExportFormat) => void
    onDelete: () => void
  }
) {
  switch (actionId) {
    case 'copy-text':
      handlers.onCopy('plain_text')
      return
    case 'copy-bilingual':
      handlers.onCopy('bilingual_text')
      return
    case 'export-text':
      handlers.onExport('plain_text')
      return
    case 'export-bilingual':
      handlers.onExport('bilingual_text')
      return
    case 'export-json':
      handlers.onExport('json')
      return
    case 'delete-record':
      handlers.onDelete()
      return
    default:
      return assertNever(actionId)
  }
}

function assertNever(value: never): never {
  throw new Error(`Unhandled history detail action: ${String(value)}`)
}
