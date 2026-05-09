import type { SavedTranscript } from '../../shared/api-types'

type Palette = {
  panel: string
  panelSoft: string
  text: string
  muted: string
  border: string
}

export function HistoryPage(props: {
  items: SavedTranscript[]
  searchQuery: string
  selectedMode: 'all' | SavedTranscript['mode']
  busyAction: string | null
  palette: Palette
  onSearchQueryChange: (value: string) => void
  onModeChange: (value: 'all' | SavedTranscript['mode']) => void
  onDelete: (id: string) => void
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
        <div style={{ color: props.palette.muted }}>{props.items.length} records</div>
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
                <button
                  type="button"
                  disabled={Boolean(props.busyAction)}
                  onClick={() => {
                    props.onDelete(item.id)
                  }}
                  style={{
                    border: '1px solid rgba(255, 255, 255, 0.12)',
                    borderRadius: 999,
                    padding: '10px 14px',
                    background: 'transparent',
                    color: 'inherit',
                    cursor: props.busyAction ? 'not-allowed' : 'pointer'
                  }}
                >
                  {props.busyAction === `delete:${item.id}` ? 'Deleting...' : 'Delete'}
                </button>
              </div>
              <div style={{ marginTop: 10, lineHeight: 1.5 }}>{item.plainText}</div>
              {item.translatedPlainText ? (
                <div style={{ marginTop: 8, color: props.palette.muted, lineHeight: 1.5 }}>{item.translatedPlainText}</div>
              ) : null}
            </article>
          ))
        )}
      </div>
    </section>
  )
}
