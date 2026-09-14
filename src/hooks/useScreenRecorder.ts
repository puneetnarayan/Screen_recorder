import { useCallback, useEffect, useRef, useState } from 'react';
import fixWebmDuration from 'fix-webm-duration';

export type RecorderStatus = 'idle' | 'selecting-area' | 'recording' | 'paused' | 'stopped';

export interface StartRecordingOptions {
  includeMic: boolean;
  includeSystemAudio: boolean;
  customArea: boolean;
}

export interface AreaRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

interface PendingCapture {
  rawVideoTrack: MediaStreamTrack;
  outputAudioTrack: MediaStreamTrack | null;
  warnings: string[];
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
  const [recordedBytes, setRecordedBytes] = useState(0);
  const [previewStream, setPreviewStream] = useState<MediaStream | null>(null);
  const [sourceVideoSize, setSourceVideoSize] = useState<{ width: number; height: number } | null>(null);

  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const cleanupTracksRef = useRef<MediaStreamTrack[]>([]);
  const audioContextRef = useRef<AudioContext | null>(null);
  const timerRef = useRef<number | null>(null);
  const durationRef = useRef({ accumulatedMs: 0, segmentStartMs: 0, isPaused: false });
  const pendingRef = useRef<PendingCapture | null>(null);
  const cropVideoElRef = useRef<HTMLVideoElement | null>(null);
  const drawIntervalRef = useRef<number | null>(null);

  const stopTimer = useCallback(() => {
    if (timerRef.current !== null) {
      window.clearInterval(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  const releaseCapture = useCallback(() => {
    if (drawIntervalRef.current !== null) {
      window.clearInterval(drawIntervalRef.current);
      drawIntervalRef.current = null;
    }
    if (cropVideoElRef.current) {
      cropVideoElRef.current.srcObject = null;
      cropVideoElRef.current = null;
    }
    cleanupTracksRef.current.forEach((track) => track.stop());
    cleanupTracksRef.current = [];
    if (audioContextRef.current) {
      audioContextRef.current.close().catch(() => {});
      audioContextRef.current = null;
    }
    pendingRef.current = null;
    setPreviewStream(null);
    setSourceVideoSize(null);
  }, []);

  const beginRecording = useCallback(
    (videoTrack: MediaStreamTrack, audioTrack: MediaStreamTrack | null, warnings: string[]) => {
      const outputTracks: MediaStreamTrack[] = [videoTrack];
      if (audioTrack) outputTracks.push(audioTrack);
      setPreviewStream(new MediaStream(outputTracks));

      if (warnings.length > 0) setError(warnings.join(' '));

      chunksRef.current = [];
      setRecordedBytes(0);
      setElapsedSeconds(0);

      const mimeType = pickMimeType();
      const recorder = new MediaRecorder(new MediaStream(outputTracks), mimeType ? { mimeType } : undefined);

      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          chunksRef.current.push(event.data);
          setRecordedBytes((prev) => prev + event.data.size);
        }
      };
      recorder.onstop = () => {
        const rawBlob = new Blob(chunksRef.current, { type: mimeType || 'video/webm' });
        const { accumulatedMs, segmentStartMs, isPaused } = durationRef.current;
        const totalMs = accumulatedMs + (isPaused ? 0 : performance.now() - segmentStartMs);

        fixWebmDuration(rawBlob, totalMs, { logger: false })
          .then((fixedBlob) => {
            setRecordedUrl(URL.createObjectURL(fixedBlob));
            setRecordedBytes(fixedBlob.size);
          })
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
    [releaseCapture, stopTimer]
  );

  const startRecording = useCallback(
    async ({ includeMic, includeSystemAudio, customArea }: StartRecordingOptions) => {
      setError(null);
      if (recordedUrl) {
        URL.revokeObjectURL(recordedUrl);
        setRecordedUrl(null);
      }

      let displayStream: MediaStream;
      try {
        displayStream = await navigator.mediaDevices.getDisplayMedia({
          video: { frameRate: 30, cursor: 'always' } as MediaTrackConstraints,
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
          'No system audio came through — in the share picker, choose "Entire Screen" and check "Share audio"; sharing a single window usually carries no audio in Chrome.'
        );
      }

      if (videoTrack.getSettings().displaySurface === 'browser') {
        warnings.push(
          'You shared a browser tab — Chrome has a known issue where hardware-accelerated video (e.g. a YouTube video) can record as a blank frame in tab capture. If the recording comes out blank, redo it sharing "Entire Screen" instead, which does not have this issue.'
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

      cleanupTracksRef.current = [
        videoTrack,
        ...(displayAudioTrack ? [displayAudioTrack] : []),
        ...(micAudioTrack ? [micAudioTrack] : []),
      ];

      if (!customArea) {
        beginRecording(videoTrack, outputAudioTrack, warnings);
        return;
      }

      pendingRef.current = { rawVideoTrack: videoTrack, outputAudioTrack, warnings };
      setPreviewStream(new MediaStream([videoTrack]));
      const { width, height } = videoTrack.getSettings();
      setSourceVideoSize({ width: width ?? 1280, height: height ?? 720 });
      setStatus('selecting-area');
    },
    [recordedUrl, beginRecording]
  );

  const confirmAreaSelection = useCallback(
    (rect: AreaRect) => {
      const pending = pendingRef.current;
      if (!pending) return;

      const video = document.createElement('video');
      video.muted = true;
      video.srcObject = new MediaStream([pending.rawVideoTrack]);
      video.play().catch(() => {});
      cropVideoElRef.current = video;

      const canvas = document.createElement('canvas');
      canvas.width = Math.max(2, Math.round(rect.width));
      canvas.height = Math.max(2, Math.round(rect.height));
      const ctx = canvas.getContext('2d');

      // Uses setInterval rather than requestAnimationFrame: rAF is throttled/suspended
      // in a background tab, which would freeze the recording the moment the user
      // switches away from this tab. A plain timer keeps running (screen-recording
      // pages are exempted from Chrome's aggressive background timer throttling).
      drawIntervalRef.current = window.setInterval(() => {
        if (ctx && video.readyState >= 2) {
          ctx.drawImage(video, rect.x, rect.y, rect.width, rect.height, 0, 0, canvas.width, canvas.height);
        }
      }, 1000 / 30);

      const croppedVideoTrack = canvas.captureStream(30).getVideoTracks()[0];
      cleanupTracksRef.current.push(croppedVideoTrack);

      pending.rawVideoTrack.addEventListener('ended', () => {
        if (recorderRef.current && recorderRef.current.state !== 'inactive') {
          recorderRef.current.stop();
        }
      });

      beginRecording(croppedVideoTrack, pending.outputAudioTrack, pending.warnings);
    },
    [beginRecording]
  );

  const cancelAreaSelection = useCallback(() => {
    releaseCapture();
    setStatus('idle');
  }, [releaseCapture]);

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
    } else if (pendingRef.current) {
      cancelAreaSelection();
    }
  }, [cancelAreaSelection]);

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
    recordedBytes,
    previewStream,
    sourceVideoSize,
    startRecording,
    confirmAreaSelection,
    cancelAreaSelection,
    pauseRecording,
    resumeRecording,
    stopRecording,
  };
}
