import type { EngineProfile } from '../../shared/api-types'
import type { RecognitionEngine } from '../../core/contracts/engine'

export type EngineFactory = (profile: EngineProfile) => RecognitionEngine

export class EngineRegistry {
  constructor(
    private readonly profiles: readonly EngineProfile[],
    private readonly createEngine: EngineFactory
  ) {}

  getProfileCatalog(): EngineProfile[] {
    return this.profiles.map((profile) => ({
      ...profile,
      capabilities: {
        ...profile.capabilities
      }
    }))
  }

  getProfileById(profileId: string): EngineProfile | undefined {
    return this.profiles.find((profile) => profile.id === profileId)
  }

  createForProfile(profile: EngineProfile): RecognitionEngine {
    return this.createEngine(profile)
  }
}
