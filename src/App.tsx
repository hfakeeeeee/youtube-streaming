import { FormEvent, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ChevronRight,
  Crown,
  Headphones,
  History,
  ListMusic,
  LoaderCircle,
  LockKeyhole,
  MessageCircle,
  MoreHorizontal,
  Pause,
  Play,
  Radio,
  Repeat2,
  Settings2,
  Share2,
  ShieldCheck,
  SkipForward,
  Sparkles,
  Trash2,
  Users,
  Volume2,
  WandSparkles,
} from 'lucide-react';
import { Brand } from './components/Brand';
import { SearchPanel } from './components/SearchPanel';
import { YouTubePlayer, type PlayerHandle } from './components/YouTubePlayer';
import { getSponsorSegments } from './lib/api';
import {
  addVideos,
  advanceQueue,
  createRoom,
  ensureUser,
  firebaseConfigured,
  joinRoom,
  normalizeMembers,
  normalizeMessages,
  normalizeQueue,
  removeQueueItem,
  sendChat,
  subscribeRoom,
  updateMemberRole,
  updateRoomMeta,
  writePlayback,
} from './lib/firebase';
import { formatDuration } from './lib/youtube';
import type { ChatMessage, LoopMode, Member, PlaybackState, QueueItem, Role, RoomMeta, SponsorSegment, VideoItem } from './types';

const EMPTY_PLAYBACK: PlaybackState = {
  video: null,
  status: 'paused',
  position: 0,
  volume: 80,
  updatedAt: 0,
  revision: 0,
  changedBy: '',
};

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
          <label>Tên của bạn<input value={name} onChange={(event) => setName(event.target.value)} placeholder="Ví dụ: Minh" maxLength={32} /></label>
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
      <section className="how" id="how-it-works">
        <article><span>01</span><Headphones /><h3>Tạo một phòng</h3><p>Không cần đăng ký. Chỉ cần đặt tên và chia sẻ mã phòng.</p></article>
        <article><span>02</span><ListMusic /><h3>Cùng xây queue</h3><p>Dán link hoặc nhập từ khóa rồi Enter để tìm kiếm YouTube.</p></article>
        <article><span>03</span><WandSparkles /><h3>Phát đồng bộ</h3><p>Play, pause, seek và SponsorBlock áp dụng cho toàn bộ phòng.</p></article>
      </section>
      <footer className="home-footer"><Brand /><span>Một không gian nghe YouTube sạch và cộng tác.</span></footer>
    </main>
  );
}

function expectedPosition(playback: PlaybackState) {
  if (playback.status !== 'playing' || typeof playback.updatedAt !== 'number') return playback.position;
  return Math.max(0, playback.position + (Date.now() - playback.updatedAt) / 1000);
}

function RoomPage({ roomId }: { roomId: string }) {
  const [uid, setUid] = useState('');
  const [meta, setMeta] = useState<RoomMeta | null>(null);
  const [playback, setPlayback] = useState<PlaybackState>(EMPTY_PLAYBACK);
  const [queue, setQueue] = useState<QueueItem[]>([]);
  const [members, setMembers] = useState<Member[]>([]);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [segments, setSegments] = useState<SponsorSegment[]>([]);
  const [activePanel, setActivePanel] = useState<'queue' | 'chat' | 'people'>('queue');
  const [chatText, setChatText] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [needsActivation, setNeedsActivation] = useState(false);
  const [copied, setCopied] = useState(false);
  const [displayPosition, setDisplayPosition] = useState(0);
  const playerRef = useRef<PlayerHandle>(null);
  const lastSponsorSkip = useRef('');

  const me = useMemo(() => members.find((member) => member.uid === uid), [members, uid]);
  const isHost = me?.role === 'host';
  const canAdd = me?.role === 'host' || me?.role === 'dj';
  const sponsorCategoryKey = meta?.sponsorCategories.join(',') ?? 'sponsor';
  const loopMode: LoopMode = meta?.loopMode ?? 'off';

  useEffect(() => {
    let active = true;
    const unsubscribes: Array<() => void> = [];
    async function connect() {
      try {
        const displayName = localStorage.getItem('syncbox:name') || `Guest ${Math.floor(Math.random() * 900 + 100)}`;
        localStorage.setItem('syncbox:name', displayName);
        const user = await ensureUser();
        if (!active) return;
        setUid(user.uid);
        const joined = await joinRoom(roomId, displayName);
        saveRecentRoom(joined.roomId, joined.roomName, joined.role);
        unsubscribes.push(
          subscribeRoom<RoomMeta | null>(roomId, 'meta', setMeta),
          subscribeRoom<PlaybackState | null>(roomId, 'playback', (value) => setPlayback(value ?? EMPTY_PLAYBACK)),
          subscribeRoom<Record<string, Omit<QueueItem, 'queueId'>> | null>(roomId, 'queue', (value) => setQueue(normalizeQueue(value))),
          subscribeRoom<Record<string, Member> | null>(roomId, 'members', (value) => setMembers(normalizeMembers(value))),
          subscribeRoom<Record<string, Omit<ChatMessage, 'id'>> | null>(roomId, 'messages', (value) => setMessages(normalizeMessages(value))),
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
    };
  }, [roomId]);

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
    const expected = expectedPosition(playback);
    const actual = player.currentTime();
    if (Math.abs(actual - expected) > 1.5) player.seek(expected);
    player.setVolume(playback.volume ?? 80);
    if (playback.status === 'playing') player.play();
    else player.pause();
  }, [playback]);

  useEffect(() => {
    const timer = window.setTimeout(conformPlayer, 250);
    return () => window.clearTimeout(timer);
  }, [conformPlayer]);

  useEffect(() => {
    const timer = window.setInterval(() => {
      setDisplayPosition(playerRef.current?.currentTime() ?? expectedPosition(playback));
    }, 500);
    return () => window.clearInterval(timer);
  }, [playback]);

  useEffect(() => {
    const timer = window.setInterval(() => {
      if (!playback.video || playback.status !== 'playing') return;
      const player = playerRef.current;
      if (!player) return;
      const expected = expectedPosition(playback);
      if (Math.abs(player.currentTime() - expected) > 2.5) player.seek(expected);

      if (!isHost || !meta?.sponsorBlockEnabled) return;
      const current = player.currentTime();
      const match = segments.find(({ segment, actionType }) => actionType === 'skip' && current >= segment[0] && current < segment[1] - 0.2);
      if (!match) return;
      const key = `${playback.video?.id}:${match.segment[0]}`;
      if (lastSponsorSkip.current === key) return;
      lastSponsorSkip.current = key;
      void writePlayback(roomId, uid, { position: match.segment[1], status: 'playing', reason: 'sponsorblock' });
    }, 500);
    return () => window.clearInterval(timer);
  }, [isHost, meta?.sponsorBlockEnabled, playback, roomId, segments, uid]);

  async function addToQueue(videos: VideoItem[]) {
    if (!me) return;
    await addVideos(roomId, videos, me);
    if (!playback.video && videos[0]) {
      await writePlayback(roomId, uid, { video: videos[0], status: 'playing', position: 0, reason: 'queue' });
    }
  }

  async function control(status: 'playing' | 'paused') {
    if (!isHost) return;
    await writePlayback(roomId, uid, { status, position: playerRef.current?.currentTime() ?? expectedPosition(playback), reason: 'control' });
  }

  async function skip(mode: LoopMode = 'off') {
    if (!isHost) return;
    await advanceQueue(roomId, uid, queue, playback.video?.id, playback.volume, mode);
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

  async function setRoomVolume(volume: number) {
    if (!isHost) return;
    playerRef.current?.setVolume(volume);
    await writePlayback(roomId, uid, { volume, position: playerRef.current?.currentTime() ?? expectedPosition(playback), reason: 'control' });
  }

  async function playQueueItem(item: QueueItem) {
    if (!isHost) return;
    await writePlayback(roomId, uid, { video: item, status: 'playing', position: 0, reason: 'queue' });
  }

  async function submitChat(event: FormEvent) {
    event.preventDefault();
    if (!chatText.trim() || !me) return;
    const text = chatText;
    setChatText('');
    await sendChat(roomId, uid, me.name, text);
  }

  async function copyInvite() {
    await navigator.clipboard.writeText(window.location.href);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1600);
  }

  if (loading) return <div className="center-screen"><LoaderCircle className="spin" /><span>Đang vào phòng {roomId}…</span></div>;
  if (error || !meta) return (
    <div className="center-screen error-screen"><Brand /><h2>Không thể mở phòng</h2><p>{error || 'Phòng không còn tồn tại.'}</p><a className="primary-button" href="#/">Về trang chủ</a></div>
  );

  return (
    <main className="room-page">
      <header className="room-header">
        <Brand />
        <div className="room-identity"><span>{meta.name}</span><small><LockKeyhole size={12} /> Phòng riêng tư · {roomId}</small></div>
        <div className="room-actions">
          <span className="online-pill"><i /> {members.length} đang nghe</span>
          <button onClick={() => void copyInvite()}><Share2 size={17} /> {copied ? 'Đã sao chép' : 'Mời bạn bè'}</button>
          <button className="avatar-button" title={me?.name}>{me?.name?.slice(0, 1).toUpperCase()}</button>
        </div>
      </header>

      <div className="room-shell">
        <section className="player-column">
          <SearchPanel canAdd={Boolean(canAdd)} onAdd={addToQueue} />

          <div className="video-stage">
            {playback.video ? (
              <YouTubePlayer
                ref={playerRef}
                videoId={playback.video.id}
                startSeconds={expectedPosition(playback)}
                onReady={conformPlayer}
                onEnded={() => { if (isHost) void skip(loopMode); }}
                onAutoplayBlocked={() => setNeedsActivation(true)}
              />
            ) : (
              <div className="empty-player"><div><ListMusic size={34} /><span>Queue đang trống</span><small>Dán một link YouTube để bắt đầu.</small></div></div>
            )}
            {needsActivation && playback.video && (
              <button className="activation-overlay" onClick={() => { playerRef.current?.activate(); setNeedsActivation(false); }}><Volume2 /> Bật âm thanh trên thiết bị này</button>
            )}
            {playback.reason === 'sponsorblock' && <div className="skip-toast"><Sparkles size={15} /> Đã bỏ qua sponsor</div>}
          </div>

          <div className="now-playing">
            <div className="track-art">{playback.video ? <img src={playback.video.thumbnail} alt="" /> : <ListMusic />}</div>
            <div className="track-copy"><span>ĐANG PHÁT</span><strong>{playback.video?.title ?? 'Chưa có video'}</strong><small>{playback.video?.channel ?? 'Thêm bài đầu tiên vào queue'}</small></div>
            <div className="room-controls">
              <button className="control-main" onClick={() => void control(playback.status === 'playing' ? 'paused' : 'playing')} disabled={!isHost || !playback.video}>
                {playback.status === 'playing' ? <Pause fill="currentColor" /> : <Play fill="currentColor" />}
              </button>
              <button onClick={() => void skip(loopMode === 'one' ? 'off' : loopMode)} disabled={!isHost || !playback.video}><SkipForward /></button>
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
              aria-label="Âm lượng phòng"
              type="range"
              min="0"
              max="100"
              value={playback.volume ?? 80}
              disabled={!isHost}
              onChange={(event) => void setRoomVolume(Number(event.target.value))}
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
              <div className="panel-title"><div><strong>Tiếp theo</strong><span>{queue.length} video trong hàng đợi</span></div><MoreHorizontal /></div>
              <div className="queue-list">
                {queue.map((item, index) => (
                  <article className={`queue-item ${playback.video?.id === item.id ? 'current' : ''}`} key={item.queueId}>
                    <button className="queue-thumb" disabled={!isHost} onClick={() => void playQueueItem(item)}>
                      <img src={item.thumbnail} alt="" />
                      <span>{playback.video?.id === item.id ? <Volume2 size={16} /> : index + 1}</span>
                    </button>
                    <div><strong>{item.title}</strong><span>{item.channel}</span><small>thêm bởi {item.addedByName} {item.duration ? `· ${formatDuration(item.duration)}` : ''}</small></div>
                    {isHost && <button className="queue-remove" onClick={() => void removeQueueItem(roomId, item.queueId)}><Trash2 size={15} /></button>}
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
                {messages.length === 0 && <div className="empty-list"><MessageCircle /><span>Cuộc trò chuyện bắt đầu ở đây</span></div>}
              </div>
              <form className="chat-form" onSubmit={submitChat}><input value={chatText} onChange={(event) => setChatText(event.target.value)} placeholder="Nhắn cho mọi người…" maxLength={500} /><button><ChevronRight /></button></form>
            </div>
          )}

          {activePanel === 'people' && (
            <div className="panel-body people-panel">
              <div className="panel-title"><div><strong>Trong phòng</strong><span>{members.length} người đang online</span></div></div>
              {members.map((member) => (
                <article className="member" key={member.uid}>
                  <div className="member-avatar">{member.name.slice(0, 1).toUpperCase()}</div>
                  <div><strong>{member.name} {member.uid === uid && '(bạn)'}</strong><span>{member.role === 'host' ? 'Host' : member.role === 'dj' ? 'DJ' : 'Listener'}</span></div>
                  {member.role === 'host' ? <Crown className="host-crown" size={18} /> : isHost ? (
                    <select value={member.role} onChange={(event) => void updateMemberRole(roomId, member.uid, event.target.value as Role)}><option value="listener">Listener</option><option value="dj">DJ</option></select>
                  ) : <i className="member-online" />}
                </article>
              ))}
            </div>
          )}
        </aside>
      </div>
    </main>
  );
}
