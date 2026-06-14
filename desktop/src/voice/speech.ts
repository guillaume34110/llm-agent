// Dictation via MediaRecorder + local Whisper sidecar (port 3471).
// Local-first: audio bytes never leave the device. The sidecar runs
// faster-whisper on the user's machine and returns the transcript.

const SIDECAR_URL = 'http://localhost:3471';

export interface VoiceOption {
  voiceURI: string;
  name: string;
  lang: string;
  default: boolean;
  localService: boolean;
}

export interface TranscribeModelOption {
  value: string;
  label: string;
  hint: string;
  cost: number;
}

export const DEFAULT_TRANSCRIBE_MODEL = '';

export async function fetchTranscribeModels(): Promise<TranscribeModelOption[]> {
  try {
    const res = await fetch(`${SIDECAR_URL}/local-models`);
    if (!res.ok) return [];
    const data = await res.json();
    const list: any[] = Array.isArray(data?.models) ? data.models : Array.isArray(data) ? data : [];
    return list
      .filter(m => m?.task === 'asr')
      .map(m => ({
        value: m.id,
        label: m.label || m.id,
        hint: m.installed ? 'installed' : 'not installed',
        cost: 0,
      }));
  } catch {
    return [];
  }
}

export async function getCheapestTranscribeModel(): Promise<string> {
  return 'whisper-base';
}

async function blobToBase64(blob: Blob): Promise<string> {
  const buf = await blob.arrayBuffer();
  const bytes = new Uint8Array(buf);
  let binary = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

async function ensureWhisperInstalled(): Promise<boolean> {
  try {
    const probe = await fetch(`${SIDECAR_URL}/local-models/whisper-base/status`);
    if (probe.ok) {
      const s = await probe.json() as { installed?: boolean };
      if (s?.installed) return true;
    }
    await fetch(`${SIDECAR_URL}/local-models/whisper-base/install`, { method: 'POST' });
  } catch { return false; }
  const deadline = Date.now() + 10 * 60_000;
  while (Date.now() < deadline) {
    await new Promise(r => setTimeout(r, 2000));
    try {
      const r = await fetch(`${SIDECAR_URL}/local-models/whisper-base/status`);
      if (!r.ok) continue;
      const s = await r.json() as { installed?: boolean; download?: { status?: string } };
      if (s?.installed) return true;
      if (s?.download?.status === 'error') return false;
    } catch {}
  }
  return false;
}

function pickMimeType(): string {
  const candidates = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/ogg;codecs=opus'];
  if (typeof MediaRecorder === 'undefined') return 'audio/webm';
  for (const m of candidates) {
    try { if (MediaRecorder.isTypeSupported(m)) return m; } catch {}
  }
  return 'audio/webm';
}

export function voiceInputSupported(): boolean {
  return typeof navigator !== 'undefined'
    && !!navigator.mediaDevices?.getUserMedia
    && typeof window !== 'undefined'
    && typeof (window as any).MediaRecorder !== 'undefined';
}

export interface DictationOptions {
  model?: string;
  language?: string;
  onText: (value: string) => void;
  onState?: (state: 'idle' | 'recording' | 'uploading' | 'done' | 'error') => void;
  onError?: (message: string) => void;
}

export interface DictationHandle {
  stop: () => void;
  cancel: () => void;
  active: () => boolean;
}

async function postTranscribe(blob: Blob, _model: string, language?: string): Promise<string> {
  const audio_b64 = await blobToBase64(blob);
  const call = () => fetch(`${SIDECAR_URL}/local-transcribe`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ audio_b64, language }),
  });
  let res = await call();
  if (res.status === 409) {
    const ok = await ensureWhisperInstalled();
    if (!ok) throw new Error('whisper-base install failed');
    res = await call();
  }
  if (!res.ok) {
    let msg = `HTTP ${res.status}`;
    try { const j = await res.json(); msg = j.detail || j.message || msg; } catch {}
    throw new Error(msg);
  }
  const data = await res.json();
  return String(data.text || '').trim();
}

export async function startDictation(opts: DictationOptions): Promise<DictationHandle | null> {
  if (!voiceInputSupported()) {
    opts.onError?.('Dictee non disponible sur ce poste');
    return null;
  }
  let stream: MediaStream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({ audio: true });
  } catch (e: any) {
    opts.onError?.(`Micro refuse: ${e?.message || e}`);
    return null;
  }
  const mimeType = pickMimeType();
  const recorder = new MediaRecorder(stream, { mimeType });
  const chunks: BlobPart[] = [];
  let canceled = false;
  let stopped = false;

  recorder.ondataavailable = ev => { if (ev.data && ev.data.size > 0) chunks.push(ev.data); };

  recorder.onstop = async () => {
    stream.getTracks().forEach(t => t.stop());
    if (canceled) { opts.onState?.('idle'); return; }
    const blob = new Blob(chunks, { type: mimeType });
    if (blob.size < 1000) {
      opts.onState?.('idle');
      opts.onError?.('Audio trop court');
      return;
    }
    opts.onState?.('uploading');
    try {
      const model = opts.model || (await getCheapestTranscribeModel());
      if (!model) {
        opts.onState?.('error');
        opts.onError?.('Aucun modele de transcription disponible');
        return;
      }
      const text = await postTranscribe(blob, model, opts.language);
      opts.onText(text);
      opts.onState?.('done');
    } catch (e: any) {
      opts.onState?.('error');
      opts.onError?.(`Transcription: ${e?.message || e}`);
    }
  };

  recorder.start();
  opts.onState?.('recording');

  return {
    stop: () => { if (!stopped) { stopped = true; recorder.state !== 'inactive' && recorder.stop(); } },
    cancel: () => { canceled = true; if (!stopped) { stopped = true; recorder.state !== 'inactive' && recorder.stop(); } },
    active: () => recorder.state === 'recording',
  };
}

// ----- Speech synthesis (TTS) is unchanged -----

export function listSpeechVoices(): VoiceOption[] {
  if (!('speechSynthesis' in window)) return [];
  return window.speechSynthesis.getVoices().map(voice => ({
    voiceURI: voice.voiceURI,
    name: voice.name,
    lang: voice.lang,
    default: voice.default,
    localService: voice.localService,
  }));
}

export function subscribeSpeechVoices(listener: (voices: VoiceOption[]) => void) {
  if (!('speechSynthesis' in window)) {
    listener([]);
    return () => {};
  }
  const emit = () => listener(listSpeechVoices());
  emit();
  window.speechSynthesis.addEventListener('voiceschanged', emit);
  return () => {
    window.speechSynthesis.removeEventListener('voiceschanged', emit);
  };
}

let _currentAudio: HTMLAudioElement | null = null;
let _piperKickedOff = false;

function _kickoffPiperInstall() {
  if (_piperKickedOff) return;
  _piperKickedOff = true;
  fetch(`${SIDECAR_URL}/local-models/piper-tts/install`, { method: 'POST' }).catch(() => {});
}

function _systemSpeak(text: string, options?: { voiceURI?: string; lang?: string }): boolean {
  if (!('speechSynthesis' in window) || !text.trim()) return false;
  const utterance = new SpeechSynthesisUtterance(text);
  utterance.lang = options?.lang || 'fr-FR';
  if (options?.voiceURI) {
    const voice = window.speechSynthesis.getVoices().find(item => item.voiceURI === options.voiceURI);
    if (voice) utterance.voice = voice;
  }
  window.speechSynthesis.cancel();
  window.speechSynthesis.speak(utterance);
  return true;
}

function _b64ToBlob(b64: string, type: string): Blob {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new Blob([bytes], { type });
}

export async function speakText(text: string, options?: { voiceURI?: string; lang?: string }): Promise<boolean> {
  if (!text.trim()) return false;
  stopSpeaking();
  try {
    const lang = (options?.lang || 'fr-FR').slice(0, 2);
    const res = await fetch(`${SIDECAR_URL}/local-tts`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text, voice: lang }),
    });
    if (res.status === 409) {
      _kickoffPiperInstall();
      return _systemSpeak(text, options);
    }
    if (!res.ok) return _systemSpeak(text, options);
    const data = await res.json() as { audio_b64?: string };
    if (!data.audio_b64) return _systemSpeak(text, options);
    const blob = _b64ToBlob(data.audio_b64, 'audio/wav');
    const url = URL.createObjectURL(blob);
    const audio = new Audio(url);
    _currentAudio = audio;
    audio.addEventListener('ended', () => { URL.revokeObjectURL(url); if (_currentAudio === audio) _currentAudio = null; });
    audio.addEventListener('error', () => { URL.revokeObjectURL(url); });
    await audio.play();
    return true;
  } catch {
    return _systemSpeak(text, options);
  }
}

export function stopSpeaking() {
  if (_currentAudio) {
    try { _currentAudio.pause(); _currentAudio.currentTime = 0; } catch {}
    _currentAudio = null;
  }
  if ('speechSynthesis' in window) window.speechSynthesis.cancel();
}
