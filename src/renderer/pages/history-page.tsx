import type { ExportFormat, SavedTranscript } from '../../shared/api-types'

type Palette = {
  panel: string
  panelSoft: string
  text: string
  muted: string
  border: string
}

export function HistoryPage(props: {
  items: SavedTranscript[]
  total: number
  searchQuery: string
  selectedMode: 'all' | SavedTranscript['mode']
  selectedTranscript: SavedTranscript | null
  exportMessage: string | null
  busyAction: string | null
  palette: Palette
  onSearchQueryChange: (value: string) => void
  onModeChange: (value: 'all' | SavedTranscript['mode']) => void
  onOpen: (id: string) => void
  onDelete: (id: string) => void
  onExport: (id: string, format: ExportFormat) => void
}) {
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

      <div style={{ marginTop: 20, display: 'flex', gap: 12, flexWrap: 'wrap' }}>
        <input
          value={props.searchQuery}
          onChange={(event) => {
            props.onSearchQueryChange(event.target.value)
          }}
          placeholder="Search transcript text"
          style={{
            flex: '1 1 260px',
            borderRadius: 16,
            border: `1px solid ${props.palette.border}`,
            background: props.palette.panelSoft,
            color: props.palette.text,
            padding: '12px 14px'
          }}
        />
        <select
          value={props.selectedMode}
          onChange={(event) => {
            props.onModeChange(event.target.value as 'all' | SavedTranscript['mode'])
          }}
          style={{
            borderRadius: 16,
            border: `1px solid ${props.palette.border}`,
            background: props.palette.panelSoft,
            color: props.palette.text,
            padding: '12px 14px'
          }}
        >
          <option value="all">All Modes</option>
          <option value="ptt">PTT</option>
          <option value="meeting">Meeting</option>
        </select>
      </div>

      <div style={{ marginTop: 20, display: 'grid', gap: 12 }}>
        {props.items.length === 0 ? (
          <div style={{ color: props.palette.muted }}>No matching transcripts.</div>
        ) : (
          props.items.map((item) => (
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
                    {item.mode}
                  </div>
                  <div style={{ marginTop: 8, fontSize: 20, fontWeight: 700 }}>{item.title}</div>
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
          ))
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

          <div style={{ marginTop: 16, color: props.palette.muted }}>
            {props.selectedTranscript.mode} · {props.selectedTranscript.blocks.length} blocks
          </div>
          <div style={{ marginTop: 16, lineHeight: 1.6 }}>{props.selectedTranscript.plainText}</div>
          {props.selectedTranscript.translatedPlainText ? (
            <div style={{ marginTop: 12, lineHeight: 1.6, color: props.palette.muted }}>
              {props.selectedTranscript.translatedPlainText}
            </div>
          ) : null}
          {props.exportMessage ? (
            <div style={{ marginTop: 16, color: props.palette.muted }}>{props.exportMessage}</div>
          ) : null}
        </section>
      ) : null}
    </section>
  )
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
