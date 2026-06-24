import { useEffect, useId, useMemo, useRef, useState, type RefObject } from 'react'

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
import { useT } from '../i18n-context'

type HistoryTimeFilter = 'all' | 'today' | 'last_7_days' | 'last_30_days'
const ITEMS_PER_PAGE = 15
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
  onRenameTitle: (id: string, title: string) => void
  onExportBulk?: (ids: string[], format: ExportFormat) => void
  onCopy: (id: string, format: ExportFormat) => void
  onExport: (id: string, format: ExportFormat) => void
  onGenerateNotes: (id: string, options?: HistoryNotesGenerateOptions) => void
}) {
  const t = useT()
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
  const detailHeadingRef = useRef<HTMLHeadingElement | null>(null)
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

  const [modeTab, setModeTab] = useState<'all' | 'ptt' | 'meeting'>('all')
  const pttCount = props.items.filter((item) => item.mode === 'ptt').length
  const meetingCount = props.items.filter((item) => item.mode === 'meeting').length
  const displayItems = modeTab === 'all'
    ? props.items
    : props.items.filter((item) => item.mode === modeTab)
  const [currentPage, setCurrentPage] = useState(1)

  useEffect(() => {
    setCurrentPage(1)
  }, [props.searchQuery, modeTab, props.selectedSource, props.selectedTimeFilter])

  const totalPages = Math.max(1, Math.ceil(displayItems.length / ITEMS_PER_PAGE))
  const pageItems = displayItems.slice(
    (currentPage - 1) * ITEMS_PER_PAGE,
    currentPage * ITEMS_PER_PAGE
  )

  if (!selectedTranscript) {
    return (
      <>
        <div className="page page--wide archive-page">
          <header className="archive-header">
            <h1 className="page-title">Archive</h1>
            <div className="archive-header__toolbar">
              <TextInput
                ref={searchInputRef}
                value={props.searchQuery}
                onChange={(event) => props.onSearchQueryChange(event.target.value)}
                placeholder={t.archiveSearchPlaceholder}
                ariaLabel={t.archiveSearchPlaceholder}
                className="field-input--full archive-search-input"
              />
            </div>
          </header>

          <div className="archive-tabs" role="tablist" aria-label="Filter by mode">
            <button
              type="button"
              role="tab"
              className={`archive-tab ${modeTab === 'all' ? 'archive-tab--active' : ''}`}
              aria-selected={modeTab === 'all'}
              onClick={() => setModeTab('all')}
            >
              {t.archiveTabAll} <span className="archive-tab__count">{props.items.length}</span>
            </button>
            <button
              type="button"
              role="tab"
              className={`archive-tab ${modeTab === 'ptt' ? 'archive-tab--active' : ''}`}
              aria-selected={modeTab === 'ptt'}
              onClick={() => setModeTab('ptt')}
            >
              PTT <span className="archive-tab__count">{pttCount}</span>
            </button>
            <button
              type="button"
              role="tab"
              className={`archive-tab ${modeTab === 'meeting' ? 'archive-tab--active' : ''}`}
              aria-selected={modeTab === 'meeting'}
              onClick={() => setModeTab('meeting')}
            >
              {t.archiveTabMeeting} <span className="archive-tab__count">{meetingCount}</span>
            </button>
          </div>

          <section className="archive-table-wrap" aria-labelledby={headingId}>
            <div id={headingId} className="sr-only">Archive results</div>

            {bulkMode ? (
              <div className="archive-bulk-bar" role="toolbar" aria-label="Bulk actions">
                <div className="archive-bulk-bar__info">
                  <div>{t.archiveBulkSelected(selectedCount)}</div>
                  <div className="archive-bulk-bar__hint">
                    {selectedCount > 0
                      ? t.archiveBulkActionHint
                      : t.archiveBulkSelectHint}
                  </div>
                </div>
                <div className="archive-bulk-bar__actions">
                  {props.onExportBulk ? (
                    <Button
                      label={t.archiveBulkExport(selectedCount)}
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
                      label={t.archiveBulkDelete(selectedCount)}
                      size="small"
                      variant="secondary"
                      danger
                      disabled={Boolean(props.busyAction) || selectedCount === 0}
                      onClick={() => setConfirmBulkDelete(true)}
                    />
                  ) : null}
                  <Button
                    label={t.archiveBulkCancel}
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

            {displayItems.length === 0 ? (
              <div className="empty-state empty-state--archive" role="status" aria-live="polite">
                <div className="empty-state__title">
                  {hasActiveFilters || modeTab !== 'all' ? t.archiveEmptyFilterHint : t.archiveEmptyList}
                </div>
                <p className="empty-state__body">
                  {hasActiveFilters || modeTab !== 'all'
                    ? t.archiveEmptyFilterBody
                    : t.archiveEmptyListHint}
                </p>
                {!hasActiveFilters && modeTab === 'all' ? (
                  <div className="empty-state__actions">
                    <Button label={t.archiveOpenQuickDictation} size="small" onClick={props.onOpenQuickDictation} />
                    <Button label={t.archiveOpenLiveSession} size="small" variant="secondary" onClick={props.onOpenLiveSession} />
                  </div>
                ) : null}
              </div>
            ) : (
              <>
                <table className="archive-table">
                  <thead>
                    <tr>
                      {bulkMode ? <th className="archive-table__th-check"></th> : null}
                      <th className="archive-table__th-title">{t.archiveThTitle}</th>
                      <th className="archive-table__th-time">{t.archiveThTime}</th>
                      <th className="archive-table__th-duration">{t.archiveThDuration}</th>
                      <th className="archive-table__th-type">{t.archiveThType}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {pageItems.map((item) => {
                      const isSelected = selectedIds.has(item.id)
                      return (
                        <tr
                          key={item.id}
                          className={`archive-table__row ${isSelected ? 'archive-table__row--selected' : ''}`}
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
                        >
                          {bulkMode ? (
                            <td className="archive-table__td-check">
                              <div className={`archive-row__checkbox ${isSelected ? 'archive-row__checkbox--checked' : ''}`} />
                            </td>
                          ) : null}
                          <td className="archive-table__td-title">{item.title}</td>
                          <td className="archive-table__td-time">{formatArchiveTime(item.startedAt)}</td>
                          <td className="archive-table__td-duration">{formatDurationMs(item.endedAt - item.startedAt)}</td>
                          <td className="archive-table__td-type">
                            <span className={`archive-badge ${item.mode === 'ptt' ? 'archive-badge--ptt' : 'archive-badge--meeting'}`}>
                              {item.mode === 'ptt' ? 'PTT' : t.archiveTypeMeeting}
                            </span>
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>

                {totalPages > 1 ? (
                  <nav className="archive-pagination" aria-label="Pagination">
                    <button
                      type="button"
                      className="archive-pagination__btn"
                      disabled={currentPage <= 1}
                      onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
                      aria-label="Previous page"
                    >
                      ←
                    </button>
                    {buildPageNumbers(currentPage, totalPages).map((page, index) =>
                      page === '...' ? (
                        <span key={`ellipsis-${index}`} className="archive-pagination__ellipsis">...</span>
                      ) : (
                        <button
                          key={page}
                          type="button"
                          className={`archive-pagination__btn ${page === currentPage ? 'archive-pagination__btn--active' : ''}`}
                          onClick={() => setCurrentPage(page as number)}
                        >
                          {page}
                        </button>
                      )
                    )}
                    <button
                      type="button"
                      className="archive-pagination__btn"
                      disabled={currentPage >= totalPages}
                      onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
                      aria-label="Next page"
                    >
                      →
                    </button>
                  </nav>
                ) : null}
              </>
            )}
          </section>
        </div>
        {deleteDialog}
      </>
    )
  }

  return (
    <>
      <div className="page page--wide archive-detail">
        <header className="archive-detail__header">
          <div className="archive-detail__top-row">
            <button type="button" className="archive-detail__back" onClick={props.onCloseDetail}>
              <span aria-hidden="true">←</span> {t.archiveBackToList}
            </button>
            <div className="archive-detail__top-actions">
              <button
                type="button"
                className="archive-detail__export-btn"
                disabled={Boolean(props.busyAction)}
                onClick={() => props.onExport(selectedTranscript.id, 'plain_text')}
              >
                <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
                  <path d="M8 1v9m0 0L5 7m3 3 3-3M2 11v2a2 2 0 0 0 2 2h8a2 2 0 0 0 2-2v-2" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
                </svg>
                {t.archiveExport}
              </button>
              <div
                ref={actionMenuRef}
                className={`detail-actions-menu ${actionMenuOpen ? 'detail-actions-menu--open' : ''}`}
              >
                <button
                  type="button"
                  className="archive-detail__more-btn"
                  aria-haspopup="true"
                  aria-expanded={actionMenuOpen}
                  aria-controls={actionMenuOpen ? actionMenuId : undefined}
                  onClick={() => setActionMenuOpen((current) => !current)}
                  aria-label="More actions"
                >
                  ···
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
          </div>

          <ArchiveDetailTitle
            title={selectedTranscript.title}
            headingId={headingId}
            headingRef={detailHeadingRef}
            disabled={Boolean(props.busyAction)}
            onRename={(title) => props.onRenameTitle(selectedTranscript.id, title)}
          />

          <div className="archive-detail__meta">
            <span className="archive-detail__meta-item">
              <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true">
                <rect x="2" y="3" width="12" height="11" rx="2" stroke="currentColor" strokeWidth="1.2"/>
                <path d="M5 1v3M11 1v3M2 7h12" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round"/>
              </svg>
              {formatArchiveDate(selectedTranscript.startedAt)}
            </span>
            <span className="archive-detail__meta-sep">·</span>
            <span className="archive-detail__meta-item">
              <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true">
                <circle cx="8" cy="8" r="6" stroke="currentColor" strokeWidth="1.2"/>
                <path d="M8 5v3.5l2.5 1.5" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round"/>
              </svg>
              {formatDurationMs(selectedTranscript.endedAt - selectedTranscript.startedAt)}
            </span>
            <span className="archive-detail__meta-sep">·</span>
            <span className={`archive-badge ${selectedTranscript.mode === 'ptt' ? 'archive-badge--ptt' : 'archive-badge--meeting'}`}>
              {selectedTranscript.mode === 'ptt' ? 'PTT' : t.archiveTypeMeeting}
            </span>
            <span className="archive-detail__meta-sep">·</span>
            <span className="archive-detail__meta-item archive-detail__meta-status">
              <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true">
                <circle cx="8" cy="8" r="6" stroke="currentColor" strokeWidth="1.2"/>
                <path d="M5.5 8l2 2 3.5-3.5" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round"/>
              </svg>
              {t.archiveArchived}
            </span>
          </div>
        </header>

        <div className="archive-detail__tabs" role="tablist" aria-label="Record views">
          <button
            type="button"
            role="tab"
            className={`archive-tab ${detailView === 'transcript' ? 'archive-tab--active' : ''}`}
            aria-selected={detailView === 'transcript'}
            onClick={() => setDetailView('transcript')}
          >
            {selectedTranscript.mode === 'meeting' ? t.archiveTabTranscriptMeeting : t.archiveTabTranscriptPtt}
          </button>
          <button
            type="button"
            role="tab"
            className={`archive-tab ${detailView === 'notes' ? 'archive-tab--active' : ''}`}
            aria-selected={detailView === 'notes'}
            onClick={() => setDetailView('notes')}
          >
            {t.archiveTabNotes}
          </button>
        </div>

        {props.exportMessage ? (
          <div className="inline-note inline-note--neutral" role="status" aria-live="polite">
            {props.exportMessage}
          </div>
        ) : null}

        {detailView === 'transcript' ? (
          <section className="archive-detail__transcript">
            <div className="archive-detail__transcript-stack">
              {filteredBlocks.map((block) => (
                <article key={block.id} className="archive-transcript-entry">
                  <div className="archive-transcript-entry__time">
                    {formatRelativeTimestamp(block.startedAt, selectedTranscript.startedAt)}
                  </div>
                  <div className="archive-transcript-entry__body">
                    <div className="archive-transcript-entry__primary">
                      {block.speakerLabel ? (
                        <strong className="archive-transcript-entry__speaker">{block.speakerLabel}：</strong>
                      ) : null}
                      {block.text}
                    </div>
                    {block.translatedText ? (
                      <div className="archive-transcript-entry__secondary">{block.translatedText}</div>
                    ) : null}
                  </div>
                </article>
              ))}
              {filteredBlocks.length === 0 ? (
                <div className="empty-inline" role="status" aria-live="polite">
                  {t.noMatchingLines}
                </div>
              ) : null}
            </div>
          </section>
        ) : (
          <section className="notes-canvas">
            {notesState?.status === 'idle' ? (
              <div className="notes-state">
                <div className="notes-state__eyebrow">{t.notesNotGenerated}</div>
                <div className="notes-state__title">{t.notesNotGeneratedTitle}</div>
                <p className="notes-state__body">
                  {t.notesNotGeneratedBody}
                </p>
                <div className="notes-state__actions">
                  <Button
                    label={t.notesGenerate}
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
                  {notesState.status === 'loading' ? t.notesLoading : t.notesGenerating}
                </div>
                <div className="notes-state__title">
                  {notesState.status === 'loading' ? t.notesLoadingTitle : t.notesGeneratingTitle}
                </div>
                <p className="notes-state__body">
                  {notesState.status === 'loading'
                    ? t.notesLoadingBody
                    : t.notesGeneratingBody}
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
                <div className="notes-state__eyebrow">{t.notesFailed}</div>
                <div className="notes-state__title">{t.notesFailedTitle}</div>
                <p className="notes-state__body">
                  {notesState.message}
                </p>
                <div className="notes-state__actions">
                  <Button
                    label={t.notesTryAgain}
                    variant="primary"
                    size="small"
                    disabled={Boolean(props.busyAction)}
                    onClick={() => props.onGenerateNotes(selectedTranscript.id, { force: true })}
                  />
                  <Button
                    label={t.notesBackToTranscript}
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
                  <div className="notes-card__eyebrow">{t.notesOverview}</div>
                  <div className="notes-overview">
                    {formatNotesOverview(notesState.notes.overview).map((paragraph, index) => (
                      <p key={`${paragraph}-${index}`}>{paragraph}</p>
                    ))}
                  </div>
                </section>
                <section className="notes-card">
                  <div className="notes-card__eyebrow">{t.notesDecisions}</div>
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
                  <div className="notes-card__eyebrow">{t.notesActionItems}</div>
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
                    <div className="notes-card__eyebrow">{t.notesOpenQuestions}</div>
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

        {selectedTranscript.mode === 'meeting' && selectedTranscript.metadata.audio && props.selectedAudio ? (
          <div className="archive-audio-bar">
            <audio
              className="archive-audio-bar__player"
              controls
              preload="metadata"
              src={props.selectedAudio.url}
            />
          </div>
        ) : null}
      </div>
      {deleteDialog}
    </>
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

function ArchiveDetailTitle(props: {
  title: string
  headingId: string
  headingRef: RefObject<HTMLHeadingElement | null>
  disabled: boolean
  onRename: (title: string) => void | Promise<void>
}) {
  const t = useT()
  const inputRef = useRef<HTMLInputElement | null>(null)
  const [isEditing, setIsEditing] = useState(false)
  const [draft, setDraft] = useState(props.title)

  useEffect(() => {
    setDraft(props.title)
    setIsEditing(false)
  }, [props.title])

  useEffect(() => {
    if (!isEditing) {
      return
    }

    inputRef.current?.focus()
    inputRef.current?.select()
  }, [isEditing])

  const cancelEditing = () => {
    setDraft(props.title)
    setIsEditing(false)
  }

  const commitEditing = () => {
    const nextTitle = draft.trim()

    if (!nextTitle || nextTitle === props.title) {
      cancelEditing()
      return
    }

    void Promise.resolve(props.onRename(nextTitle)).finally(() => {
      setIsEditing(false)
    })
  }

  const startEditing = () => {
    if (props.disabled) {
      return
    }

    setDraft(props.title)
    setIsEditing(true)
  }

  if (isEditing) {
    return (
      <div className="archive-detail__title-row">
        <input
          ref={inputRef}
          className="archive-detail__title-input page-title page-title--compact"
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              event.preventDefault()
              commitEditing()
            }

            if (event.key === 'Escape') {
              event.preventDefault()
              cancelEditing()
            }
          }}
          onBlur={commitEditing}
          maxLength={120}
          aria-label={t.archiveRenameTitle}
        />
      </div>
    )
  }

  return (
    <div className="archive-detail__title-row">
      <h1 className="page-title page-title--compact" id={props.headingId} ref={props.headingRef} tabIndex={-1}>
        {props.title}
      </h1>
      <button
        type="button"
        className="archive-detail__title-edit"
        aria-label={t.archiveRenameTitle}
        disabled={props.disabled}
        onClick={startEditing}
      >
        <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
          <path d="M11.5 2.5l2 2-8 8H3.5v-2l8-8z" stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round" />
        </svg>
      </button>
    </div>
  )
}


function formatArchiveTime(timestamp: number): string {
  return new Date(timestamp).toLocaleString([], {
    month: 'short',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit'
  })
}

function formatArchiveDate(timestamp: number): string {
  return new Date(timestamp).toLocaleString([], {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit'
  })
}

function formatRelativeTimestamp(blockTimestamp: number, sessionStart: number): string {
  const elapsed = Math.max(0, Math.floor((blockTimestamp - sessionStart) / 1000))
  const hours = Math.floor(elapsed / 3600)
  const minutes = Math.floor((elapsed % 3600) / 60)
  const seconds = elapsed % 60
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`
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

function buildPageNumbers(current: number, total: number): (number | '...')[] {
  if (total <= 7) {
    return Array.from({ length: total }, (_, i) => i + 1)
  }

  const pages: (number | '...')[] = [1]

  if (current > 3) {
    pages.push('...')
  }

  const start = Math.max(2, current - 1)
  const end = Math.min(total - 1, current + 1)

  for (let i = start; i <= end; i++) {
    pages.push(i)
  }

  if (current < total - 2) {
    pages.push('...')
  }

  pages.push(total)
  return pages
}
