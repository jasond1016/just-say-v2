import type { Session } from 'electron'

type DisplayMediaHandler = NonNullable<Parameters<Session['setDisplayMediaRequestHandler']>[0]>
type DisplayMediaRequest = Parameters<DisplayMediaHandler>[0]
type DisplayMediaCallback = Parameters<DisplayMediaHandler>[1]
type DisplayMediaGrant = Parameters<DisplayMediaCallback>[0]
type DisplayMediaVideo = NonNullable<DisplayMediaGrant['video']>

type DesktopCapturerLike = {
  getSources(options: {
    types: Array<'screen' | 'window'>
    thumbnailSize?: {
      width: number
      height: number
    }
  }): Promise<Array<{ id: string }>>
}

export function registerElectronDisplayMediaHandler(
  electronSession: Pick<Session, 'setDisplayMediaRequestHandler'>,
  capturer: DesktopCapturerLike
): void {
  electronSession.setDisplayMediaRequestHandler(
    async (_request: DisplayMediaRequest, callback: DisplayMediaCallback) => {
      try {
        const [primaryScreenSource] = await capturer.getSources({
          types: ['screen'],
          thumbnailSize: {
            width: 0,
            height: 0
          }
        })

        if (!primaryScreenSource) {
          callback({})
          return
        }

        callback({
          video: primaryScreenSource as DisplayMediaVideo,
          audio: 'loopback'
        } satisfies DisplayMediaGrant)
      } catch {
        callback({} satisfies DisplayMediaGrant)
      }
    },
    {
      useSystemPicker: false
    }
  )
}
