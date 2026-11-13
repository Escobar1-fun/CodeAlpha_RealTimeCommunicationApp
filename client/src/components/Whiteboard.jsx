import { Eraser, Pen, Trash2, Type } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';

// Everyone draws on the same logical canvas and CSS scales it to fit,
// so coordinates mean the same thing on every screen.
const WIDTH = 1920;
const HEIGHT = 1080;
const FLUSH_MS = 40;
const MAX_POINTS_PER_BATCH = 400;
const COLORS = ['#16181c', '#e03131', '#f08c00', '#2f9e44', '#1971c2', '#9c36b5'];
const TOOLS = [
  { id: 'pen', label: 'Pen', Icon: Pen },
  { id: 'eraser', label: 'Eraser', Icon: Eraser },
  { id: 'text', label: 'Text', Icon: Type },
];

const textSizeFor = (brush) => Math.round(brush * 3 + 18);
const fontFor = (size) => `${size}px "Figtree Variable", system-ui, sans-serif`;
const newId = () => crypto.randomUUID().replaceAll('-', '').slice(0, 24);
const clamp = (value, max) => Math.round(Math.min(Math.max(value, 0), max) * 10) / 10;

export default function Whiteboard({ socket, board, onNotice }) {
  const canvasRef = useRef(null);
  const wrapRef = useRef(null);
  const textRef = useRef(null);
  const openEnds = useRef(new Map()); // Last point of each stroke still being drawn.
  const active = useRef(null); // { id, unsent: [] } for the local pointer stroke.

  const [tool, setTool] = useState('pen');
  const [color, setColor] = useState(COLORS[0]);
  const [size, setSize] = useState(4);
  const [textDraft, setTextDraft] = useState(null);
  const [confirmingClear, setConfirmingClear] = useState(false);

  const style = useRef({ tool, color, size });
  style.current = { tool, color, size };

  const ctx = () => canvasRef.current.getContext('2d');

  function drawSegment(op, points, from) {
    if (points.length === 0) return;
    const g = ctx();
    g.save();
    g.globalCompositeOperation = op.tool === 'eraser' ? 'destination-out' : 'source-over';
    g.strokeStyle = g.fillStyle = op.color;
    g.lineWidth = op.size;
    g.lineCap = 'round';

    let previous = from;
    if (!previous) {
      [previous] = points;
      g.beginPath();
      g.arc(previous[0], previous[1], op.size / 2, 0, Math.PI * 2);
      g.fill();
    }
    // One stroke() per segment on purpose: the drawer paints move by move and others
    // paint network batches, and this way every client ends up with identical pixels.
    for (const point of from ? points : points.slice(1)) {
      g.beginPath();
      g.moveTo(previous[0], previous[1]);
      g.lineTo(point[0], point[1]);
      g.stroke();
      previous = point;
    }
    g.restore();
  }

  function applyStrokeBatch(op) {
    drawSegment(op, op.points, openEnds.current.get(op.id));
    if (op.done) openEnds.current.delete(op.id);
    else if (op.points.length) openEnds.current.set(op.id, op.points.at(-1));
  }

  function drawText(op) {
    const g = ctx();
    g.save();
    g.fillStyle = op.color;
    g.font = fontFor(op.size);
    g.textBaseline = 'top';
    g.fillText(op.text, op.x, op.y);
    g.restore();
  }

  function clearCanvas() {
    ctx().clearRect(0, 0, WIDTH, HEIGHT);
    openEnds.current.clear();
  }

  // Replays the server's log on join and again after any reconnect.
  useEffect(() => {
    clearCanvas();
    for (const op of board) {
      if (op.type === 'text') drawText(op);
      else applyStrokeBatch(op);
    }
  }, [board]);

  useEffect(() => {
    const onClear = ({ by }) => {
      clearCanvas();
      onNotice(`${by} cleared the whiteboard`);
    };
    const onFull = () => onNotice('The whiteboard is full. Clear it to keep drawing.');
    socket.on('wb:stroke', applyStrokeBatch);
    socket.on('wb:text', drawText);
    socket.on('wb:clear', onClear);
    socket.on('wb:full', onFull);
    return () => {
      socket.off('wb:stroke', applyStrokeBatch);
      socket.off('wb:text', drawText);
      socket.off('wb:clear', onClear);
      socket.off('wb:full', onFull);
    };
  }, [socket, onNotice]);

  function flush(done) {
    const stroke = active.current;
    if (!stroke) return;
    if (stroke.unsent.length === 0 && !done) return;
    const { tool: strokeTool, color: strokeColor, size: strokeSize } = stroke;
    socket.emit('wb:stroke', {
      id: stroke.id,
      tool: strokeTool,
      color: strokeColor,
      size: strokeSize,
      points: stroke.unsent.splice(0, MAX_POINTS_PER_BATCH),
      done: done && stroke.unsent.length === 0,
    });
  }

  useEffect(() => {
    const timer = setInterval(() => flush(false), FLUSH_MS);
    return () => clearInterval(timer);
  }, [socket]);

  function toBoard(e) {
    const rect = canvasRef.current.getBoundingClientRect();
    return [
      clamp(((e.clientX - rect.left) / rect.width) * WIDTH, WIDTH),
      clamp(((e.clientY - rect.top) / rect.height) * HEIGHT, HEIGHT),
    ];
  }

  function onPointerDown(e) {
    if (e.button !== 0) return;
    const { tool: current, color: currentColor, size: currentSize } = style.current;

    if (current === 'text') {
      e.preventDefault(); // Keep the click from immediately blurring the new input.
      if (textDraft?.value.trim()) commitText();
      const [x, y] = toBoard(e);
      setTextDraft({ x, y, value: '' });
      return;
    }

    e.currentTarget.setPointerCapture(e.pointerId);
    const point = toBoard(e);
    const stroke = {
      id: newId(),
      tool: current,
      color: currentColor,
      size: current === 'eraser' ? currentSize * 4 : currentSize,
      unsent: [point],
      last: point,
    };
    active.current = stroke;
    drawSegment(stroke, [point], null);
  }

  function onPointerMove(e) {
    const stroke = active.current;
    if (!stroke) return;
    const events = e.nativeEvent.getCoalescedEvents?.() ?? [];
    const points = (events.length ? events : [e]).map(toBoard);
    drawSegment(stroke, points, stroke.last);
    stroke.last = points.at(-1);
    stroke.unsent.push(...points);
  }

  function onPointerUp() {
    if (!active.current) return;
    while (active.current.unsent.length > MAX_POINTS_PER_BATCH) flush(false);
    flush(true);
    active.current = null;
  }

  useEffect(() => {
    if (textDraft) textRef.current?.focus();
  }, [Boolean(textDraft)]);

  function commitText() {
    const draft = textDraft;
    setTextDraft(null);
    const text = draft?.value.trim();
    if (!text) return;
    const op = { id: newId(), x: draft.x, y: draft.y, text, color, size: textSizeFor(size) };
    // Drawn from the server's reply so the author sees the same sanitized text as everyone else.
    socket.emit('wb:text', op, (res) => {
      if (res.ok) drawText(res.op);
      else if (res.error === 'Invalid payload') onNotice('This text cannot be added to the board.');
    });
  }

  function clearAll() {
    if (!confirmingClear) {
      setConfirmingClear(true);
      setTimeout(() => setConfirmingClear(false), 3000);
      return;
    }
    setConfirmingClear(false);
    clearCanvas();
    socket.emit('wb:clear', {});
  }

  // The input overlays the canvas, so its type size follows the canvas's display scale.
  const scale = (wrapRef.current?.clientWidth ?? WIDTH) / WIDTH;

  return (
    <div className="board">
      <div className="board-tools" role="toolbar" aria-label="Whiteboard tools">
        {TOOLS.map(({ id, label, Icon }) => (
          <button
            key={id}
            className={`tool ${tool === id ? 'active' : ''}`}
            onClick={() => setTool(id)}
            aria-label={label}
            aria-pressed={tool === id}
            title={label}
          >
            <Icon size={18} />
          </button>
        ))}
        <span className="board-divider" />
        {COLORS.map((c) => (
          <button
            key={c}
            className={`swatch ${color === c ? 'active' : ''}`}
            style={{ background: c }}
            onClick={() => setColor(c)}
            aria-label={`Color ${c}`}
            aria-pressed={color === c}
          />
        ))}
        <label className="swatch-custom" title="Custom color">
          <input
            type="color"
            value={color}
            onChange={(e) => setColor(e.target.value)}
            aria-label="Custom color"
          />
        </label>
        <span className="board-divider" />
        <label className="board-size">
          <span className="sr-only">Brush size</span>
          <input
            type="range"
            min="1"
            max="30"
            value={size}
            onChange={(e) => setSize(Number(e.target.value))}
          />
        </label>
        <button className={`btn small ${confirmingClear ? 'danger' : ''} board-clear`} onClick={clearAll}>
          <Trash2 size={15} />
          {confirmingClear ? 'Clear for everyone?' : 'Clear'}
        </button>
      </div>

      <div className="board-area">
        <div className="board-sheet" ref={wrapRef}>
          <canvas
            ref={canvasRef}
            width={WIDTH}
            height={HEIGHT}
            className={`tool-${tool}`}
            data-testid="whiteboard"
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            onPointerCancel={onPointerUp}
          />
          {textDraft && (
            <input
              ref={textRef}
              className="board-text"
              value={textDraft.value}
              maxLength={500}
              placeholder="Type, then Enter"
              style={{
                left: `${(textDraft.x / WIDTH) * 100}%`,
                top: `${(textDraft.y / HEIGHT) * 100}%`,
                color,
                fontSize: textSizeFor(size) * scale,
              }}
              onChange={(e) => setTextDraft((d) => ({ ...d, value: e.target.value }))}
              onBlur={commitText}
              onKeyDown={(e) => {
                if (e.key === 'Enter') commitText();
                if (e.key === 'Escape') setTextDraft(null);
              }}
            />
          )}
        </div>
      </div>
    </div>
  );
}
