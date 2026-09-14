import { useEffect, useMemo, useRef, useState } from 'react';
import { useScreenRecorder } from './hooks/useScreenRecorder';
import './App.css';

function formatDuration(totalSeconds: number): string {
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  const pad = (n: number) => n.toString().padStart(2, '0');
  return hours > 0 ? `${pad(hours)}:${pad(minutes)}:${pad(seconds)}` : `${pad(minutes)}:${pad(seconds)}`;
}

const isSecureContext = typeof window !== 'undefined' && window.isSecureContext;
const supportsDisplayMedia =
  typeof navigator !== 'undefined' && !!navigator.mediaDevices?.getDisplayMedia;

function App() {
  const [includeSystemAudio, setIncludeSystemAudio] = useState(true);
  const [includeMic, setIncludeMic] = useState(false);

  const {
    status,
    error,
    elapsedSeconds,
    recordedUrl,
    previewStream,
    startRecording,
    pauseRecording,
    resumeRecording,
    stopRecording,
  } = useScreenRecorder();

  const previewRef = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    if (previewRef.current) {
      previewRef.current.srcObject = previewStream;
    }
  }, [previewStream]);

  const isRecording = status === 'recording';
  const isPaused = status === 'paused';
  const isActive = isRecording || isPaused;
  const canStart = status === 'idle' || status === 'stopped';

  const downloadName = useMemo(() => {
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    return `screen-recording-${stamp}.webm`;
  }, [recordedUrl]);

  if (!supportsDisplayMedia || !isSecureContext) {
    return (
      <main className="app">
        <h1>Screen Recorder</h1>
        <p className="error">
          Your browser or connection doesn't support screen capture. Open this over HTTPS (or
          localhost) in a recent Chrome, Edge, or Firefox.
        </p>
      </main>
    );
  }

  return (
    <main className="app">
      <h1>Screen Recorder</h1>

      <section className="options">
        <label className={isActive ? 'disabled' : undefined}>
          <input
            type="checkbox"
            checked={includeSystemAudio}
            disabled={isActive}
            onChange={(e) => setIncludeSystemAudio(e.target.checked)}
          />
          System audio (meetings, media players)
        </label>
        <label className={isActive ? 'disabled' : undefined}>
          <input
            type="checkbox"
            checked={includeMic}
            disabled={isActive}
            onChange={(e) => setIncludeMic(e.target.checked)}
          />
          Microphone (optional narration)
        </label>
      </section>

      <p className="hint">
        When the share picker opens, choose <strong>Entire Screen</strong> — a single window
        usually carries no audio, and sharing a browser tab can record hardware-accelerated video
        (e.g. a YouTube video) as a blank frame due to a known Chrome limitation. Also check{' '}
        <strong>Share audio</strong> to capture a Zoom/Teams call, a video player, or any other
        app's sound. On Windows and ChromeOS this captures all system audio; on macOS, Chrome can
        only capture a shared tab's own audio and cannot capture other apps' audio at all.
      </p>

      <section className="controls">
        {canStart && (
          <button
            className="primary"
            onClick={() => startRecording({ includeMic, includeSystemAudio })}
          >
            Start Recording
          </button>
        )}
        {isRecording && (
          <button onClick={pauseRecording}>Pause</button>
        )}
        {isPaused && (
          <button onClick={resumeRecording}>Resume</button>
        )}
        {isActive && (
          <button className="danger" onClick={stopRecording}>
            Stop
          </button>
        )}
        {isActive && <span className="timer">{formatDuration(elapsedSeconds)}</span>}
      </section>

      {error && <p className="error">{error}</p>}

      {previewStream && (
        <video ref={previewRef} className="preview" autoPlay muted playsInline />
      )}

      {recordedUrl && (
        <section className="result">
          <video src={recordedUrl} controls className="preview" />
          <a className="primary download" href={recordedUrl} download={downloadName}>
            Download recording (.webm)
          </a>
        </section>
      )}
    </main>
  );
}

export default App;
