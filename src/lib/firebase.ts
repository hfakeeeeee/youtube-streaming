import { initializeApp } from 'firebase/app';
import { getAuth, onAuthStateChanged, signInAnonymously, type User } from 'firebase/auth';
import {
  getDatabase,
  get,
  onDisconnect,
  onValue,
  push,
  ref,
  remove,
  runTransaction,
  serverTimestamp,
  set,
  update,
  type Database,
  type Unsubscribe,
} from 'firebase/database';
import type { ChatMessage, Member, PlaybackState, QueueItem, Role, RoomMeta, VideoItem } from '../types';

const config = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  databaseURL: import.meta.env.VITE_FIREBASE_DATABASE_URL,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID,
};

export const firebaseConfigured = Object.values(config).every(Boolean);
const app = firebaseConfigured ? initializeApp(config) : null;
const auth = app ? getAuth(app) : null;
export const database: Database | null = app ? getDatabase(app) : null;

function requireFirebase(): { db: Database; auth: NonNullable<typeof auth> } {
  if (!database || !auth) throw new Error('Firebase chưa được cấu hình. Hãy kiểm tra file .env.local.');
  return { db: database, auth };
}

export async function ensureUser(): Promise<User> {
  const { auth: firebaseAuth } = requireFirebase();
  if (firebaseAuth.currentUser) return firebaseAuth.currentUser;
  return new Promise<User>((resolve, reject) => {
    let settled = false;
    const unsubscribe = onAuthStateChanged(firebaseAuth, async (user) => {
      if (settled) return;
      if (user) {
        settled = true;
        unsubscribe();
        resolve(user);
        return;
      }
      try {
        const credential = await signInAnonymously(firebaseAuth);
        settled = true;
        unsubscribe();
        resolve(credential.user);
      } catch (error) {
        settled = true;
        unsubscribe();
        reject(error);
      }
    });
  });
}

function makeRoomId(): string {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  return Array.from({ length: 6 }, () => alphabet[Math.floor(Math.random() * alphabet.length)]).join('');
}

export async function createRoom(name: string, displayName: string): Promise<string> {
  const { db } = requireFirebase();
  const user = await ensureUser();
  let roomId = makeRoomId();
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const exists = await get(ref(db, `rooms/${roomId}/meta`));
    if (!exists.exists()) break;
    roomId = makeRoomId();
  }

  const meta: RoomMeta = {
    name: name.trim() || `${displayName}'s room`,
    hostUid: user.uid,
    createdAt: Date.now(),
    isPublic: false,
    sponsorBlockEnabled: true,
    sponsorCategories: ['sponsor'],
  };
  const playback: PlaybackState = {
    video: null,
    status: 'paused',
    position: 0,
    volume: 80,
    updatedAt: Date.now(),
    revision: 0,
    changedBy: user.uid,
  };

  await set(ref(db, `rooms/${roomId}/meta`), meta);
  await set(ref(db, `rooms/${roomId}/playback`), playback);
  await joinRoom(roomId, displayName);
  return roomId;
}

export async function joinRoom(roomIdInput: string, displayName: string): Promise<{ roomId: string; role: Role; roomName: string }> {
  const { db } = requireFirebase();
  const user = await ensureUser();
  const roomId = roomIdInput.trim().toUpperCase();
  const metaSnap = await get(ref(db, `rooms/${roomId}/meta`));
  if (!metaSnap.exists()) throw new Error('Không tìm thấy phòng này.');
  const meta = metaSnap.val() as RoomMeta;
  const role: Role = meta.hostUid === user.uid ? 'host' : 'listener';
  const member: Member = {
    uid: user.uid,
    name: displayName.trim().slice(0, 32) || 'Guest',
    role,
    joinedAt: Date.now(),
    online: true,
  };
  const memberRef = ref(db, `rooms/${roomId}/members/${user.uid}`);
  await set(memberRef, member);
  await onDisconnect(memberRef).remove();
  return { roomId, role, roomName: meta.name };
}

export function leaveRoom(roomId: string, uid: string): Promise<void> {
  const { db } = requireFirebase();
  return remove(ref(db, `rooms/${roomId}/members/${uid}`));
}

export function subscribeRoom<T>(roomId: string, key: string, callback: (value: T) => void): Unsubscribe {
  const { db } = requireFirebase();
  return onValue(ref(db, `rooms/${roomId}/${key}`), (snapshot) => callback(snapshot.val() as T));
}

export async function addVideos(roomId: string, videos: VideoItem[], member: Member): Promise<void> {
  const { db } = requireFirebase();
  const additions: Record<string, QueueItem> = {};
  for (const video of videos.slice(0, 50)) {
    const itemRef = push(ref(db, `rooms/${roomId}/queue`));
    additions[itemRef.key!] = {
      ...video,
      queueId: itemRef.key!,
      addedAt: Date.now(),
      addedBy: member.uid,
      addedByName: member.name,
    };
  }
  await update(ref(db, `rooms/${roomId}/queue`), additions);
}

export function removeQueueItem(roomId: string, queueId: string): Promise<void> {
  const { db } = requireFirebase();
  return remove(ref(db, `rooms/${roomId}/queue/${queueId}`));
}

export async function writePlayback(
  roomId: string,
  uid: string,
  patch: Partial<PlaybackState>,
): Promise<void> {
  const { db } = requireFirebase();
  const playbackRef = ref(db, `rooms/${roomId}/playback`);
  await runTransaction(playbackRef, (current: PlaybackState | null) => ({
    video: null,
    status: 'paused',
    position: 0,
    volume: 80,
    ...(current ?? {}),
    ...patch,
    updatedAt: Date.now(),
    revision: (current?.revision ?? 0) + 1,
    changedBy: uid,
  }));
}

export async function advanceQueue(
  roomId: string,
  uid: string,
  queue: QueueItem[],
  currentVideoId?: string,
  volume = 80,
): Promise<void> {
  const { db } = requireFirebase();
  const foundIndex = currentVideoId ? queue.findIndex((item) => item.id === currentVideoId) : -1;
  const currentIndex = foundIndex >= 0 ? foundIndex : 0;
  const current = queue[currentIndex];
  const next = queue.find((_, index) => index !== currentIndex);
  const updates: Record<string, unknown> = {};
  if (current) updates[`rooms/${roomId}/queue/${current.queueId}`] = null;
  updates[`rooms/${roomId}/playback`] = {
    video: next ? { id: next.id, title: next.title, channel: next.channel ?? '', thumbnail: next.thumbnail, duration: next.duration ?? 0 } : null,
    status: next ? 'playing' : 'paused',
    position: 0,
    volume,
    updatedAt: serverTimestamp() as unknown as number,
    revision: Date.now(),
    changedBy: uid,
    reason: 'queue',
  } satisfies PlaybackState;
  await update(ref(db), updates);
}

export async function sendChat(roomId: string, uid: string, name: string, text: string): Promise<void> {
  const { db } = requireFirebase();
  const messageRef = push(ref(db, `rooms/${roomId}/messages`));
  await set(messageRef, { uid, name, text: text.trim().slice(0, 500), sentAt: serverTimestamp() });
}

export function updateRoomMeta(roomId: string, patch: Partial<RoomMeta>): Promise<void> {
  const { db } = requireFirebase();
  return update(ref(db, `rooms/${roomId}/meta`), patch);
}

export function updateMemberRole(roomId: string, uid: string, role: Role): Promise<void> {
  const { db } = requireFirebase();
  return set(ref(db, `rooms/${roomId}/members/${uid}/role`), role);
}

export function normalizeQueue(value: Record<string, Omit<QueueItem, 'queueId'>> | null): QueueItem[] {
  if (!value) return [];
  return Object.entries(value)
    .map(([queueId, item]) => ({ ...item, queueId }))
    .sort((a, b) => a.addedAt - b.addedAt || a.queueId.localeCompare(b.queueId));
}

export function normalizeMembers(value: Record<string, Member> | null): Member[] {
  return value ? Object.values(value).sort((a, b) => a.joinedAt - b.joinedAt) : [];
}

export function normalizeMessages(value: Record<string, Omit<ChatMessage, 'id'>> | null): ChatMessage[] {
  if (!value) return [];
  return Object.entries(value)
    .map(([id, message]) => ({ ...message, id }))
    .sort((a, b) => a.sentAt - b.sentAt)
    .slice(-100);
}
