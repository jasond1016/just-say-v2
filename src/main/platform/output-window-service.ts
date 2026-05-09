export interface OutputWindowLike {
  loadURL(url: string): Promise<void> | void
  show(): void
  focus?(): void
}

export class OutputWindowService {
  constructor(
    private readonly createWindow: () => OutputWindowLike = createDefaultOutputWindow
  ) {}

  async showText(text: string): Promise<void> {
    const window = this.createWindow()
    const escapedText = escapeHtml(text).replace(/\n/g, '<br />')
    await window.loadURL(
      `data:text/html;charset=utf-8,${encodeURIComponent(`
        <html>
          <body style="margin:0;padding:24px;background:#10161f;color:#eef4ff;font:16px/1.5 Segoe UI, sans-serif;">
            <div style="font-size:12px;letter-spacing:0.12em;text-transform:uppercase;color:#9ab0ca;">PTT Output</div>
            <div style="margin-top:16px;white-space:normal;">${escapedText}</div>
          </body>
        </html>
      `)}`
    )
    window.show()
    window.focus?.()
  }
}

function createDefaultOutputWindow(): OutputWindowLike {
  const { BrowserWindow } = require('electron') as {
    BrowserWindow: new (options: Record<string, unknown>) => OutputWindowLike
  }

  return new BrowserWindow({
    width: 520,
    height: 320,
    title: 'JustSay Output',
    autoHideMenuBar: true,
    backgroundColor: '#10161f',
    show: false
  })
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}
