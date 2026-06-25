import { Ellipsis, Pause, Play, Volume1, Volume2, VolumeX } from 'lucide-react'
import { useEffect, useId, useRef, useState, type ChangeEvent, type CSSProperties } from 'react'

import type { HistoryAudioPlayback } from '../../shared/api-types'
import { useT } from '../i18n-context'
import { appIconProps } from './icons'

const PLAYBACK_RATES = [0.75, 1, 1.25, 1.5, 2] as const

const AUDIO_BAR_ICON_PROPS = appIconProps(18, 'archive-audio-bar__icon')

type VolumeLevel = 'muted' | 'low' | 'high'

function VolumeLevelIcon(props: { level: VolumeLevel }) {
  if (props.level === 'muted') {
    return <VolumeX {...AUDIO_BAR_ICON_PROPS} />
  }

  if (props.level === 'low') {
    return <Volume1 {...AUDIO_BAR_ICON_PROPS} />
  }

  return <Volume2 {...AUDIO_BAR_ICON_PROPS} />
}

function resolveVolumeLevel(volume: number): VolumeLevel {
  if (volume < 0.05) {
    return 'muted'
  }

  if (volume < 0.5) {
    return 'low'
  }

  return 'high'
}

export function formatPlaybackClock(totalSeconds: number): string {
  if (!Number.isFinite(totalSeconds) || totalSeconds < 0) {
    return '0:00'
  }

  const seconds = Math.floor(totalSeconds)
  const minutes = Math.floor(seconds / 60)
  const remainder = seconds % 60
  return `${minutes}:${String(remainder).padStart(2, '0')}`
}

export function ArchiveAudioBar(props: { playback: HistoryAudioPlayback }) {
  const t = useT()
  const audioRef = useRef<HTMLAudioElement | null>(null)
  const menuRef = useRef<HTMLDivElement | null>(null)
  const menuId = useId()
  const [isPlaying, setIsPlaying] = useState(false)
  const [currentTime, setCurrentTime] = useState(0)
  const [duration, setDuration] = useState(0)
  const [volume, setVolume] = useState(1)
  const [lastVolume, setLastVolume] = useState(1)
  const [playbackRate, setPlaybackRate] = useState(1)
  const [menuOpen, setMenuOpen] = useState(false)

  useEffect(() => {
    const audio = audioRef.current
    if (!audio) {
      return
    }

    const syncDuration = () => {
      setDuration(Number.isFinite(audio.duration) ? audio.duration : 0)
    }
    const syncTime = () => {
      setCurrentTime(audio.currentTime)
    }
    const handlePlay = () => {
      setIsPlaying(true)
    }
    const handlePause = () => {
      setIsPlaying(false)
    }
    const handleEnded = () => {
      setIsPlaying(false)
      setCurrentTime(0)
    }

    syncDuration()
    syncTime()
    audio.addEventListener('loadedmetadata', syncDuration)
    audio.addEventListener('durationchange', syncDuration)
    audio.addEventListener('timeupdate', syncTime)
    audio.addEventListener('play', handlePlay)
    audio.addEventListener('pause', handlePause)
    audio.addEventListener('ended', handleEnded)

    return () => {
      audio.removeEventListener('loadedmetadata', syncDuration)
      audio.removeEventListener('durationchange', syncDuration)
      audio.removeEventListener('timeupdate', syncTime)
      audio.removeEventListener('play', handlePlay)
      audio.removeEventListener('pause', handlePause)
      audio.removeEventListener('ended', handleEnded)
    }
  }, [props.playback.url])

  useEffect(() => {
    const audio = audioRef.current
    if (!audio) {
      return
    }

    audio.pause()
    audio.currentTime = 0
    setIsPlaying(false)
    setCurrentTime(0)
    setDuration(0)
    setVolume(1)
    setLastVolume(1)
  }, [props.playback.url])

  useEffect(() => {
    const audio = audioRef.current
    if (!audio) {
      return
    }

    audio.volume = volume
  }, [volume])

  useEffect(() => {
    const audio = audioRef.current
    if (!audio) {
      return
    }

    audio.playbackRate = playbackRate
  }, [playbackRate])

  useEffect(() => {
    if (!menuOpen) {
      return
    }

    const onPointerDown = (event: PointerEvent) => {
      const menu = menuRef.current
      if (!menu || !(event.target instanceof Node) || menu.contains(event.target)) {
        return
      }

      setMenuOpen(false)
    }

    window.addEventListener('pointerdown', onPointerDown)
    return () => window.removeEventListener('pointerdown', onPointerDown)
  }, [menuOpen])

  const togglePlay = () => {
    const audio = audioRef.current
    if (!audio) {
      return
    }

    if (audio.paused) {
      void audio.play()
      return
    }

    audio.pause()
  }

  const handleSeek = (event: ChangeEvent<HTMLInputElement>) => {
    const audio = audioRef.current
    if (!audio) {
      return
    }

    const nextTime = Number(event.target.value)
    audio.currentTime = nextTime
    setCurrentTime(nextTime)
  }

  const selectPlaybackRate = (rate: number) => {
    setPlaybackRate(rate)
    setMenuOpen(false)
  }

  const handleVolumeChange = (event: ChangeEvent<HTMLInputElement>) => {
    const nextVolume = Number(event.target.value)
    setVolume(nextVolume)
    if (nextVolume > 0) {
      setLastVolume(nextVolume)
    }
  }

  const toggleMute = () => {
    if (volume > 0) {
      setLastVolume(volume)
      setVolume(0)
      return
    }

    setVolume(lastVolume > 0 ? lastVolume : 0.8)
  }

  const progressPercent = duration > 0 ? (currentTime / duration) * 100 : 0
  const volumePercent = volume * 100
  const volumeLevel = resolveVolumeLevel(volume)

  return (
    <div className="archive-audio-bar" role="group" aria-label={t.archiveAudioPlayer}>
      <audio
        ref={audioRef}
        className="archive-audio-bar__media"
        preload="metadata"
        src={props.playback.url}
      />

      <div className="archive-audio-bar__inner">
        <button
          type="button"
          className="archive-audio-bar__play"
          aria-label={isPlaying ? t.archiveAudioPause : t.archiveAudioPlay}
          onClick={togglePlay}
        >
          {isPlaying ? <Pause {...AUDIO_BAR_ICON_PROPS} /> : <Play {...AUDIO_BAR_ICON_PROPS} />}
        </button>

        <div className="archive-audio-bar__time" aria-live="off">
          <span>{formatPlaybackClock(currentTime)}</span>
          <span className="archive-audio-bar__time-sep">/</span>
          <span>{formatPlaybackClock(duration)}</span>
        </div>

        <div className="archive-audio-bar__progress-wrap">
          <div
            className="archive-audio-bar__progress-rail"
            style={{ '--archive-audio-progress': `${progressPercent}%` } as CSSProperties}
          >
            <input
              type="range"
              className="archive-audio-bar__progress"
              min={0}
              max={duration > 0 ? duration : 1}
              step={0.1}
              value={duration > 0 ? currentTime : 0}
              disabled={duration <= 0}
              aria-label={t.archiveAudioSeek}
              onChange={handleSeek}
            />
          </div>
        </div>

        <div className="archive-audio-bar__volume">
          <button
            type="button"
            className="archive-audio-bar__icon-btn"
            aria-label={volumeLevel === 'muted' ? t.archiveAudioUnmute : t.archiveAudioMute}
            aria-pressed={volumeLevel === 'muted'}
            onClick={toggleMute}
          >
            <VolumeLevelIcon level={volumeLevel} />
          </button>

          <div
            className="archive-audio-bar__volume-rail"
            style={{ '--archive-audio-volume': `${volumePercent}%` } as CSSProperties}
          >
            <input
              type="range"
              className="archive-audio-bar__volume-slider"
              min={0}
              max={1}
              step={0.01}
              value={volume}
              aria-label={t.archiveAudioVolume}
              onChange={handleVolumeChange}
            />
          </div>
        </div>

        <div ref={menuRef} className={`archive-audio-bar__menu-wrap ${menuOpen ? 'archive-audio-bar__menu-wrap--open' : ''}`}>
          <button
            type="button"
            className="archive-audio-bar__icon-btn archive-audio-bar__more-btn"
            aria-haspopup="menu"
            aria-expanded={menuOpen}
            aria-controls={menuOpen ? menuId : undefined}
            aria-label={t.archiveAudioMore}
            onClick={() => setMenuOpen((current) => !current)}
          >
            <Ellipsis {...AUDIO_BAR_ICON_PROPS} />
          </button>

          {menuOpen ? (
            <div id={menuId} className="archive-audio-bar__menu" role="menu">
              <div className="archive-audio-bar__menu-label">{t.archiveAudioSpeed}</div>
              {PLAYBACK_RATES.map((rate) => (
                <button
                  key={rate}
                  type="button"
                  role="menuitemradio"
                  aria-checked={playbackRate === rate}
                  className={`archive-audio-bar__menu-item ${playbackRate === rate ? 'archive-audio-bar__menu-item--active' : ''}`}
                  onClick={() => selectPlaybackRate(rate)}
                >
                  {rate === 1 ? '1×' : `${rate}×`}
                </button>
              ))}
            </div>
          ) : null}
        </div>
      </div>
    </div>
  )
}
