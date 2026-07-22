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
  setVolume: (volume: number) => void;
  activate: () => void;
}

interface Props {
  videoId?: string;
  startSeconds?: number;
  onReady?: () => void;
  onEnded?: () => void;
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

export const YouTubePlayer = forwardRef<PlayerHandle, Props>(function YouTubePlayer(
  { videoId, startSeconds = 0, onReady, onEnded, onAutoplayBlocked },
  forwardedRef,
) {
  const mountRef = useRef<HTMLDivElement>(null);
  const playerRef = useRef<any>(null);
  const latestCallbacks = useRef({ onReady, onEnded, onAutoplayBlocked });
  const initialVideo = useRef({ videoId, startSeconds });
  const [ready, setReady] = useState(false);
  latestCallbacks.current = { onReady, onEnded, onAutoplayBlocked };

  useImperativeHandle(forwardedRef, () => ({
    play: () => playerRef.current?.playVideo?.(),
    pause: () => playerRef.current?.pauseVideo?.(),
    seek: (seconds) => playerRef.current?.seekTo?.(Math.max(0, seconds), true),
    currentTime: () => Number(playerRef.current?.getCurrentTime?.() ?? 0),
    duration: () => Number(playerRef.current?.getDuration?.() ?? 0),
    state: () => Number(playerRef.current?.getPlayerState?.() ?? -1),
    setVolume: (volume) => playerRef.current?.setVolume?.(Math.min(100, Math.max(0, volume))),
    activate: () => {
      playerRef.current?.unMute?.();
      playerRef.current?.playVideo?.();
    },
  }), []);

  useEffect(() => {
    let disposed = false;
    loadApi().then((YT) => {
      if (disposed || !mountRef.current || playerRef.current) return;
      playerRef.current = new YT.Player(mountRef.current, {
        host: 'https://www.youtube-nocookie.com',
        width: '100%',
        height: '100%',
        videoId: initialVideo.current.videoId ?? '',
        playerVars: {
          autoplay: 0,
          controls: 0,
          playsinline: 1,
          rel: 0,
          origin: window.location.origin,
          start: Math.floor(initialVideo.current.startSeconds),
        },
        events: {
          onReady: () => {
            setReady(true);
            latestCallbacks.current.onReady?.();
          },
          onStateChange: (event: { data: number }) => {
            if (event.data === YT.PlayerState.ENDED) latestCallbacks.current.onEnded?.();
          },
          onAutoplayBlocked: () => latestCallbacks.current.onAutoplayBlocked?.(),
        },
      });
    });
    return () => {
      disposed = true;
      playerRef.current?.destroy?.();
      playerRef.current = null;
    };
  }, []);

  useEffect(() => {
    if (!ready || !videoId) return;
    const loadedId = playerRef.current?.getVideoData?.()?.video_id;
    if (loadedId !== videoId) playerRef.current?.cueVideoById?.({ videoId, startSeconds });
  }, [ready, videoId, startSeconds]);

  return <div className="youtube-player" ref={mountRef} aria-label="YouTube player" />;
});
