import { useCallback, useEffect, useRef, useState } from 'react';
import fixWebmDuration from 'fix-webm-duration';

export type RecorderStatus = 'idle' | 'recording' | 'paused' | 'stopped';

export interface StartRecordingOptions {
  includeMic: boolean;
  includeSystemAudio: boolean;
}

const MIME_CANDIDATES = [
  'video/webm;codecs=vp9,opus',
  'video/webm;codecs=vp8,opus',
  'video/webm',
];

function pickMimeType(): string {
  for (const type of MIME_CANDIDATES) {
    if (MediaRecorder.isTypeSupported(type)) return type;
  }
  return '';
}

export function useScreenRecorder() {
  const [status, setStatus] = useState<RecorderStatus>('idle');
  const [error, setError] = useState<string | null>(null);
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const [recordedUrl, setRecordedUrl] = useState<string | null>(null);
  const [previewStream, setPreviewStream] = useState<MediaStream | null>(null);

  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const rawTracksRef = useRef<MediaStreamTrack[]>([]);
  const audioContextRef = useRef<AudioContext | null>(null);
  const timerRef = useRef<number | null>(null);
  const durationRef = useRef({ accumulatedMs: 0, segmentStartMs: 0, isPaused: false });

  const stopTimer = useCallback(() => {
    if (timerRef.current !== null) {
      window.clearInterval(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  const releaseCapture = useCallback(() => {
    rawTracksRef.current.forEach((track) => track.stop());
    rawTracksRef.current = [];
    if (audioContextRef.current) {
      audioContextRef.current.close().catch(() => {});
      audioContextRef.current = null;
    }
    setPreviewStream(null);
  }, []);

  const startRecording = useCallback(
    async ({ includeMic, includeSystemAudio }: StartRecordingOptions) => {
      setError(null);
      if (recordedUrl) {
        URL.revokeObjectURL(recordedUrl);
        setRecordedUrl(null);
      }
      chunksRef.current = [];
      setElapsedSeconds(0);

      let displayStream: MediaStream;
      try {
        displayStream = await navigator.mediaDevices.getDisplayMedia({
          video: { frameRate: 30 },
          audio: includeSystemAudio,
        });
      } catch (err) {
        setError(
          err instanceof DOMException && err.name === 'NotAllowedError'
            ? 'Screen sharing permission was denied.'
            : 'Could not start screen capture.'
        );
        return;
      }

      const warnings: string[] = [];

      let micStream: MediaStream | null = null;
      if (includeMic) {
        try {
          micStream = await navigator.mediaDevices.getUserMedia({ audio: true });
        } catch {
          warnings.push('Microphone access was denied.');
        }
      }

      const videoTrack = displayStream.getVideoTracks()[0];
      const displayAudioTrack = displayStream.getAudioTracks()[0] ?? null;
      const micAudioTrack = micStream?.getAudioTracks()[0] ?? null;

      if (includeSystemAudio && !displayAudioTrack) {
        warnings.push(
          "No system audio came through — in the share picker, choose \"Entire Screen\" (or a browser tab) and check \"Share audio\"; sharing a single window usually carries no audio in Chrome."
        );
      }

      let outputAudioTrack: MediaStreamTrack | null = null;
      if (displayAudioTrack && micAudioTrack) {
        const audioContext = new AudioContext();
        audioContextRef.current = audioContext;
        const destination = audioContext.createMediaStreamDestination();
        audioContext.createMediaStreamSource(new MediaStream([displayAudioTrack])).connect(destination);
        audioContext.createMediaStreamSource(new MediaStream([micAudioTrack])).connect(destination);
        outputAudioTrack = destination.stream.getAudioTracks()[0];
      } else {
        outputAudioTrack = displayAudioTrack ?? micAudioTrack;
      }

      rawTracksRef.current = [
        videoTrack,
        ...(displayAudioTrack ? [displayAudioTrack] : []),
        ...(micAudioTrack ? [micAudioTrack] : []),
      ];

      const outputTracks: MediaStreamTrack[] = [videoTrack];
      if (outputAudioTrack) outputTracks.push(outputAudioTrack);
      const combinedStream = new MediaStream(outputTracks);
      setPreviewStream(combinedStream);

      if (warnings.length > 0) setError(warnings.join(' '));

      const mimeType = pickMimeType();
      const recorder = new MediaRecorder(combinedStream, mimeType ? { mimeType } : undefined);

      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) chunksRef.current.push(event.data);
      };
      recorder.onstop = () => {
        const rawBlob = new Blob(chunksRef.current, { type: mimeType || 'video/webm' });
        const { accumulatedMs, segmentStartMs, isPaused } = durationRef.current;
        const totalMs = accumulatedMs + (isPaused ? 0 : performance.now() - segmentStartMs);

        fixWebmDuration(rawBlob, totalMs, { logger: false })
          .then((fixedBlob) => setRecordedUrl(URL.createObjectURL(fixedBlob)))
          .catch(() => setRecordedUrl(URL.createObjectURL(rawBlob)))
          .finally(() => {
            releaseCapture();
            setStatus('stopped');
            stopTimer();
          });
      };

      videoTrack.addEventListener('ended', () => {
        if (recorder.state !== 'inactive') recorder.stop();
      });

      durationRef.current = { accumulatedMs: 0, segmentStartMs: performance.now(), isPaused: false };
      recorder.start(1000);
      recorderRef.current = recorder;
      setStatus('recording');
      timerRef.current = window.setInterval(() => {
        setElapsedSeconds((prev) => prev + 1);
      }, 1000);
    },
    [recordedUrl, releaseCapture, stopTimer]
  );

  const pauseRecording = useCallback(() => {
    if (recorderRef.current?.state === 'recording') {
      recorderRef.current.pause();
      durationRef.current.accumulatedMs += performance.now() - durationRef.current.segmentStartMs;
      durationRef.current.isPaused = true;
      setStatus('paused');
      stopTimer();
    }
  }, [stopTimer]);

  const resumeRecording = useCallback(() => {
    if (recorderRef.current?.state === 'paused') {
      recorderRef.current.resume();
      durationRef.current.segmentStartMs = performance.now();
      durationRef.current.isPaused = false;
      setStatus('recording');
      timerRef.current = window.setInterval(() => {
        setElapsedSeconds((prev) => prev + 1);
      }, 1000);
    }
  }, []);

  const stopRecording = useCallback(() => {
    if (recorderRef.current && recorderRef.current.state !== 'inactive') {
      recorderRef.current.stop();
    }
  }, []);

  useEffect(() => {
    return () => {
      stopTimer();
      releaseCapture();
      if (recorderRef.current && recorderRef.current.state !== 'inactive') {
        recorderRef.current.stop();
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return {
    status,
    error,
    elapsedSeconds,
    recordedUrl,
    previewStream,
    startRecording,
    pauseRecording,
    resumeRecording,
    stopRecording,
  };
}
