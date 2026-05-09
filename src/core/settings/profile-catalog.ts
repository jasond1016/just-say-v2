import type { EngineProfile } from '../../shared/api-types'

export const profileCatalog = [
  {
    id: 'local-fast',
    label: 'Local Fast',
    kind: 'local',
    preset: 'local-fast',
    capabilities: {
      streaming: true,
      translation: false,
      wordTiming: true,
      speakerSeparation: false,
      requiresNetwork: false,
      requiresLocalService: true
    }
  },
  {
    id: 'local-accurate',
    label: 'Local Accurate',
    kind: 'local',
    preset: 'local-accurate',
    capabilities: {
      streaming: true,
      translation: false,
      wordTiming: true,
      speakerSeparation: true,
      requiresNetwork: false,
      requiresLocalService: true
    }
  },
  {
    id: 'cloud-low-latency',
    label: 'Cloud Low Latency',
    kind: 'cloud',
    preset: 'cloud-low-latency',
    capabilities: {
      streaming: true,
      translation: false,
      wordTiming: true,
      speakerSeparation: true,
      requiresNetwork: true,
      requiresLocalService: false
    }
  },
  {
    id: 'cloud-low-cost',
    label: 'Cloud Low Cost',
    kind: 'cloud',
    preset: 'cloud-low-cost',
    capabilities: {
      streaming: true,
      translation: false,
      wordTiming: false,
      speakerSeparation: false,
      requiresNetwork: true,
      requiresLocalService: false
    }
  }
] satisfies EngineProfile[]

export const exposedProfileCatalog = profileCatalog.filter((profile) => profile.kind === 'local')

export function getProfileById(profileId: string): EngineProfile | undefined {
  return profileCatalog.find((profile) => profile.id === profileId)
}

export function getExposedProfileById(profileId: string): EngineProfile | undefined {
  return exposedProfileCatalog.find((profile) => profile.id === profileId)
}
