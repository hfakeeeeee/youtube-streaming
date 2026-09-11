import { initializeApp } from 'firebase/app';
import { getToken, initializeAppCheck, ReCaptchaEnterpriseProvider, type AppCheck } from 'firebase/app-check';
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
import type { ActivityLogItem, ActivityType, BanRecord, ChatMessage, LoopMode, Member, PlaybackDiagnostic, PlaybackState, PublicRoom, QueueHistoryItem, QueueItem, QueuePlaybackIssue, Role, RoomMeta, VideoItem, VoicePresence } from '../types';

const config = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  databaseURL: import.meta.env.VITE_FIREBASE_DATABASE_URL,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID,
};

export const firebaseConfigured = Object.values(config).every(Boolean);
const app = firebaseConfigured ? initializeApp(config) : null;
const appCheckSiteKey = import.meta.env.VITE_FIREBASE_APPCHECK_SITE_KEY?.trim();
if (app && appCheckSiteKey && import.meta.env.DEV && import.meta.env.VITE_FIREBASE_APPCHECK_DEBUG_TOKEN) {
  (globalThis as typeof globalThis & { FIREBASE_APPCHECK_DEBUG_TOKEN?: string | boolean }).FIREBASE_APPCHECK_DEBUG_TOKEN =
    import.meta.env.VITE_FIREBASE_APPCHECK_DEBUG_TOKEN === 'true' ? true : import.meta.env.VITE_FIREBASE_APPCHECK_DEBUG_TOKEN;
}
const appCheck: AppCheck | null = app && appCheckSiteKey
  ? initializeAppCheck(app, { provider: new ReCaptchaEnterpriseProvider(appCheckSiteKey), isTokenAutoRefreshEnabled: true })
  : null;
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

export async function getFirebaseIdToken(): Promise<string> {
  return (await ensureUser()).getIdToken();
}

export async function getFirebaseAppCheckToken(): Promise<string> {
  if (!appCheck) return '';
  return (await getToken(appCheck)).token;
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
    sponsorBlockEnabled: false,
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

  // Playback rules resolve the existing room owner, so meta must exist first.
  await set(ref(db, `rooms/${roomId}/meta`), meta);
  try {
    await update(ref(db), {
      [`rooms/${roomId}/playback`]: playback,
      [`roomExpirations/${roomId}`]: meta.expiresAt,
    });
    await joinRoom(roomId, displayName);
    return roomId;
  } catch (error) {
    await update(ref(db), {
      [`rooms/${roomId}`]: null,
      [`roomExpirations/${roomId}`]: null,
    }).catch(() => undefined);
    throw error;
  }
}

export async function joinRoom(roomIdInput: string, displayName: string): Promise<{ roomId: string; role: Role; roomName: string }> {
  const { db } = requireFirebase();
  const user = await ensureUser();
  const roomId = roomIdInput.trim().toUpperCase();
  const metaSnap = await get(ref(db, `rooms/${roomId}/meta`));
  if (!metaSnap.exists()) throw new Error('Không tìm thấy phòng này.');
  const meta = metaSnap.val() as RoomMeta;
  if (meta.expiresAt && meta.expiresAt <= Date.now()) {
    await update(ref(db), { [`rooms/${roomId}`]: null, [`publicRooms/${roomId}`]: null, [`roomExpirations/${roomId}`]: null }).catch(() => undefined);
    throw new Error('Phòng đã hết hạn do không hoạt động trong 7 ngày.');
  }
  const banSnap = await get(ref(db, `rooms/${roomId}/bans/${user.uid}`));
  if (banSnap.exists()) throw new Error('Bạn đã bị cấm tham gia phòng này.');
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

export function updateDisplayName(roomId: string, uid: string, displayName: string, inVoice: boolean): Promise<void> {
  const { db } = requireFirebase();
  const name = displayName.trim().slice(0, 32);
  if (!name) return Promise.reject(new Error('Tên hiển thị không được để trống.'));
  const changes: Record<string, string> = {
    [`rooms/${roomId}/members/${uid}/name`]: name,
  };
  if (inVoice) changes[`rooms/${roomId}/voice/${uid}/name`] = name;
  return update(ref(db), changes);
}

export function leaveRoom(roomId: string, uid: string): Promise<void> {
  const { db } = requireFirebase();
  return remove(ref(db, `rooms/${roomId}/members/${uid}`));
}

export async function setVoicePresence(roomId: string, presence: VoicePresence): Promise<void> {
  const { db } = requireFirebase();
  const presenceRef = ref(db, `rooms/${roomId}/voice/${presence.uid}`);
  const existing = await get(presenceRef);
  const forcedMuted = existing.child('forcedMuted');
  await set(presenceRef, { ...presence, ...(forcedMuted.exists() ? { forcedMuted: forcedMuted.val() === true } : {}) });
  await onDisconnect(presenceRef).remove();
}

export function updateVoiceMuted(roomId: string, uid: string, muted: boolean): Promise<void> {
  const { db } = requireFirebase();
  return update(ref(db, `rooms/${roomId}/voice/${uid}`), { muted });
}

export function updateVoiceForcedMuted(roomId: string, uid: string, forcedMuted: boolean): Promise<void> {
  const { db } = requireFirebase();
  return update(ref(db, `rooms/${roomId}/voice/${uid}`), { forcedMuted });
}

export function removeVoicePresence(roomId: string, uid: string): Promise<void> {
  const { db } = requireFirebase();
  return remove(ref(db, `rooms/${roomId}/voice/${uid}`));
}

export function subscribeRoom<T>(roomId: string, key: string, callback: (value: T) => void, onError?: (error: Error) => void): Unsubscribe {
  const { db } = requireFirebase();
  return onValue(ref(db, `rooms/${roomId}/${key}`), (snapshot) => callback(snapshot.val() as T), (error) => onError?.(error));
}

export function subscribePublicRooms(callback: (rooms: PublicRoom[]) => void): Unsubscribe {
  const { db } = requireFirebase();
  return onValue(ref(db, 'publicRooms'), (snapshot) => {
    const value = snapshot.val() as Record<string, Omit<PublicRoom, 'roomId'>> | null;
    callback(value ? Object.entries(value).map(([roomId, room]) => ({ ...room, roomId })).sort((a, b) => b.updatedAt - a.updatedAt) : []);
  });
}

export function subscribeConnection(callback: (connected: boolean) => void): Unsubscribe {
  const { db } = requireFirebase();
  return onValue(ref(db, '.info/connected'), (snapshot) => callback(snapshot.val() === true));
}

export function subscribeServerOffset(callback: (offset: number) => void): Unsubscribe {
  const { db } = requireFirebase();
  return onValue(ref(db, '.info/serverTimeOffset'), (snapshot) => callback(Number(snapshot.val()) || 0));
}

export async function addVideos(roomId: string, videos: VideoItem[], member: Member): Promise<{ added: VideoItem[]; duplicates: VideoItem[] }> {
  const { db } = requireFirebase();
  const added: VideoItem[] = [];
  const duplicates: VideoItem[] = [];
  for (const video of videos.slice(0, 50)) {
    const cleanVideo: VideoItem = {
      id: video.id,
      title: video.title,
      channel: video.channel ?? '',
      thumbnail: video.thumbnail,
      duration: video.duration ?? 0,
    };
    const itemRef = ref(db, `rooms/${roomId}/queue/${cleanVideo.id}`);
    const result = await runTransaction(itemRef, (current) => {
      if (current) return undefined;
      return {
        ...cleanVideo,
        queueId: cleanVideo.id,
        addedAt: Date.now(),
        addedBy: member.uid,
        addedByName: member.name,
      } satisfies QueueItem;
    }, { applyLocally: false });
    if (result.committed) added.push(cleanVideo);
    else duplicates.push(cleanVideo);
  }
  if (added.length > 0) {
    await update(ref(db), { [`rooms/${roomId}/members/${member.uid}/lastQueueAt`]: serverTimestamp() });
  }
  return { added, duplicates };
}

export function removeQueueItem(roomId: string, queueId: string): Promise<void> {
  const { db } = requireFirebase();
  return remove(ref(db, `rooms/${roomId}/queue/${queueId}`));
}

export function updateMusicMuted(roomId: string, uid: string, musicMuted: boolean): Promise<void> {
  const { db } = requireFirebase();
  return update(ref(db, `rooms/${roomId}/members/${uid}`), { musicMuted });
}

export function updateQueuePlaybackIssue(roomId: string, queueId: string, issue: Omit<QueuePlaybackIssue, 'updatedAt'> | null): Promise<void> {
  const { db } = requireFirebase();
  const issueRef = ref(db, `rooms/${roomId}/queue/${queueId}/playbackIssue`);
  return issue ? set(issueRef, { ...issue, updatedAt: serverTimestamp() }) : remove(issueRef);
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

export function restoreQueueItems(roomId: string, items: QueueItem[]): Promise<void> {
  const { db } = requireFirebase();
  const updates: Record<string, QueueItem> = {};
  items.forEach((item) => { updates[item.queueId] = item; });
  return update(ref(db, `rooms/${roomId}/queue`), updates);
}

export async function transferHost(roomId: string, newHostUid: string): Promise<void> {
  const { db } = requireFirebase();
  const user = await ensureUser();
  const metaSnapshot = await get(ref(db, `rooms/${roomId}/meta`));
  if (!metaSnapshot.exists()) throw new Error('Phòng không còn tồn tại.');
  const meta = metaSnapshot.val() as RoomMeta;
  if (meta.hostUid === newHostUid) return;
  const listing = await get(ref(db, `publicRooms/${roomId}`));
  const isManualTransfer = user.uid === meta.hostUid;

  if (isManualTransfer) {
    const updates: Record<string, unknown> = {
      [`rooms/${roomId}/meta/hostUid`]: newHostUid,
      [`rooms/${roomId}/meta/coHosts/${newHostUid}`]: null,
      [`rooms/${roomId}/meta/coHosts/${meta.hostUid}`]: true,
    };
    if (listing.exists()) updates[`publicRooms/${roomId}/ownerUid`] = newHostUid;
    await update(ref(db), updates);
    return;
  }

  // During automatic takeover, update meta first. Public-room rules only allow
  // the new owner to update the listing after this write has succeeded.
  await update(ref(db), { [`rooms/${roomId}/meta/hostUid`]: newHostUid });
  const followUp: Record<string, unknown> = {
    [`rooms/${roomId}/members/${newHostUid}/role`]: 'host',
    [`rooms/${roomId}/members/${meta.hostUid}/role`]: 'listener',
  };
  if (listing.exists()) followUp[`publicRooms/${roomId}/ownerUid`] = newHostUid;
  await update(ref(db), followUp);
}

export function normalizeHistory(value: Record<string, Omit<QueueHistoryItem, 'historyId'>> | null): QueueHistoryItem[] {
  return value
    ? Object.entries(value)
      .map(([historyId, item]) => ({ ...item, historyId }))
      .sort((a, b) => b.playedAt - a.playedAt)
      .slice(0, 50)
    : [];
}

function appendHistoryUpdate(
  db: Database,
  roomId: string,
  current: QueueItem | undefined,
  uid: string,
  history: QueueHistoryItem[],
  updates: Record<string, unknown>,
): void {
  if (!current) return;
  const historyRef = push(ref(db, `rooms/${roomId}/history`));
  updates[`rooms/${roomId}/history/${historyRef.key!}`] = {
    id: current.id,
    title: current.title,
    channel: current.channel ?? '',
    thumbnail: current.thumbnail,
    duration: current.duration ?? 0,
    playedAt: serverTimestamp(),
    playedBy: uid,
    addedByName: current.addedByName ?? '',
  };
  history.slice(49).forEach((item) => {
    updates[`rooms/${roomId}/history/${item.historyId}`] = null;
  });
}

export async function selectQueueVideo(
  roomId: string,
  uid: string,
  item: QueueItem,
  previous: QueueItem | undefined,
  volume: number,
  removePrevious: boolean,
  history: QueueHistoryItem[],
): Promise<void> {
  const { db } = requireFirebase();
  const updates: Record<string, unknown> = {};
  if (previous && previous.queueId !== item.queueId) {
    appendHistoryUpdate(db, roomId, previous, uid, history, updates);
    if (removePrevious) updates[`rooms/${roomId}/queue/${previous.queueId}`] = null;
  }
  updates[`rooms/${roomId}/playback`] = {
    video: { id: item.id, title: item.title, channel: item.channel ?? '', thumbnail: item.thumbnail, duration: item.duration ?? 0 },
    status: 'paused',
    position: 0,
    volume,
    updatedAt: serverTimestamp() as unknown as number,
    revision: Date.now(),
    changedBy: uid,
    reason: 'queue',
  } satisfies PlaybackState;
  await update(ref(db), updates);
}

export function updateCoHost(roomId: string, uid: string, enabled: boolean): Promise<void> {
  const { db } = requireFirebase();
  const coHostRef = ref(db, `rooms/${roomId}/meta/coHosts/${uid}`);
  return enabled ? set(coHostRef, true) : remove(coHostRef);
}

export function closeRoom(roomId: string): Promise<void> {
  const { db } = requireFirebase();
  return update(ref(db), { [`rooms/${roomId}`]: null, [`publicRooms/${roomId}`]: null, [`roomExpirations/${roomId}`]: null });
}

export function kickMember(roomId: string, uid: string, revokeCoHost = false): Promise<void> {
  const { db } = requireFirebase();
  if (!revokeCoHost) return remove(ref(db, `rooms/${roomId}/members/${uid}`));
  return update(ref(db), {
    [`rooms/${roomId}/members/${uid}`]: null,
    [`rooms/${roomId}/meta/coHosts/${uid}`]: null,
  });
}

export function banMember(roomId: string, member: Member, bannedBy: string, revokeCoHost = false): Promise<void> {
  const { db } = requireFirebase();
  const record: BanRecord = { uid: member.uid, name: member.name, bannedAt: Date.now(), bannedBy };
  const updates: Record<string, BanRecord | null> = {
    [`rooms/${roomId}/bans/${member.uid}`]: record,
    [`rooms/${roomId}/members/${member.uid}`]: null,
  };
  if (revokeCoHost) updates[`rooms/${roomId}/meta/coHosts/${member.uid}`] = null;
  return update(ref(db), updates);
}

export function unbanMember(roomId: string, uid: string): Promise<void> {
  const { db } = requireFirebase();
  return remove(ref(db, `rooms/${roomId}/bans/${uid}`));
}

export async function advanceQueue(
  roomId: string,
  uid: string,
  queue: QueueItem[],
  currentVideoId?: string,
  volume = 80,
  loopMode: LoopMode = 'off',
  history: QueueHistoryItem[] = [],
  preserveCurrent = false,
): Promise<void> {
  const { db } = requireFirebase();
  const foundIndex = currentVideoId ? queue.findIndex((item) => item.id === currentVideoId) : -1;
  const currentIndex = foundIndex >= 0 ? foundIndex : 0;
  const current = queue[currentIndex];
  const next = queue.length > 1 ? queue[(currentIndex + 1) % queue.length] : undefined;
  const updates: Record<string, unknown> = {};
  if (!preserveCurrent) appendHistoryUpdate(db, roomId, current, uid, history, updates);
  if (current && loopMode === 'off' && !preserveCurrent) updates[`rooms/${roomId}/queue/${current.queueId}`] = null;
  if (current && preserveCurrent) updates[`rooms/${roomId}/queue/${current.queueId}/addedAt`] = Date.now();
  if (current && loopMode === 'all' && next) {
    updates[`rooms/${roomId}/queue/${current.queueId}/addedAt`] = Date.now();
  }
  const target = loopMode === 'one' || (loopMode === 'all' && !next) ? current : next;
  updates[`rooms/${roomId}/playback`] = {
    video: target ? { id: target.id, title: target.title, channel: target.channel ?? '', thumbnail: target.thumbnail, duration: target.duration ?? 0 } : null,
    // Keep the room clock frozen at zero while the initiating client cues the
    // next iframe. It switches to playing only after YouTube reports CUED.
    status: 'paused',
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
  await update(ref(db), {
    [`rooms/${roomId}/messages/${messageRef.key!}`]: { uid, name, text: text.trim().slice(0, 500), sentAt: serverTimestamp() },
    [`rooms/${roomId}/members/${uid}/lastChatAt`]: serverTimestamp(),
  });
}

export async function recordActivity(
  roomId: string,
  actor: Pick<Member, 'uid' | 'name'>,
  type: ActivityType,
  text: string,
): Promise<void> {
  const { db } = requireFirebase();
  const activityRef = push(ref(db, `rooms/${roomId}/activity`));
  await set(activityRef, {
    type,
    actorUid: actor.uid,
    actorName: actor.name,
    text: text.trim().slice(0, 240),
    createdAt: serverTimestamp(),
  });
}

export async function recordPlaybackDiagnostic(
  roomId: string,
  diagnostic: Omit<PlaybackDiagnostic, 'id' | 'createdAt'>,
): Promise<void> {
  const { db } = requireFirebase();
  const diagnosticRef = push(ref(db, `rooms/${roomId}/diagnostics`));
  await set(diagnosticRef, { ...diagnostic, createdAt: serverTimestamp() });
}

export function updateRoomMeta(roomId: string, patch: Partial<RoomMeta>): Promise<void> {
  const { db } = requireFirebase();
  return update(ref(db, `rooms/${roomId}/meta`), patch);
}

export function saveRoomSettings(roomId: string, settings: RoomMeta): Promise<void> {
  const { db } = requireFirebase();
  return update(ref(db), {
    [`rooms/${roomId}/meta`]: settings,
    [`publicRooms/${roomId}`]: settings.isPublic
      ? { name: settings.name, updatedAt: serverTimestamp(), ownerUid: settings.hostUid }
      : null,
    [`roomExpirations/${roomId}`]: settings.expiresAt ?? Date.now() + 7 * 24 * 60 * 60 * 1000,
  });
}

export function renewRoomExpiration(roomId: string, expiresAt: number): Promise<void> {
  const { db } = requireFirebase();
  return update(ref(db), { [`rooms/${roomId}/meta/expiresAt`]: expiresAt, [`roomExpirations/${roomId}`]: expiresAt });
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

export function normalizeActivity(value: Record<string, Omit<ActivityLogItem, 'id'>> | null): ActivityLogItem[] {
  if (!value) return [];
  return Object.entries(value)
    .map(([id, item]) => ({ ...item, id }))
    .sort((a, b) => b.createdAt - a.createdAt)
    .slice(0, 100);
}

export function normalizeDiagnostics(value: Record<string, Omit<PlaybackDiagnostic, 'id'>> | null): PlaybackDiagnostic[] {
  if (!value) return [];
  return Object.entries(value)
    .map(([id, item]) => ({ ...item, id }))
    .sort((a, b) => b.createdAt - a.createdAt)
    .slice(0, 100);
}
