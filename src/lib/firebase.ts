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
  serverTimestamp,
  set,
  update,
  type Database,
  type Unsubscribe,
} from 'firebase/database';
import type { ChatMessage, LoopMode, Member, PlaybackState, QueueItem, Role, RoomMeta, VideoItem } from '../types';

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
    loopMode: 'off',
    allowListenersToAdd: false,
    chatEnabled: true,
    expiresAt: Date.now() + 7 * 24 * 60 * 60 * 1000,
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
  if (meta.expiresAt && meta.expiresAt <= Date.now()) {
    await remove(ref(db, `rooms/${roomId}`)).catch(() => undefined);
    throw new Error('Phòng đã hết hạn do không hoạt động trong 7 ngày.');
  }
  let previousRole: Role = 'listener';
  try {
    const existing = await get(ref(db, `rooms/${roomId}/members/${user.uid}`));
    if (existing.exists()) previousRole = (existing.val() as Member).role;
  } catch {
    // New members cannot read the member list until their own record exists.
  }
  const role: Role = meta.hostUid === user.uid ? 'host' : previousRole === 'dj' ? 'dj' : 'listener';
  const member: Member = {
    uid: user.uid,
    name: displayName.trim().slice(0, 32) || 'Guest',
    role,
    joinedAt: Date.now(),
    online: true,
  };
  const memberRef = ref(db, `rooms/${roomId}/members/${user.uid}`);
  await set(memberRef, member);
  await onDisconnect(memberRef).update({ online: false });
  return { roomId, role, roomName: meta.name };
}

export function setMemberOnline(roomId: string, uid: string, online: boolean): Promise<void> {
  const { db } = requireFirebase();
  return update(ref(db, `rooms/${roomId}/members/${uid}`), { online });
}

export function leaveRoom(roomId: string, uid: string): Promise<void> {
  const { db } = requireFirebase();
  return remove(ref(db, `rooms/${roomId}/members/${uid}`));
}

export function subscribeRoom<T>(roomId: string, key: string, callback: (value: T) => void): Unsubscribe {
  const { db } = requireFirebase();
  return onValue(ref(db, `rooms/${roomId}/${key}`), (snapshot) => callback(snapshot.val() as T));
}

export function subscribeConnection(callback: (connected: boolean) => void): Unsubscribe {
  const { db } = requireFirebase();
  return onValue(ref(db, '.info/connected'), (snapshot) => callback(snapshot.val() === true));
}

export function subscribeServerOffset(callback: (offset: number) => void): Unsubscribe {
  const { db } = requireFirebase();
  return onValue(ref(db, '.info/serverTimeOffset'), (snapshot) => callback(Number(snapshot.val()) || 0));
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

export function toggleQueueVote(roomId: string, queueId: string, uid: string, voted: boolean): Promise<void> {
  const { db } = requireFirebase();
  const voteRef = ref(db, `rooms/${roomId}/queue/${queueId}/votes/${uid}`);
  return voted ? remove(voteRef) : set(voteRef, true);
}

export async function writePlayback(
  roomId: string,
  uid: string,
  patch: Partial<PlaybackState>,
): Promise<void> {
  const { db } = requireFirebase();
  const playbackRef = ref(db, `rooms/${roomId}/playback`);
  await update(playbackRef, {
    ...patch,
    updatedAt: serverTimestamp(),
    revision: Date.now(),
    changedBy: uid,
  });
}

export function clearQueue(roomId: string): Promise<void> {
  const { db } = requireFirebase();
  return remove(ref(db, `rooms/${roomId}/queue`));
}

export function reorderQueue(roomId: string, queueIds: string[]): Promise<void> {
  const { db } = requireFirebase();
  const updates: Record<string, number> = {};
  const base = Date.now();
  queueIds.forEach((queueId, index) => { updates[`${queueId}/addedAt`] = base + index; });
  return update(ref(db, `rooms/${roomId}/queue`), updates);
}

export function transferHost(roomId: string, newHostUid: string): Promise<void> {
  const { db } = requireFirebase();
  return update(ref(db, `rooms/${roomId}/meta`), { hostUid: newHostUid });
}

export function updateCoHost(roomId: string, uid: string, enabled: boolean): Promise<void> {
  const { db } = requireFirebase();
  const coHostRef = ref(db, `rooms/${roomId}/meta/coHosts/${uid}`);
  return enabled ? set(coHostRef, true) : remove(coHostRef);
}

export function closeRoom(roomId: string): Promise<void> {
  const { db } = requireFirebase();
  return remove(ref(db, `rooms/${roomId}`));
}

export async function advanceQueue(
  roomId: string,
  uid: string,
  queue: QueueItem[],
  currentVideoId?: string,
  volume = 80,
  loopMode: LoopMode = 'off',
): Promise<void> {
  const { db } = requireFirebase();
  const foundIndex = currentVideoId ? queue.findIndex((item) => item.id === currentVideoId) : -1;
  const currentIndex = foundIndex >= 0 ? foundIndex : 0;
  const current = queue[currentIndex];
  const next = queue.length > 1 ? queue[(currentIndex + 1) % queue.length] : undefined;
  const updates: Record<string, unknown> = {};
  if (current && loopMode === 'off') updates[`rooms/${roomId}/queue/${current.queueId}`] = null;
  if (current && loopMode === 'all' && next) {
    updates[`rooms/${roomId}/queue/${current.queueId}/addedAt`] = Date.now();
  }
  const target = loopMode === 'one' || (loopMode === 'all' && !next) ? current : next;
  updates[`rooms/${roomId}/playback`] = {
    video: target ? { id: target.id, title: target.title, channel: target.channel ?? '', thumbnail: target.thumbnail, duration: target.duration ?? 0 } : null,
    status: target ? 'playing' : 'paused',
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
  return value ? Object.values(value).filter((member) => member.online !== false).sort((a, b) => a.joinedAt - b.joinedAt) : [];
}

export function normalizeMessages(value: Record<string, Omit<ChatMessage, 'id'>> | null): ChatMessage[] {
  if (!value) return [];
  return Object.entries(value)
    .map(([id, message]) => ({ ...message, id }))
    .sort((a, b) => a.sentAt - b.sentAt)
    .slice(-100);
}
