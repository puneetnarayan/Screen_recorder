import { useEffect, useRef, useState } from 'react';
import type { AreaRect } from '../hooks/useScreenRecorder';
import './AreaSelector.css';

interface DragState {
  startX: number;
  startY: number;
  x: number;
  y: number;
  w: number;
  h: number;
}

interface AreaSelectorProps {
  previewStream: MediaStream;
  sourceSize: { width: number; height: number };
  onConfirm: (rect: AreaRect) => void;
  onCancel: () => void;
}

const MIN_SELECTION_PX = 10;

export function AreaSelector({ previewStream, sourceSize, onConfirm, onCancel }: AreaSelectorProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const frameRef = useRef<HTMLDivElement>(null);
  const [drag, setDrag] = useState<DragState | null>(null);

  useEffect(() => {
    if (videoRef.current) videoRef.current.srcObject = previewStream;
  }, [previewStream]);

  const pointFromEvent = (e: React.PointerEvent) => {
    const rect = frameRef.current!.getBoundingClientRect();
    return {
      x: Math.min(Math.max(e.clientX - rect.left, 0), rect.width),
      y: Math.min(Math.max(e.clientY - rect.top, 0), rect.height),
    };
  };

  const handlePointerDown = (e: React.PointerEvent) => {
    const { x, y } = pointFromEvent(e);
    setDrag({ startX: x, startY: y, x, y, w: 0, h: 0 });
    (e.target as Element).setPointerCapture(e.pointerId);
  };

  const handlePointerMove = (e: React.PointerEvent) => {
    if (!drag) return;
    const { x, y } = pointFromEvent(e);
    setDrag((d) =>
      d && {
        ...d,
        x: Math.min(d.startX, x),
        y: Math.min(d.startY, y),
        w: Math.abs(x - d.startX),
        h: Math.abs(y - d.startY),
      }
    );
  };

  const hasValidSelection = !!drag && drag.w >= MIN_SELECTION_PX && drag.h >= MIN_SELECTION_PX;

  const handleConfirm = () => {
    if (!hasValidSelection || !drag || !frameRef.current) return;
    const scale = sourceSize.width / frameRef.current.clientWidth;
    onConfirm({
      x: Math.round(drag.x * scale),
      y: Math.round(drag.y * scale),
      width: Math.round(drag.w * scale),
      height: Math.round(drag.h * scale),
    });
  };

  return (
    <section className="area-selector">
      <p className="hint">Drag a rectangle over the preview below to choose the area to record.</p>
      <div
        ref={frameRef}
        className="area-selector-frame"
        style={{ aspectRatio: `${sourceSize.width} / ${sourceSize.height}` }}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
      >
        <video ref={videoRef} autoPlay muted playsInline />
        {drag && drag.w > 0 && drag.h > 0 && (
          <div
            className="area-selector-box"
            style={{ left: drag.x, top: drag.y, width: drag.w, height: drag.h }}
          />
        )}
      </div>
      <div className="controls">
        <button className="primary" onClick={handleConfirm} disabled={!hasValidSelection}>
          Confirm area
        </button>
        <button className="danger" onClick={onCancel}>
          Cancel
        </button>
      </div>
    </section>
  );
}
