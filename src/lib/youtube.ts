import type { ParsedYouTubeInput, VideoItem } from '../types';

const VIDEO_ID = /^[A-Za-z0-9_-]{11}$/;
const PLAYLIST_ID = /^[A-Za-z0-9_-]{10,64}$/;

export function isYouTubeMixPlaylist(playlistId: string): boolean {
  return /^RD/.test(playlistId);
}

function secondsFromTime(value: string | null): number | undefined {
  if (!value) return undefined;
  if (/^\d+$/.test(value)) return Number(value);
  const match = value.toLowerCase().match(/^(?:(\d+)h)?(?:(\d+)m)?(?:(\d+)s)?$/);
  if (!match) return undefined;
  const seconds = Number(match[1] ?? 0) * 3600 + Number(match[2] ?? 0) * 60 + Number(match[3] ?? 0);
  return seconds || undefined;
}

export function parseYouTubeInput(raw: string): ParsedYouTubeInput | null {
  const input = raw.trim();
  if (!input) return null;
  if (VIDEO_ID.test(input)) return { videoId: input };

  let url: URL;
  try {
    url = new URL(/^https?:\/\//i.test(input) ? input : `https://${input}`);
  } catch {
    return null;
  }

  const host = url.hostname.replace(/^www\./, '').toLowerCase();
  if (!['youtube.com', 'm.youtube.com', 'music.youtube.com', 'youtu.be', 'youtube-nocookie.com'].includes(host)) {
    return null;
  }

  let videoId: string | undefined;
  let playlistId: string | undefined;
  const parts = url.pathname.split('/').filter(Boolean);

  if (host === 'youtu.be') videoId = parts[0];
  else if (url.pathname === '/watch') videoId = url.searchParams.get('v') ?? undefined;
  else if (['shorts', 'embed', 'live', 'v'].includes(parts[0])) videoId = parts[1];

  const list = url.searchParams.get('list');
  if (list && PLAYLIST_ID.test(list)) playlistId = list;
  if (videoId && !VIDEO_ID.test(videoId)) videoId = undefined;

  const time = url.searchParams.get('t') ?? url.searchParams.get('start') ?? url.hash.match(/t=([^&]+)/)?.[1] ?? null;
  const startSeconds = secondsFromTime(time);
  if (!videoId && !playlistId) return null;
  const result: ParsedYouTubeInput = {};
  if (videoId) result.videoId = videoId;
  if (playlistId) result.playlistId = playlistId;
  if (startSeconds) result.startSeconds = startSeconds;
  return result;
}

export function isProbablyUrl(value: string): boolean {
  return /^(https?:\/\/)?(www\.|m\.|music\.)?(youtube\.com|youtu\.be)\//i.test(value.trim()) || VIDEO_ID.test(value.trim());
}

export async function fallbackVideoMetadata(videoId: string): Promise<VideoItem> {
  const watchUrl = `https://www.youtube.com/watch?v=${encodeURIComponent(videoId)}`;
  try {
    const response = await fetch(`https://www.youtube.com/oembed?url=${encodeURIComponent(watchUrl)}&format=json`);
    if (!response.ok) throw new Error('Không lấy được metadata');
    const data = await response.json() as { title: string; author_name?: string; thumbnail_url?: string };
    return {
      id: videoId,
      title: data.title,
      channel: data.author_name,
      thumbnail: data.thumbnail_url ?? `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`,
    };
  } catch {
    return {
      id: videoId,
      title: `YouTube video · ${videoId}`,
      thumbnail: `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`,
    };
  }
}

export function formatDuration(seconds?: number): string {
  if (!seconds || !Number.isFinite(seconds)) return '';
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const secs = Math.floor(seconds % 60);
  return hours
    ? `${hours}:${String(minutes).padStart(2, '0')}:${String(secs).padStart(2, '0')}`
    : `${minutes}:${String(secs).padStart(2, '0')}`;
}
