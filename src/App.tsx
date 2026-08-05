import { FormEvent, Fragment, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AudioWaveform,
  ArrowDown,
  ArrowUp,
  Ban,
  Bell,
  BellOff,
  ChevronRight,
  GripVertical,
  Globe2,
  Crown,
  Compass,
  CircleHelp,
  Download,
  Headphones,
  History,
  ListMusic,
  LoaderCircle,
  LockKeyhole,
  Maximize2,
  MessageCircle,
  Mic,
  MicOff,
  Minimize2,
  Pause,
  PanelRightClose,
  PanelRightOpen,
  Pencil,
  Play,
  Radio,
  RefreshCw,
  Repeat2,
  Search,
  ScrollText,
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
  VolumeX,
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
  normalizeActivity,
  normalizeDiagnostics,
  normalizeHistory,
  normalizeMessages,
  normalizeQueue,
  removeQueueItem,
  recordActivity,
  recordPlaybackDiagnostic,
  reorderQueue,
  renewRoomExpiration,
  restoreQueueItems,
  selectQueueVideo,
  sendChat,
  saveRoomSettings,
  removeVoicePresence,
  setMemberOnline,
  setVoicePresence,
  subscribeConnection,
  subscribePublicRooms,
  subscribeRoom,
  subscribeServerOffset,
  transferHost,
  toggleQueueVote,
  unbanMember,
  updateMemberRole,
  updateQueuePlaybackIssue,
  updateCoHost,
  updateDisplayName,
  updateRoomMeta,
  updateVoiceMuted,
  updateVoiceForcedMuted,
  writePlayback,
} from './lib/firebase';
import { VoiceClient, type VoiceConnectionState } from './lib/voice';
import { formatDuration } from './lib/youtube';
import { playPresenceSound, unlockSounds } from './lib/sounds';
import type { ActivityLogItem, ActivityType, BanRecord, ChatMessage, LoopMode, Member, PlaybackDiagnostic, PlaybackState, PublicRoom, QueueHistoryItem, QueueItem, Role, RoomMeta, SponsorSegment, VideoItem, VoicePresence } from './types';

const EMPTY_PLAYBACK: PlaybackState = {
  video: null,
  status: 'paused',
  position: 0,
  volume: 80,
  updatedAt: 0,
  revision: 0,
  changedBy: '',
};

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed'; platform: string }>;
}

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
const NOTIFICATIONS_KEY = 'syncbox:browser-notifications';

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

function CreatorLinks({ compact = false }: { compact?: boolean }) {
  return (
    <div className={`creator-links ${compact ? 'compact' : ''}`}>
      {!compact && <span className="creator-name">Created by <strong>HFake</strong></span>}
      <nav aria-label="Liên hệ HFake">
        <a href="https://www.facebook.com/HFakeee/" target="_blank" rel="noreferrer" aria-label="Facebook của HFake"><i aria-hidden="true">f</i><span>Facebook</span></a>
        <a href="https://www.linkedin.com/in/hfake/" target="_blank" rel="noreferrer" aria-label="LinkedIn của HFake"><i aria-hidden="true">in</i><span>LinkedIn</span></a>
        <a href="mailto:huynguyenquoc.work@gmail.com" aria-label="Gửi email cho HFake"><i aria-hidden="true">@</i><span>Email</span></a>
      </nav>
    </div>
  );
}

export default function App() {
  const route = useHashRoute();
  const [installPrompt, setInstallPrompt] = useState<BeforeInstallPromptEvent | null>(null);

  useEffect(() => {
    const capturePrompt = (event: Event) => {
      event.preventDefault();
      setInstallPrompt(event as BeforeInstallPromptEvent);
    };
    const clearPrompt = () => setInstallPrompt(null);
    window.addEventListener('beforeinstallprompt', capturePrompt);
    window.addEventListener('appinstalled', clearPrompt);
    return () => {
      window.removeEventListener('beforeinstallprompt', capturePrompt);
      window.removeEventListener('appinstalled', clearPrompt);
    };
  }, []);

  async function installApp() {
    if (!installPrompt) return;
    await installPrompt.prompt();
    await installPrompt.userChoice;
    setInstallPrompt(null);
  }

  return <>
    {route.page === 'room' ? <RoomPage roomId={route.roomId} /> : <HomePage />}
    {installPrompt && <button className="pwa-install" onClick={() => void installApp()}><Download size={16} /><span>Cài Syncbox</span></button>}
  </>;
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
    void unlockSounds();
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
    void unlockSounds();
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
      <footer className="home-footer"><Brand /><span>Một không gian nghe YouTube sạch và cộng tác.</span><CreatorLinks /></footer>
    </main>
  );
}

function expectedPosition(playback: PlaybackState, serverOffset = 0) {
  if (playback.status !== 'playing' || typeof playback.updatedAt !== 'number') return playback.position;
  return Math.max(0, playback.position + (Date.now() + serverOffset - playback.updatedAt) / 1000);
}

const chatTimestampFormatter = new Intl.DateTimeFormat('vi-VN', {
  hour: '2-digit',
  minute: '2-digit',
  hour12: false,
});

const chatDateFormatter = new Intl.DateTimeFormat('vi-VN', {
  weekday: 'long',
  day: '2-digit',
  month: '2-digit',
  year: 'numeric',
});

function chatDateKey(sentAt: number): string {
  const date = new Date(sentAt);
  if (!Number.isFinite(date.getTime())) return '';
  return `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`;
}

function formatChatDate(sentAt: number): string {
  const date = new Date(sentAt);
  if (!Number.isFinite(date.getTime())) return '';
  const today = new Date();
  const yesterday = new Date(today);
  yesterday.setDate(today.getDate() - 1);
  const key = chatDateKey(sentAt);
  if (key === chatDateKey(today.getTime())) return 'Hôm nay';
  if (key === chatDateKey(yesterday.getTime())) return 'Hôm qua';
  return chatDateFormatter.format(date);
}

function formatChatTimestamp(sentAt: number): string {
  const date = new Date(sentAt);
  return Number.isFinite(date.getTime()) ? chatTimestampFormatter.format(date) : '';
}

function chatTimestampIso(sentAt: number): string | undefined {
  const date = new Date(sentAt);
  return Number.isFinite(date.getTime()) ? date.toISOString() : undefined;
}

function youtubeErrorDescription(code: number): { message: string; retryable: boolean } {
  if (code === 2) return { message: 'Link hoặc mã video không hợp lệ.', retryable: false };
  if (code === 5) return { message: 'Trình duyệt gặp lỗi khi giải mã video.', retryable: true };
  if (code === 100) return { message: 'Video đã bị xoá hoặc đang ở chế độ riêng tư.', retryable: false };
  if (code === 101 || code === 150) return { message: 'Chủ video không cho phép phát trên website khác.', retryable: false };
  if (code === 153) return { message: 'YouTube không nhận được thông tin nhận diện của player.', retryable: true };
  return { message: `YouTube không thể phát video này (mã lỗi ${code}).`, retryable: true };
}

function playbackEnvironment(): Pick<PlaybackDiagnostic, 'browser' | 'device'> {
  const agent = navigator.userAgent;
  const browser = /Edg\//.test(agent) ? 'edge'
    : /Firefox\//.test(agent) ? 'firefox'
      : /Chrome\//.test(agent) ? 'chrome'
        : /Safari\//.test(agent) ? 'safari'
          : 'other';
  return { browser, device: /Android|iPhone|iPad|iPod|Mobile/i.test(agent) ? 'mobile' : 'desktop' };
}

function RoomPage({ roomId }: { roomId: string }) {
  const [uid, setUid] = useState('');
  const [meta, setMeta] = useState<RoomMeta | null>(null);
  const [playback, setPlayback] = useState<PlaybackState>(EMPTY_PLAYBACK);
  const [queue, setQueue] = useState<QueueItem[]>([]);
  const [queueHistory, setQueueHistory] = useState<QueueHistoryItem[]>([]);
  const [members, setMembers] = useState<Member[]>([]);
  const [voicePresences, setVoicePresences] = useState<VoicePresence[]>([]);
  const [voiceState, setVoiceState] = useState<VoiceConnectionState>('idle');
  const [voiceError, setVoiceError] = useState('');
  const [voiceMuted, setVoiceMuted] = useState(false);
  const [voiceDeafened, setVoiceDeafened] = useState(false);
  const [speakingUids, setSpeakingUids] = useState<Set<string>>(() => new Set());
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [activity, setActivity] = useState<ActivityLogItem[]>([]);
  const [diagnostics, setDiagnostics] = useState<PlaybackDiagnostic[]>([]);
  const [unreadChatCount, setUnreadChatCount] = useState(0);
  const [bans, setBans] = useState<BanRecord[]>([]);
  const [segments, setSegments] = useState<SponsorSegment[]>([]);
  const [activePanel, setActivePanel] = useState<'queue' | 'chat' | 'activity'>('queue');
  const [queueView, setQueueView] = useState<'upcoming' | 'history'>('upcoming');
  const [sidePanelCollapsed, setSidePanelCollapsed] = useState(() => localStorage.getItem('syncbox:side-panel-collapsed') === '1');
  const [rosterCollapsed, setRosterCollapsed] = useState(() => localStorage.getItem('syncbox:roster-collapsed') === '1');
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
  const [notificationPermission, setNotificationPermission] = useState<NotificationPermission>(() => typeof Notification === 'undefined' ? 'denied' : Notification.permission);
  const [notificationsEnabled, setNotificationsEnabled] = useState(() => typeof Notification !== 'undefined' && Notification.permission === 'granted' && localStorage.getItem(NOTIFICATIONS_KEY) === '1');
  const [serverOffset, setServerOffset] = useState(0);
  const [notice, setNotice] = useState<{ message: string; tone: 'success' | 'error' } | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [profileOpen, setProfileOpen] = useState(false);
  const [connectionOpen, setConnectionOpen] = useState(false);
  const [nameDraft, setNameDraft] = useState('');
  const [profileSaving, setProfileSaving] = useState(false);
  const [settingsSponsorEnabled, setSettingsSponsorEnabled] = useState(false);
  const [settingsSponsorCategories, setSettingsSponsorCategories] = useState<string[]>([]);
  const [helpOpen, setHelpOpen] = useState(false);
  const [playerAttempt, setPlayerAttempt] = useState(0);
  const [playerEmbedMode, setPlayerEmbedMode] = useState<'private' | 'standard'>('private');
  const [playerIssue, setPlayerIssue] = useState('');
  const [draggedQueueId, setDraggedQueueId] = useState<string | null>(null);
  const [dropTarget, setDropTarget] = useState<{ queueId: string; position: 'before' | 'after' } | null>(null);
  const [undoQueue, setUndoQueue] = useState<{ items: QueueItem[]; label: string } | null>(null);
  const playerRef = useRef<PlayerHandle>(null);
  const needsActivationRef = useRef(false);
  const videoStageRef = useRef<HTMLDivElement>(null);
  const lastSponsorSkip = useRef('');
  const pendingQueueStart = useRef<string | null>(null);
  const handledEndedRevision = useRef(0);
  const playerRecovery = useRef({ videoId: '', attempts: 0 });
  const nonRetryablePlayerVideo = useRef('');
  const playerFailureTimer = useRef<number | undefined>(undefined);
  const skippedFailedVideo = useRef('');
  const reportedPlayerFailure = useRef('');
  const playbackStartedAt = useRef({ videoId: '', at: performance.now() });
  const reportedPlaybackSuccess = useRef('');
  const undoTimer = useRef<number | undefined>(undefined);
  const voiceClientRef = useRef<VoiceClient | null>(null);
  const previousVoiceUids = useRef<Set<string> | null>(null);
  const voiceRecoveryAttempts = useRef(0);
  const voiceShouldRecover = useRef(false);
  const joinVoiceRef = useRef<() => Promise<void>>(async () => undefined);
  const skipRef = useRef<(mode?: LoopMode, activityText?: string, preserveCurrent?: boolean) => Promise<void>>(async () => undefined);
  const reportPlaybackDiagnosticRef = useRef<(event: PlaybackDiagnostic['event'], playerState: number, extra?: { startupMs?: number; errorCode?: number }) => void>(() => undefined);
  const markCurrentPlaybackIssueRef = useRef<(status: 'retrying' | 'failed', message: string, code?: number) => void>(() => undefined);
  const databaseWasDisconnected = useRef(false);
  const messagesRef = useRef<HTMLDivElement>(null);
  const shouldAutoScrollChat = useRef(true);
  const lastChatMessageId = useRef<string | null>(null);
  const lastObservedChatMessageId = useRef<string | null>(null);
  const chatMessagesInitialized = useRef(false);
  const ownPrivileges = useRef<{ role: Role; coHost: boolean } | null>(null);
  const ownForcedMute = useRef<boolean | null>(null);
  const browserNotificationRef = useRef<(title: string, body: string, tag: string, action?: 'chat') => void>(() => undefined);
  const mediaActionsRef = useRef<{ play: () => Promise<void>; pause: () => Promise<void>; next: () => Promise<void> }>({
    play: async () => undefined,
    pause: async () => undefined,
    next: async () => undefined,
  });

  useEffect(() => {
    needsActivationRef.current = needsActivation;
  }, [needsActivation]);

  const me = useMemo(() => members.find((member) => member.uid === uid), [members, uid]);
  const isOwner = Boolean(uid && meta?.hostUid === uid);
  const isCoHost = Boolean(uid && meta?.coHosts?.[uid]);
  const isHost = isOwner || isCoHost;
  const canManageQueue = isHost || me?.role === 'dj';
  const canControlPlayback = isHost || me?.role === 'dj';
  const canAdd = canManageQueue || Boolean(meta?.allowListenersToAdd);
  const playbackCoordinatorUid = useMemo(() => {
    if (members.some((member) => member.uid === meta?.hostUid && member.online)) return meta?.hostUid ?? '';
    return members
      .filter((member) => member.online && (Boolean(meta?.coHosts?.[member.uid]) || member.role === 'dj'))
      .map((member) => member.uid)
      .sort()[0] ?? '';
  }, [members, meta?.coHosts, meta?.hostUid]);
  const isPlaybackCoordinator = Boolean(uid && uid === playbackCoordinatorUid);
  const sponsorCategoryKey = meta?.sponsorCategories.join(',') ?? 'sponsor';
  const loopMode: LoopMode = meta?.loopMode ?? 'off';
  const queueDuration = useMemo(() => queue.reduce((total, item) => total + (item.duration ?? 0), 0), [queue]);
  const diagnosticSummary = useMemo(() => {
    const cutoff = Date.now() - 24 * 60 * 60 * 1000;
    const recent = diagnostics.filter((item) => item.createdAt >= cutoff);
    const starts = recent.filter((item) => item.event === 'playing');
    const measured = starts.filter((item) => typeof item.startupMs === 'number');
    return {
      total: recent.length,
      starts: starts.length,
      errors: recent.filter((item) => item.event === 'error').length,
      fallbacks: recent.filter((item) => item.event === 'fallback').length,
      averageStartup: measured.length > 0 ? Math.round(measured.reduce((sum, item) => sum + (item.startupMs ?? 0), 0) / measured.length) : 0,
    };
  }, [diagnostics]);
  const onlineMemberCount = useMemo(() => members.filter((member) => member.online).length, [members]);
  const voiceByUid = useMemo(() => new Map(voicePresences.map((presence) => [presence.uid, presence])), [voicePresences]);
  const forcedVoiceMuted = Boolean(voiceByUid.get(uid)?.forcedMuted);
  const voiceJoined = voiceByUid.has(uid) && (voiceState === 'connected' || voiceState === 'reconnecting' || voiceState === 'error');
  const playerConnectionState = !playback.video
    ? 'idle'
    : playerIssue
      ? 'error'
      : needsActivation
        ? 'attention'
        : playerRef.current?.videoId() === playback.video.id
          ? 'connected'
          : 'loading';
  const connectionNeedsAttention = connected === false || playerConnectionState === 'error' || voiceState === 'error';
  const memberGroups = useMemo(() => {
    const groups = [
      { key: 'owner', label: 'OWNER', members: members.filter((member) => member.uid === meta?.hostUid) },
      { key: 'cohost', label: 'CO-HOST', members: members.filter((member) => member.uid !== meta?.hostUid && Boolean(meta?.coHosts?.[member.uid])) },
      { key: 'dj', label: 'DJ', members: members.filter((member) => member.uid !== meta?.hostUid && !meta?.coHosts?.[member.uid] && member.role === 'dj') },
      { key: 'listener', label: 'LISTENER', members: members.filter((member) => member.uid !== meta?.hostUid && !meta?.coHosts?.[member.uid] && member.role !== 'dj') },
    ];
    return groups.filter((group) => group.members.length > 0);
  }, [members, meta?.coHosts, meta?.hostUid]);

  browserNotificationRef.current = (title, body, tag, action) => {
    if (!notificationsEnabled || typeof Notification === 'undefined' || Notification.permission !== 'granted' || document.visibilityState === 'visible') return;
    const options: NotificationOptions = {
      body,
      icon: `${import.meta.env.BASE_URL}app-icon-512.png`,
      tag,
      data: { action, url: window.location.href },
    };
    void (async () => {
      try {
        if ('serviceWorker' in navigator) {
          const registration = await navigator.serviceWorker.getRegistration(import.meta.env.BASE_URL)
            ?? await navigator.serviceWorker.register(`${import.meta.env.BASE_URL}notification-sw.js`, { scope: import.meta.env.BASE_URL });
          await registration.showNotification(title, options);
          return;
        }
        const notification = new Notification(title, options);
        notification.onclick = () => {
          window.focus();
          notification.close();
          if (action === 'chat') {
            shouldAutoScrollChat.current = true;
            setUnreadChatCount(0);
            setActivePanel('chat');
            setSidePanelCollapsed(false);
            localStorage.setItem('syncbox:side-panel-collapsed', '0');
          }
        };
      } catch {
        // Permission can be revoked while the room is open.
      }
    })();
  };

  useEffect(() => {
    if (!('serviceWorker' in navigator)) return;
    const handleNotificationClick = (event: MessageEvent<{ type?: string; action?: string }>) => {
      if (event.data?.type !== 'syncbox-notification-click' || event.data.action !== 'chat') return;
      shouldAutoScrollChat.current = true;
      setUnreadChatCount(0);
      setActivePanel('chat');
      setSidePanelCollapsed(false);
      localStorage.setItem('syncbox:side-panel-collapsed', '0');
    };
    navigator.serviceWorker.addEventListener('message', handleNotificationClick);
    return () => navigator.serviceWorker.removeEventListener('message', handleNotificationClick);
  }, []);

  useEffect(() => {
    const latestMessage = messages[messages.length - 1];
    const isNewMessage = Boolean(latestMessage && latestMessage.id !== lastChatMessageId.current);
    const isMyNewMessage = Boolean(isNewMessage && latestMessage?.uid === uid);
    lastChatMessageId.current = latestMessage?.id ?? null;

    if (activePanel !== 'chat' || sidePanelCollapsed) return;
    const container = messagesRef.current;
    if (!container || (!shouldAutoScrollChat.current && !isMyNewMessage)) return;

    const frame = window.requestAnimationFrame(() => {
      container.scrollTo({ top: container.scrollHeight, behavior: isNewMessage ? 'smooth' : 'auto' });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [activePanel, messages, sidePanelCollapsed, uid]);

  useEffect(() => {
    const markVisibleChatRead = () => {
      if (document.visibilityState === 'visible' && activePanel === 'chat' && !sidePanelCollapsed && shouldAutoScrollChat.current) {
        setUnreadChatCount(0);
      }
    };
    document.addEventListener('visibilitychange', markVisibleChatRead);
    return () => document.removeEventListener('visibilitychange', markVisibleChatRead);
  }, [activePanel, sidePanelCollapsed]);

  useEffect(() => {
    const latestMessage = messages[messages.length - 1];
    if (!chatMessagesInitialized.current) return;
    if (!latestMessage || latestMessage.id === lastObservedChatMessageId.current) return;

    const previousIndex = messages.findIndex((message) => message.id === lastObservedChatMessageId.current);
    const newMessages = previousIndex >= 0 ? messages.slice(previousIndex + 1) : [latestMessage];
    lastObservedChatMessageId.current = latestMessage.id;
    const incomingCount = newMessages.filter((message) => message.uid !== uid).length;
    if (incomingCount === 0) return;

    const latestIncoming = [...newMessages].reverse().find((message) => message.uid !== uid);
    if (latestIncoming) browserNotificationRef.current(
      `${latestIncoming.name} · ${meta?.name ?? 'Syncbox'}`,
      latestIncoming.text,
      `syncbox-chat-${roomId}`,
      'chat',
    );

    const chatIsBeingRead = activePanel === 'chat'
      && !sidePanelCollapsed
      && document.visibilityState === 'visible'
      && shouldAutoScrollChat.current;
    if (chatIsBeingRead) setUnreadChatCount(0);
    else setUnreadChatCount((count) => count + incomingCount);
  }, [activePanel, messages, meta?.name, roomId, sidePanelCollapsed, uid]);

  useEffect(() => {
    if (!uid || !me || !meta) return;
    const current = { role: me.role, coHost: Boolean(meta.coHosts?.[uid]) };
    const previous = ownPrivileges.current;
    ownPrivileges.current = current;
    if (!previous) return;
    if (!previous.coHost && current.coHost) {
      showNotice('Bạn vừa được cấp quyền Co-host.');
      browserNotificationRef.current('Bạn đã trở thành Co-host', `Bạn có thể cùng quản lý phòng ${meta.name}.`, `syncbox-role-${roomId}`);
    } else if (previous.role !== 'dj' && current.role === 'dj' && !current.coHost) {
      showNotice('Bạn vừa được cấp quyền DJ.');
      browserNotificationRef.current('Bạn đã trở thành DJ', `Bạn có thể điều khiển nhạc trong phòng ${meta.name}.`, `syncbox-role-${roomId}`);
    }
  }, [me, meta, roomId, uid]);

  useEffect(() => {
    if (!voiceJoined) {
      ownForcedMute.current = null;
      return;
    }
    const previous = ownForcedMute.current;
    ownForcedMute.current = forcedVoiceMuted;
    if (forcedVoiceMuted) {
      voiceClientRef.current?.setMuted(true);
      setVoiceMuted(true);
    }
    if (previous !== false || !forcedVoiceMuted) return;
    showNotice('Microphone của bạn đã bị Host tắt.', 'error');
    browserNotificationRef.current('Bạn đã bị mute khỏi Voice Lounge', `${meta?.name ?? 'Phòng Syncbox'} đã tắt microphone của bạn.`, `syncbox-voice-mute-${roomId}`);
  }, [forcedVoiceMuted, meta?.name, roomId, voiceJoined]);

  function handleChatScroll() {
    const container = messagesRef.current;
    if (!container) return;
    shouldAutoScrollChat.current = container.scrollHeight - container.scrollTop - container.clientHeight < 72;
    if (shouldAutoScrollChat.current && activePanel === 'chat' && !sidePanelCollapsed) setUnreadChatCount(0);
  }

  function scrollChatToLatest() {
    const container = messagesRef.current;
    if (!container) return;
    shouldAutoScrollChat.current = true;
    setUnreadChatCount(0);
    container.scrollTo({ top: container.scrollHeight, behavior: 'smooth' });
  }

  function showNotice(message: string, tone: 'success' | 'error' = 'success') {
    setNotice({ message, tone });
    window.setTimeout(() => setNotice(null), 2600);
  }

  async function toggleBrowserNotifications() {
    if (typeof Notification === 'undefined') {
      showNotice('Trình duyệt này không hỗ trợ thông báo.', 'error');
      return;
    }
    if (notificationsEnabled) {
      localStorage.removeItem(NOTIFICATIONS_KEY);
      setNotificationsEnabled(false);
      showNotice('Đã tắt thông báo trình duyệt.');
      return;
    }
    if (Notification.permission === 'denied') {
      setNotificationPermission('denied');
      showNotice('Thông báo đang bị chặn. Hãy cho phép trong cài đặt của trình duyệt.', 'error');
      return;
    }
    const permission = await Notification.requestPermission();
    setNotificationPermission(permission);
    if (permission !== 'granted') {
      showNotice('Syncbox chỉ bật thông báo khi bạn đồng ý.', 'error');
      return;
    }
    localStorage.setItem(NOTIFICATIONS_KEY, '1');
    if ('serviceWorker' in navigator) {
      await navigator.serviceWorker.register(`${import.meta.env.BASE_URL}notification-sw.js`, { scope: import.meta.env.BASE_URL }).catch(() => undefined);
    }
    setNotificationsEnabled(true);
    showNotice('Đã bật thông báo cho chat, quyền và voice.');
  }

  function toggleSidePanel() {
    const next = !sidePanelCollapsed;
    setSidePanelCollapsed(next);
    localStorage.setItem('syncbox:side-panel-collapsed', next ? '1' : '0');
    if (!next && activePanel === 'chat') {
      shouldAutoScrollChat.current = true;
      setUnreadChatCount(0);
    }
  }

  function toggleRoster() {
    setRosterCollapsed((collapsed) => {
      const next = !collapsed;
      localStorage.setItem('syncbox:roster-collapsed', next ? '1' : '0');
      return next;
    });
  }

  function openSidePanel(panel: 'queue' | 'chat' | 'activity') {
    setActivePanel(panel);
    if (panel === 'chat') {
      shouldAutoScrollChat.current = true;
      setUnreadChatCount(0);
    }
    if (sidePanelCollapsed) {
      setSidePanelCollapsed(false);
      localStorage.setItem('syncbox:side-panel-collapsed', '0');
    }
  }

  function logActivity(type: ActivityType, text: string) {
    if (!me) return;
    void recordActivity(roomId, me, type, text).catch(() => undefined);
  }

  function reportPlaybackDiagnostic(event: PlaybackDiagnostic['event'], playerState: number, extra: { startupMs?: number; errorCode?: number } = {}) {
    if (!isPlaybackCoordinator || !playback.video) return;
    void recordPlaybackDiagnostic(roomId, {
      event,
      videoId: playback.video.id,
      embedMode: playerEmbedMode,
      playerState,
      ...extra,
      ...playbackEnvironment(),
    }).catch(() => undefined);
  }

  function markCurrentPlaybackIssue(status: 'retrying' | 'failed', message: string, code?: number) {
    if (!isPlaybackCoordinator || !playback.video) return;
    const current = queue.find((item) => item.id === playback.video?.id);
    if (!current) return;
    void updateQueuePlaybackIssue(roomId, current.queueId, {
      status,
      message: message.slice(0, 240),
      ...(typeof code === 'number' ? { code } : {}),
      embedMode: playerEmbedMode,
      attempts: playerRecovery.current.attempts,
    }).catch(() => undefined);
  }

  reportPlaybackDiagnosticRef.current = reportPlaybackDiagnostic;
  markCurrentPlaybackIssueRef.current = markCurrentPlaybackIssue;

  function openProfile() {
    setNameDraft(me?.name ?? localStorage.getItem('syncbox:name') ?? '');
    setProfileOpen(true);
  }

  async function saveDisplayName(event: FormEvent) {
    event.preventDefault();
    const name = nameDraft.trim().slice(0, 32);
    if (!name) {
      showNotice('Tên hiển thị không được để trống.', 'error');
      return;
    }
    if (!uid || name === me?.name) {
      setProfileOpen(false);
      return;
    }
    setProfileSaving(true);
    try {
      await updateDisplayName(roomId, uid, name, voiceByUid.has(uid));
      localStorage.setItem('syncbox:name', name);
      setProfileOpen(false);
      showNotice(`Đã đổi tên thành ${name}.`);
    } catch (cause) {
      showNotice(cause instanceof Error ? cause.message : 'Không thể đổi tên lúc này.', 'error');
    } finally {
      setProfileSaving(false);
    }
  }

  useEffect(() => {
    let active = true;
    let joinedUid = '';
    const unsubscribes: Array<() => void> = [];
    chatMessagesInitialized.current = false;
    ownPrivileges.current = null;
    ownForcedMute.current = null;
    lastObservedChatMessageId.current = null;
    lastChatMessageId.current = null;
    setUnreadChatCount(0);
    setMessages([]);
    setActivity([]);
    setDiagnostics([]);
    setQueueHistory([]);
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
          subscribeRoom<Record<string, Omit<QueueHistoryItem, 'historyId'>> | null>(roomId, 'history', (value) => setQueueHistory(normalizeHistory(value)), handleAccessError),
          subscribeRoom<Record<string, Member> | null>(roomId, 'members', (value) => setMembers(normalizeMembers(value)), handleAccessError),
          subscribeRoom<Record<string, VoicePresence> | null>(roomId, 'voice', (value) => {
            const nextPresences = value ? Object.values(value) : [];
            const nextUids = new Set(nextPresences.map((presence) => presence.uid));
            const previousUids = previousVoiceUids.current;
            if (previousUids) {
              if (nextPresences.some((presence) => !previousUids.has(presence.uid))) playPresenceSound('join');
              if (Array.from(previousUids).some((voiceUid) => !nextUids.has(voiceUid))) playPresenceSound('leave');
            }
            previousVoiceUids.current = nextUids;
            setVoicePresences(nextPresences);
          }, handleAccessError),
          subscribeRoom<Record<string, Omit<ChatMessage, 'id'>> | null>(roomId, 'messages', (value) => {
            const nextMessages = normalizeMessages(value);
            if (!chatMessagesInitialized.current) {
              const latestMessageId = nextMessages[nextMessages.length - 1]?.id ?? null;
              chatMessagesInitialized.current = true;
              lastObservedChatMessageId.current = latestMessageId;
              lastChatMessageId.current = latestMessageId;
            }
            setMessages(nextMessages);
          }, handleAccessError),
          subscribeRoom<Record<string, Omit<ActivityLogItem, 'id'>> | null>(roomId, 'activity', (value) => {
            setActivity(normalizeActivity(value));
          }, () => setActivity([])),
          subscribeRoom<Record<string, Omit<PlaybackDiagnostic, 'id'>> | null>(roomId, 'diagnostics', (value) => {
            setDiagnostics(normalizeDiagnostics(value));
          }, () => setDiagnostics([])),
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
      void voiceClientRef.current?.leave();
      if (joinedUid) void removeVoicePresence(roomId, joinedUid).catch(() => undefined);
      if (joinedUid) void setMemberOnline(roomId, joinedUid, false).catch(() => undefined);
    };
  }, [roomId]);

  useEffect(() => {
    if (voiceState !== 'connected' && voiceState !== 'reconnecting') return;
    void voiceClientRef.current?.sync(voicePresences);
  }, [voicePresences, voiceState]);

  useEffect(() => {
    if (voiceState === 'connected') {
      voiceRecoveryAttempts.current = 0;
      return;
    }
    if (voiceState !== 'error' || !voiceShouldRecover.current || voiceRecoveryAttempts.current >= 2) return;
    const delay = 2500 + voiceRecoveryAttempts.current * 2500;
    const timer = window.setTimeout(() => {
      voiceRecoveryAttempts.current += 1;
      void joinVoiceRef.current();
    }, delay);
    return () => window.clearTimeout(timer);
  }, [voiceState]);

  useEffect(() => {
    const unlock = () => { void unlockSounds(); };
    window.addEventListener('pointerdown', unlock, { once: true });
    window.addEventListener('keydown', unlock, { once: true });
    return () => {
      window.removeEventListener('pointerdown', unlock);
      window.removeEventListener('keydown', unlock);
    };
  }, []);

  useEffect(() => {
    if (!isHost) {
      setBans([]);
      return;
    }
    return subscribeRoom<Record<string, BanRecord> | null>(roomId, 'bans', (value) => setBans(value ? Object.values(value).sort((a, b) => b.bannedAt - a.bannedAt) : []));
  }, [isHost, roomId]);

  useEffect(() => () => {
    window.clearTimeout(undoTimer.current);
    window.clearTimeout(playerFailureTimer.current);
  }, []);

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
    if (!connectionOpen) return;
    const closeOnEscape = (event: KeyboardEvent) => { if (event.key === 'Escape') setConnectionOpen(false); };
    document.addEventListener('keydown', closeOnEscape);
    return () => document.removeEventListener('keydown', closeOnEscape);
  }, [connectionOpen]);

  useEffect(() => {
    if (!meta || !uid || !connected || (!isCoHost && me?.role !== 'dj') || members.some((member) => member.uid === meta.hostUid && member.online)) return;
    const timer = window.setTimeout(() => {
      void transferHost(roomId, uid).then(() => {
        if (me?.name) void recordActivity(roomId, { uid, name: me.name }, 'owner_transfer', 'tự động tiếp quản Owner vì Owner cũ mất kết nối').catch(() => undefined);
        setNotice({ message: 'Bạn đã tiếp quản Owner vì Owner cũ mất kết nối.', tone: 'success' });
      }).catch(() => undefined);
    }, 15000);
    return () => window.clearTimeout(timer);
  }, [connected, isCoHost, me?.name, me?.role, members, meta, roomId, uid]);

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
    // The client that selected the track is deliberately pre-rolling its local
    // iframe while Firebase remains paused at zero. Do not pause that pre-roll.
    if (playback.status === 'paused' && playback.reason === 'queue' && canControlPlayback) return;
    if (playback.status === 'playing') {
      if (Math.abs(actual - expected) > 1.5) player.seek(expected);
      player.play();
    } else {
      // Pause before correcting the timestamp so the iframe cannot advance
      // while seekTo is being processed asynchronously.
      player.pause();
      if (Math.abs(actual - expected) > 0.25) player.seek(expected);
    }
  }, [canControlPlayback, localVolume, playback, serverOffset]);

  useEffect(() => {
    if (connected === false) {
      databaseWasDisconnected.current = true;
      return;
    }
    if (connected === true && databaseWasDisconnected.current) {
      databaseWasDisconnected.current = false;
      showNotice('Đã kết nối lại phòng và đồng bộ trạng thái.');
      conformPlayer();
    }
  }, [connected, conformPlayer]);

  useEffect(() => {
    setNeedsActivation(false);
    setPlayerIssue('');
    if (!playback.video) return;
    if (playerRecovery.current.videoId !== playback.video.id) {
      playerRecovery.current = { videoId: playback.video.id, attempts: 0 };
      playbackStartedAt.current = { videoId: playback.video.id, at: performance.now() };
      reportedPlaybackSuccess.current = '';
      setPlayerEmbedMode('private');
      nonRetryablePlayerVideo.current = '';
      skippedFailedVideo.current = '';
      reportedPlayerFailure.current = '';
      window.clearTimeout(playerFailureTimer.current);
    }

    const shouldStartQueue = playback.status === 'paused' && playback.reason === 'queue' && canControlPlayback;
    if (shouldStartQueue) pendingQueueStart.current = playback.video.id;
    let attempts = 0;
    const retry = () => {
      if (!shouldStartQueue) return;
      const player = playerRef.current;
      if (!player || player.videoId() !== playback.video?.id) return;
      attempts += 1;
      player.seek(0);
      player.play();
      if (attempts >= 3) {
        setNeedsActivation(true);
        window.clearInterval(retryTimer);
      }
    };
    const firstRetry = window.setTimeout(retry, 700);
    const retryTimer = window.setInterval(retry, 1800);
    const recoveryDelay = playerEmbedMode === 'private' ? 12000 : 20000;
    const issueTimer = window.setTimeout(() => {
      const player = playerRef.current;
      const state = player?.state() ?? -1;
      // Paused, buffering and cued are valid states. They may mean autoplay is
      // waiting for user activation, not that the video is broken.
      const correctVideo = Boolean(player && player.videoId() === playback.video?.id);
      if (correctVideo && state === 3) {
        const message = 'Video đang buffer lâu hơn bình thường. Syncbox vẫn giữ nguyên bài; bạn có thể chờ hoặc tải lại player.';
        setPlayerIssue(message);
        markCurrentPlaybackIssueRef.current('retrying', message);
        reportPlaybackDiagnosticRef.current('buffering', state);
        return;
      }
      const healthyState = [1, 5].includes(state) || (state === 2 && needsActivationRef.current);
      const healthy = correctVideo && healthyState;
      if (!healthy && (playback.status === 'playing' || playback.reason === 'queue')) {
        const videoId = playback.video?.id ?? '';
        const recovery = playerRecovery.current;
        if (nonRetryablePlayerVideo.current === videoId) {
          if (isPlaybackCoordinator && skippedFailedVideo.current !== videoId) {
            skippedFailedVideo.current = videoId;
            playerFailureTimer.current = window.setTimeout(() => {
              void skipRef.current('off', `tự bỏ qua “${playback.video?.title ?? 'video'}” vì YouTube từ chối phát`, true);
            }, 3500);
          }
          return;
        }
        if (videoId && recovery.videoId === videoId && playerEmbedMode === 'private') {
          recovery.attempts += 1;
          if (playback.status === 'paused' && playback.reason === 'queue' && canControlPlayback) pendingQueueStart.current = videoId;
          setPlayerIssue('Chế độ phát riêng tư chưa phản hồi. Đang thử player tiêu chuẩn…');
          markCurrentPlaybackIssueRef.current('retrying', 'Đang thử lại bằng player tiêu chuẩn.');
          reportPlaybackDiagnosticRef.current('fallback', state);
          setPlayerEmbedMode('standard');
          return;
        }
        if (videoId && recovery.videoId === videoId && recovery.attempts < 2) {
          recovery.attempts += 1;
          if (playback.status === 'paused' && playback.reason === 'queue' && canControlPlayback) pendingQueueStart.current = videoId;
          setPlayerAttempt((attempt) => attempt + 1);
          return;
        }
        const message = 'Player chưa thể phát sau khi tự khôi phục. Bài hát được giữ nguyên; hãy thử tải lại hoặc để Host bỏ qua.';
        setPlayerIssue(message);
        markCurrentPlaybackIssueRef.current('failed', message);
        reportPlaybackDiagnosticRef.current('error', state);
      }
    }, recoveryDelay);
    return () => {
      window.clearTimeout(firstRetry);
      window.clearInterval(retryTimer);
      window.clearTimeout(issueTimer);
    };
  }, [canControlPlayback, isPlaybackCoordinator, playback.reason, playback.revision, playback.status, playback.video, playerAttempt, playerEmbedMode]);

  useEffect(() => {
    conformPlayer();
    const timer = window.setTimeout(conformPlayer, 250);
    return () => window.clearTimeout(timer);
  }, [conformPlayer]);

  useEffect(() => {
    const recoverPlayback = () => {
      if (document.visibilityState === 'visible') conformPlayer();
    };
    document.addEventListener('visibilitychange', recoverPlayback);
    window.addEventListener('pageshow', recoverPlayback);
    return () => {
      document.removeEventListener('visibilitychange', recoverPlayback);
      window.removeEventListener('pageshow', recoverPlayback);
    };
  }, [conformPlayer]);

  useEffect(() => {
    const timer = window.setInterval(() => {
      setDisplayPosition(playerRef.current?.currentTime() ?? expectedPosition(playback, serverOffset));
    }, 500);
    return () => window.clearInterval(timer);
  }, [playback, serverOffset]);

  useEffect(() => {
    if (!isPlaybackCoordinator || playback.status !== 'playing' || !playback.video) return undefined;
    const timer = window.setInterval(() => {
      const duration = playback.video?.duration || playerRef.current?.duration() || 0;
      if (duration <= 0 || expectedPosition(playback, serverOffset) < duration + 0.75) return;
      if (handledEndedRevision.current === playback.revision) return;
      handledEndedRevision.current = playback.revision;
      void skipRef.current(loopMode).catch((cause) => {
        showNotice(cause instanceof Error ? cause.message : 'Không thể tự chuyển bài.', 'error');
      });
    }, 1500);
    return () => window.clearInterval(timer);
  }, [isPlaybackCoordinator, loopMode, playback, serverOffset]);

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
    const remainingSlots = Math.max(0, 100 - queue.length);
    if (remainingSlots === 0) {
      showNotice('Queue đã đạt giới hạn 100 bài.', 'error');
      return;
    }
    const existingIds = new Set(queue.map((item) => item.id));
    if (playback.video?.id) existingIds.add(playback.video.id);
    const uniqueCandidates = videos.filter((video, index) => !existingIds.has(video.id) && videos.findIndex((item) => item.id === video.id) === index);
    const unique = uniqueCandidates.slice(0, remainingSlots);
    if (!unique.length) {
      showNotice('Video này đã có trong queue.', 'error');
      return;
    }
    const result = await addVideos(roomId, unique, me);
    if (!result.added.length) {
      showNotice('Các video này vừa được người khác thêm vào queue.', 'error');
      return;
    }
    if (!playback.video && result.added[0]) {
      pendingQueueStart.current = result.added[0].id;
      await writePlayback(roomId, uid, { video: result.added[0], status: 'paused', position: 0, reason: 'queue' });
    }
    logActivity('queue_add', `thêm ${result.added.length === 1 ? `“${result.added[0].title}”` : `${result.added.length} bài`} vào queue`);
    const skippedForCapacity = Math.max(0, uniqueCandidates.length - unique.length);
    showNotice(skippedForCapacity > 0
      ? `Đã thêm ${result.added.length} video · queue đã đạt giới hạn 100 bài.`
      : result.duplicates.length > 0
      ? `Đã thêm ${result.added.length} video · bỏ qua ${result.duplicates.length} bài trùng.`
      : `Đã thêm ${result.added.length} video vào queue.`);
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
      logActivity('queue_remove', `xoá “${item.title}” khỏi queue`);
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
      logActivity('queue_clear', `xoá ${removed.length} bài khỏi queue`);
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

  async function skip(mode: LoopMode = 'off', activityText?: string, preserveCurrent = false) {
    if (!canControlPlayback) return;
    const foundIndex = playback.video ? queue.findIndex((item) => item.id === playback.video?.id) : -1;
    const currentIndex = foundIndex >= 0 ? foundIndex : 0;
    const current = queue[currentIndex];
    const next = queue.length > 1 ? queue[(currentIndex + 1) % queue.length] : undefined;
    const target = mode === 'one' || (mode === 'all' && !next) ? current : next;
    pendingQueueStart.current = target?.id ?? null;
    await advanceQueue(roomId, uid, queue, playback.video?.id, playback.volume, mode, queueHistory, preserveCurrent);
    logActivity(activityText ? 'video_error' : 'track_change', activityText ?? `chuyển sang ${target ? `“${target.title}”` : 'cuối queue'}`);
    if (target && target.id === playback.video?.id) {
      playerRef.current?.seek(0);
      playerRef.current?.play();
    }
  }

  skipRef.current = skip;

  async function cycleLoopMode() {
    if (!isHost) return;
    const next: LoopMode = loopMode === 'off' ? 'one' : loopMode === 'one' ? 'all' : 'off';
    await updateRoomMeta(roomId, { loopMode: next });
    logActivity('loop_change', `đổi chế độ lặp thành ${next === 'off' ? 'Tắt' : next === 'one' ? 'Lặp một bài' : 'Lặp toàn bộ'}`);
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
    const previous = queue.find((entry) => entry.id === playback.video?.id);
    pendingQueueStart.current = item.id;
    try {
      if (item.playbackIssue) {
        await updateQueuePlaybackIssue(roomId, item.queueId, {
          status: 'retrying',
          message: 'Host đang thử phát lại bài này.',
          embedMode: 'private',
          attempts: 0,
        }).catch(() => undefined);
      }
      await selectQueueVideo(roomId, uid, item, previous, playback.volume, loopMode === 'off', queueHistory);
      logActivity('track_change', `chọn phát “${item.title}”`);
      if (item.id === playback.video?.id) {
        playerRef.current?.seek(0);
        playerRef.current?.play();
      }
    } catch (cause) {
      pendingQueueStart.current = null;
      showNotice(cause instanceof Error ? cause.message : 'Không thể chuyển bài.', 'error');
    }
  }

  function skipFailedVideo() {
    markCurrentPlaybackIssue('failed', playerIssue || 'Host đã bỏ qua sau khi player không thể tải bài này.');
    void skip('off', `bỏ qua “${playback.video?.title ?? 'video'}” sau khi player không thể tải`, true);
  }

  const handlePlayerCued = useCallback((videoId: string) => {
    if (
      playback.video?.id !== videoId
      || playback.status !== 'paused'
      || playback.reason !== 'queue'
      || !canControlPlayback
    ) return;
    pendingQueueStart.current = videoId;
    // Start only this local iframe first. The shared room clock must remain
    // paused until YouTube confirms that media is actually playing.
    playerRef.current?.seek(0);
    playerRef.current?.play();
  }, [canControlPlayback, playback.reason, playback.status, playback.video?.id]);

  const handlePlayerPlaying = useCallback((videoId: string) => {
    if (playback.video?.id !== videoId) return;
    playerRecovery.current = { videoId, attempts: 0 };
    nonRetryablePlayerVideo.current = '';
    skippedFailedVideo.current = '';
    reportedPlayerFailure.current = '';
    window.clearTimeout(playerFailureTimer.current);
    setNeedsActivation(false);
    setPlayerIssue('');
    const successKey = `${videoId}:${playback.revision}`;
    if (isPlaybackCoordinator && reportedPlaybackSuccess.current !== successKey) {
      reportedPlaybackSuccess.current = successKey;
      const startedAt = playbackStartedAt.current.videoId === videoId ? playbackStartedAt.current.at : performance.now();
      reportPlaybackDiagnosticRef.current('playing', 1, { startupMs: Math.min(300000, Math.max(0, Math.round(performance.now() - startedAt))) });
      const current = queue.find((item) => item.id === videoId);
      if (current?.playbackIssue) void updateQueuePlaybackIssue(roomId, current.queueId, null).catch(() => undefined);
    }
    if (playback.status !== 'paused' || playback.reason !== 'queue' || !canControlPlayback) return;
    pendingQueueStart.current = null;
    // Rebase at zero at the moment playback truly starts. CUED only means the
    // metadata is ready and may still be followed by several seconds of buffer.
    void writePlayback(roomId, uid, { status: 'playing', position: 0, reason: 'queue' }).catch((cause) => {
      showNotice(cause instanceof Error ? cause.message : 'Không thể bắt đầu video.', 'error');
    });
  }, [canControlPlayback, isPlaybackCoordinator, playback.reason, playback.revision, playback.status, playback.video?.id, queue, roomId, uid]);

  function handlePlayerEnded() {
    if (!isPlaybackCoordinator || handledEndedRevision.current === playback.revision) return;
    handledEndedRevision.current = playback.revision;
    void skip(loopMode).catch((cause) => {
      showNotice(cause instanceof Error ? cause.message : 'Không thể tự chuyển bài.', 'error');
    });
  }

  function retryPlayer() {
    if (playback.video) {
      playerRecovery.current = { videoId: playback.video.id, attempts: 0 };
      nonRetryablePlayerVideo.current = '';
    }
    setPlayerEmbedMode('private');
    setPlayerIssue('');
    setNeedsActivation(false);
    skippedFailedVideo.current = '';
    reportedPlayerFailure.current = '';
    markCurrentPlaybackIssue('retrying', 'Đang tải lại player theo yêu cầu của Host.');
    window.clearTimeout(playerFailureTimer.current);
    if (playback.status === 'paused' && playback.reason === 'queue' && playback.video) {
      pendingQueueStart.current = playback.video.id;
    }
    setPlayerAttempt((attempt) => attempt + 1);
  }

  function handlePlayerError(code: number) {
    if (!playback.video) return;
    const videoId = playback.video.id;
    const failure = youtubeErrorDescription(code);
    reportPlaybackDiagnostic('error', playerRef.current?.state() ?? -1, { errorCode: code });
    window.clearTimeout(playerFailureTimer.current);
    if (failure.retryable) {
      if (playerEmbedMode === 'private') {
        playerRecovery.current.attempts = Math.max(1, playerRecovery.current.attempts);
        setPlayerIssue(`${failure.message} Đang chuyển sang player tiêu chuẩn…`);
        markCurrentPlaybackIssue('retrying', `${failure.message} Đang thử player tiêu chuẩn.`, code);
        reportPlaybackDiagnostic('fallback', playerRef.current?.state() ?? -1, { errorCode: code });
        playerFailureTimer.current = window.setTimeout(() => setPlayerEmbedMode('standard'), 1200);
        return;
      }
      if (playerRecovery.current.attempts < 2) {
        playerRecovery.current.attempts += 1;
        setPlayerIssue(`${failure.message} Đang thử tải lại player tiêu chuẩn…`);
        markCurrentPlaybackIssue('retrying', `${failure.message} Đang tải lại player tiêu chuẩn.`, code);
        playerFailureTimer.current = window.setTimeout(() => setPlayerAttempt((attempt) => attempt + 1), 1800);
        return;
      }
      setPlayerIssue(`${failure.message} Syncbox đã dừng tự khôi phục và giữ nguyên bài hát. Hãy tải lại player hoặc để Host bỏ qua.`);
      markCurrentPlaybackIssue('failed', failure.message, code);
      const reportKey = `${videoId}:${code}`;
      if (isPlaybackCoordinator && reportedPlayerFailure.current !== reportKey) {
        reportedPlayerFailure.current = reportKey;
        logActivity('video_error', `player lỗi mã ${code} với “${playback.video.title}”; giữ nguyên bài trong queue`);
      }
      return;
    }
    nonRetryablePlayerVideo.current = videoId;
    markCurrentPlaybackIssue('failed', failure.message, code);
    setPlayerIssue(isPlaybackCoordinator ? `${failure.message} Syncbox sẽ tự chuyển bài.` : failure.message);
    if (isPlaybackCoordinator && skippedFailedVideo.current !== videoId) {
      skippedFailedVideo.current = videoId;
      playerFailureTimer.current = window.setTimeout(() => {
        void skip('off', `tự bỏ qua “${playback.video?.title ?? 'video'}” · ${failure.message}`, true);
      }, 3500);
    }
  }

  async function submitChat(event: FormEvent) {
    event.preventDefault();
    if (!chatText.trim() || !me || meta?.chatEnabled === false) return;
    const text = chatText;
    setChatText('');
    shouldAutoScrollChat.current = true;
    setUnreadChatCount(0);
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
      logActivity('settings_change', 'cập nhật cài đặt phòng');
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
    if (!isOwner) return;
    if (!member.online) {
      showNotice('Chỉ có thể chuyển Owner cho thành viên đang online.', 'error');
      return;
    }
    if (!window.confirm(`Chuyển quyền Owner cho ${member.name}?\n\nBạn sẽ trở thành Co-host và ${member.name} sẽ có toàn quyền quản lý phòng.`)) return;
    try {
      await transferHost(roomId, member.uid);
      logActivity('owner_transfer', `chuyển quyền Owner cho ${member.name}`);
      showNotice(`${member.name} hiện là Owner mới · bạn đã chuyển thành Co-host.`);
    } catch (cause) {
      showNotice(cause instanceof Error ? cause.message : 'Không thể chuyển Owner.', 'error');
    }
  }

  async function setCoHost(member: Member, enabled: boolean) {
    if (!isOwner) return;
    try {
      await updateCoHost(roomId, member.uid, enabled);
      logActivity('role_change', `${enabled ? 'cấp' : 'thu hồi'} quyền Co-host ${enabled ? 'cho' : 'của'} ${member.name}`);
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

  async function joinVoice() {
    if (!uid || !me || voiceState === 'joining') return;
    if (!navigator.mediaDevices?.getUserMedia) {
      showNotice('Trình duyệt này không hỗ trợ microphone.', 'error');
      return;
    }
    setVoiceError('');
    await voiceClientRef.current?.leave();
    const client = new VoiceClient({
      onState: (state, message) => {
        if (state === 'connected') voiceShouldRecover.current = true;
        setVoiceState(state);
        setVoiceError(message ?? '');
      },
      onSpeaking: (speakerUid, speaking) => {
        setSpeakingUids((current) => {
          if (current.has(speakerUid) === speaking) return current;
          const next = new Set(current);
          if (speaking) next.add(speakerUid);
          else next.delete(speakerUid);
          return next;
        });
      },
    });
    voiceClientRef.current = client;
    try {
      const published = await client.join(roomId, uid);
      await setVoicePresence(roomId, {
        uid,
        name: me.name,
        sessionId: published.sessionId,
        trackName: published.trackName,
        joinedAt: Date.now(),
        muted: false,
      });
      setVoiceMuted(false);
      setVoiceDeafened(false);
      await client.sync(voicePresences);
    } catch (cause) {
      await removeVoicePresence(roomId, uid).catch(() => undefined);
      showNotice(cause instanceof Error ? cause.message : 'Không thể tham gia voice chat.', 'error');
    }
  }

  async function leaveVoice() {
    voiceShouldRecover.current = false;
    await removeVoicePresence(roomId, uid).catch(() => undefined);
    await voiceClientRef.current?.leave();
    voiceClientRef.current = null;
    setVoiceMuted(false);
    setVoiceDeafened(false);
    setSpeakingUids(new Set());
    setVoiceError('');
  }

  joinVoiceRef.current = joinVoice;

  function toggleVoiceMute() {
    if (forcedVoiceMuted) {
      showNotice('Host đang tắt microphone của bạn.', 'error');
      return;
    }
    const next = !voiceMuted;
    voiceClientRef.current?.setMuted(next);
    setVoiceMuted(next);
    void updateVoiceMuted(roomId, uid, next).catch(() => undefined);
  }

  function toggleVoiceDeafen() {
    const next = !voiceDeafened;
    voiceClientRef.current?.setDeafened(next);
    setVoiceDeafened(next);
    if (next && !voiceMuted) {
      setVoiceMuted(true);
      void updateVoiceMuted(roomId, uid, true).catch(() => undefined);
    }
  }

  function canModerate(member: Member) {
    if (member.uid === uid || member.uid === meta?.hostUid) return false;
    if (isOwner) return true;
    return isCoHost && !meta?.coHosts?.[member.uid];
  }

  async function toggleMemberVoiceMute(member: Member) {
    const presence = voiceByUid.get(member.uid);
    if (!presence || !canModerate(member)) return;
    const forcedMuted = !presence.forcedMuted;
    try {
      await updateVoiceForcedMuted(roomId, member.uid, forcedMuted);
      logActivity('moderation', `${forcedMuted ? 'tắt' : 'cho phép bật lại'} microphone của ${member.name}`);
      showNotice(forcedMuted ? `Đã mute ${member.name} khỏi voice.` : `${member.name} có thể bật microphone trở lại.`);
    } catch (cause) {
      showNotice(cause instanceof Error ? cause.message : 'Không thể cập nhật microphone.', 'error');
    }
  }

  async function handleKick(member: Member) {
    if (!canModerate(member) || !window.confirm(`Đưa ${member.name} khỏi phòng? Người này vẫn có thể tham gia lại.`)) return;
    try {
      await kickMember(roomId, member.uid);
      logActivity('moderation', `đưa ${member.name} khỏi phòng`);
      showNotice(`Đã đưa ${member.name} khỏi phòng.`);
    } catch (cause) {
      showNotice(cause instanceof Error ? cause.message : 'Không thể kick thành viên.', 'error');
    }
  }

  async function handleBan(member: Member) {
    if (!canModerate(member) || !window.confirm(`Cấm ${member.name} tham gia lại phòng này?`)) return;
    try {
      await banMember(roomId, member, uid);
      logActivity('moderation', `cấm ${member.name} tham gia phòng`);
      showNotice(`Đã cấm ${member.name}.`);
    } catch (cause) {
      showNotice(cause instanceof Error ? cause.message : 'Không thể ban thành viên.', 'error');
    }
  }

  mediaActionsRef.current = {
    play: () => control('playing'),
    pause: () => control('paused'),
    next: () => skip(loopMode === 'one' ? 'off' : loopMode),
  };

  useEffect(() => {
    if (!('mediaSession' in navigator) || !('MediaMetadata' in window)) return;
    if (!playback.video) {
      navigator.mediaSession.metadata = null;
      return;
    }

    navigator.mediaSession.metadata = new MediaMetadata({
      title: playback.video.title,
      artist: playback.video.channel || 'YouTube',
      album: meta?.name ? `${meta.name} · Syncbox` : 'Syncbox',
      artwork: playback.video.thumbnail ? [{ src: playback.video.thumbnail }] : [],
    });
    return () => {
      navigator.mediaSession.metadata = null;
    };
  }, [meta?.name, playback.video]);

  useEffect(() => {
    if (!('mediaSession' in navigator)) return;
    navigator.mediaSession.playbackState = playback.video ? playback.status : 'none';
  }, [playback.status, playback.video]);

  useEffect(() => {
    if (!('mediaSession' in navigator) || !navigator.mediaSession.setPositionState) return;
    const duration = playback.video?.duration ?? 0;
    try {
      if (!playback.video || !Number.isFinite(duration) || duration <= 0) {
        navigator.mediaSession.setPositionState();
        return;
      }
      navigator.mediaSession.setPositionState({
        duration,
        playbackRate: 1,
        position: Math.min(duration, Math.max(0, displayPosition)),
      });
    } catch {
      // Some browsers expose Media Session but reject position state for iframe media.
    }
  }, [displayPosition, playback.video]);

  useEffect(() => {
    if (!('mediaSession' in navigator)) return;
    const mediaSession = navigator.mediaSession;
    const setHandler = (action: MediaSessionAction, handler: MediaSessionActionHandler | null) => {
      try {
        mediaSession.setActionHandler(action, handler);
      } catch {
        // Individual actions are not supported consistently across browsers.
      }
    };

    setHandler('play', canControlPlayback ? () => {
      mediaSession.playbackState = 'playing';
      void mediaActionsRef.current.play();
    } : null);
    setHandler('pause', canControlPlayback ? () => {
      mediaSession.playbackState = 'paused';
      void mediaActionsRef.current.pause();
    } : null);
    setHandler('nexttrack', canControlPlayback ? () => { void mediaActionsRef.current.next(); } : null);

    return () => {
      setHandler('play', null);
      setHandler('pause', null);
      setHandler('nexttrack', null);
    };
  }, [canControlPlayback]);

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
          <button type="button" className={`online-pill connection-pill ${connectionNeedsAttention ? 'degraded' : connected === null ? 'connecting' : ''}`} title="Xem trạng thái kết nối" onClick={() => setConnectionOpen(true)}><i /> {onlineMemberCount} đang nghe</button>
          <button className="help-button" onClick={() => setHelpOpen(true)}><CircleHelp size={17} /> Hướng dẫn</button>
          <button className={`notification-button ${notificationsEnabled ? 'active' : ''} ${notificationPermission === 'denied' ? 'blocked' : ''}`} title={notificationsEnabled ? 'Tắt thông báo trình duyệt' : notificationPermission === 'denied' ? 'Thông báo đang bị trình duyệt chặn' : 'Bật thông báo trình duyệt'} aria-pressed={notificationsEnabled} onClick={() => void toggleBrowserNotifications()}>{notificationsEnabled ? <Bell size={17} /> : <BellOff size={17} />} <span>{notificationsEnabled ? 'Thông báo bật' : 'Thông báo'}</span></button>
          <button className="invite-button" onClick={() => void copyInvite()}><Share2 size={17} /> {copied ? 'Đã sao chép' : 'Mời bạn bè'}</button>
          {isHost && <button onClick={openSettings}><Settings2 size={17} /> Cài đặt</button>}
          <button className="avatar-button" title={`${me?.name ?? 'Tài khoản'} · Đổi tên`} aria-label="Mở hồ sơ và đổi tên" onClick={openProfile}>{me?.name?.slice(0, 1).toUpperCase()}</button>
        </div>
      </header>

      {connected === false && <div className="connection-banner"><WifiOff size={15} /> Mất kết nối — đang thử kết nối lại…</div>}
      {notice && <div className={`toast ${notice.tone}`}><span>{notice.message}</span><button onClick={() => setNotice(null)}><X size={14} /></button></div>}

      <div className={`room-shell ${sidePanelCollapsed ? 'panel-collapsed' : ''} ${rosterCollapsed ? 'roster-collapsed' : ''}`}>
        <section className="player-column">
          <SearchPanel canAdd={Boolean(canAdd)} onAdd={addToQueue} />

          <div className="video-stage" ref={videoStageRef}>
            {playback.video ? (
              <YouTubePlayer
                key={`${playerAttempt}-${playerEmbedMode}`}
                ref={playerRef}
                videoId={playback.video.id}
                startSeconds={expectedPosition(playback, serverOffset)}
                autoPlay={playback.status === 'playing' || (playback.reason === 'queue' && canControlPlayback)}
                embedMode={playerEmbedMode}
                onReady={conformPlayer}
                onCued={handlePlayerCued}
                onPlaying={handlePlayerPlaying}
                onEnded={handlePlayerEnded}
                onError={handlePlayerError}
                onAutoplayBlocked={() => setNeedsActivation(true)}
              />
            ) : (
              <div className="empty-player"><div><ListMusic size={34} /><span>Queue đang trống</span><small>Dán một link YouTube để bắt đầu.</small></div></div>
            )}
            {needsActivation && playback.video && (
              <button className="activation-overlay" onClick={() => { playerRef.current?.activate(); setNeedsActivation(false); }}><Volume2 /> Bấm để tiếp tục phát</button>
            )}
            {playerIssue && playback.video && (
              <div className="player-recovery">
                <WifiOff />
                <strong>Không tải được video</strong>
                <span>{playerIssue}</span>
                <div>
                  <button onClick={retryPlayer}><RefreshCw /> Tải lại player</button>
                  {canControlPlayback && <button onClick={skipFailedVideo}><SkipForward /> Bỏ qua bài</button>}
                  <a href={`https://www.youtube.com/watch?v=${encodeURIComponent(playback.video.id)}`} target="_blank" rel="noreferrer">Mở trên YouTube</a>
                </div>
              </div>
            )}
            {playback.reason === 'sponsorblock' && <div className="skip-toast"><Sparkles size={15} /> Đã bỏ qua sponsor</div>}
            <button className="fullscreen-button" title={fullscreen ? 'Thoát toàn màn hình' : 'Toàn màn hình'} aria-label={fullscreen ? 'Thoát toàn màn hình' : 'Mở toàn màn hình'} onClick={() => void toggleFullscreen()} disabled={!playback.video}>
              {fullscreen ? <Minimize2 /> : <Maximize2 />}
            </button>
          </div>

          <div className="now-playing">
            <div className="track-art">{playback.video ? <img src={playback.video.thumbnail} alt="" /> : <ListMusic />}</div>
            <div className="track-copy">
              <span>ĐANG PHÁT</span>
              <strong title={playback.video?.title}>{playback.video?.title ?? 'Chưa có video'}</strong>
              <small title={playback.video?.channel}>{playback.video?.channel ?? 'Thêm bài đầu tiên vào queue'}</small>
            </div>
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

        <aside className={`side-panel ${sidePanelCollapsed ? 'collapsed' : ''}`}>
          <div className="panel-tabs">
            <button className={activePanel === 'queue' ? 'active' : ''} title="Queue" onClick={() => openSidePanel('queue')}><ListMusic /><b>Queue</b><span>{queue.length}</span></button>
            <button className={activePanel === 'chat' ? 'active' : ''} title={unreadChatCount > 0 ? `Chat · ${unreadChatCount} tin chưa đọc` : 'Chat'} onClick={() => openSidePanel('chat')}><MessageCircle /><b>Chat</b>{unreadChatCount > 0 && <span className="unread-badge" aria-label={`${unreadChatCount} tin chưa đọc`}>{unreadChatCount > 99 ? '99+' : unreadChatCount}</span>}</button>
            <button className={activePanel === 'activity' ? 'active' : ''} title="Hoạt động" onClick={() => openSidePanel('activity')}><ScrollText /><b>Log</b></button>
            <button className="panel-collapse" title={sidePanelCollapsed ? 'Mở bảng bên' : 'Thu gọn bảng bên'} aria-label={sidePanelCollapsed ? 'Mở bảng bên' : 'Thu gọn bảng bên'} onClick={toggleSidePanel}>
              {sidePanelCollapsed ? <PanelRightOpen /> : <PanelRightClose />}
            </button>
          </div>

          {activePanel === 'queue' && (
            <div className="panel-body queue-panel">
              <div className="panel-title">
                <div><strong>{queueView === 'upcoming' ? 'Tiếp theo' : 'Đã phát'}</strong><span>{queueView === 'upcoming' ? `${queue.length} video ${queueDuration > 0 ? `· ${formatDuration(queueDuration)}` : ''}` : `${queueHistory.length} bài gần nhất`}</span></div>
                {queueView === 'upcoming' && canManageQueue && queue.length > 0 && <button className="clear-queue" onClick={() => void handleClearQueue()}><Trash2 size={14} /> Xóa hết</button>}
              </div>
              <div className="queue-view-tabs" role="tablist" aria-label="Queue và lịch sử">
                <button className={queueView === 'upcoming' ? 'active' : ''} onClick={() => setQueueView('upcoming')}><ListMusic size={13} /> Queue <span>{queue.length}</span></button>
                <button className={queueView === 'history' ? 'active' : ''} onClick={() => setQueueView('history')}><History size={13} /> Lịch sử <span>{queueHistory.length}</span></button>
              </div>
              {queueView === 'upcoming' ? <div className="queue-list">
                {queue.map((item, index) => (
                  <article
                    className={`queue-item ${playback.video?.id === item.id ? 'current' : ''} ${item.playbackIssue ? `has-issue ${item.playbackIssue.status}` : ''} ${draggedQueueId === item.queueId ? 'dragging' : ''} ${dropTarget?.queueId === item.queueId ? `drop-${dropTarget.position}` : ''}`}
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
                    <div className="queue-copy">
                      <strong title={item.title}>{item.title}</strong>
                      <span title={item.channel}>{item.channel}</span>
                      <small title={`Thêm bởi ${item.addedByName}${item.duration ? ` · ${formatDuration(item.duration)}` : ''}`}>thêm bởi <b>{item.addedByName}</b> {item.duration ? `· ${formatDuration(item.duration)}` : ''}</small>
                      {item.playbackIssue && <span className="queue-issue" title={item.playbackIssue.message}><WifiOff size={11} /> {item.playbackIssue.status === 'retrying' ? 'Đang thử lại' : 'Không phát được'}{item.playbackIssue.code ? ` · lỗi ${item.playbackIssue.code}` : ''}</span>}
                    </div>
                    <div className="queue-item-actions">
                      {item.playbackIssue && canControlPlayback && <button className="queue-retry" title="Thử phát lại bài này" onClick={() => void playQueueItem(item)}><RefreshCw size={13} /></button>}
                      <button className={`queue-vote ${item.votes?.[uid] ? 'active' : ''}`} title="Bình chọn bài này" onClick={() => void toggleQueueVote(roomId, item.queueId, uid, Boolean(item.votes?.[uid])).catch((cause) => showNotice(cause instanceof Error ? cause.message : 'Không thể bình chọn.', 'error'))}><ThumbsUp size={13} /><span>{Object.keys(item.votes ?? {}).length || ''}</span></button>
                      {canManageQueue && <span className="queue-move-buttons"><button title="Đưa lên" disabled={index === 0} onClick={() => void moveQueueBy(item.queueId, -1)}><ArrowUp size={12} /></button><button title="Đưa xuống" disabled={index === queue.length - 1} onClick={() => void moveQueueBy(item.queueId, 1)}><ArrowDown size={12} /></button></span>}
                      {canManageQueue && <GripVertical className="queue-grip" size={15} />}
                      {isHost && <button className="queue-remove" onClick={() => void handleRemoveQueueItem(item)}><Trash2 size={15} /></button>}
                    </div>
                  </article>
                ))}
                {queue.length === 0 && <div className="empty-list"><ListMusic /><span>Chưa có bài nào</span><small>Thêm link hoặc tìm kiếm để xây queue.</small></div>}
              </div> : <div className="queue-list history-list">
                {queueHistory.map((item) => {
                  const alreadyQueued = playback.video?.id === item.id || queue.some((queued) => queued.id === item.id);
                  return (
                    <article className="history-item" key={item.historyId}>
                      <img src={item.thumbnail} alt="" />
                      <div>
                        <strong title={item.title}>{item.title}</strong>
                        <span title={item.channel}>{item.channel || 'YouTube'}</span>
                        <small>{formatChatDate(item.playedAt)} · {formatChatTimestamp(item.playedAt)}{item.addedByName ? ` · thêm bởi ${item.addedByName}` : ''}</small>
                      </div>
                      <button disabled={!canAdd || alreadyQueued} title={alreadyQueued ? 'Bài này đang có trong queue' : 'Thêm lại vào queue'} onClick={() => void addToQueue([item])}>
                        {alreadyQueued ? <ShieldCheck size={14} /> : <RefreshCw size={14} />}
                      </button>
                    </article>
                  );
                })}
                {queueHistory.length === 0 && <div className="empty-list"><History /><span>Chưa có lịch sử</span><small>Các bài đã phát sẽ xuất hiện tại đây.</small></div>}
              </div>}
              {isHost && (
                <div className="sponsor-setting">
                  <div><Sparkles size={17} /><span><strong>SponsorBlock</strong><small>Tự động bỏ qua sponsor · <a href="https://sponsor.ajay.app" target="_blank" rel="noreferrer">dữ liệu cộng đồng</a></small></span></div>
                  <label className="toggle"><input type="checkbox" checked={meta.sponsorBlockEnabled} onChange={(event) => { const enabled = event.target.checked; void updateRoomMeta(roomId, { sponsorBlockEnabled: enabled }).then(() => logActivity('settings_change', `${enabled ? 'bật' : 'tắt'} SponsorBlock`)).catch((cause) => showNotice(cause instanceof Error ? cause.message : 'Không thể cập nhật SponsorBlock.', 'error')); }} /><span /></label>
                </div>
              )}
            </div>
          )}

          {activePanel === 'chat' && (
            <div className="panel-body chat-panel">
              <div className="messages" ref={messagesRef} onScroll={handleChatScroll}>
                {messages.map((message, index) => {
                  const showDate = index === 0 || chatDateKey(messages[index - 1].sentAt) !== chatDateKey(message.sentAt);
                  return (
                    <Fragment key={message.id}>
                      {showDate && <div className="chat-date-divider"><span>{formatChatDate(message.sentAt)}</span></div>}
                      <div className={`message ${message.uid === uid ? 'mine' : ''}`}>
                        <div className="message-meta">
                          <strong>{message.uid === uid ? 'Bạn' : message.name}</strong>
                          <time dateTime={chatTimestampIso(message.sentAt)}>{formatChatTimestamp(message.sentAt)}</time>
                        </div>
                        <p>{message.text}</p>
                      </div>
                    </Fragment>
                  );
                })}
                {messages.length === 0 && <div className="empty-list"><MessageCircle /><span>{meta.chatEnabled === false ? 'Chat đang được Host tắt' : 'Cuộc trò chuyện bắt đầu ở đây'}</span></div>}
              </div>
              {unreadChatCount > 0 && (
                <button className="chat-jump-latest" type="button" onClick={scrollChatToLatest} aria-label={`Đi đến ${unreadChatCount} tin nhắn mới nhất`}>
                  <ArrowDown size={14} />
                  <span>{unreadChatCount > 99 ? '99+' : unreadChatCount} tin mới</span>
                </button>
              )}
              <form className="chat-form" onSubmit={submitChat}><input value={chatText} onChange={(event) => setChatText(event.target.value)} placeholder={meta.chatEnabled === false ? 'Chat đã bị tắt' : 'Nhắn cho mọi người…'} disabled={meta.chatEnabled === false} maxLength={500} /><button disabled={meta.chatEnabled === false}><ChevronRight /></button></form>
            </div>
          )}

          {activePanel === 'activity' && (
            <div className="panel-body activity-panel">
              <div className="panel-title"><div><strong>Hoạt động phòng</strong><span>100 sự kiện gần nhất</span></div><ScrollText /></div>
              <div className="activity-list">
                {activity.map((item, index) => {
                  const showDate = index === 0 || chatDateKey(activity[index - 1].createdAt) !== chatDateKey(item.createdAt);
                  return (
                    <Fragment key={item.id}>
                      {showDate && <div className="chat-date-divider"><span>{formatChatDate(item.createdAt)}</span></div>}
                      <article className={`activity-item ${item.type}`}>
                        <i><ScrollText /></i>
                        <div><p><strong>{item.actorUid === uid ? 'Bạn' : item.actorName}</strong> {item.text}</p><time dateTime={chatTimestampIso(item.createdAt)}>{formatChatTimestamp(item.createdAt)}</time></div>
                      </article>
                    </Fragment>
                  );
                })}
                {activity.length === 0 && <div className="empty-list"><ScrollText /><span>Chưa có hoạt động</span><small>Các thay đổi quan trọng của phòng sẽ xuất hiện tại đây.</small></div>}
              </div>
            </div>
          )}

        </aside>

        <aside className={`member-roster ${rosterCollapsed ? 'collapsed' : ''}`} aria-label="Thành viên trong phòng">
          <div className="roster-header">
            <div><Users /><strong>Thành viên</strong></div>
            <span>{onlineMemberCount} online</span>
            <button className="roster-collapse" title={rosterCollapsed ? 'Mở danh sách thành viên' : 'Thu gọn danh sách thành viên'} aria-label={rosterCollapsed ? 'Mở danh sách thành viên' : 'Thu gọn danh sách thành viên'} onClick={toggleRoster}>
              {rosterCollapsed ? <PanelRightOpen /> : <PanelRightClose />}
            </button>
          </div>
          <section className={`voice-card ${voiceJoined ? 'joined' : ''}`}>
            <div className="voice-heading">
              <span className="voice-icon"><Radio /></span>
              <div>
                <strong>{voiceJoined ? 'Voice đã kết nối' : 'Voice Lounge'}</strong>
                <small>
                  {voiceState === 'joining' ? 'Đang mở microphone…'
                    : voiceState === 'reconnecting' ? 'Đang kết nối lại…'
                      : voiceJoined ? `${voicePresences.length} người trong voice`
                        : 'Trò chuyện trong khi nghe nhạc'}
                </small>
              </div>
              {!voiceJoined ? (
                <button className="voice-join" onClick={() => void joinVoice()} disabled={voiceState === 'joining'}>
                  {voiceState === 'joining' ? <LoaderCircle className="spin" /> : <Mic />}
                  <span>Tham gia</span>
                </button>
              ) : (
                <button className="voice-leave" title="Rời voice" onClick={() => void leaveVoice()}><X /></button>
              )}
            </div>
            {voiceJoined && (
              <div className="voice-controls">
                <button className={voiceMuted ? 'active' : ''} onClick={toggleVoiceMute} disabled={voiceDeafened || forcedVoiceMuted} title={forcedVoiceMuted ? 'Host đang tắt microphone của bạn' : undefined}>
                  {voiceMuted ? <MicOff /> : <Mic />}
                  <span>{forcedVoiceMuted ? 'Bị mute' : voiceMuted ? 'Bật mic' : 'Tắt mic'}</span>
                </button>
                <button className={voiceDeafened ? 'active' : ''} onClick={toggleVoiceDeafen}>
                  {voiceDeafened ? <VolumeX /> : <Headphones />}
                  <span>{voiceDeafened ? 'Bật nghe' : 'Tắt nghe'}</span>
                </button>
              </div>
            )}
            {voicePresences.length > 0 && (
              <div className="voice-participants" aria-label={`${voicePresences.length} người đang trong voice`}>
                {voicePresences.map((presence) => (
                  <div className={`voice-participant ${speakingUids.has(presence.uid) ? 'speaking' : ''}`} key={presence.uid} title={`${presence.name}${presence.muted ? ' · Đang tắt mic' : ' · Đang trong voice'}`}>
                    <i>{presence.name.slice(0, 1).toUpperCase()}</i>
                    <span>{presence.name}{presence.uid === uid ? ' (bạn)' : ''}</span>
                    {presence.muted ? <MicOff /> : <Mic />}
                  </div>
                ))}
              </div>
            )}
            {voiceError && (
              <button className="voice-error" onClick={() => void joinVoice()}>
                <RefreshCw /><span>{voiceError}</span><b>Thử lại</b>
              </button>
            )}
          </section>
          <div className="roster-scroll">
            {memberGroups.map((group) => (
              <section className="roster-group" key={group.key}>
                <h3>{group.label} — {group.members.length}</h3>
                {group.members.map((member) => (
                  <article className={`member roster-member ${speakingUids.has(member.uid) ? 'speaking' : ''}`} key={member.uid} title={`${member.name}${voiceByUid.has(member.uid) ? ' · Trong voice' : ''}`}>
                    <div className={`member-avatar ${voiceByUid.has(member.uid) ? 'in-voice' : ''}`}>
                      {member.name.slice(0, 1).toUpperCase()}
                      <i className="member-presence" />
                    </div>
                    <div className="member-copy">
                      <strong>{member.name} {member.uid === uid && <small>(bạn)</small>}</strong>
                      <span>{voiceByUid.has(member.uid) ? <>{voiceByUid.get(member.uid)?.muted ? <MicOff size={10} /> : <Mic size={10} />} Trong voice</> : member.uid === meta.hostUid ? 'Owner phòng' : meta.coHosts?.[member.uid] ? 'Co-host' : member.role === 'dj' ? 'DJ' : 'Đang nghe'}</span>
                    </div>
                    {member.uid === meta.hostUid ? <Crown className="host-crown" size={17} /> : meta.coHosts?.[member.uid] ? (
                      isOwner ? <span className="member-inline-actions"><button className="cohost-button active" title="Thu hồi quyền Co-host" onClick={() => void setCoHost(member, false)}><ShieldCheck size={15} /></button>{voiceByUid.has(member.uid) && <button className={`voice-force-mute ${voiceByUid.get(member.uid)?.forcedMuted ? 'active' : ''}`} title={voiceByUid.get(member.uid)?.forcedMuted ? 'Cho phép bật mic' : 'Mute khỏi voice'} onClick={() => void toggleMemberVoiceMute(member)}><MicOff size={14} /></button>}</span> : <ShieldCheck className="cohost-mark" size={17} />
                    ) : isHost ? (
                      <div className="member-admin">
                        {isOwner && <button title="Thêm Co-host" onClick={() => void setCoHost(member, true)}><ShieldCheck size={14} /></button>}
                        {isOwner && <button title={member.online ? 'Chuyển quyền Owner' : 'Thành viên phải online để nhận Owner'} disabled={!member.online} onClick={() => void handOffHost(member)}><Crown size={14} /></button>}
                        {canModerate(member) && voiceByUid.has(member.uid) && <button className={`voice-force-mute ${voiceByUid.get(member.uid)?.forcedMuted ? 'active' : ''}`} title={voiceByUid.get(member.uid)?.forcedMuted ? 'Cho phép bật mic' : 'Mute khỏi voice'} onClick={() => void toggleMemberVoiceMute(member)}><MicOff size={14} /></button>}
                        <RolePicker value={member.role === 'dj' ? 'dj' : 'listener'} onChange={(role) => void updateMemberRole(roomId, member.uid, role as Role).then(() => { logActivity('role_change', `${role === 'dj' ? 'cấp quyền DJ cho' : 'chuyển về Listener'} ${member.name}`); showNotice(`Đã cập nhật quyền của ${member.name}.`); }).catch((cause) => showNotice(cause instanceof Error ? cause.message : 'Không thể cập nhật quyền.', 'error'))} />
                        {canModerate(member) && <button className="moderation-button" title="Đưa khỏi phòng" onClick={() => void handleKick(member)}><UserMinus size={14} /></button>}
                        {canModerate(member) && <button className="moderation-button ban" title="Cấm khỏi phòng" onClick={() => void handleBan(member)}><Ban size={14} /></button>}
                      </div>
                    ) : <i className="member-online" />}
                  </article>
                ))}
              </section>
            ))}
          </div>
        </aside>
      </div>

      <footer className="room-footer">
        <span>Syncbox được xây dựng bởi <strong>HFake</strong></span>
        <CreatorLinks compact />
      </footer>

      {connectionOpen && (
        <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setConnectionOpen(false); }}>
          <section className="settings-modal connection-modal" role="dialog" aria-modal="true" aria-labelledby="connection-title">
            <div className="modal-heading"><div><span>TRẠNG THÁI HỆ THỐNG</span><h2 id="connection-title">Kết nối Syncbox</h2></div><button type="button" aria-label="Đóng trạng thái" onClick={() => setConnectionOpen(false)}><X /></button></div>
            <div className="connection-summary">
              <i className={connectionNeedsAttention ? 'error' : connected === null ? 'loading' : 'ok'} />
              <div><strong>{connectionNeedsAttention ? 'Cần kiểm tra' : connected === null ? 'Đang kết nối' : 'Mọi thứ ổn định'}</strong><span>Syncbox tự thử kết nối lại khi một dịch vụ bị gián đoạn.</span></div>
            </div>
            <div className="connection-services">
              <article className={connected === false ? 'error' : connected === null ? 'loading' : 'ok'}>
                <i /><div><strong>Phòng Firebase</strong><span>{connected === false ? 'Mất kết nối · đang tự thử lại' : connected === null ? 'Đang thiết lập kết nối' : 'Realtime Database đã kết nối'}</span></div>
                {connected === false && <button onClick={() => window.location.reload()}><RefreshCw size={13} /> Tải lại</button>}
              </article>
              <article className={playerConnectionState === 'idle' ? 'idle' : playerConnectionState === 'error' ? 'error' : playerConnectionState === 'attention' || playerConnectionState === 'loading' ? 'loading' : 'ok'}>
                <i /><div><strong>YouTube Player</strong><span>{playerConnectionState === 'idle' ? 'Chưa có bài đang phát' : playerConnectionState === 'error' ? playerIssue : playerConnectionState === 'attention' ? 'Trình duyệt đang chờ bạn bật âm thanh' : playerConnectionState === 'loading' ? 'Đang tải và đồng bộ player' : 'Player đã sẵn sàng'}</span></div>
                {(playerConnectionState === 'error' || playerConnectionState === 'loading') && playback.video && <button onClick={retryPlayer}><RefreshCw size={13} /> Thử lại</button>}
                {playerConnectionState === 'attention' && <button onClick={() => { playerRef.current?.activate(); setNeedsActivation(false); }}><Volume2 size={13} /> Bật âm thanh</button>}
              </article>
              <article className={voiceState === 'idle' ? 'idle' : voiceState === 'error' ? 'error' : voiceState === 'joining' || voiceState === 'reconnecting' ? 'loading' : 'ok'}>
                <i /><div><strong>Voice Lounge</strong><span>{voiceState === 'idle' ? 'Chưa tham gia voice' : voiceState === 'joining' ? 'Đang tham gia voice' : voiceState === 'reconnecting' ? 'Đang tự kết nối lại' : voiceState === 'error' ? voiceError || 'Kết nối voice gặp lỗi' : 'Voice đã kết nối'}</span></div>
                {voiceState === 'error' && <button onClick={() => { voiceRecoveryAttempts.current = 0; void joinVoice(); }}><RefreshCw size={13} /> Kết nối lại</button>}
              </article>
            </div>
            <div className="diagnostic-summary">
              <div><span>24 GIỜ GẦN NHẤT</span><strong>Playback diagnostics</strong><small>Ẩn danh · không lưu UID, tên hoặc nội dung chat</small></div>
              <dl>
                <div><dt>{diagnosticSummary.starts}</dt><dd>Lần phát</dd></div>
                <div><dt>{diagnosticSummary.errors}</dt><dd>Lỗi player</dd></div>
                <div><dt>{diagnosticSummary.fallbacks}</dt><dd>Fallback</dd></div>
                <div><dt>{diagnosticSummary.averageStartup ? `${(diagnosticSummary.averageStartup / 1000).toFixed(1)}s` : '—'}</dt><dd>Start trung bình</dd></div>
              </dl>
              {diagnosticSummary.total === 0 && <p>Chưa có đủ dữ liệu. Thống kê sẽ xuất hiện khi phòng bắt đầu phát nhạc.</p>}
            </div>
            <div className="connection-note"><ShieldCheck size={15} /><span>Firebase tự nối lại và đồng bộ thành viên; player tự tải lại tối đa 2 lần; voice tự kết nối lại tối đa 2 lần trước khi cần thao tác thủ công.</span></div>
          </section>
        </div>
      )}

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
              <article><i><History /></i><div><strong>Lịch sử phát</strong><span>Mở Lịch sử trong Queue để xem tối đa 50 bài gần nhất và thêm lại; bài trùng được tự động bỏ qua.</span></div></article>
              <article><i><ThumbsUp /></i><div><strong>Bình chọn</strong><span>Mỗi người có một vote để thể hiện bài muốn nghe tiếp.</span></div></article>
              <article><i><MessageCircle /></i><div><strong>Chat</strong><span>Badge hiển thị tin chưa đọc và tự xóa khi bạn mở chat hoặc cuộn xuống cuối.</span></div></article>
              <article><i><Bell /></i><div><strong>Thông báo</strong><span>Bật bằng nút chuông trên header để nhận chat mới, thay đổi quyền và voice mute khi tab chạy nền.</span></div></article>
              <article><i><AudioWaveform /></i><div><strong>Media Session</strong><span>Hiển thị bài trên màn hình khóa; Play, Pause và Next phụ thuộc việc trình duyệt có chuyển action từ YouTube iframe cho Syncbox hay không.</span></div></article>
              <article><i><Download /></i><div><strong>Cài Syncbox</strong><span>Chrome/Edge sẽ hiện nút Cài Syncbox. Trên iPhone, dùng Chia sẻ → Thêm vào Màn hình chính.</span></div></article>
              <article><i><WifiOff /></i><div><strong>Trạng thái kết nối</strong><span>Bấm vào số người đang nghe trên header để kiểm tra Firebase, player, voice và chạy phục hồi thủ công.</span></div></article>
              <article><i><Crown /></i><div><strong>Chuyển Owner</strong><span>Owner bấm biểu tượng vương miện cạnh một thành viên online; Owner cũ sẽ trở thành Co-host.</span></div></article>
              <article><i><Sparkles /></i><div><strong>SponsorBlock</strong><span>Tự bỏ qua sponsor và các phân đoạn cộng đồng đã đánh dấu.</span></div></article>
              <article><i><Mic /></i><div><strong>Voice Lounge</strong><span>Bấm Tham gia trong danh sách thành viên và cho phép trình duyệt dùng microphone.</span></div></article>
              <article><i><VolumeX /></i><div><strong>Mute / Deafen</strong><span>Mute tắt microphone; Deafen tắt âm thanh của mọi người. Owner/Co-host có thể force-mute thành viên trong voice.</span></div></article>
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

      {profileOpen && (
        <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget && !profileSaving) setProfileOpen(false); }}>
          <form className="settings-modal profile-modal" onSubmit={(event) => void saveDisplayName(event)}>
            <div className="modal-heading">
              <div><span>HỒ SƠ TRONG PHÒNG</span><h2>Đổi tên hiển thị</h2></div>
              <button type="button" aria-label="Đóng" disabled={profileSaving} onClick={() => setProfileOpen(false)}><X /></button>
            </div>
            <label className="field-label" htmlFor="display-name">Tên của bạn</label>
            <div className="profile-name-field">
              <Pencil />
              <input id="display-name" autoFocus maxLength={32} value={nameDraft} onChange={(event) => setNameDraft(event.target.value)} placeholder="Nhập tên hiển thị" />
              <span>{nameDraft.trim().length}/32</span>
            </div>
            <p className="profile-name-note">Tên mới sẽ được cập nhật cho danh sách thành viên và Voice Lounge. Tin nhắn hoặc bài hát đã thêm trước đó vẫn giữ tên cũ.</p>
            <div className="modal-actions profile-actions">
              <button type="button" className="secondary-button" disabled={profileSaving} onClick={() => setProfileOpen(false)}>Huỷ</button>
              <button className="save-settings" disabled={profileSaving || !nameDraft.trim()}>{profileSaving ? <><LoaderCircle className="spin" /> Đang lưu</> : 'Lưu tên mới'}</button>
            </div>
          </form>
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
