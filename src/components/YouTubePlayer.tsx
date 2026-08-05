import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react';

declare global {
  interface Window {
    YT?: any;
    onYouTubeIframeAPIReady?: () => void;
  }
}

export interface PlayerHandle {
  play: () => void;
  pause: () => void;
  seek: (seconds: number) => void;
  currentTime: () => number;
  duration: () => number;
  state: () => number;
  videoId: () => string;
  setVolume: (volume: number) => void;
  activate: () => void;
}

interface Props {
  videoId?: string;
  startSeconds?: number;
  autoPlay?: boolean;
  embedMode?: 'private' | 'standard';
  onReady?: () => void;
  onCued?: (videoId: string) => void;
  onPlaying?: (videoId: string) => void;
  onEnded?: () => void;
  onError?: (code: number) => void;
  onAutoplayBlocked?: () => void;
}

let apiPromise: Promise<any> | null = null;

function loadApi(): Promise<any> {
  if (window.YT?.Player) return Promise.resolve(window.YT);
  if (apiPromise) return apiPromise;
  apiPromise = new Promise((resolve) => {
    const previous = window.onYouTubeIframeAPIReady;
    window.onYouTubeIframeAPIReady = () => {
      previous?.();
      resolve(window.YT);
    };
    if (!document.querySelector('script[src="https://www.youtube.com/iframe_api"]')) {
      const script = document.createElement('script');
      script.src = 'https://www.youtube.com/iframe_api';
      document.head.appendChild(script);
    }
  });
  return apiPromise;
}

function buildEmbedUrl(videoId: string | undefined, startSeconds: number, embedMode: 'private' | 'standard'): string {
  const params = new URLSearchParams({
    enablejsapi: '1',
    autoplay: '0',
    controls: '0',
    playsinline: '1',
    rel: '0',
    origin: window.location.origin,
  });
  if (startSeconds > 0) params.set('start', String(Math.floor(startSeconds)));
  const host = embedMode === 'private' ? 'www.youtube-nocookie.com' : 'www.youtube.com';
  return `https://${host}/embed/${encodeURIComponent(videoId ?? '')}?${params}`;
}

export const YouTubePlayer = forwardRef<PlayerHandle, Props>(function YouTubePlayer(
  { videoId, startSeconds = 0, autoPlay = false, embedMode = 'private', onReady, onCued, onPlaying, onEnded, onError, onAutoplayBlocked },
  forwardedRef,
) {
  const mountRef = useRef<HTMLDivElement>(null);
  const playerRef = useRef<any>(null);
  const iframeId = useRef(`syncbox-youtube-${Math.random().toString(36).slice(2)}`).current;
  const latestCallbacks = useRef({ onReady, onCued, onPlaying, onEnded, onError, onAutoplayBlocked });
  const initialVideo = useRef({ videoId, startSeconds, embedMode });
  const latestStartSeconds = useRef(startSeconds);
  const [ready, setReady] = useState(false);
  latestCallbacks.current = { onReady, onCued, onPlaying, onEnded, onError, onAutoplayBlocked };
  latestStartSeconds.current = startSeconds;

  useImperativeHandle(forwardedRef, () => ({
    play: () => playerRef.current?.playVideo?.(),
    pause: () => playerRef.current?.pauseVideo?.(),
    seek: (seconds) => playerRef.current?.seekTo?.(Math.max(0, seconds), true),
    currentTime: () => Number(playerRef.current?.getCurrentTime?.() ?? 0),
    duration: () => Number(playerRef.current?.getDuration?.() ?? 0),
    state: () => Number(playerRef.current?.getPlayerState?.() ?? -1),
    videoId: () => String(playerRef.current?.getVideoData?.()?.video_id ?? ''),
    setVolume: (volume) => playerRef.current?.setVolume?.(Math.min(100, Math.max(0, volume))),
    activate: () => {
      playerRef.current?.unMute?.();
      playerRef.current?.playVideo?.();
    },
  }), []);

  useEffect(() => {
    let disposed = false;
    const mount = mountRef.current;
    if (!mount) return undefined;

    // Start in the isolated privacy mode. Recovery may deliberately fall back
    // to the standard embed when YouTube needs normal client identification.
    const iframe = document.createElement('iframe');
    iframe.id = iframeId;
    iframe.title = 'YouTube video player';
    iframe.width = '100%';
    iframe.height = '100%';
    iframe.setAttribute('frameborder', '0');
    if (initialVideo.current.embedMode === 'private') iframe.setAttribute('credentialless', '');
    iframe.setAttribute('sandbox', 'allow-scripts allow-same-origin allow-presentation');
    iframe.setAttribute('allow', 'accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; fullscreen; web-share');
    iframe.setAttribute('allowfullscreen', '');
    iframe.referrerPolicy = 'strict-origin-when-cross-origin';
    iframe.src = buildEmbedUrl(initialVideo.current.videoId, initialVideo.current.startSeconds, initialVideo.current.embedMode);
    mount.replaceChildren(iframe);

    loadApi().then((YT) => {
      if (disposed || !mountRef.current || playerRef.current) return;
      playerRef.current = new YT.Player(iframeId, {
        events: {
          onReady: () => {
            if (disposed) return;
            setReady(true);
            latestCallbacks.current.onReady?.();
            const cuedId = String(playerRef.current?.getVideoData?.()?.video_id ?? '');
            if (cuedId) latestCallbacks.current.onCued?.(cuedId);
          },
          onStateChange: (event: { data: number }) => {
            if (event.data === YT.PlayerState.CUED) {
              const cuedId = String(playerRef.current?.getVideoData?.()?.video_id ?? '');
              if (cuedId) latestCallbacks.current.onCued?.(cuedId);
            }
            if (event.data === YT.PlayerState.PLAYING) {
              const playingId = String(playerRef.current?.getVideoData?.()?.video_id ?? '');
              if (playingId) latestCallbacks.current.onPlaying?.(playingId);
            }
            if (event.data === YT.PlayerState.ENDED) latestCallbacks.current.onEnded?.();
          },
          onError: (event: { data: number }) => latestCallbacks.current.onError?.(Number(event.data)),
          onAutoplayBlocked: () => latestCallbacks.current.onAutoplayBlocked?.(),
        },
      });
    });
    return () => {
      disposed = true;
      playerRef.current?.destroy?.();
      playerRef.current = null;
      mount.replaceChildren();
    };
  }, [iframeId]);

  useEffect(() => {
    if (!ready || !videoId) return;
    const loadedId = playerRef.current?.getVideoData?.()?.video_id;
    if (loadedId !== videoId) {
      const nextStart = latestStartSeconds.current;
      if (autoPlay) playerRef.current?.loadVideoById?.({ videoId, startSeconds: nextStart });
      else playerRef.current?.cueVideoById?.({ videoId, startSeconds: nextStart });
      return;
    }
    const state = Number(playerRef.current?.getPlayerState?.() ?? -1);
    if (autoPlay && state !== 1 && state !== 3) playerRef.current?.playVideo?.();
  }, [autoPlay, ready, videoId]);

  return <div className="youtube-player" ref={mountRef} aria-label="YouTube player" />;
});
