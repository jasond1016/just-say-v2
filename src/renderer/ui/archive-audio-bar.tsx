import { useEffect, useId, useRef, useState, type ChangeEvent, type CSSProperties } from 'react'

import type { HistoryAudioPlayback } from '../../shared/api-types'
import { useT } from '../i18n-context'

const PLAYBACK_RATES = [0.75, 1, 1.25, 1.5, 2] as const

type VolumeLevel = 'muted' | 'low' | 'high'

export function VolumeIcon(props: { level: VolumeLevel }) {
  return (
    <svg className="archive-audio-bar__icon" width="18" height="18" viewBox="0 0 20 20" fill="none" aria-hidden="true">
      <path
        d="M5.25 8.25h2.2l3.8-2.35v8.2l-3.8-2.35h-2.2v-3.5Z"
        fill="currentColor"
      />
      {props.level === 'low' ? (
        <path
          d="M12.75 8.1a2.9 2.9 0 0 1 0 3.8"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinecap="round"
        />
      ) : null}
      {props.level === 'high' ? (
        <>
          <path
            d="M12.6 8a3.2 3.2 0 0 1 0 4"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
          />
          <path
            d="M15.1 5.8a6.2 6.2 0 0 1 0 8.4"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
          />
        </>
      ) : null}
      {props.level === 'muted' ? (
        <path
          d="M12.8 8.1 16.2 11.5M16.2 8.1 12.8 11.5"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinecap="round"
        />
      ) : null}
    </svg>
  )
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
          {isPlaying ? (
            <svg width="18" height="18" viewBox="0 0 16 16" fill="none" aria-hidden="true">
              <rect x="3" y="2.5" width="3.5" height="11" rx="0.8" fill="currentColor" />
              <rect x="9.5" y="2.5" width="3.5" height="11" rx="0.8" fill="currentColor" />
            </svg>
          ) : (
            <svg width="18" height="18" viewBox="0 0 16 16" fill="none" aria-hidden="true">
              <path d="M4 2.8v10.4l9.2-5.2L4 2.8Z" fill="currentColor" />
            </svg>
          )}
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
            <VolumeIcon level={volumeLevel} />
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
            ···
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
