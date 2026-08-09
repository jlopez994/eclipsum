import { Platform } from 'react-native';
import {
  createAudioPlayer,
  setAudioModeAsync,
  setIsAudioActiveAsync,
  type AudioPlayer,
  type AudioSource,
} from 'expo-audio';
import type { AlertSound } from './prefs';

/** Mismo package que app.json → android.resource://…/raw/eclipse */
const ANDROID_PKG = 'com.jlopez.eclipsum';
const ECLIPSE_ASSET = require('../assets/sounds/eclipse.wav');

let player: AudioPlayer | null = null;
let modeReady = false;

async function ensureMode(): Promise<void> {
  if (modeReady) return;
  await setIsAudioActiveAsync(true);
  await setAudioModeAsync({
    playsInSilentMode: true,
    // Pedir foco para que el preview se oiga encima de otras apps
    interruptionMode: 'duckOthers',
    shouldPlayInBackground: false,
  });
  modeReady = true;
}

function sourceFor(sound: AlertSound): AudioSource | null {
  if (sound === 'eclipse') {
    // El wav de notificaciones ya está en res/raw — más fiable que el require de Metro
    if (Platform.OS === 'android') {
      return { uri: `android.resource://${ANDROID_PKG}/raw/eclipse` };
    }
    return ECLIPSE_ASSET;
  }
  // Tono de sistema: content://settings/... no carga en expo-audio; se previsualiza
  // con una notificación real (sendTestNotification) desde Ajustes
  return null;
}

function waitLoaded(p: AudioPlayer, ms = 4000): Promise<void> {
  if (p.isLoaded) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      sub.remove();
      reject(new Error('audio load timeout'));
    }, ms);
    const sub = p.addListener('playbackStatusUpdate', (st) => {
      if (st.isLoaded) {
        clearTimeout(timer);
        sub.remove();
        resolve();
      } else if (st.error) {
        clearTimeout(timer);
        sub.remove();
        reject(new Error(st.error));
      }
    });
  });
}

function releasePlayer(): void {
  if (!player) return;
  try {
    player.pause();
    player.remove();
  } catch {
    // ignore
  }
  player = null;
}

/**
 * Reproduce el tono en la app (sin notificación).
 * Custom: res/raw/eclipse. Sistema: tono de notificación del dispositivo (Android).
 */
export async function previewAlertSound(sound: AlertSound): Promise<void> {
  const source = sourceFor(sound);
  if (source == null) return;

  await ensureMode();
  releasePlayer();

  const next = createAudioPlayer(source, {
    downloadFirst: typeof source === 'number',
    keepAudioSessionActive: true,
  });
  player = next;

  try {
    await waitLoaded(next);
    next.volume = 1;
    await next.seekTo(0);
    next.play();
  } catch {
    releasePlayer();
    // Fallback custom: asset empaquetado por Metro si el URI raw falla
    if (sound === 'eclipse' && Platform.OS === 'android') {
      try {
        const fallback = createAudioPlayer(ECLIPSE_ASSET, { downloadFirst: true, keepAudioSessionActive: true });
        player = fallback;
        await waitLoaded(fallback);
        fallback.volume = 1;
        await fallback.seekTo(0);
        fallback.play();
      } catch {
        releasePlayer();
      }
    }
  }
}
