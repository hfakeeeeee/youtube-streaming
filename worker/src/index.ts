interface Env {
  YOUTUBE_API_KEY: string;
  ALLOWED_ORIGINS: string;
  SEARCH_QUOTA?: KVNamespace;
  FIREBASE_DATABASE_URL?: string;
  FIREBASE_CLIENT_EMAIL?: string;
  FIREBASE_PRIVATE_KEY?: string;
  CLOUDFLARE_REALTIME_APP_ID?: string;
  CLOUDFLARE_REALTIME_APP_SECRET?: string;
}

interface SearchQuota {
  limit: number;
  used: number;
  remaining: number;
  estimated: true;
}

interface YouTubeSnippet {
  title: string;
  channelTitle: string;
  thumbnails: Record<string, { url: string }>;
  resourceId?: { videoId?: string };
}

interface YouTubeItem {
  id: string | { videoId?: string };
  snippet: YouTubeSnippet;
  contentDetails?: { duration?: string; videoId?: string };
}

const ALLOWED_CATEGORIES = new Set([
  'sponsor', 'selfpromo', 'interaction', 'intro', 'outro', 'preview', 'music_offtopic', 'filler',
]);

function corsHeaders(request: Request, env: Env): HeadersInit {
  const origin = request.headers.get('Origin') ?? '';
  const allowed = env.ALLOWED_ORIGINS.split(',').map((item) => item.trim());
  return {
    'Access-Control-Allow-Origin': allowed.includes(origin) ? origin : allowed[0] || '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Authorization, Content-Type',
    'Vary': 'Origin',
  };
}

function json(request: Request, env: Env, body: unknown, status = 200, cacheSeconds = 0): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...corsHeaders(request, env),
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': cacheSeconds ? `public, max-age=${cacheSeconds}` : 'no-store',
      'X-Content-Type-Options': 'nosniff',
    },
  });
}

function durationToSeconds(value?: string): number | undefined {
  if (!value) return undefined;
  const match = value.match(/^PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?$/);
  if (!match) return undefined;
  return Number(match[1] ?? 0) * 3600 + Number(match[2] ?? 0) * 60 + Number(match[3] ?? 0);
}

function videoFromItem(item: YouTubeItem) {
  const id = typeof item.id === 'string'
    ? item.id
    : item.id.videoId ?? item.contentDetails?.videoId ?? item.snippet.resourceId?.videoId;
  if (!id) return null;
  const thumbnails = item.snippet.thumbnails;
  return {
    id,
    title: item.snippet.title,
    channel: item.snippet.channelTitle,
    thumbnail: thumbnails.medium?.url ?? thumbnails.high?.url ?? thumbnails.default?.url ?? `https://i.ytimg.com/vi/${id}/hqdefault.jpg`,
    duration: durationToSeconds(item.contentDetails?.duration),
  };
}

async function youtube(path: string, params: URLSearchParams, env: Env) {
  if (!env.YOUTUBE_API_KEY) throw new Error('YOUTUBE_API_KEY is not configured');
  params.set('key', env.YOUTUBE_API_KEY);
  const response = await fetch(`https://www.googleapis.com/youtube/v3/${path}?${params}`);
  const data = await response.json() as { items?: YouTubeItem[]; error?: { message?: string } };
  if (!response.ok) throw new Error(data.error?.message ?? 'YouTube API request failed');
  return data.items ?? [];
}

const SEARCH_DAILY_LIMIT = 100;
const FIREBASE_OAUTH_SCOPE = 'https://www.googleapis.com/auth/firebase.database https://www.googleapis.com/auth/userinfo.email';

function base64Url(value: string | ArrayBuffer): string {
  const bytes = typeof value === 'string' ? new TextEncoder().encode(value) : new Uint8Array(value);
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function decodeBase64Url(value: string): Uint8Array {
  const padded = value.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(value.length / 4) * 4, '=');
  const binary = atob(padded);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

function decodeFirebaseUid(token: string): string | null {
  try {
    const payload = JSON.parse(new TextDecoder().decode(decodeBase64Url(token.split('.')[1]))) as { sub?: unknown };
    return typeof payload.sub === 'string' && payload.sub.length > 0 && payload.sub.length <= 128 ? payload.sub : null;
  } catch {
    return null;
  }
}

interface VoiceCapability {
  uid: string;
  roomId: string;
  sessionId: string;
  exp: number;
}

interface SessionDescription {
  type: 'offer' | 'answer';
  sdp: string;
}

function voiceConfigured(env: Env): boolean {
  return Boolean(env.FIREBASE_DATABASE_URL && env.CLOUDFLARE_REALTIME_APP_ID && env.CLOUDFLARE_REALTIME_APP_SECRET);
}

function validRoomId(value: unknown): value is string {
  return typeof value === 'string' && /^[A-Z2-9]{6}$/.test(value);
}

function validSfuId(value: unknown): value is string {
  return typeof value === 'string' && /^[\w.:/-]{1,256}$/.test(value);
}

function validSessionDescription(value: unknown): value is SessionDescription {
  if (!value || typeof value !== 'object') return false;
  const description = value as Partial<SessionDescription>;
  return (description.type === 'offer' || description.type === 'answer')
    && typeof description.sdp === 'string'
    && description.sdp.length > 0
    && description.sdp.length <= 1_000_000;
}

async function requestBody(request: Request): Promise<Record<string, unknown>> {
  const length = Number(request.headers.get('Content-Length') ?? 0);
  if (length > 1_100_000) throw new Error('Voice request is too large');
  const body = await request.json();
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw new Error('Invalid JSON body');
  return body as Record<string, unknown>;
}

async function authenticateRoomMember(
  request: Request,
  env: Env,
  roomId: string,
): Promise<{ uid: string; token: string }> {
  const authorization = request.headers.get('Authorization') ?? '';
  const token = authorization.startsWith('Bearer ') ? authorization.slice(7).trim() : '';
  const uid = token ? decodeFirebaseUid(token) : null;
  if (!uid) throw new Error('VOICE_UNAUTHORIZED');
  const databaseUrl = env.FIREBASE_DATABASE_URL!.replace(/\/$/, '');
  const memberUrl = `${databaseUrl}/rooms/${encodeURIComponent(roomId)}/members/${encodeURIComponent(uid)}.json?auth=${encodeURIComponent(token)}`;
  const response = await fetch(memberUrl, { headers: { Accept: 'application/json' } });
  if (!response.ok) throw new Error('VOICE_UNAUTHORIZED');
  const member = await response.json() as { uid?: string; online?: boolean } | null;
  if (!member || member.uid !== uid || member.online === false) throw new Error('VOICE_UNAUTHORIZED');
  return { uid, token };
}

async function signVoiceCapability(env: Env, capability: VoiceCapability): Promise<string> {
  const payload = base64Url(JSON.stringify(capability));
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(env.CLOUDFLARE_REALTIME_APP_SECRET!),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const signature = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(payload));
  return `${payload}.${base64Url(signature)}`;
}

async function verifyVoiceCapability(
  env: Env,
  value: unknown,
  expected: Pick<VoiceCapability, 'uid' | 'roomId' | 'sessionId'>,
): Promise<boolean> {
  if (typeof value !== 'string') return false;
  const [payload, encodedSignature, extra] = value.split('.');
  if (!payload || !encodedSignature || extra) return false;
  try {
    const key = await crypto.subtle.importKey(
      'raw',
      new TextEncoder().encode(env.CLOUDFLARE_REALTIME_APP_SECRET!),
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['verify'],
    );
    const valid = await crypto.subtle.verify(
      'HMAC',
      key,
      decodeBase64Url(encodedSignature).buffer as ArrayBuffer,
      new TextEncoder().encode(payload),
    );
    if (!valid) return false;
    const capability = JSON.parse(new TextDecoder().decode(decodeBase64Url(payload))) as VoiceCapability;
    return capability.uid === expected.uid
      && capability.roomId === expected.roomId
      && capability.sessionId === expected.sessionId
      && capability.exp > Math.floor(Date.now() / 1000);
  } catch {
    return false;
  }
}

async function realtimeRequest(
  env: Env,
  path: string,
  method: 'POST' | 'PUT',
  body?: unknown,
): Promise<unknown> {
  const headers: Record<string, string> = {
    Authorization: `Bearer ${env.CLOUDFLARE_REALTIME_APP_SECRET}`,
  };
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  const response = await fetch(`https://rtc.live.cloudflare.com/v1/apps/${encodeURIComponent(env.CLOUDFLARE_REALTIME_APP_ID!)}${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = await response.json().catch(() => ({})) as Record<string, unknown>;
  if (!response.ok) {
    const message = typeof data.errorDescription === 'string'
      ? data.errorDescription
      : typeof data.error === 'string' ? data.error : `Cloudflare Realtime error (${response.status})`;
    throw new Error(message);
  }
  return data;
}

async function voicePresence(
  env: Env,
  roomId: string,
  token: string,
  publisherUid: string,
): Promise<{ sessionId?: string; trackName?: string } | null> {
  const databaseUrl = env.FIREBASE_DATABASE_URL!.replace(/\/$/, '');
  const url = `${databaseUrl}/rooms/${encodeURIComponent(roomId)}/voice/${encodeURIComponent(publisherUid)}.json?auth=${encodeURIComponent(token)}`;
  const response = await fetch(url, { headers: { Accept: 'application/json' } });
  if (!response.ok) return null;
  return response.json() as Promise<{ sessionId?: string; trackName?: string } | null>;
}

async function voice(request: Request, env: Env, pathname: string): Promise<unknown> {
  if (!voiceConfigured(env)) throw new Error('Voice chat is not configured on the Worker');
  const body = await requestBody(request);
  if (!validRoomId(body.roomId)) throw new Error('Invalid room ID');
  const { uid, token } = await authenticateRoomMember(request, env, body.roomId);

  if (pathname === '/api/voice/session') {
    // Cloudflare's session endpoint expects no request body when the client has
    // not created an SDP offer yet. Sending `{}` triggers its schema validator.
    const result = await realtimeRequest(env, '/sessions/new', 'POST') as { sessionId?: unknown };
    if (!validSfuId(result.sessionId)) throw new Error('Cloudflare did not return a valid voice session');
    const capability = await signVoiceCapability(env, {
      uid,
      roomId: body.roomId,
      sessionId: result.sessionId,
      exp: Math.floor(Date.now() / 1000) + 6 * 60 * 60,
    });
    return { ...result, capability };
  }

  if (!validSfuId(body.sessionId)
    || !await verifyVoiceCapability(env, body.capability, { uid, roomId: body.roomId, sessionId: body.sessionId })) {
    throw new Error('VOICE_UNAUTHORIZED');
  }

  if (pathname === '/api/voice/publish') {
    if (!validSessionDescription(body.sessionDescription)
      || !validSfuId(body.mid)
      || !validSfuId(body.trackName)) throw new Error('Invalid publish request');
    return realtimeRequest(env, `/sessions/${encodeURIComponent(body.sessionId)}/tracks/new`, 'POST', {
      sessionDescription: {
        sdp: body.sessionDescription.sdp,
        type: body.sessionDescription.type,
      },
      tracks: [{ location: 'local', mid: body.mid, trackName: body.trackName }],
    });
  }

  if (pathname === '/api/voice/subscribe') {
    if (!validSfuId(body.publisherUid)
      || !validSfuId(body.publisherSessionId)
      || !validSfuId(body.trackName)
      || body.publisherUid === uid) throw new Error('Invalid subscription request');
    const published = await voicePresence(env, body.roomId, token, body.publisherUid);
    if (!published
      || published.sessionId !== body.publisherSessionId
      || published.trackName !== body.trackName) throw new Error('Voice publisher is no longer available');
    return realtimeRequest(env, `/sessions/${encodeURIComponent(body.sessionId)}/tracks/new`, 'POST', {
      tracks: [{
        location: 'remote',
        sessionId: body.publisherSessionId,
        trackName: body.trackName,
      }],
    });
  }

  if (pathname === '/api/voice/renegotiate') {
    if (!validSessionDescription(body.sessionDescription)) throw new Error('Invalid renegotiation request');
    return realtimeRequest(env, `/sessions/${encodeURIComponent(body.sessionId)}/renegotiate`, 'PUT', {
      sessionDescription: body.sessionDescription,
    });
  }

  if (pathname === '/api/voice/close') {
    const mids = Array.isArray(body.mids) ? body.mids.filter(validSfuId).slice(0, 100) : [];
    if (!mids.length) throw new Error('No voice tracks to close');
    return realtimeRequest(env, `/sessions/${encodeURIComponent(body.sessionId)}/tracks/close`, 'PUT', {
      tracks: mids.map((mid) => ({ mid })),
      force: true,
    });
  }

  throw new Error('VOICE_NOT_FOUND');
}

function privateKeyBytes(pem: string): ArrayBuffer {
  const content = pem
    .replace(/\\n/g, '\n')
    .replace(/-----BEGIN PRIVATE KEY-----|-----END PRIVATE KEY-----/g, '')
    .replace(/\s/g, '');
  const binary = atob(content);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes.buffer;
}

async function firebaseAccessToken(env: Env): Promise<string> {
  if (!env.FIREBASE_CLIENT_EMAIL || !env.FIREBASE_PRIVATE_KEY) {
    throw new Error('Firebase cleanup credentials are not configured');
  }
  const now = Math.floor(Date.now() / 1000);
  const header = base64Url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const payload = base64Url(JSON.stringify({
    iss: env.FIREBASE_CLIENT_EMAIL,
    sub: env.FIREBASE_CLIENT_EMAIL,
    aud: 'https://oauth2.googleapis.com/token',
    scope: FIREBASE_OAUTH_SCOPE,
    iat: now,
    exp: now + 3600,
  }));
  const unsigned = `${header}.${payload}`;
  const privateKey = await crypto.subtle.importKey(
    'pkcs8',
    privateKeyBytes(env.FIREBASE_PRIVATE_KEY),
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const signature = await crypto.subtle.sign(
    'RSASSA-PKCS1-v1_5',
    privateKey,
    new TextEncoder().encode(unsigned),
  );
  const assertion = `${unsigned}.${base64Url(signature)}`;
  const response = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion,
    }),
  });
  const data = await response.json() as { access_token?: string; error_description?: string };
  if (!response.ok || !data.access_token) throw new Error(data.error_description ?? 'Could not authenticate Firebase cleanup');
  return data.access_token;
}

async function cleanupExpiredRooms(env: Env): Promise<void> {
  if (!env.FIREBASE_DATABASE_URL || !env.FIREBASE_CLIENT_EMAIL || !env.FIREBASE_PRIVATE_KEY) {
    console.warn('Scheduled room cleanup skipped: Firebase secrets are not configured.');
    return;
  }
  const databaseUrl = env.FIREBASE_DATABASE_URL.replace(/\/$/, '');
  const accessToken = await firebaseAccessToken(env);
  const headers = { Authorization: `Bearer ${accessToken}` };
  const legacyQuery = new URLSearchParams({ orderBy: JSON.stringify('meta/expiresAt'), endAt: String(Date.now()) });
  const [expirationResponse, legacyResponse] = await Promise.all([
    fetch(`${databaseUrl}/roomExpirations.json`, { headers }),
    fetch(`${databaseUrl}/rooms.json?${legacyQuery}`, { headers }),
  ]);
  if (!expirationResponse.ok) throw new Error(`Could not read room expirations (${expirationResponse.status})`);
  if (!legacyResponse.ok) throw new Error(`Could not query legacy rooms (${legacyResponse.status})`);
  const expirations = await expirationResponse.json() as Record<string, number> | null;
  const legacyRooms = await legacyResponse.json() as Record<string, { meta?: { expiresAt?: number } }> | null;
  const now = Date.now();
  const expiredRoomIds = new Set(Object.entries(expirations ?? {})
    .filter(([, expiresAt]) => Number.isFinite(expiresAt) && expiresAt <= now)
    .map(([roomId]) => roomId));
  Object.entries(legacyRooms ?? {}).forEach(([roomId, room]) => {
    if (Number.isFinite(room.meta?.expiresAt) && room.meta!.expiresAt! <= now) expiredRoomIds.add(roomId);
  });
  if (!expiredRoomIds.size) return;

  const updates: Record<string, null> = {};
  expiredRoomIds.forEach((roomId) => {
    updates[`rooms/${roomId}`] = null;
    updates[`publicRooms/${roomId}`] = null;
    updates[`roomExpirations/${roomId}`] = null;
  });
  const cleanupResponse = await fetch(`${databaseUrl}/.json`, {
    method: 'PATCH',
    headers: { ...headers, 'Content-Type': 'application/json' },
    body: JSON.stringify(updates),
  });
  if (!cleanupResponse.ok) throw new Error(`Could not delete expired rooms (${cleanupResponse.status})`);
  console.log(`Scheduled room cleanup removed ${expiredRoomIds.size} expired room(s).`);
}

function quotaDate(): string {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Los_Angeles', year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(new Date());
  const value = (type: Intl.DateTimeFormatPartTypes) => parts.find((part) => part.type === type)?.value ?? '';
  return `${value('year')}-${value('month')}-${value('day')}`;
}

async function readSearchQuota(env: Env): Promise<SearchQuota | null> {
  if (!env.SEARCH_QUOTA) return null;
  const used = Math.max(0, Number(await env.SEARCH_QUOTA.get(`search:${quotaDate()}`)) || 0);
  return { limit: SEARCH_DAILY_LIMIT, used, remaining: Math.max(0, SEARCH_DAILY_LIMIT - used), estimated: true };
}

async function recordSearch(env: Env): Promise<void> {
  if (!env.SEARCH_QUOTA) return;
  const key = `search:${quotaDate()}`;
  const used = Math.max(0, Number(await env.SEARCH_QUOTA.get(key)) || 0);
  await env.SEARCH_QUOTA.put(key, String(used + 1), { expirationTtl: 259200 });
}

async function search(request: Request, env: Env, url: URL) {
  const query = (url.searchParams.get('q') ?? '').trim().slice(0, 100);
  if (query.length < 2) return json(request, env, { error: 'Từ khóa phải có ít nhất 2 ký tự.' }, 400);
  const items = await youtube('search', new URLSearchParams({
    part: 'snippet', type: 'video', maxResults: '10', safeSearch: 'moderate', q: query,
  }), env);
  await recordSearch(env).catch(() => undefined);
  return json(request, env, items.map(videoFromItem).filter(Boolean), 200, 600);
}

async function video(request: Request, env: Env, videoId: string) {
  if (!/^[\w-]{11}$/.test(videoId)) return json(request, env, { error: 'Video ID không hợp lệ.' }, 400);
  const items = await youtube('videos', new URLSearchParams({ part: 'snippet,contentDetails,status', id: videoId }), env);
  const result = items[0] && videoFromItem(items[0]);
  return result ? json(request, env, result, 200, 86400) : json(request, env, { error: 'Không tìm thấy video.' }, 404);
}

async function playlist(request: Request, env: Env, playlistId: string) {
  if (!/^[\w-]{10,64}$/.test(playlistId)) return json(request, env, { error: 'Playlist ID không hợp lệ.' }, 400);
  if (/^RD/.test(playlistId)) return json(request, env, { error: 'YouTube Mix là playlist động và có thể chứa bài đề xuất. Hãy dùng playlist tĩnh.' }, 400);
  const playlistItems = await youtube('playlistItems', new URLSearchParams({
    part: 'snippet,contentDetails', playlistId, maxResults: '50',
  }), env);
  const ids = playlistItems.map((item) => item.contentDetails?.videoId).filter((id): id is string => Boolean(id));
  if (!ids.length) return json(request, env, [], 200, 3600);
  const details = await youtube('videos', new URLSearchParams({ part: 'snippet,contentDetails,status', id: ids.join(',') }), env);
  const byId = new Map(details.map((item) => [typeof item.id === 'string' ? item.id : '', videoFromItem(item)]));
  const result = ids.map((id) => byId.get(id)).filter(Boolean);
  return json(request, env, result, 200, 3600);
}

async function sha256Prefix(value: string) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest)).map((byte) => byte.toString(16).padStart(2, '0')).join('').slice(0, 4);
}

async function sponsor(request: Request, env: Env, url: URL, videoId: string) {
  if (!/^[\w-]{11}$/.test(videoId)) return json(request, env, { error: 'Video ID không hợp lệ.' }, 400);
  const categories = (url.searchParams.get('categories') ?? 'sponsor')
    .split(',').filter((category) => ALLOWED_CATEGORIES.has(category));
  const selected = categories.length ? categories : ['sponsor'];
  const prefix = await sha256Prefix(videoId);
  const sponsorUrl = new URL(`https://sponsor.ajay.app/api/skipSegments/${prefix}`);
  sponsorUrl.searchParams.set('categories', JSON.stringify(selected));
  sponsorUrl.searchParams.set('actionTypes', JSON.stringify(['skip']));
  sponsorUrl.searchParams.set('service', 'YouTube');
  sponsorUrl.searchParams.set('trimUUIDs', 'true');
  const response = await fetch(sponsorUrl, { headers: { 'User-Agent': 'Syncbox/0.1 (GitHub Pages room player)' } });
  if (response.status === 404) return json(request, env, [], 200, 21600);
  if (!response.ok) return json(request, env, { error: 'SponsorBlock không khả dụng.' }, 502);
  const groups = await response.json() as Array<{ videoID: string; segments: unknown[] }>;
  const segments = groups.find((group) => group.videoID === videoId)?.segments ?? [];
  return json(request, env, segments, 200, 21600);
}

export default {
  async fetch(request: Request, env: Env, context: ExecutionContext): Promise<Response> {
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: corsHeaders(request, env) });
    const url = new URL(request.url);
    if (url.pathname.startsWith('/api/voice/')) {
      if (request.method !== 'POST') return json(request, env, { error: 'Method not allowed' }, 405);
      try {
        return json(request, env, await voice(request, env, url.pathname));
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Voice request failed';
        if (message === 'VOICE_UNAUTHORIZED') return json(request, env, { error: 'Bạn không còn quyền truy cập voice của phòng này.' }, 401);
        if (message === 'VOICE_NOT_FOUND') return json(request, env, { error: 'Not found' }, 404);
        return json(request, env, { error: message }, message.startsWith('Invalid') || message.startsWith('No voice') ? 400 : 502);
      }
    }
    if (request.method !== 'GET') return json(request, env, { error: 'Method not allowed' }, 405);
    const cacheable = /^\/api\/(search|videos\/|playlists\/|sponsor\/)/.test(url.pathname);
    const cacheUrl = new URL(url);
    cacheUrl.searchParams.set('__origin', request.headers.get('Origin') ?? 'none');
    const cacheKey = new Request(cacheUrl.toString(), { method: 'GET' });
    const edgeCache = (caches as unknown as { default: Cache }).default;
    if (cacheable) {
      const hit = await edgeCache.match(cacheKey);
      if (hit) return hit;
    }
    try {
      let response: Response | undefined;
      if (url.pathname === '/api/health') response = json(request, env, { ok: true, voice: voiceConfigured(env) });
      else if (url.pathname === '/api/quota') response = json(request, env, await readSearchQuota(env));
      else if (url.pathname === '/api/search') response = await search(request, env, url);
      const videoMatch = url.pathname.match(/^\/api\/videos\/([\w-]+)$/);
      if (videoMatch) response = await video(request, env, videoMatch[1]);
      const playlistMatch = url.pathname.match(/^\/api\/playlists\/([\w-]+)$/);
      if (playlistMatch) response = await playlist(request, env, playlistMatch[1]);
      const sponsorMatch = url.pathname.match(/^\/api\/sponsor\/([\w-]+)$/);
      if (sponsorMatch) response = await sponsor(request, env, url, sponsorMatch[1]);
      if (!response) response = json(request, env, { error: 'Not found' }, 404);
      if (cacheable && response.ok) context.waitUntil(edgeCache.put(cacheKey, response.clone()));
      return response;
    } catch (error) {
      return json(request, env, { error: error instanceof Error ? error.message : 'Internal error' }, 500);
    }
  },
  async scheduled(_controller: ScheduledController, env: Env, context: ExecutionContext): Promise<void> {
    context.waitUntil(cleanupExpiredRooms(env));
  },
} satisfies ExportedHandler<Env>;
