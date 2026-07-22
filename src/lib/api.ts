import type { SponsorSegment, VideoItem } from '../types';
import { fallbackVideoMetadata } from './youtube';

const baseUrl = (import.meta.env.VITE_API_BASE_URL ?? '').replace(/\/$/, '');

async function getJson<T>(path: string): Promise<T> {
  if (!baseUrl) throw new Error('Chưa cấu hình VITE_API_BASE_URL');
  const response = await fetch(`${baseUrl}${path}`);
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error((body as { error?: string }).error ?? 'Yêu cầu thất bại');
  return body as T;
}

export async function searchVideos(query: string): Promise<VideoItem[]> {
  return getJson<VideoItem[]>(`/api/search?q=${encodeURIComponent(query)}`);
}

export async function getVideo(videoId: string): Promise<VideoItem> {
  try {
    return await getJson<VideoItem>(`/api/videos/${encodeURIComponent(videoId)}`);
  } catch {
    return fallbackVideoMetadata(videoId);
  }
}

export async function getPlaylist(playlistId: string): Promise<VideoItem[]> {
  return getJson<VideoItem[]>(`/api/playlists/${encodeURIComponent(playlistId)}`);
}

export async function getSponsorSegments(videoId: string, categories: string[]): Promise<SponsorSegment[]> {
  if (!baseUrl) return [];
  return getJson<SponsorSegment[]>(
    `/api/sponsor/${encodeURIComponent(videoId)}?categories=${encodeURIComponent(categories.join(','))}`,
  ).catch(() => []);
}
