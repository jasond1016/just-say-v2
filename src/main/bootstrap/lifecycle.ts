export type AppLike = {
  whenReady(): Promise<void>
  on(event: 'window-all-closed', listener: () => void): void
  quit(): void
}

export type LifecycleOptions = {
  onReady: () => Promise<void>
  shouldQuitOnAllWindowsClosed?: boolean
}

export async function wireAppLifecycle(app: AppLike, options: LifecycleOptions): Promise<void> {
  await app.whenReady()
  await options.onReady()

  app.on('window-all-closed', () => {
    if (options.shouldQuitOnAllWindowsClosed ?? true) {
      app.quit()
    }
  })
}
