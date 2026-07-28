import type { VoicePresence } from '../types';
import { postAuthenticatedJson } from './api';

interface SessionDescriptionPayload {
  type: RTCSdpType;
  sdp: string;
}

interface SessionResponse {
  sessionId: string;
  capability: string;
}

interface TracksResponse {
  sessionDescription?: SessionDescriptionPayload;
  tracks?: Array<{ mid?: string; trackName?: string }>;
  requiresImmediateRenegotiation?: boolean;
}

export type VoiceConnectionState = 'idle' | 'joining' | 'connected' | 'reconnecting' | 'error';

interface VoiceCallbacks {
  onState: (state: VoiceConnectionState, message?: string) => void;
  onSpeaking: (uid: string, speaking: boolean) => void;
}

function description(value: RTCSessionDescription | RTCSessionDescriptionInit | null): SessionDescriptionPayload {
  if (!value?.sdp || !value.type) throw new Error('Trình duyệt không tạo được SDP cho voice chat.');
  return { type: value.type, sdp: value.sdp };
}

export class VoiceClient {
  private peer: RTCPeerConnection | null = null;
  private stream: MediaStream | null = null;
  private sessionId = '';
  private capability = '';
  private localMid = '';
  private roomId = '';
  private uid = '';
  private muted = false;
  private deafened = false;
  private closed = false;
  private disconnectTimer: number | undefined;
  private operation = Promise.resolve();
  private subscriptions = new Map<string, { mid: string; audio: HTMLAudioElement }>();
  private midToUid = new Map<string, string>();
  private audioContext: AudioContext | null = null;
  private analysers = new Map<string, { analyser: AnalyserNode; buffer: Uint8Array<ArrayBuffer> }>();
  private speakingTimer: number | undefined;

  constructor(private callbacks: VoiceCallbacks) {}

  async join(roomId: string, uid: string): Promise<{ sessionId: string; trackName: string }> {
    this.closed = false;
    this.roomId = roomId;
    this.uid = uid;
    this.callbacks.onState('joining');
    try {
      this.stream = await navigator.mediaDevices.getUserMedia({
        video: false,
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
      });
      const session = await postAuthenticatedJson<SessionResponse>('/api/voice/session', { roomId });
      this.sessionId = session.sessionId;
      this.capability = session.capability;
      this.peer = new RTCPeerConnection({
        bundlePolicy: 'max-bundle',
        iceServers: [{ urls: 'stun:stun.cloudflare.com:3478' }],
      });
      this.peer.ontrack = (event) => this.receiveTrack(event);
      this.peer.onconnectionstatechange = () => this.handleConnectionState();

      const microphone = this.stream.getAudioTracks()[0];
      if (!microphone) throw new Error('Không tìm thấy microphone.');
      const transceiver = this.peer.addTransceiver(microphone, { direction: 'sendonly' });
      const offer = await this.peer.createOffer();
      await this.peer.setLocalDescription(offer);
      if (!transceiver.mid) throw new Error('Không tạo được audio track.');
      this.localMid = transceiver.mid;
      const trackName = `mic-${uid.slice(0, 12)}-${crypto.randomUUID().slice(0, 8)}`;
      let published: TracksResponse;
      try {
        published = await postAuthenticatedJson<TracksResponse>('/api/voice/publish', {
          roomId,
          sessionId: this.sessionId,
          capability: this.capability,
          sessionDescription: description(offer),
          mid: this.localMid,
          trackName,
        });
      } catch (cause) {
        throw new Error(`Publish microphone thất bại: ${cause instanceof Error ? cause.message : 'Unknown error'}`);
      }
      if (!published.sessionDescription) throw new Error('Cloudflare không trả về answer hợp lệ cho microphone.');
      await this.peer.setRemoteDescription(published.sessionDescription);
      this.monitorStream(uid, this.stream);
      this.callbacks.onState('connected');
      return { sessionId: this.sessionId, trackName };
    } catch (cause) {
      await this.leave();
      const message = cause instanceof Error ? cause.message : 'Không thể kết nối voice chat.';
      this.callbacks.onState('error', message);
      throw cause;
    }
  }

  sync(presences: VoicePresence[]): Promise<void> {
    this.operation = this.operation
      .then(() => this.syncNow(presences))
      .catch((cause) => {
        if (!this.closed) this.callbacks.onState('error', cause instanceof Error ? cause.message : 'Voice chat bị gián đoạn.');
      });
    return this.operation;
  }

  private async syncNow(presences: VoicePresence[]): Promise<void> {
    if (!this.peer || this.closed || !this.sessionId) return;
    const remote = new Map(presences.filter((presence) => presence.uid !== this.uid).map((presence) => [presence.uid, presence]));
    for (const [remoteUid, subscription] of this.subscriptions) {
      if (!remote.has(remoteUid)) await this.unsubscribe(remoteUid, subscription);
    }
    for (const presence of remote.values()) {
      if (!this.subscriptions.has(presence.uid)) await this.subscribe(presence);
    }
  }

  private async subscribe(presence: VoicePresence): Promise<void> {
    if (!this.peer) return;
    const response = await postAuthenticatedJson<TracksResponse>('/api/voice/subscribe', {
      roomId: this.roomId,
      sessionId: this.sessionId,
      capability: this.capability,
      publisherUid: presence.uid,
      publisherSessionId: presence.sessionId,
      trackName: presence.trackName,
    });
    const remoteTrack = response.tracks?.[0];
    if (!response.sessionDescription || !remoteTrack?.mid) throw new Error(`Không thể nhận voice của ${presence.name}.`);
    this.midToUid.set(remoteTrack.mid, presence.uid);
    await this.peer.setRemoteDescription(response.sessionDescription);
    const answer = await this.peer.createAnswer();
    await this.peer.setLocalDescription(answer);
    await postAuthenticatedJson('/api/voice/renegotiate', {
      roomId: this.roomId,
      sessionId: this.sessionId,
      capability: this.capability,
      sessionDescription: description(answer),
    });
    const existing = this.subscriptions.get(presence.uid);
    if (existing) existing.mid = remoteTrack.mid;
  }

  private receiveTrack(event: RTCTrackEvent): void {
    if (event.track.kind !== 'audio') return;
    const mid = event.transceiver.mid ?? '';
    const remoteUid = this.midToUid.get(mid);
    if (!remoteUid) return;
    const stream = event.streams[0] ?? new MediaStream([event.track]);
    const audio = new Audio();
    audio.autoplay = true;
    audio.muted = this.deafened;
    audio.srcObject = stream;
    void audio.play().catch(() => undefined);
    this.subscriptions.set(remoteUid, { mid, audio });
    this.monitorStream(remoteUid, stream);
  }

  private async unsubscribe(remoteUid: string, subscription: { mid: string; audio: HTMLAudioElement }): Promise<void> {
    this.subscriptions.delete(remoteUid);
    this.midToUid.delete(subscription.mid);
    subscription.audio.pause();
    subscription.audio.srcObject = null;
    this.removeMonitor(remoteUid);
    await postAuthenticatedJson('/api/voice/close', {
      roomId: this.roomId,
      sessionId: this.sessionId,
      capability: this.capability,
      mids: [subscription.mid],
    }).catch(() => undefined);
  }

  setMuted(muted: boolean): void {
    this.muted = muted;
    this.stream?.getAudioTracks().forEach((track) => { track.enabled = !muted; });
    if (muted) this.callbacks.onSpeaking(this.uid, false);
  }

  setDeafened(deafened: boolean): void {
    this.deafened = deafened;
    this.subscriptions.forEach(({ audio }) => { audio.muted = deafened; });
    if (deafened) this.setMuted(true);
  }

  private handleConnectionState(): void {
    if (!this.peer || this.closed) return;
    window.clearTimeout(this.disconnectTimer);
    if (this.peer.connectionState === 'connected') {
      this.callbacks.onState('connected');
    } else if (this.peer.connectionState === 'disconnected') {
      this.callbacks.onState('reconnecting');
      this.disconnectTimer = window.setTimeout(() => {
        if (this.peer?.connectionState === 'disconnected') {
          this.callbacks.onState('error', 'Mất kết nối voice. Hãy bấm kết nối lại.');
        }
      }, 6000);
    } else if (this.peer.connectionState === 'failed') {
      this.callbacks.onState('error', 'Kết nối voice thất bại. Hãy bấm kết nối lại.');
    }
  }

  private monitorStream(uid: string, stream: MediaStream): void {
    try {
      this.audioContext ??= new AudioContext();
      void this.audioContext.resume();
      const source = this.audioContext.createMediaStreamSource(stream);
      const analyser = this.audioContext.createAnalyser();
      analyser.fftSize = 512;
      analyser.smoothingTimeConstant = 0.55;
      source.connect(analyser);
      this.analysers.set(uid, { analyser, buffer: new Uint8Array(analyser.fftSize) });
      if (!this.speakingTimer) {
        this.speakingTimer = window.setInterval(() => {
          this.analysers.forEach(({ analyser, buffer }, speakerUid) => {
            if (speakerUid === this.uid && this.muted) return;
            analyser.getByteTimeDomainData(buffer);
            let energy = 0;
            for (const sample of buffer) {
              const normalized = (sample - 128) / 128;
              energy += normalized * normalized;
            }
            this.callbacks.onSpeaking(speakerUid, Math.sqrt(energy / buffer.length) > 0.035);
          });
        }, 160);
      }
    } catch {
      // Voice still works when an older browser cannot create an audio analyser.
    }
  }

  private removeMonitor(uid: string): void {
    this.analysers.delete(uid);
    this.callbacks.onSpeaking(uid, false);
  }

  async leave(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    window.clearTimeout(this.disconnectTimer);
    window.clearInterval(this.speakingTimer);
    this.speakingTimer = undefined;
    const mids = [this.localMid, ...Array.from(this.subscriptions.values(), (item) => item.mid)].filter(Boolean);
    if (this.sessionId && this.capability && mids.length) {
      await postAuthenticatedJson('/api/voice/close', {
        roomId: this.roomId,
        sessionId: this.sessionId,
        capability: this.capability,
        mids,
      }).catch(() => undefined);
    }
    this.subscriptions.forEach(({ audio }) => {
      audio.pause();
      audio.srcObject = null;
    });
    this.subscriptions.clear();
    this.midToUid.clear();
    this.stream?.getTracks().forEach((track) => track.stop());
    this.stream = null;
    this.peer?.close();
    this.peer = null;
    this.analysers.clear();
    await this.audioContext?.close().catch(() => undefined);
    this.audioContext = null;
    this.sessionId = '';
    this.capability = '';
    this.localMid = '';
    this.callbacks.onState('idle');
  }
}
