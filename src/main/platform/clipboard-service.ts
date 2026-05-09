export interface ClipboardLike {
  writeText(text: string): void
}

export class ElectronClipboardService {
  constructor(private readonly clipboardLike?: ClipboardLike) {}

  async writeText(text: string): Promise<void> {
    const clipboardLike = this.clipboardLike ?? loadElectronClipboard()
    clipboardLike.writeText(text)
  }
}

function loadElectronClipboard(): ClipboardLike {
  const electron = require('electron') as { clipboard: ClipboardLike }
  return electron.clipboard
}
