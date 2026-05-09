import type { AppSettings } from '../../shared/api-types'
import type { HotkeyService } from '../platform/hotkey-service'
import type { SessionCoordinator } from './session-coordinator'

export interface HotkeySettingsProvider {
  getSettings(): Promise<AppSettings>
  onChanged(listener: (settings: AppSettings) => void): () => void
}

export class PttHotkeyController {
  private unsubscribeSettings: (() => void) | null = null

  constructor(
    private readonly hotkeyService: HotkeyService,
    private readonly settingsProvider: HotkeySettingsProvider,
    private readonly sessionCoordinator: SessionCoordinator
  ) {}

  async start(): Promise<void> {
    await this.applySettings(await this.settingsProvider.getSettings())
    this.unsubscribeSettings = this.settingsProvider.onChanged((settings) => {
      void this.applySettings(settings)
    })
  }

  dispose(): void {
    this.unsubscribeSettings?.()
    this.unsubscribeSettings = null
    this.hotkeyService.dispose()
  }

  private async applySettings(settings: AppSettings): Promise<void> {
    await this.hotkeyService.setPttBinding({
      pttHotkey: settings.input.pttHotkey,
      onPressed: async () => {
        await this.runSafely(() => this.sessionCoordinator.startPtt())
      },
      onReleased: async () => {
        await this.runSafely(() => this.sessionCoordinator.stopPtt())
      }
    })
  }

  private async runSafely(action: () => Promise<void>): Promise<void> {
    try {
      await action()
    } catch {
      // Ignore invalid edge-triggered transitions so the global hook does not crash the app.
    }
  }
}
