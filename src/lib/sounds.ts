export type PresenceSound = 'join' | 'leave';

let audioContext: AudioContext | null = null;
let presenceAudio: Record<PresenceSound, HTMLAudioElement> | null = null;

function getPresenceAudio(): Record<PresenceSound, HTMLAudioElement> | null {
  if (typeof window === 'undefined') return null;
  if (presenceAudio) return presenceAudio;
  const baseUrl = import.meta.env.BASE_URL;
  const join = new Audio(`${baseUrl}sounds/voice-join.mp3`);
  const leave = new Audio(`${baseUrl}sounds/voice-leave.mp3`);
  join.preload = 'auto';
  leave.preload = 'auto';
  presenceAudio = { join, leave };
  return presenceAudio;
}

function getAudioContext(): AudioContext | null {
  if (typeof window === 'undefined') return null;
  const AudioContextClass = window.AudioContext;
  if (!AudioContextClass) return null;
  audioContext ??= new AudioContextClass();
  return audioContext;
}

export async function unlockSounds(): Promise<void> {
  const context = getAudioContext();
  const sounds = getPresenceAudio();
  sounds?.join.load();
  sounds?.leave.load();
  if (context?.state === 'suspended') await context.resume().catch(() => undefined);
}

function playSynthFallback(kind: PresenceSound): void {
  const context = getAudioContext();
  if (!context || context.state !== 'running') return;

  const notes = kind === 'join'
    ? [{ frequency: 523.25, offset: 0 }, { frequency: 659.25, offset: 0.09 }]
    : [{ frequency: 493.88, offset: 0 }, { frequency: 392, offset: 0.09 }];

  notes.forEach(({ frequency, offset }) => {
    const oscillator = context.createOscillator();
    const gain = context.createGain();
    const start = context.currentTime + offset;
    const end = start + 0.16;

    oscillator.type = 'sine';
    oscillator.frequency.setValueAtTime(frequency, start);
    gain.gain.setValueAtTime(0.0001, start);
    gain.gain.exponentialRampToValueAtTime(0.045, start + 0.018);
    gain.gain.exponentialRampToValueAtTime(0.0001, end);
    oscillator.connect(gain);
    gain.connect(context.destination);
    oscillator.start(start);
    oscillator.stop(end + 0.02);
  });
}

export function playPresenceSound(kind: PresenceSound): void {
  const source = getPresenceAudio()?.[kind];
  if (!source) {
    playSynthFallback(kind);
    return;
  }
  const sound = source.cloneNode(true) as HTMLAudioElement;
  sound.volume = 0.62;
  void sound.play().catch(() => playSynthFallback(kind));
}
