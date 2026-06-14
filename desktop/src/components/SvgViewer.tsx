import React, { useEffect, useRef, useState } from 'react';

function svgStringToNode(svgString: string): SVGElement | null {
  const doc = new DOMParser().parseFromString(svgString, 'image/svg+xml');
  const err = doc.querySelector('parsererror');
  if (err) return null;
  const root = doc.documentElement;
  if (!(root instanceof SVGElement)) return null;
  return root;
}

function makeSvgFluid(svg: SVGElement): void {
  const w = svg.getAttribute('width');
  const h = svg.getAttribute('height');
  if (!svg.getAttribute('viewBox') && w && h) {
    svg.setAttribute('viewBox', `0 0 ${parseFloat(w)} ${parseFloat(h)}`);
  }
  svg.removeAttribute('width');
  svg.removeAttribute('height');
  svg.setAttribute('preserveAspectRatio', 'xMidYMid meet');
  svg.style.width = '100%';
  svg.style.height = 'auto';
  svg.style.maxWidth = '100%';
  svg.style.display = 'block';
}

const ctrlBtnStyle: React.CSSProperties = {
  width: 28, height: 28, borderRadius: 6,
  border: '1px solid var(--border)', background: 'var(--bg)',
  color: 'var(--text)', cursor: 'pointer', fontFamily: 'Nunito',
  fontWeight: 700, fontSize: 13,
};

function DiagramModal({ svgString, onClose }: { svgString: string; onClose: () => void }) {
  const host = useRef<HTMLDivElement>(null);
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const dragRef = useRef<{ x: number; y: number; px: number; py: number } | null>(null);

  useEffect(() => {
    const node = svgStringToNode(svgString);
    if (!node) return;
    makeSvgFluid(node);
    host.current?.replaceChildren(node);
  }, [svgString]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
      else if (e.key === '+' || e.key === '=') setZoom(z => Math.min(z * 1.25, 8));
      else if (e.key === '-') setZoom(z => Math.max(z / 1.25, 0.2));
      else if (e.key === '0') { setZoom(1); setPan({ x: 0, y: 0 }); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const onWheel = (e: React.WheelEvent) => {
    e.preventDefault();
    const delta = -e.deltaY;
    setZoom(z => Math.min(8, Math.max(0.2, z * (delta > 0 ? 1.1 : 0.9))));
  };
  const onMouseDown = (e: React.MouseEvent) => {
    if (e.button !== 0) return;
    dragRef.current = { x: e.clientX, y: e.clientY, px: pan.x, py: pan.y };
  };
  const onMouseMove = (e: React.MouseEvent) => {
    const d = dragRef.current;
    if (!d) return;
    setPan({ x: d.px + (e.clientX - d.x), y: d.py + (e.clientY - d.y) });
  };
  const onMouseUp = () => { dragRef.current = null; };

  return (
    <div
      onClick={onClose}
      className="fixed inset-0 z-[9999] flex items-center justify-center bg-[rgba(0,0,0,0.78)] p-[24px] animate-[fade-in_120ms_ease-out]"
    >
      <style>{`@keyframes fade-in { from { opacity: 0 } to { opacity: 1 } }`}</style>
      <div
        onClick={e => e.stopPropagation()}
        onWheel={onWheel}
        onMouseDown={onMouseDown}
        onMouseMove={onMouseMove}
        onMouseUp={onMouseUp}
        onMouseLeave={onMouseUp}
        className="relative w-[min(96vw,1600px)] h-[min(92vh,1100px)] bg-[var(--bg2)] border border-[var(--border)] rounded-[12px] overflow-hidden shadow-[0_12px_48px_rgba(0,0,0,0.6)]"
        style={{ cursor: dragRef.current ? 'grabbing' : 'grab' }}
      >
        <div className="absolute top-[8px] right-[8px] z-[2] flex gap-[6px] items-center">
          <button onClick={() => setZoom(z => Math.max(0.2, z / 1.25))} title="Zoom out" style={ctrlBtnStyle}>−</button>
          <span className="text-[11px] text-[var(--text-muted)] font-Nunito min-w-[42px] text-center">{Math.round(zoom * 100)}%</span>
          <button onClick={() => setZoom(z => Math.min(8, z * 1.25))} title="Zoom in" style={ctrlBtnStyle}>+</button>
          <button onClick={() => { setZoom(1); setPan({ x: 0, y: 0 }); }} title="Reset" style={ctrlBtnStyle}>⟳</button>
          <button onClick={onClose} title="Close (Esc)" style={{ ...ctrlBtnStyle, color: 'var(--red, #ef4444)' }}>✕</button>
        </div>
        <div className="w-full h-full flex items-center justify-center overflow-hidden">
          <div
            ref={host}
            className="w-[90%] h-[90%] flex items-center justify-center pointer-events-none"
            style={{
              transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`,
              transformOrigin: 'center center',
              transition: dragRef.current ? 'none' : 'transform 0.08s ease-out',
            }}
          />
        </div>
        <div className="absolute bottom-[8px] left-[12px] text-[10.5px] text-[var(--text-dim)] font-Nunito pointer-events-none">
          drag · wheel · +/− · 0 reset · Esc close
        </div>
      </div>
    </div>
  );
}

export default function SvgViewer({ svgString }: { svgString: string }) {
  const host = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!svgString) return;
    const node = svgStringToNode(svgString);
    if (!node) return;
    makeSvgFluid(node);
    host.current?.replaceChildren(node);
  }, [svgString]);

  return (
    <>
      <div
        onClick={() => svgString && setOpen(true)}
        title={svgString ? 'Click to expand' : ''}
        className={`my-[8px] p-[12px] bg-[var(--bg2)] border border-[var(--border)] rounded-[10px] overflow-hidden relative transition-[border-color_0.15s] ${svgString ? 'hover:border-[var(--accent)]' : ''}`}
        style={{ cursor: svgString ? 'zoom-in' : 'default' }}
      >
        <div ref={host} className="w-full flex justify-center" />
        {svgString && (
          <div className="absolute top-[6px] right-[8px] text-[10px] text-[var(--text-dim)] bg-[var(--bg)] border border-[var(--border)] rounded-[4px] px-[5px] py-[1px] pointer-events-none opacity-70">⤢</div>
        )}
      </div>
      {open && <DiagramModal svgString={svgString} onClose={() => setOpen(false)} />}
    </>
  );
}
