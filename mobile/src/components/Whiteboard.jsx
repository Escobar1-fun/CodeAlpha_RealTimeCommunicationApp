import {
  BlendMode,
  Canvas,
  Group,
  matchFont,
  PaintStyle,
  Picture,
  Skia,
  StrokeCap,
  StrokeJoin,
} from '@shopify/react-native-skia';
import { Eraser, Pen, Trash2, Type } from 'lucide-react-native';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { PanResponder, Platform, Pressable, StyleSheet, TextInput, View } from 'react-native';
import { colors } from '../theme';
import { Button, RoundButton, iconColor } from '../ui';

// The same logical canvas as the web client, so strokes mean the same thing on both.
const WIDTH = 1920;
const HEIGHT = 1080;
const FLUSH_MS = 40;
const MAX_POINTS_PER_BATCH = 400;
const COLORS = ['#16181c', '#e03131', '#f08c00', '#2f9e44', '#1971c2', '#9c36b5'];
const SIZES = [4, 8, 16, 28];
const TOOLS = [
  { id: 'pen', label: 'Pen', Icon: Pen },
  { id: 'eraser', label: 'Eraser', Icon: Eraser },
  { id: 'text', label: 'Text', Icon: Type },
];

const textSizeFor = (brush) => Math.round(brush * 3 + 18);
const newId = () => `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 12)}`;
const clamp = (value, max) => Math.round(Math.min(Math.max(value, 0), max) * 10) / 10;

function makeStrokePaint(tool, color, size) {
  const paint = Skia.Paint();
  paint.setAntiAlias(true);
  paint.setStyle(PaintStyle.Stroke);
  paint.setStrokeWidth(size);
  paint.setStrokeCap(StrokeCap.Round);
  paint.setStrokeJoin(StrokeJoin.Round);
  paint.setColor(Skia.Color(color));
  if (tool === 'eraser') paint.setBlendMode(BlendMode.DstOut);
  return paint;
}

function makeTextEntry(op) {
  const font = matchFont({
    fontFamily: Platform.select({ ios: 'Helvetica', default: 'sans-serif' }),
    fontSize: op.size,
  });
  const paint = Skia.Paint();
  paint.setAntiAlias(true);
  paint.setColor(Skia.Color(op.color));
  return { type: 'text', text: op.text, x: op.x, y: op.y - font.getMetrics().ascent, font, paint };
}

export default function Whiteboard({ socket, board, onNotice }) {
  const entries = useRef([]);
  const open = useRef(new Map()); // Strokes still receiving points, by id.
  const active = useRef(null); // The local finger stroke: { id, tool, color, size, unsent }.
  const frame = useRef(null);

  const [picture, setPicture] = useState(null);
  const [sheet, setSheet] = useState({ width: 0, height: 0 });
  const [tool, setTool] = useState('pen');
  const [color, setColor] = useState(COLORS[0]);
  const [size, setSize] = useState(SIZES[1]);
  const [textAt, setTextAt] = useState(null);
  const [text, setText] = useState('');
  const [confirmingClear, setConfirmingClear] = useState(false);

  const style = useRef({ tool, color, size });
  style.current = { tool, color, size };
  const sheetRef = useRef(sheet);
  sheetRef.current = sheet;

  const redraw = useCallback(() => {
    if (frame.current !== null) return;
    frame.current = requestAnimationFrame(() => {
      frame.current = null;
      const recorder = Skia.PictureRecorder();
      const canvas = recorder.beginRecording(Skia.XYWHRect(0, 0, WIDTH, HEIGHT));
      const background = Skia.Paint();
      background.setColor(Skia.Color(colors.paper));
      canvas.drawRect(Skia.XYWHRect(0, 0, WIDTH, HEIGHT), background);
      // A layer, so that the eraser removes ink and leaves the paper.
      canvas.saveLayer();
      for (const entry of entries.current) {
        if (entry.type === 'text') {
          canvas.drawText(entry.text, entry.x, entry.y, entry.paint, entry.font);
          continue;
        }
        // Paths are immutable, so only strokes that gained points are rebuilt.
        if (entry.changed) {
          entry.path = entry.builder.build();
          entry.changed = false;
        }
        if (entry.path) canvas.drawPath(entry.path, entry.paint);
      }
      canvas.restore();
      setPicture(recorder.finishRecordingAsPicture());
    });
  }, []);

  const applyStroke = useCallback((op) => {
    let entry = open.current.get(op.id);
    if (!entry) {
      entry = {
        type: 'stroke',
        builder: Skia.PathBuilder.Make(),
        path: null,
        changed: false,
        paint: makeStrokePaint(op.tool, op.color, op.size),
        started: false,
      };
      open.current.set(op.id, entry);
      entries.current.push(entry);
    }
    for (const [x, y] of op.points) {
      if (!entry.started) {
        entry.builder.moveTo(x, y);
        entry.started = true;
      }
      entry.builder.lineTo(x, y);
      entry.changed = true;
    }
    if (op.done) open.current.delete(op.id);
  }, []);

  const clearBoard = useCallback(() => {
    entries.current = [];
    open.current.clear();
  }, []);

  const addText = useCallback((op) => {
    entries.current.push(makeTextEntry(op));
    redraw();
  }, [redraw]);

  // Replays the server's log on join and again after any reconnect.
  useEffect(() => {
    clearBoard();
    for (const op of board) {
      if (op.type === 'text') entries.current.push(makeTextEntry(op));
      else applyStroke(op);
    }
    redraw();
  }, [board, applyStroke, clearBoard, redraw]);

  useEffect(() => {
    const onStroke = (op) => {
      applyStroke(op);
      redraw();
    };
    const onClear = ({ by }) => {
      clearBoard();
      redraw();
      onNotice(`${by} cleared the whiteboard`);
    };
    const onFull = () => onNotice('The whiteboard is full. Clear it to keep drawing.');
    socket.on('wb:stroke', onStroke);
    socket.on('wb:text', addText);
    socket.on('wb:clear', onClear);
    socket.on('wb:full', onFull);
    return () => {
      socket.off('wb:stroke', onStroke);
      socket.off('wb:text', addText);
      socket.off('wb:clear', onClear);
      socket.off('wb:full', onFull);
    };
  }, [socket, onNotice, applyStroke, addText, clearBoard, redraw]);

  const flush = useCallback((done) => {
    const stroke = active.current;
    if (!stroke || (stroke.unsent.length === 0 && !done)) return;
    socket.emit('wb:stroke', {
      id: stroke.id,
      tool: stroke.tool,
      color: stroke.color,
      size: stroke.size,
      points: stroke.unsent.splice(0, MAX_POINTS_PER_BATCH),
      done: done && stroke.unsent.length === 0,
    });
  }, [socket]);

  useEffect(() => {
    const timer = setInterval(() => flush(false), FLUSH_MS);
    return () => clearInterval(timer);
  }, [flush]);

  const responder = useMemo(() => {
    const toBoard = ({ nativeEvent: { locationX, locationY } }) => {
      const { width, height } = sheetRef.current;
      return [clamp((locationX / width) * WIDTH, WIDTH), clamp((locationY / height) * HEIGHT, HEIGHT)];
    };
    const finish = () => {
      if (!active.current) return;
      while (active.current.unsent.length > MAX_POINTS_PER_BATCH) flush(false);
      flush(true);
      open.current.delete(active.current.id);
      active.current = null;
    };
    return PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: () => true,
      onPanResponderTerminationRequest: () => false,
      onPanResponderGrant: (event) => {
        const point = toBoard(event);
        const current = style.current;
        if (current.tool === 'text') {
          setTextAt(point);
          return;
        }
        const strokeSize = current.tool === 'eraser' ? current.size * 4 : current.size;
        const stroke = { id: newId(), tool: current.tool, color: current.color, size: strokeSize, unsent: [point] };
        active.current = stroke;
        applyStroke({ ...stroke, points: [point], done: false });
        redraw();
      },
      onPanResponderMove: (event) => {
        const stroke = active.current;
        if (!stroke) return;
        const point = toBoard(event);
        stroke.unsent.push(point);
        applyStroke({ ...stroke, points: [point], done: false });
        redraw();
      },
      onPanResponderRelease: finish,
      onPanResponderTerminate: finish,
    });
  }, [applyStroke, flush, redraw]);

  function commitText() {
    const value = text.trim();
    const at = textAt;
    setTextAt(null);
    setText('');
    if (!value || !at) return;
    const op = { id: newId(), x: at[0], y: at[1], text: value, color, size: textSizeFor(size) };
    // Drawn from the server's reply so the author sees the same sanitized text as everyone else.
    socket.emit('wb:text', op, (res) => {
      if (res.ok) addText(res.op);
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
    clearBoard();
    redraw();
    socket.emit('wb:clear', {});
  }

  function fitSheet({ nativeEvent: { layout } }) {
    const width = Math.min(layout.width, (layout.height * WIDTH) / HEIGHT);
    if (width > 0) setSheet({ width, height: (width * HEIGHT) / WIDTH });
  }

  return (
    <View style={styles.board}>
      <View style={styles.tools}>
        {TOOLS.map(({ id, label, Icon }) => (
          <RoundButton
            key={id}
            size={40}
            label={label}
            state={tool === id ? 'on' : undefined}
            onPress={() => setTool(id)}
            icon={<Icon size={18} color={iconColor(tool === id ? 'on' : undefined)} />}
          />
        ))}
        <View style={styles.push} />
        <Button
          small
          variant={confirmingClear ? 'danger' : 'default'}
          label={confirmingClear ? 'Clear for everyone?' : 'Clear'}
          icon={<Trash2 size={15} color={confirmingClear ? '#fff' : colors.text} />}
          onPress={clearAll}
        />
      </View>
      <View style={styles.tools}>
        {COLORS.map((c) => (
          <Pressable
            key={c}
            accessibilityRole="button"
            accessibilityLabel={`Color ${c}`}
            accessibilityState={{ selected: color === c }}
            hitSlop={4}
            onPress={() => setColor(c)}
            style={[styles.swatch, { backgroundColor: c }, color === c && styles.swatchActive]}
          />
        ))}
        <View style={styles.push} />
        {SIZES.map((s) => (
          <Pressable
            key={s}
            accessibilityRole="button"
            accessibilityLabel={`Brush size ${s}`}
            accessibilityState={{ selected: size === s }}
            hitSlop={3}
            onPress={() => setSize(s)}
            style={[styles.size, size === s && styles.sizeActive]}
          >
            <View style={[styles.sizeDot, { width: 4 + s / 2.4, height: 4 + s / 2.4, borderRadius: 12 }]} />
          </Pressable>
        ))}
      </View>

      {textAt && (
        <View style={styles.textRow}>
          <TextInput
            accessibilityLabel="Whiteboard text"
            autoFocus
            value={text}
            onChangeText={setText}
            onSubmitEditing={commitText}
            maxLength={500}
            placeholder="Type, then Done"
            placeholderTextColor={colors.muted}
            returnKeyType="done"
            style={styles.textInput}
          />
          <Button small variant="primary" label="Add" onPress={commitText} />
          <Button
            small
            variant="ghost"
            label="Cancel"
            onPress={() => {
              setTextAt(null);
              setText('');
            }}
          />
        </View>
      )}

      <View style={styles.area} onLayout={fitSheet}>
        {sheet.width > 0 && (
          <View
            testID="whiteboard"
            accessibilityLabel="Whiteboard canvas"
            style={[styles.sheet, sheet]}
            {...responder.panHandlers}
          >
            <Canvas style={sheet} pointerEvents="none">
              {picture && (
                <Group transform={[{ scale: sheet.width / WIDTH }]}>
                  <Picture picture={picture} />
                </Group>
              )}
            </Canvas>
          </View>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  board: { flex: 1, gap: 8 },
  tools: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  push: { flex: 1 },
  swatch: { width: 26, height: 26, borderRadius: 13, borderWidth: 2, borderColor: colors.line },
  swatchActive: { borderColor: colors.accent, borderWidth: 3 },
  size: { width: 30, height: 30, alignItems: 'center', justifyContent: 'center', borderRadius: 8 },
  sizeActive: { backgroundColor: colors.raised },
  sizeDot: { backgroundColor: colors.text },
  textRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  textInput: {
    flex: 1,
    height: 40,
    paddingHorizontal: 10,
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: 8,
    backgroundColor: colors.ink,
    color: colors.text,
  },
  area: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  sheet: { overflow: 'hidden', borderRadius: 10, backgroundColor: colors.paper },
});
