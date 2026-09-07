/**
 * Hook-based voice recorder used by the concierge sheet's mic button.
 * `expo-audio` only exposes `AudioRecorder` as a class at the type level —
 * the runtime constructor lives behind the `useAudioRecorder` hook —
 * so we wrap that hook here and expose tiny `start/stop/cancel`
 * promises plus a Boolean `isRecording` flag for the UI.
 *
 * `stop()` resolves with the raw audio bytes (read back from the
 * recorder's local URI) so the caller can upload them straight to
 * /concierge/transcribe.
 */
import { useCallback, useRef, useState } from "react";
import {
  RecordingPresets,
  requestRecordingPermissionsAsync,
  setAudioModeAsync,
  useAudioRecorder,
} from "expo-audio";

export interface VoiceRecorder {
  isRecording: boolean;
  start: () => Promise<void>;
  stop: () => Promise<ArrayBuffer | null>;
  cancel: () => Promise<void>;
}

export function useConciergeVoiceRecorder(): VoiceRecorder {
  const recorder = useAudioRecorder(RecordingPresets.HIGH_QUALITY);
  const [isRecording, setIsRecording] = useState(false);
  // Track which "session" of recording we're in so a stop call after a
  // cancel can no-op cleanly.
  const sessionRef = useRef(0);

  const start = useCallback(async () => {
    const perm = await requestRecordingPermissionsAsync();
    if (!perm.granted) {
      throw new Error("Microphone permission was denied.");
    }
    await setAudioModeAsync({
      allowsRecording: true,
      playsInSilentMode: true,
    });
    sessionRef.current += 1;
    await recorder.prepareToRecordAsync();
    recorder.record();
    setIsRecording(true);
  }, [recorder]);

  const stop = useCallback(async (): Promise<ArrayBuffer | null> => {
    if (!isRecording) return null;
    setIsRecording(false);
    try {
      await recorder.stop();
    } catch {
      // Already stopped — keep going so we still try to read the file.
    }
    const uri = recorder.uri;
    if (!uri) return null;
    try {
      const res = await fetch(uri);
      return await res.arrayBuffer();
    } catch {
      return null;
    }
  }, [isRecording, recorder]);

  const cancel = useCallback(async () => {
    if (!isRecording) return;
    setIsRecording(false);
    try {
      await recorder.stop();
    } catch {
      // ignore
    }
  }, [isRecording, recorder]);

  return { isRecording, start, stop, cancel };
}
