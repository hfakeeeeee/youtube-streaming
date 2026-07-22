export type Role = 'host' | 'dj' | 'listener';
export type PlaybackStatus = 'playing' | 'paused';
export type LoopMode = 'off' | 'one' | 'all';

export interface VideoItem {
  id: string;
  title: string;
  channel?: string;
  thumbnail: string;
  duration?: number;
}

export interface QueueItem extends VideoItem {
  queueId: string;
  addedAt: number;
  addedBy: string;
  addedByName: string;
}

export interface Member {
  uid: string;
  name: string;
  role: Role;
  joinedAt: number;
  online: boolean;
}

export interface RoomMeta {
  name: string;
  hostUid: string;
  createdAt: number;
  isPublic: boolean;
  sponsorBlockEnabled: boolean;
  sponsorCategories: string[];
  loopMode?: LoopMode;
}

export interface PlaybackState {
  video: VideoItem | null;
  status: PlaybackStatus;
  position: number;
  volume: number;
  updatedAt: number;
  revision: number;
  changedBy: string;
  reason?: 'control' | 'sponsorblock' | 'queue';
}

export interface ChatMessage {
  id: string;
  uid: string;
  name: string;
  text: string;
  sentAt: number;
}

export interface SponsorSegment {
  segment: [number, number];
  category: string;
  actionType: string;
  UUID?: string;
}

export interface ParsedYouTubeInput {
  videoId?: string;
  playlistId?: string;
  startSeconds?: number;
}
