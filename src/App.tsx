import { FormEvent, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AudioWaveform,
  ArrowDown,
  ArrowUp,
  Ban,
  ChevronRight,
  GripVertical,
  Globe2,
  Crown,
  Compass,
  CircleHelp,
  Headphones,
  History,
  ListMusic,
  LoaderCircle,
  LockKeyhole,
  Maximize2,
  MessageCircle,
  Minimize2,
  Pause,
  Play,
  Radio,
  Repeat2,
  Search,
  Settings2,
  Share2,
  ShieldCheck,
  SkipForward,
  Sparkles,
  Trash2,
  ThumbsUp,
  Users,
  UserMinus,
  Volume2,
  WandSparkles,
  WifiOff,
  X,
} from 'lucide-react';
import { Brand } from './components/Brand';
import { SearchPanel } from './components/SearchPanel';
import { YouTubePlayer, type PlayerHandle } from './components/YouTubePlayer';
import { getSponsorSegments } from './lib/api';
import {
  addVideos,
  advanceQueue,
  banMember,
  clearQueue,
  closeRoom,
  createRoom,
  ensureUser,
  firebaseConfigured,
  joinRoom,
  kickMember,
  normalizeMembers,
  normalizeMessages,
  normalizeQueue,
  removeQueueItem,
  reorderQueue,
  renewRoomExpiration,
  restoreQueueItems,
  sendChat,
  saveRoomSettings,
  setMemberOnline,
  subscribeConnection,
  subscribePublicRooms,
  subscribeRoom,
  subscribeServerOffset,
  transferHost,
  toggleQueueVote,
  unbanMember,
  updateMemberRole,
  updateCoHost,
  updateRoomMeta,
  writePlayback,
} from './lib/firebase';
import { formatDuration } from './lib/youtube';
import type { BanRecord, ChatMessage, LoopMode, Member, PlaybackState, PublicRoom, QueueItem, Role, RoomMeta, SponsorSegment, VideoItem } from './types';

const EMPTY_PLAYBACK: PlaybackState = {
  video: null,
  status: 'paused',
  position: 0,
  volume: 80,
  updatedAt: 0,
  revision: 0,
  changedBy: '',
};

const SPONSOR_CATEGORY_OPTIONS = [
  ['sponsor', 'Sponsor'],
  ['selfpromo', 'Tự quảng bá'],
  ['interaction', 'Kêu gọi tương tác'],
  ['intro', 'Intro'],
  ['outro', 'Outro'],
  ['music_offtopic', 'Ngoài nội dung nhạc'],
] as const;

interface RecentRoom {
  roomId: string;
  name: string;
  role: Role;
  lastJoinedAt: number;
}

const RECENT_ROOMS_KEY = 'syncbox:recent-rooms';

function loadRecentRooms(): RecentRoom[] {
  try {
    const value = JSON.parse(localStorage.getItem(RECENT_ROOMS_KEY) ?? '[]') as RecentRoom[];
    return Array.isArray(value) ? value.filter((room) => room.roomId && room.name).slice(0, 6) : [];
  } catch {
    return [];
  }
}

function saveRecentRoom(roomId: string, name: string, role: Role): RecentRoom[] {
  const room: RecentRoom = { roomId, name, role, lastJoinedAt: Date.now() };
  const rooms = [room, ...loadRecentRooms().filter((item) => item.roomId !== roomId)].slice(0, 6);
  localStorage.setItem(RECENT_ROOMS_KEY, JSON.stringify(rooms));
  return rooms;
}

function routeFromHash() {
  const match = window.location.hash.match(/^#\/room\/([A-Z0-9]+)/i);
  return match ? { page: 'room' as const, roomId: match[1].toUpperCase() } : { page: 'home' as const };
}

function useHashRoute() {
  const [route, setRoute] = useState(routeFromHash);
  useEffect(() => {
    const update = () => setRoute(routeFromHash());
    window.addEventListener('hashchange', update);
    return () => window.removeEventListener('hashchange', update);
  }, []);
  return route;
}

function RolePicker({ value, onChange }: { value: 'listener' | 'dj'; onChange: (role: 'listener' | 'dj') => void }) {
  const isDj = value === 'dj';
  const nextRole = isDj ? 'listener' : 'dj';
  return (
    <button
      type="button"
      className={`role-toggle ${isDj ? 'dj' : 'listener'}`}
      title={isDj ? 'DJ · Bấm để chuyển thành Listener' : 'Listener · Bấm để cấp quyền DJ'}
      aria-label={isDj ? 'Chuyển thành Listener' : 'Cấp quyền DJ'}
      aria-pressed={isDj}
      onClick={() => onChange(nextRole)}
    >
      {isDj ? <Radio size={15} /> : <Headphones size={15} />}
    </button>
  );
}

export default function App() {
  const route = useHashRoute();
  return route.page === 'room' ? <RoomPage roomId={route.roomId} /> : <HomePage />;
}

function HomePage() {
  const [name, setName] = useState(() => localStorage.getItem('syncbox:name') ?? '');
  const [roomName, setRoomName] = useState('');
  const [roomCode, setRoomCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [recentRooms, setRecentRooms] = useState(loadRecentRooms);
  const [publicRooms, setPublicRooms] = useState<PublicRoom[]>([]);

  useEffect(() => {
    if (!firebaseConfigured) return;
    let unsubscribe: (() => void) | undefined;
    void ensureUser().then(() => { unsubscribe = subscribePublicRooms(setPublicRooms); }).catch(() => undefined);
    return () => unsubscribe?.();
  }, []);

  function saveName() {
    const cleaned = name.trim().slice(0, 32);
    if (!cleaned) throw new Error('Hãy nhập tên hiển thị của bạn.');
    localStorage.setItem('syncbox:name', cleaned);
    return cleaned;
  }

  async function handleCreate(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError('');
    try {
      const displayName = saveName();
      const id = await createRoom(roomName, displayName);
      setRecentRooms(saveRecentRoom(id, roomName.trim() || `${displayName}'s room`, 'host'));
      window.location.hash = `#/room/${id}`;
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Không thể tạo phòng.');
    } finally {
      setBusy(false);
    }
  }

  async function handleJoin(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError('');
    try {
      const displayName = saveName();
      const { roomId, role, roomName: joinedRoomName } = await joinRoom(roomCode, displayName);
      setRecentRooms(saveRecentRoom(roomId, joinedRoomName, role));
      window.location.hash = `#/room/${roomId}`;
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Không thể vào phòng.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="home-page">
      <nav className="home-nav">
        <Brand />
        <a href="#how-it-works">Cách hoạt động</a>
      </nav>
      <section className="hero">
        <div className="hero-copy">
          <div className="eyebrow"><span className="live-dot" /> YouTube, cùng một nhịp</div>
          <h1>Nghe cùng nhau.<br /><em>Không còn xao nhãng.</em></h1>
          <p>Tạo một phòng, xếp hàng những video bạn thích và giữ mọi thiết bị đồng bộ — dù mọi người ở đâu.</p>
          <div className="hero-points">
            <span><ShieldCheck size={17} /> Không cần tài khoản</span>
            <span><Sparkles size={17} /> SponsorBlock tích hợp</span>
          </div>
        </div>
        <div className="room-card">
          <div className="room-card-tabs"><span className="active">Tạo phòng</span><span>hoặc tham gia bên dưới</span></div>
          {!firebaseConfigured && (
            <div className="setup-warning"><Settings2 size={18} /><div><strong>Cần cấu hình Firebase</strong><span>Sao chép .env.example thành .env.local và điền thông tin dự án.</span></div></div>
          )}
          <label>Tên của bạn<input value={name} onChange={(event) => setName(event.target.value)} placeholder="Ví dụ: Huy" maxLength={32} /></label>
          <form onSubmit={handleCreate}>
            <label>Tên phòng<input value={roomName} onChange={(event) => setRoomName(event.target.value)} placeholder="Friday focus" maxLength={60} /></label>
            <button className="primary-button" disabled={busy || !firebaseConfigured}>
              {busy ? <LoaderCircle className="spin" size={19} /> : <Radio size={19} />} Tạo phòng mới
            </button>
          </form>
          <div className="or"><span />hoặc<span /></div>
          <form className="join-row" onSubmit={handleJoin}>
            <input value={roomCode} onChange={(event) => setRoomCode(event.target.value.toUpperCase())} placeholder="Mã phòng" maxLength={8} />
            <button disabled={busy || !roomCode.trim() || !firebaseConfigured}>Tham gia <ChevronRight size={17} /></button>
          </form>
          {error && <p className="form-error">{error}</p>}
          {recentRooms.length > 0 && (
            <div className="recent-rooms">
              <div className="recent-heading"><span><History size={15} /> Phòng gần đây</span><small>{recentRooms.length}/6</small></div>
              <div className="recent-list">
                {recentRooms.map((room) => (
                  <article className="recent-room" key={room.roomId}>
                    <a href={`#/room/${room.roomId}`}>
                      <span className="recent-room-icon">{room.name.slice(0, 1).toUpperCase()}</span>
                      <span className="recent-room-copy"><strong>{room.name}</strong><small>{room.roomId} · {room.role === 'host' ? 'Host' : room.role === 'dj' ? 'DJ' : 'Listener'}</small></span>
                      <ChevronRight size={16} />
                    </a>
                    <button aria-label={`Xóa ${room.name} khỏi phòng gần đây`} onClick={() => {
                      const next = recentRooms.filter((item) => item.roomId !== room.roomId);
                      localStorage.setItem(RECENT_ROOMS_KEY, JSON.stringify(next));
                      setRecentRooms(next);
                    }}><Trash2 size={14} /></button>
                  </article>
                ))}
              </div>
            </div>
          )}
        </div>
      </section>
      <section className="public-section">
        <div className="public-heading"><div><span><Compass size={16} /> KHÁM PHÁ</span><h2>Phòng đang mở</h2></div><small>{publicRooms.length} phòng công khai</small></div>
        {publicRooms.length > 0 ? <div className="public-grid">{publicRooms.slice(0, 8).map((room) => (
          <a className="public-room" href={`#/room/${room.roomId}`} key={room.roomId}>
            <span className="public-room-art"><AudioWaveform size={20} /></span>
            <span><strong>{room.name}</strong><small>{room.roomId} · Tham gia ngay</small></span>
            <ChevronRight size={17} />
          </a>
        ))}</div> : <div className="public-empty"><Compass /><span>Chưa có phòng công khai</span><small>Bật “Phòng công khai” trong cài đặt room để xuất hiện ở đây.</small></div>}
      </section>
      <section className="how" id="how-it-works">
        <article><span>01</span><Headphones /><h3>Tạo một phòng</h3><p>Không cần đăng ký. Chỉ cần đặt tên và chia sẻ mã phòng.</p></article>
        <article><span>02</span><ListMusic /><h3>Cùng xây queue</h3><p>Dán link hoặc nhập từ khóa rồi Enter để tìm kiếm YouTube.</p></article>
        <article><span>03</span><WandSparkles /><h3>Phát đồng bộ</h3><p>Play, pause, seek và SponsorBlock áp dụng cho toàn bộ phòng.</p></article>
      </section>
      <footer className="home-footer"><Brand /><span>Một không gian nghe YouTube sạch và cộng tác.</span></footer>
    </main>
  );
}

function expectedPosition(playback: PlaybackState, serverOffset = 0) {
  if (playback.status !== 'playing' || typeof playback.updatedAt !== 'number') return playback.position;
  return Math.max(0, playback.position + (Date.now() + serverOffset - playback.updatedAt) / 1000);
}

function RoomPage({ roomId }: { roomId: string }) {
  const [uid, setUid] = useState('');
  const [meta, setMeta] = useState<RoomMeta | null>(null);
  const [playback, setPlayback] = useState<PlaybackState>(EMPTY_PLAYBACK);
  const [queue, setQueue] = useState<QueueItem[]>([]);
  const [members, setMembers] = useState<Member[]>([]);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [bans, setBans] = useState<BanRecord[]>([]);
  const [segments, setSegments] = useState<SponsorSegment[]>([]);
  const [activePanel, setActivePanel] = useState<'queue' | 'chat' | 'people'>('queue');
  const [chatText, setChatText] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [needsActivation, setNeedsActivation] = useState(false);
  const [fullscreen, setFullscreen] = useState(false);
  const [copied, setCopied] = useState(false);
  const [displayPosition, setDisplayPosition] = useState(0);
  const [localVolume, setLocalVolume] = useState(() => Number(localStorage.getItem('syncbox:volume') ?? 80));
  const [controlBusy, setControlBusy] = useState(false);
  const [connected, setConnected] = useState<boolean | null>(null);
  const [serverOffset, setServerOffset] = useState(0);
  const [notice, setNotice] = useState<{ message: string; tone: 'success' | 'error' } | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settingsSponsorEnabled, setSettingsSponsorEnabled] = useState(false);
  const [settingsSponsorCategories, setSettingsSponsorCategories] = useState<string[]>([]);
  const [helpOpen, setHelpOpen] = useState(false);
  const [draggedQueueId, setDraggedQueueId] = useState<string | null>(null);
  const [dropTarget, setDropTarget] = useState<{ queueId: string; position: 'before' | 'after' } | null>(null);
  const [undoQueue, setUndoQueue] = useState<{ items: QueueItem[]; label: string } | null>(null);
  const playerRef = useRef<PlayerHandle>(null);
  const videoStageRef = useRef<HTMLDivElement>(null);
  const lastSponsorSkip = useRef('');
  const pendingQueueStart = useRef<string | null>(null);
  const undoTimer = useRef<number | undefined>(undefined);

  const me = useMemo(() => members.find((member) => member.uid === uid), [members, uid]);
  const isOwner = Boolean(uid && meta?.hostUid === uid);
  const isCoHost = Boolean(uid && meta?.coHosts?.[uid]);
  const isHost = isOwner || isCoHost;
  const canManageQueue = isHost || me?.role === 'dj';
  const canControlPlayback = isHost || me?.role === 'dj';
  const canAdd = canManageQueue || Boolean(meta?.allowListenersToAdd);
  const sponsorCategoryKey = meta?.sponsorCategories.join(',') ?? 'sponsor';
  const loopMode: LoopMode = meta?.loopMode ?? 'off';
  const queueDuration = useMemo(() => queue.reduce((total, item) => total + (item.duration ?? 0), 0), [queue]);

  function showNotice(message: string, tone: 'success' | 'error' = 'success') {
    setNotice({ message, tone });
    window.setTimeout(() => setNotice(null), 2600);
  }

  useEffect(() => {
    let active = true;
    let joinedUid = '';
    const unsubscribes: Array<() => void> = [];
    async function connect() {
      try {
        const displayName = localStorage.getItem('syncbox:name') || `Guest ${Math.floor(Math.random() * 900 + 100)}`;
        localStorage.setItem('syncbox:name', displayName);
        const user = await ensureUser();
        if (!active) return;
        setUid(user.uid);
        joinedUid = user.uid;
        const joined = await joinRoom(roomId, displayName);
        saveRecentRoom(joined.roomId, joined.roomName, joined.role);
        const handleAccessError = () => { if (active) setError('Bạn đã bị đưa khỏi phòng hoặc không còn quyền truy cập.'); };
        unsubscribes.push(
          subscribeConnection(setConnected),
          subscribeServerOffset(setServerOffset),
          subscribeRoom<RoomMeta | null>(roomId, 'meta', setMeta, handleAccessError),
          subscribeRoom<PlaybackState | null>(roomId, 'playback', (value) => setPlayback(value ?? EMPTY_PLAYBACK), handleAccessError),
          subscribeRoom<Record<string, Omit<QueueItem, 'queueId'>> | null>(roomId, 'queue', (value) => setQueue(normalizeQueue(value)), handleAccessError),
          subscribeRoom<Record<string, Member> | null>(roomId, 'members', (value) => setMembers(normalizeMembers(value)), handleAccessError),
          subscribeRoom<Record<string, Omit<ChatMessage, 'id'>> | null>(roomId, 'messages', (value) => setMessages(normalizeMessages(value)), handleAccessError),
        );
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : 'Không thể kết nối đến phòng.');
      } finally {
        if (active) setLoading(false);
      }
    }
    void connect();
    return () => {
      active = false;
      unsubscribes.forEach((unsubscribe) => unsubscribe());
      if (joinedUid) void setMemberOnline(roomId, joinedUid, false).catch(() => undefined);
    };
  }, [roomId]);

  useEffect(() => {
    if (!isHost) {
      setBans([]);
      return;
    }
    return subscribeRoom<Record<string, BanRecord> | null>(roomId, 'bans', (value) => setBans(value ? Object.values(value).sort((a, b) => b.bannedAt - a.bannedAt) : []));
  }, [isHost, roomId]);

  useEffect(() => () => window.clearTimeout(undoTimer.current), []);

  useEffect(() => {
    const updateFullscreen = () => {
      const webkitDocument = document as Document & { webkitFullscreenElement?: Element | null };
      setFullscreen((document.fullscreenElement ?? webkitDocument.webkitFullscreenElement) === videoStageRef.current);
    };
    document.addEventListener('fullscreenchange', updateFullscreen);
    document.addEventListener('webkitfullscreenchange', updateFullscreen);
    return () => {
      document.removeEventListener('fullscreenchange', updateFullscreen);
      document.removeEventListener('webkitfullscreenchange', updateFullscreen);
    };
  }, []);

  useEffect(() => {
    if (!helpOpen) return;
    const closeOnEscape = (event: KeyboardEvent) => { if (event.key === 'Escape') setHelpOpen(false); };
    document.addEventListener('keydown', closeOnEscape);
    return () => document.removeEventListener('keydown', closeOnEscape);
  }, [helpOpen]);

  useEffect(() => {
    if (!meta || !uid || !connected || (!isCoHost && me?.role !== 'dj') || members.some((member) => member.uid === meta.hostUid)) return;
    const timer = window.setTimeout(() => {
      void transferHost(roomId, uid).then(() => setNotice({ message: 'Bạn đã tiếp quản Owner vì Owner cũ mất kết nối.', tone: 'success' })).catch(() => undefined);
    }, 15000);
    return () => window.clearTimeout(timer);
  }, [connected, isCoHost, me?.role, members, meta, roomId, uid]);

  useEffect(() => {
    if (!connected || !uid) return;
    const displayName = localStorage.getItem('syncbox:name') || 'Guest';
    void joinRoom(roomId, displayName).catch((cause) => {
      setNotice({ message: cause instanceof Error ? cause.message : 'Không thể kết nối lại phòng.', tone: 'error' });
    });
  }, [connected, roomId, uid]);

  useEffect(() => {
    if (!isOwner || !me) return;
    const changes: Array<Promise<void>> = [];
    if (me.role !== 'host') changes.push(updateMemberRole(roomId, uid, 'host'));
    members.filter((member) => member.uid !== uid && member.role === 'host').forEach((member) => {
      changes.push(updateMemberRole(roomId, member.uid, 'listener'));
    });
    if (meta?.expiresAt && meta.expiresAt < Date.now() + 6 * 24 * 60 * 60 * 1000) {
      changes.push(renewRoomExpiration(roomId, Date.now() + 7 * 24 * 60 * 60 * 1000));
    }
    void Promise.all(changes).catch(() => undefined);
  }, [isOwner, me, members, meta?.expiresAt, roomId, uid]);

  useEffect(() => {
    if (!playback.video?.id || !meta?.sponsorBlockEnabled) {
      setSegments([]);
      return;
    }
    let active = true;
    getSponsorSegments(playback.video.id, sponsorCategoryKey.split(',')).then((items) => active && setSegments(items));
    return () => { active = false; };
  }, [playback.video?.id, meta?.sponsorBlockEnabled, sponsorCategoryKey]);

  const conformPlayer = useCallback(() => {
    const player = playerRef.current;
    if (!player || !playback.video) return;
    const expected = expectedPosition(playback, serverOffset);
    const actual = player.currentTime();
    player.setVolume(localVolume);
    if (playback.status === 'playing') {
      if (Math.abs(actual - expected) > 1.5) player.seek(expected);
      player.play();
    } else {
      // Pause before correcting the timestamp so the iframe cannot advance
      // while seekTo is being processed asynchronously.
      player.pause();
      if (Math.abs(actual - expected) > 0.25) player.seek(expected);
    }
  }, [localVolume, playback, serverOffset]);

  useEffect(() => {
    const timer = window.setTimeout(conformPlayer, 250);
    return () => window.clearTimeout(timer);
  }, [conformPlayer]);

  useEffect(() => {
    const timer = window.setInterval(() => {
      setDisplayPosition(playerRef.current?.currentTime() ?? expectedPosition(playback, serverOffset));
    }, 500);
    return () => window.clearInterval(timer);
  }, [playback, serverOffset]);

  useEffect(() => {
    const timer = window.setInterval(() => {
      if (!playback.video || playback.status !== 'playing') return;
      const player = playerRef.current;
      if (!player) return;
      const expected = expectedPosition(playback, serverOffset);
      if (Math.abs(player.currentTime() - expected) > 2.5) player.seek(expected);

      if (!isOwner || !meta?.sponsorBlockEnabled) return;
      const current = player.currentTime();
      const match = segments.find(({ segment, actionType }) => actionType === 'skip' && current >= segment[0] && current < segment[1] - 0.2);
      if (!match) return;
      const key = `${playback.video?.id}:${match.segment[0]}`;
      if (lastSponsorSkip.current === key) return;
      lastSponsorSkip.current = key;
      void writePlayback(roomId, uid, { position: match.segment[1], status: 'playing', reason: 'sponsorblock' });
    }, 500);
    return () => window.clearInterval(timer);
  }, [isOwner, meta?.sponsorBlockEnabled, playback, roomId, segments, serverOffset, uid]);

  async function addToQueue(videos: VideoItem[]) {
    if (!me) return;
    const existingIds = new Set(queue.map((item) => item.id));
    const unique = videos.filter((video, index) => !existingIds.has(video.id) && videos.findIndex((item) => item.id === video.id) === index);
    if (!unique.length) {
      showNotice('Video này đã có trong queue.', 'error');
      return;
    }
    await addVideos(roomId, unique, me);
    if (!playback.video && unique[0]) {
      pendingQueueStart.current = unique[0].id;
      await writePlayback(roomId, uid, { video: unique[0], status: 'paused', position: 0, reason: 'queue' });
    }
    showNotice(`Đã thêm ${unique.length} video vào queue.`);
  }

  function offerUndo(items: QueueItem[], label: string) {
    window.clearTimeout(undoTimer.current);
    setUndoQueue({ items, label });
    undoTimer.current = window.setTimeout(() => setUndoQueue(null), 7000);
  }

  async function undoQueueChange() {
    if (!undoQueue) return;
    try {
      await restoreQueueItems(roomId, undoQueue.items);
      setUndoQueue(null);
      window.clearTimeout(undoTimer.current);
      showNotice('Đã khôi phục queue.');
    } catch (cause) {
      showNotice(cause instanceof Error ? cause.message : 'Không thể hoàn tác.', 'error');
    }
  }

  async function moveQueueItem(targetQueueId: string, position: 'before' | 'after') {
    if (!canManageQueue || !draggedQueueId || draggedQueueId === targetQueueId) return;
    const next = [...queue];
    const from = next.findIndex((item) => item.queueId === draggedQueueId);
    if (from < 0) return;
    const [moved] = next.splice(from, 1);
    const targetIndex = next.findIndex((item) => item.queueId === targetQueueId);
    if (targetIndex < 0) return;
    next.splice(targetIndex + (position === 'after' ? 1 : 0), 0, moved);
    setDraggedQueueId(null);
    setDropTarget(null);
    try {
      await reorderQueue(roomId, next.map((item) => item.queueId));
      offerUndo([...queue], `Đã di chuyển “${moved.title}”`);
    } catch (cause) {
      showNotice(cause instanceof Error ? cause.message : 'Không thể đổi thứ tự queue.', 'error');
    }
  }

  async function moveQueueBy(queueId: string, direction: -1 | 1) {
    if (!canManageQueue) return;
    const index = queue.findIndex((item) => item.queueId === queueId);
    const target = index + direction;
    if (index < 0 || target < 0 || target >= queue.length) return;
    const next = [...queue];
    [next[index], next[target]] = [next[target], next[index]];
    try {
      await reorderQueue(roomId, next.map((item) => item.queueId));
      offerUndo([...queue], `Đã di chuyển “${queue[index].title}”`);
    } catch (cause) {
      showNotice(cause instanceof Error ? cause.message : 'Không thể đổi thứ tự queue.', 'error');
    }
  }

  async function handleRemoveQueueItem(item: QueueItem) {
    try {
      await removeQueueItem(roomId, item.queueId);
      offerUndo([item], `Đã xóa “${item.title}”`);
    } catch (cause) {
      showNotice(cause instanceof Error ? cause.message : 'Không thể xóa bài.', 'error');
    }
  }

  async function handleClearQueue() {
    if (!queue.length) return;
    const removed = [...queue];
    try {
      await clearQueue(roomId);
      offerUndo(removed, `Đã xóa ${removed.length} bài khỏi queue`);
    } catch (cause) {
      showNotice(cause instanceof Error ? cause.message : 'Không thể xóa queue.', 'error');
    }
  }

  async function control(status: 'playing' | 'paused') {
    if (!canControlPlayback || controlBusy) return;
    const player = playerRef.current;
    setControlBusy(true);
    try {
      if (status === 'paused') {
        pendingQueueStart.current = null;
        // Freeze locally first; otherwise the video keeps moving during the
        // Firebase round trip and that later timestamp can leak into Play.
        player?.pause();
        const position = player?.currentTime() ?? expectedPosition(playback, serverOffset);
        setDisplayPosition(position);
        await writePlayback(roomId, uid, { status, position, reason: 'control' });
      } else {
        // A paused room has one canonical timestamp. Do not read a potentially
        // drifting iframe position when resuming.
        const position = playback.status === 'paused'
          ? playback.position
          : player?.currentTime() ?? expectedPosition(playback, serverOffset);
        await writePlayback(roomId, uid, { status, position, reason: 'control' });
        player?.seek(position);
        player?.play();
      }
    } catch (cause) {
      conformPlayer();
      showNotice(cause instanceof Error ? cause.message : 'Không thể đồng bộ phát nhạc.', 'error');
    } finally {
      setControlBusy(false);
    }
  }

  async function skip(mode: LoopMode = 'off') {
    if (!canControlPlayback) return;
    const foundIndex = playback.video ? queue.findIndex((item) => item.id === playback.video?.id) : -1;
    const currentIndex = foundIndex >= 0 ? foundIndex : 0;
    const current = queue[currentIndex];
    const next = queue.length > 1 ? queue[(currentIndex + 1) % queue.length] : undefined;
    const target = mode === 'one' || (mode === 'all' && !next) ? current : next;
    pendingQueueStart.current = target?.id ?? null;
    await advanceQueue(roomId, uid, queue, playback.video?.id, playback.volume, mode);
    if (target && target.id === playback.video?.id) {
      pendingQueueStart.current = null;
      playerRef.current?.seek(0);
      await writePlayback(roomId, uid, { status: 'playing', position: 0, reason: 'queue' });
      playerRef.current?.play();
    }
  }

  async function cycleLoopMode() {
    if (!isHost) return;
    const next: LoopMode = loopMode === 'off' ? 'one' : loopMode === 'one' ? 'all' : 'off';
    await updateRoomMeta(roomId, { loopMode: next });
  }

  async function seekTo(position: number) {
    if (!isHost) return;
    playerRef.current?.seek(position);
    await writePlayback(roomId, uid, { position, status: playback.status, reason: 'control' });
  }

  function setDeviceVolume(volume: number) {
    setLocalVolume(volume);
    localStorage.setItem('syncbox:volume', String(volume));
    playerRef.current?.setVolume(volume);
  }

  async function toggleFullscreen() {
    const stage = videoStageRef.current;
    if (!stage) return;
    const webkitDocument = document as Document & {
      webkitFullscreenElement?: Element | null;
      webkitExitFullscreen?: () => Promise<void> | void;
    };
    const webkitStage = stage as HTMLDivElement & { webkitRequestFullscreen?: () => Promise<void> | void };
    try {
      if (document.fullscreenElement || webkitDocument.webkitFullscreenElement) {
        if (document.exitFullscreen) await document.exitFullscreen();
        else await webkitDocument.webkitExitFullscreen?.();
      } else if (stage.requestFullscreen) {
        await stage.requestFullscreen();
      } else {
        await webkitStage.webkitRequestFullscreen?.();
      }
    } catch {
      showNotice('Trình duyệt không cho phép mở toàn màn hình.', 'error');
    }
  }

  async function playQueueItem(item: QueueItem) {
    if (!canControlPlayback) return;
    pendingQueueStart.current = item.id;
    await writePlayback(roomId, uid, { video: item, status: 'paused', position: 0, reason: 'queue' });
    if (item.id === playback.video?.id) {
      pendingQueueStart.current = null;
      playerRef.current?.seek(0);
      await writePlayback(roomId, uid, { status: 'playing', position: 0, reason: 'queue' });
      playerRef.current?.play();
    }
  }

  const handlePlayerCued = useCallback((videoId: string) => {
    if (pendingQueueStart.current !== videoId) return;
    pendingQueueStart.current = null;
    void writePlayback(roomId, uid, { status: 'playing', position: 0, reason: 'queue' }).catch((cause) => {
      showNotice(cause instanceof Error ? cause.message : 'Không thể bắt đầu video.', 'error');
    });
  }, [roomId, uid]);

  async function submitChat(event: FormEvent) {
    event.preventDefault();
    if (!chatText.trim() || !me || meta?.chatEnabled === false) return;
    const text = chatText;
    setChatText('');
    try {
      await sendChat(roomId, uid, me.name, text);
    } catch (cause) {
      setChatText(text);
      showNotice(cause instanceof Error ? cause.message : 'Bạn đang gửi tin nhắn quá nhanh.', 'error');
    }
  }

  async function copyInvite() {
    await navigator.clipboard.writeText(window.location.href);
    setCopied(true);
    showNotice('Đã sao chép link mời.');
    window.setTimeout(() => setCopied(false), 1600);
  }

  async function saveSettings(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!isHost) return;
    const form = new FormData(event.currentTarget);
    if (settingsSponsorEnabled && !settingsSponsorCategories.length) {
      showNotice('Hãy chọn ít nhất một loại phân đoạn cho SponsorBlock.', 'error');
      return;
    }
    try {
      await saveRoomSettings(roomId, {
        ...meta!,
        name: String(form.get('name') ?? '').trim().slice(0, 60) || meta?.name || 'Syncbox room',
        isPublic: form.get('isPublic') === 'on',
        allowListenersToAdd: form.get('allowListenersToAdd') === 'on',
        chatEnabled: form.get('chatEnabled') === 'on',
        sponsorBlockEnabled: settingsSponsorEnabled,
        sponsorCategories: settingsSponsorEnabled
          ? settingsSponsorCategories
          : meta?.sponsorCategories?.length ? meta.sponsorCategories : ['sponsor'],
        expiresAt: Date.now() + 7 * 24 * 60 * 60 * 1000,
      });
      setSettingsOpen(false);
      showNotice('Đã lưu cài đặt phòng.');
    } catch (cause) {
      showNotice(cause instanceof Error ? cause.message : 'Không thể lưu cài đặt.', 'error');
    }
  }

  function openSettings() {
    setSettingsSponsorEnabled(Boolean(meta?.sponsorBlockEnabled));
    setSettingsSponsorCategories(meta?.sponsorBlockEnabled ? [...(meta.sponsorCategories ?? [])] : []);
    setSettingsOpen(true);
  }

  async function handOffHost(member: Member) {
    if (!isOwner || !window.confirm(`Chuyển quyền Owner cho ${member.name}?`)) return;
    try {
      await transferHost(roomId, member.uid);
      showNotice(`${member.name} hiện là Owner mới.`);
    } catch (cause) {
      showNotice(cause instanceof Error ? cause.message : 'Không thể chuyển Owner.', 'error');
    }
  }

  async function setCoHost(member: Member, enabled: boolean) {
    if (!isOwner) return;
    try {
      await updateCoHost(roomId, member.uid, enabled);
      showNotice(enabled ? `${member.name} hiện là Co-host.` : `Đã thu hồi quyền Co-host của ${member.name}.`);
    } catch (cause) {
      showNotice(cause instanceof Error ? cause.message : 'Không thể cập nhật Co-host.', 'error');
    }
  }

  async function handleCloseRoom() {
    if (!isOwner || !window.confirm('Đóng phòng và xóa toàn bộ queue, chat, thành viên? Thao tác này không thể hoàn tác.')) return;
    try {
      await closeRoom(roomId);
      localStorage.setItem(RECENT_ROOMS_KEY, JSON.stringify(loadRecentRooms().filter((room) => room.roomId !== roomId)));
      window.location.hash = '#/';
    } catch (cause) {
      showNotice(cause instanceof Error ? cause.message : 'Không thể đóng phòng.', 'error');
    }
  }

  function canModerate(member: Member) {
    if (member.uid === uid || member.uid === meta?.hostUid) return false;
    if (isOwner) return true;
    return isCoHost && !meta?.coHosts?.[member.uid];
  }

  async function handleKick(member: Member) {
    if (!canModerate(member) || !window.confirm(`Đưa ${member.name} khỏi phòng? Người này vẫn có thể tham gia lại.`)) return;
    try {
      await kickMember(roomId, member.uid);
      showNotice(`Đã đưa ${member.name} khỏi phòng.`);
    } catch (cause) {
      showNotice(cause instanceof Error ? cause.message : 'Không thể kick thành viên.', 'error');
    }
  }

  async function handleBan(member: Member) {
    if (!canModerate(member) || !window.confirm(`Cấm ${member.name} tham gia lại phòng này?`)) return;
    try {
      await banMember(roomId, member, uid);
      showNotice(`Đã cấm ${member.name}.`);
    } catch (cause) {
      showNotice(cause instanceof Error ? cause.message : 'Không thể ban thành viên.', 'error');
    }
  }

  if (loading) return <div className="center-screen"><LoaderCircle className="spin" /><span>Đang vào phòng {roomId}…</span></div>;
  if (error || !meta) return (
    <div className="center-screen error-screen"><Brand /><h2>Không thể mở phòng</h2><p>{error || 'Phòng không còn tồn tại.'}</p><a className="primary-button" href="#/">Về trang chủ</a></div>
  );

  return (
    <main className="room-page">
      <header className="room-header">
        <Brand />
        <div className="room-identity"><span>{meta.name}</span><small>{meta.isPublic ? <Globe2 size={12} /> : <LockKeyhole size={12} />} {meta.isPublic ? 'Phòng công khai' : 'Phòng riêng tư'} · {roomId}</small></div>
        <div className="room-actions">
          <span className="online-pill"><i /> {members.length} đang nghe</span>
          <button onClick={() => setHelpOpen(true)}><CircleHelp size={17} /> Hướng dẫn</button>
          <button onClick={() => void copyInvite()}><Share2 size={17} /> {copied ? 'Đã sao chép' : 'Mời bạn bè'}</button>
          {isHost && <button onClick={openSettings}><Settings2 size={17} /> Cài đặt</button>}
          <button className="avatar-button" title={me?.name}>{me?.name?.slice(0, 1).toUpperCase()}</button>
        </div>
      </header>

      {connected === false && <div className="connection-banner"><WifiOff size={15} /> Mất kết nối — đang thử kết nối lại…</div>}
      {notice && <div className={`toast ${notice.tone}`}><span>{notice.message}</span><button onClick={() => setNotice(null)}><X size={14} /></button></div>}

      <div className="room-shell">
        <section className="player-column">
          <SearchPanel canAdd={Boolean(canAdd)} onAdd={addToQueue} />

          <div className="video-stage" ref={videoStageRef}>
            {playback.video ? (
              <YouTubePlayer
                ref={playerRef}
                videoId={playback.video.id}
                startSeconds={expectedPosition(playback, serverOffset)}
                onReady={conformPlayer}
                onCued={handlePlayerCued}
                onEnded={() => { if (isOwner) void skip(loopMode); }}
                onAutoplayBlocked={() => setNeedsActivation(true)}
              />
            ) : (
              <div className="empty-player"><div><ListMusic size={34} /><span>Queue đang trống</span><small>Dán một link YouTube để bắt đầu.</small></div></div>
            )}
            {needsActivation && playback.video && (
              <button className="activation-overlay" onClick={() => { playerRef.current?.activate(); setNeedsActivation(false); }}><Volume2 /> Bật âm thanh trên thiết bị này</button>
            )}
            {playback.reason === 'sponsorblock' && <div className="skip-toast"><Sparkles size={15} /> Đã bỏ qua sponsor</div>}
            <button className="fullscreen-button" title={fullscreen ? 'Thoát toàn màn hình' : 'Toàn màn hình'} aria-label={fullscreen ? 'Thoát toàn màn hình' : 'Mở toàn màn hình'} onClick={() => void toggleFullscreen()} disabled={!playback.video}>
              {fullscreen ? <Minimize2 /> : <Maximize2 />}
            </button>
          </div>

          <div className="now-playing">
            <div className="track-art">{playback.video ? <img src={playback.video.thumbnail} alt="" /> : <ListMusic />}</div>
            <div className="track-copy"><span>ĐANG PHÁT</span><strong>{playback.video?.title ?? 'Chưa có video'}</strong><small>{playback.video?.channel ?? 'Thêm bài đầu tiên vào queue'}</small></div>
            <div className="room-controls">
              <button className="control-main" onClick={() => void control(playback.status === 'playing' ? 'paused' : 'playing')} disabled={!canControlPlayback || !playback.video || controlBusy}>
                {controlBusy ? <LoaderCircle className="spin" /> : playback.status === 'playing' ? <Pause fill="currentColor" /> : <Play fill="currentColor" />}
              </button>
              <button onClick={() => void skip(loopMode === 'one' ? 'off' : loopMode)} disabled={!canControlPlayback || !playback.video}><SkipForward /></button>
              <button
                className={`loop-button ${loopMode !== 'off' ? 'active' : ''}`}
                onClick={() => void cycleLoopMode()}
                disabled={!isHost}
                aria-label={loopMode === 'off' ? 'Bật lặp một bài' : loopMode === 'one' ? 'Bật lặp queue' : 'Tắt lặp'}
                title={loopMode === 'off' ? 'Không lặp' : loopMode === 'one' ? 'Lặp một bài' : 'Lặp queue'}
              >
                <Repeat2 />
                {loopMode === 'one' && <span>1</span>}
              </button>
            </div>
          </div>
          <div className="timeline-controls">
            <span>{formatDuration(displayPosition) || '0:00'}</span>
            <input
              aria-label="Vị trí phát"
              type="range"
              min="0"
              max={Math.max(1, playerRef.current?.duration() || playback.video?.duration || 1)}
              step="1"
              value={Math.min(displayPosition, playerRef.current?.duration() || playback.video?.duration || 1)}
              disabled={!isHost || !playback.video}
              onChange={(event) => setDisplayPosition(Number(event.target.value))}
              onPointerUp={(event) => void seekTo(Number((event.target as HTMLInputElement).value))}
              onKeyUp={(event) => { if (event.key === 'Enter') void seekTo(Number((event.target as HTMLInputElement).value)); }}
            />
            <span>{formatDuration(playerRef.current?.duration() || playback.video?.duration) || '0:00'}</span>
            <Volume2 size={15} />
            <input
              className="volume-slider"
              aria-label="Âm lượng thiết bị"
              type="range"
              min="0"
              max="100"
              value={localVolume}
              onChange={(event) => setDeviceVolume(Number(event.target.value))}
            />
          </div>

          <div className="room-note"><ShieldCheck size={15} /><span>Video được phát trực tiếp từ YouTube. Syncbox chỉ đồng bộ trạng thái phòng.</span></div>
        </section>

        <aside className="side-panel">
          <div className="panel-tabs">
            <button className={activePanel === 'queue' ? 'active' : ''} onClick={() => setActivePanel('queue')}><ListMusic /> Queue <span>{queue.length}</span></button>
            <button className={activePanel === 'chat' ? 'active' : ''} onClick={() => setActivePanel('chat')}><MessageCircle /> Chat {messages.length > 0 && <span>{messages.length}</span>}</button>
            <button className={activePanel === 'people' ? 'active' : ''} onClick={() => setActivePanel('people')}><Users /> Người</button>
          </div>

          {activePanel === 'queue' && (
            <div className="panel-body queue-panel">
              <div className="panel-title">
                <div><strong>Tiếp theo</strong><span>{queue.length} video {queueDuration > 0 ? `· ${formatDuration(queueDuration)}` : ''}</span></div>
                {canManageQueue && queue.length > 0 && <button className="clear-queue" onClick={() => void handleClearQueue()}><Trash2 size={14} /> Xóa hết</button>}
              </div>
              <div className="queue-list">
                {queue.map((item, index) => (
                  <article
                    className={`queue-item ${playback.video?.id === item.id ? 'current' : ''} ${draggedQueueId === item.queueId ? 'dragging' : ''} ${dropTarget?.queueId === item.queueId ? `drop-${dropTarget.position}` : ''}`}
                    key={item.queueId}
                    draggable={Boolean(canManageQueue)}
                    onDragStart={() => setDraggedQueueId(item.queueId)}
                    onDragEnd={() => { setDraggedQueueId(null); setDropTarget(null); }}
                    onDragOver={(event) => {
                      if (!canManageQueue || draggedQueueId === item.queueId) return;
                      event.preventDefault();
                      const bounds = event.currentTarget.getBoundingClientRect();
                      setDropTarget({ queueId: item.queueId, position: event.clientY < bounds.top + bounds.height / 2 ? 'before' : 'after' });
                    }}
                    onDrop={() => { if (dropTarget) void moveQueueItem(item.queueId, dropTarget.position); }}
                  >
                    <button className="queue-thumb" disabled={!canControlPlayback} onClick={() => void playQueueItem(item)}>
                      <img src={item.thumbnail} alt="" />
                      <span>{playback.video?.id === item.id ? <Volume2 size={16} /> : index + 1}</span>
                    </button>
                    <div><strong>{item.title}</strong><span>{item.channel}</span><small>thêm bởi {item.addedByName} {item.duration ? `· ${formatDuration(item.duration)}` : ''}</small></div>
                    <div className="queue-item-actions">
                      <button className={`queue-vote ${item.votes?.[uid] ? 'active' : ''}`} title="Bình chọn bài này" onClick={() => void toggleQueueVote(roomId, item.queueId, uid, Boolean(item.votes?.[uid])).catch((cause) => showNotice(cause instanceof Error ? cause.message : 'Không thể bình chọn.', 'error'))}><ThumbsUp size={13} /><span>{Object.keys(item.votes ?? {}).length || ''}</span></button>
                      {canManageQueue && <span className="queue-move-buttons"><button title="Đưa lên" disabled={index === 0} onClick={() => void moveQueueBy(item.queueId, -1)}><ArrowUp size={12} /></button><button title="Đưa xuống" disabled={index === queue.length - 1} onClick={() => void moveQueueBy(item.queueId, 1)}><ArrowDown size={12} /></button></span>}
                      {canManageQueue && <GripVertical className="queue-grip" size={15} />}
                      {isHost && <button className="queue-remove" onClick={() => void handleRemoveQueueItem(item)}><Trash2 size={15} /></button>}
                    </div>
                  </article>
                ))}
                {queue.length === 0 && <div className="empty-list"><ListMusic /><span>Chưa có bài nào</span><small>Thêm link hoặc tìm kiếm để xây queue.</small></div>}
              </div>
              {isHost && (
                <div className="sponsor-setting">
                  <div><Sparkles size={17} /><span><strong>SponsorBlock</strong><small>Tự động bỏ qua sponsor · <a href="https://sponsor.ajay.app" target="_blank" rel="noreferrer">dữ liệu cộng đồng</a></small></span></div>
                  <label className="toggle"><input type="checkbox" checked={meta.sponsorBlockEnabled} onChange={(event) => void updateRoomMeta(roomId, { sponsorBlockEnabled: event.target.checked })} /><span /></label>
                </div>
              )}
            </div>
          )}

          {activePanel === 'chat' && (
            <div className="panel-body chat-panel">
              <div className="messages">
                {messages.map((message) => <div className={`message ${message.uid === uid ? 'mine' : ''}`} key={message.id}><span>{message.name}</span><p>{message.text}</p></div>)}
                {messages.length === 0 && <div className="empty-list"><MessageCircle /><span>{meta.chatEnabled === false ? 'Chat đang được Host tắt' : 'Cuộc trò chuyện bắt đầu ở đây'}</span></div>}
              </div>
              <form className="chat-form" onSubmit={submitChat}><input value={chatText} onChange={(event) => setChatText(event.target.value)} placeholder={meta.chatEnabled === false ? 'Chat đã bị tắt' : 'Nhắn cho mọi người…'} disabled={meta.chatEnabled === false} maxLength={500} /><button disabled={meta.chatEnabled === false}><ChevronRight /></button></form>
            </div>
          )}

          {activePanel === 'people' && (
            <div className="panel-body people-panel">
              <div className="panel-title"><div><strong>Trong phòng</strong><span>{members.length} người đang online</span></div></div>
              {members.map((member) => (
                <article className="member" key={member.uid}>
                  <div className="member-avatar">{member.name.slice(0, 1).toUpperCase()}</div>
                  <div><strong>{member.name} {member.uid === uid && '(bạn)'}</strong><span>{member.uid === meta.hostUid ? 'Owner' : meta.coHosts?.[member.uid] ? 'Co-host' : member.role === 'dj' ? 'DJ' : 'Listener'}</span></div>
                  {member.uid === meta.hostUid ? <Crown className="host-crown" size={18} /> : meta.coHosts?.[member.uid] ? (
                    isOwner ? <button className="cohost-button active" title="Thu hồi quyền Co-host" onClick={() => void setCoHost(member, false)}><ShieldCheck size={15} /></button> : <ShieldCheck className="cohost-mark" size={18} />
                  ) : isHost ? (
                    <div className="member-admin">
                      {isOwner && <button title="Thêm Co-host" onClick={() => void setCoHost(member, true)}><ShieldCheck size={14} /></button>}
                      {isOwner && <button title="Chuyển quyền Owner" onClick={() => void handOffHost(member)}><Crown size={14} /></button>}
                      <RolePicker value={member.role === 'dj' ? 'dj' : 'listener'} onChange={(role) => void updateMemberRole(roomId, member.uid, role as Role).then(() => showNotice(`Đã cập nhật quyền của ${member.name}.`)).catch((cause) => showNotice(cause instanceof Error ? cause.message : 'Không thể cập nhật quyền.', 'error'))} />
                      {canModerate(member) && <button className="moderation-button" title="Đưa khỏi phòng" onClick={() => void handleKick(member)}><UserMinus size={14} /></button>}
                      {canModerate(member) && <button className="moderation-button ban" title="Cấm khỏi phòng" onClick={() => void handleBan(member)}><Ban size={14} /></button>}
                    </div>
                  ) : <i className="member-online" />}
                </article>
              ))}
            </div>
          )}
        </aside>
      </div>

      {helpOpen && (
        <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setHelpOpen(false); }}>
          <section className="settings-modal help-modal" role="dialog" aria-modal="true" aria-labelledby="help-title">
            <div className="modal-heading"><div><span>HƯỚNG DẪN SYNCBOX</span><h2 id="help-title">Nghe nhạc cùng nhau</h2></div><button type="button" aria-label="Đóng hướng dẫn" onClick={() => setHelpOpen(false)}><X /></button></div>
            <div className="help-intro"><CircleHelp size={18} /><p>Bạn đang tham gia với quyền <strong>{isOwner ? 'Owner' : isCoHost ? 'Co-host' : me?.role === 'dj' ? 'DJ' : 'Listener'}</strong>. Các nút bị mờ là tính năng cần quyền cao hơn.</p></div>

            <div className="help-steps">
              <article><b>1</b><div><strong>Thêm nhạc</strong><span>Dán link YouTube để thêm ngay, hoặc nhập từ khóa rồi nhấn Enter để tìm.</span></div></article>
              <article><b>2</b><div><strong>Cùng xây queue</strong><span>Bình chọn bài yêu thích; DJ hoặc Host có thể đổi thứ tự và chuyển bài.</span></div></article>
              <article><b>3</b><div><strong>Nghe đồng bộ</strong><span>Nếu trình duyệt chặn âm thanh, bấm “Bật âm thanh” một lần trên thiết bị.</span></div></article>
            </div>

            <div className="help-section"><h3>Các nút trong phòng</h3><div className="help-grid">
              <article><i><Search /></i><div><strong>Tìm kiếm / dán link</strong><span>Search chỉ chạy sau khi Enter; dán link không dùng quota tìm kiếm.</span></div></article>
              <article><i><Play /></i><div><strong>Play / Pause</strong><span>Owner, Co-host và DJ điều khiển phát nhạc cho cả phòng.</span></div></article>
              <article><i><SkipForward /></i><div><strong>Chuyển bài</strong><span>Bỏ qua bài hiện tại và phát bài tiếp theo trong queue.</span></div></article>
              <article><i><Repeat2 /></i><div><strong>Loop</strong><span>Chuyển giữa không lặp, lặp một bài và lặp toàn bộ queue.</span></div></article>
              <article><i><GripVertical /></i><div><strong>Sắp xếp queue</strong><span>Kéo bài lên hoặc xuống; đường sáng cho biết vị trí sẽ thả.</span></div></article>
              <article><i><ThumbsUp /></i><div><strong>Bình chọn</strong><span>Mỗi người có một vote để thể hiện bài muốn nghe tiếp.</span></div></article>
              <article><i><MessageCircle /></i><div><strong>Chat</strong><span>Trò chuyện với mọi người trong tab Chat nếu phòng đang bật chat.</span></div></article>
              <article><i><Sparkles /></i><div><strong>SponsorBlock</strong><span>Tự bỏ qua sponsor và các phân đoạn cộng đồng đã đánh dấu.</span></div></article>
            </div></div>

            <div className="help-section"><h3>Quyền trong phòng</h3><div className="role-guide">
              <article><Headphones /><div><strong>Listener</strong><span>Nghe, chat, vote và thêm bài khi Host cho phép.</span></div></article>
              <article><Radio /><div><strong>DJ</strong><span>Thêm/sắp xếp queue, play, pause và chuyển bài.</span></div></article>
              <article><ShieldCheck /><div><strong>Co-host</strong><span>Quản lý phòng, thành viên và cài đặt cùng Owner.</span></div></article>
              <article><Crown /><div><strong>Owner</strong><span>Toàn quyền, cấp Co-host và chuyển quyền sở hữu.</span></div></article>
            </div></div>
            <div className="help-tip"><Sparkles size={15} /><span>Mẹo: sau khi xóa hoặc di chuyển queue, bạn có 7 giây để bấm <strong>Hoàn tác</strong>.</span></div>
          </section>
        </div>
      )}

      {settingsOpen && meta && (
        <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setSettingsOpen(false); }}>
          <form className="settings-modal" onSubmit={saveSettings}>
            <div className="modal-heading"><div><span>CÀI ĐẶT PHÒNG</span><h2>{meta.name}</h2></div><button type="button" onClick={() => setSettingsOpen(false)}><X /></button></div>
            <label className="settings-field">Tên phòng<input name="name" defaultValue={meta.name} maxLength={60} /></label>
            <div className="settings-group">
              <label><span><strong>Phòng công khai</strong><small>Hiển thị trạng thái public trong phòng.</small></span><span className="toggle"><input name="isPublic" type="checkbox" defaultChecked={meta.isPublic} /><span /></span></label>
              <label><span><strong>Listener thêm bài</strong><small>Không cần Host cấp quyền DJ.</small></span><span className="toggle"><input name="allowListenersToAdd" type="checkbox" defaultChecked={meta.allowListenersToAdd} /><span /></span></label>
              <label><span><strong>Bật chat</strong><small>Cho phép thành viên nhắn tin.</small></span><span className="toggle"><input name="chatEnabled" type="checkbox" defaultChecked={meta.chatEnabled !== false} /><span /></span></label>
              <label><span><strong>SponsorBlock</strong><small>Tự động bỏ qua các đoạn đã chọn.</small></span><span className="toggle"><input name="sponsorBlockEnabled" type="checkbox" checked={settingsSponsorEnabled} onChange={(event) => { setSettingsSponsorEnabled(event.target.checked); if (!event.target.checked) setSettingsSponsorCategories([]); }} /><span /></span></label>
            </div>
            <fieldset className="category-settings" disabled={!settingsSponsorEnabled}><legend>Phân đoạn sẽ bỏ qua</legend>{SPONSOR_CATEGORY_OPTIONS.map(([value, label]) => <label key={value}><input type="checkbox" name={`category:${value}`} checked={settingsSponsorCategories.includes(value)} onChange={(event) => setSettingsSponsorCategories((current) => event.target.checked ? [...current, value] : current.filter((category) => category !== value))} /><span>{label}</span></label>)}</fieldset>
            <div className="ban-settings">
              <div><strong>Danh sách bị cấm</strong><small>{bans.length} thành viên</small></div>
              {bans.length > 0 ? bans.map((ban) => <div className="banned-user" key={ban.uid}><span><strong>{ban.name}</strong><small>{ban.uid.slice(0, 8)}…</small></span><button type="button" onClick={() => void unbanMember(roomId, ban.uid).then(() => showNotice(`Đã bỏ cấm ${ban.name}.`)).catch((cause) => showNotice(cause instanceof Error ? cause.message : 'Không thể bỏ cấm.', 'error'))}>Bỏ cấm</button></div>) : <p>Chưa có thành viên nào bị cấm.</p>}
            </div>
            <div className="modal-actions">{isOwner ? <button type="button" className="danger-button" onClick={() => void handleCloseRoom()}><Trash2 size={15} /> Đóng phòng</button> : <span />}<button className="save-settings">Lưu thay đổi</button></div>
          </form>
        </div>
      )}
      {undoQueue && <div className="undo-toast"><span>{undoQueue.label}</span><button onClick={() => void undoQueueChange()}>Hoàn tác</button><button className="undo-close" onClick={() => setUndoQueue(null)}><X size={14} /></button></div>}
    </main>
  );
}
