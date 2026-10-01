/**
 * HALQA Mobile — LiveClassWhiteboard
 * Host draws → broadcasts strokes via POST /live-classes/:id/whiteboard
 * Students receive liveclass:draw socket event → replay strokes.
 * Uses react-native-svg (already installed) for rendering paths.
 * Uses PanResponder for touch input — no additional packages needed.
 */
import React, {
  useState, useCallback, useRef, useImperativeHandle, forwardRef
} from 'react';
import {
  View, PanResponder, StyleSheet, TouchableOpacity,
  Text, ScrollView
} from 'react-native';
import Svg, { Path, G } from 'react-native-svg';
import { Ionicons } from '@expo/vector-icons';
import { showMessage } from 'react-native-flash-message';

// ─── Types ────────────────────────────────────────────────────────────────────
export interface DrawEvent {
  type: 'stroke' | 'clear' | 'snapshot';
  path?: string;     // SVG path data (for stroke)
  color?: string;
  strokeWidth?: number;
  dataUrl?: string;  // base64 PNG (for snapshot — not used on mobile, just relayed)
}

export interface WhiteboardHandle {
  getSnapshot: () => string | null;          // returns current SVG as data URI
  loadSnapshot: (dataUrl: string) => void;   // loads a snapshot (not applicable on mobile — no-op)
  clear: () => void;
}

interface StrokeData {
  id: string;
  path: string;
  color: string;
  strokeWidth: number;
}

interface Props {
  isHost: boolean;
  remoteEvent: DrawEvent | null;   // incoming event from liveclass:draw socket
  onDraw: (event: DrawEvent) => void; // called by host when drawing
}

// ─── Colour palette ───────────────────────────────────────────────────────────
const COLORS = ['#ffffff', '#ef4444', '#f59e0b', '#10b981', '#3b82f6', '#8b5cf6', '#000000'];
const WIDTHS  = [2, 4, 8, 14];

// ─── Convert touch points to SVG path string ─────────────────────────────────
function pointsToPath(points: Array<{ x: number; y: number }>): string {
  if (points.length === 0) return '';
  if (points.length === 1) {
    const p = points[0];
    return `M ${p.x} ${p.y} L ${p.x + 0.1} ${p.y + 0.1}`;
  }
  let d = `M ${points[0].x} ${points[0].y}`;
  for (let i = 1; i < points.length; i++) {
    // Smooth curve through Bezier control points
    const prev = points[i - 1];
    const curr = points[i];
    const cx = (prev.x + curr.x) / 2;
    const cy = (prev.y + curr.y) / 2;
    d += ` Q ${prev.x} ${prev.y} ${cx} ${cy}`;
  }
  const last = points[points.length - 1];
  d += ` L ${last.x} ${last.y}`;
  return d;
}

// ─── Main component ───────────────────────────────────────────────────────────
export const LiveClassWhiteboard = forwardRef<WhiteboardHandle, Props>(
  function LiveClassWhiteboard({ isHost, remoteEvent, onDraw }, ref) {
    const [strokes, setStrokes]         = useState<StrokeData[]>([]);
    const [activeColor, setActiveColor] = useState('#ffffff');
    const [activeWidth, setActiveWidth] = useState(4);
    const [showTools, setShowTools]     = useState(true);
    const currentPoints = useRef<Array<{ x: number; y: number }>>([]);
    const svgRef        = useRef<any>(null);

    // Apply incoming remote events from socket (for students + replay)
    React.useEffect(() => {
      if (!remoteEvent) return;
      if (remoteEvent.type === 'stroke' && remoteEvent.path) {
        setStrokes(prev => [...prev, {
          id:          `remote-${Date.now()}-${Math.random()}`,
          path:        remoteEvent.path!,
          color:       remoteEvent.color ?? '#ffffff',
          strokeWidth: remoteEvent.strokeWidth ?? 4,
        }]);
      } else if (remoteEvent.type === 'clear') {
        setStrokes([]);
      }
      // snapshot type: not rendered on mobile (just for Redis persistence)
    }, [remoteEvent]);

    // Expose imperative handle to parent (mirror web WhiteboardHandle)
    useImperativeHandle(ref, () => ({
      getSnapshot: () => null,           // SVG → PNG not supported without native module
      loadSnapshot: (_dataUrl: string) => {}, // no-op on mobile
      clear: () => {
        setStrokes([]);
        onDraw({ type: 'clear' });
      },
    }));

    // ── Touch handling ──────────────────────────────────────────────────────
    const panResponder = useRef(
      PanResponder.create({
        onStartShouldSetPanResponder:        () => isHost,
        onMoveShouldSetPanResponder:         () => isHost,
        onPanResponderGrant: (evt) => {
          currentPoints.current = [{
            x: evt.nativeEvent.locationX,
            y: evt.nativeEvent.locationY,
          }];
        },
        onPanResponderMove: (evt) => {
          currentPoints.current.push({
            x: evt.nativeEvent.locationX,
            y: evt.nativeEvent.locationY,
          });
          // Force re-render every ~5 points for smooth live preview
          if (currentPoints.current.length % 5 === 0) {
            const pathStr = pointsToPath(currentPoints.current);
            setStrokes(prev => {
              const last = prev[prev.length - 1];
              if (last?.id === '__active__') {
                return [...prev.slice(0, -1), { ...last, path: pathStr }];
              }
              return [...prev, {
                id: '__active__',
                path: pathStr,
                color: activeColor,
                strokeWidth: activeWidth,
              }];
            });
          }
        },
        onPanResponderRelease: () => {
          const pathStr = pointsToPath(currentPoints.current);
          if (!pathStr) return;

          const strokeId = `stroke-${Date.now()}-${Math.random().toString(36).slice(2)}`;
          const strokeData: StrokeData = {
            id:          strokeId,
            path:        pathStr,
            color:       activeColor,
            strokeWidth: activeWidth,
          };

          // Replace the __active__ preview with the final stroke
          setStrokes(prev => [
            ...prev.filter(s => s.id !== '__active__'),
            strokeData,
          ]);

          // Broadcast to all students
          onDraw({
            type:        'stroke',
            path:        pathStr,
            color:       activeColor,
            strokeWidth: activeWidth,
          });

          currentPoints.current = [];
        },
      })
    ).current;

    const handleClear = useCallback(() => {
      setStrokes([]);
      onDraw({ type: 'clear' });
    }, [onDraw]);

    const handleUndo = useCallback(() => {
      // Remove last confirmed stroke (not __active__)
      setStrokes(prev => {
        const confirmed = prev.filter(s => s.id !== '__active__');
        if (confirmed.length === 0) return prev;
        return confirmed.slice(0, -1);
      });
      // Note: undo is local only — students keep the stroke until next sync
      // A full undo-sync would require a 'remove_stroke' event type
      showMessage({ message: 'Undo (local only)', type: 'info', duration: 1000 });
    }, []);

    return (
      <View style={wb.container}>
        {/* Canvas */}
        <View
          style={wb.canvas}
          {...(isHost ? panResponder.panHandlers : {})}
        >
          <Svg width="100%" height="100%" style={StyleSheet.absoluteFill}>
            <G>
              {strokes.map(s => (
                <Path
                  key={s.id}
                  d={s.path}
                  stroke={s.color}
                  strokeWidth={s.strokeWidth}
                  fill="none"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              ))}
            </G>
          </Svg>

          {/* Placeholder text when empty */}
          {strokes.length === 0 && (
            <View style={wb.placeholder} pointerEvents="none">
              <Ionicons name="pencil-outline" size={40} color="#374151" />
              <Text style={wb.placeholderText}>
                {isHost ? 'Draw here — students see your strokes live' : 'Waiting for teacher to draw…'}
              </Text>
            </View>
          )}
        </View>

        {/* Host toolbar */}
        {isHost && (
          <View style={wb.toolbar}>
            {/* Toggle toolbar visibility */}
            <TouchableOpacity
              style={wb.toolBtn}
              onPress={() => setShowTools(v => !v)}
            >
              <Ionicons name={showTools ? 'chevron-down' : 'chevron-up'} size={16} color="#9ca3af" />
            </TouchableOpacity>

            {showTools && (
              <>
                {/* Colour picker */}
                <ScrollView horizontal showsHorizontalScrollIndicator={false} style={wb.colorRow}>
                  {COLORS.map(c => (
                    <TouchableOpacity
                      key={c}
                      style={[wb.colorDot, { backgroundColor: c }, activeColor === c && wb.colorDotActive]}
                      onPress={() => setActiveColor(c)}
                    />
                  ))}
                </ScrollView>

                {/* Stroke width */}
                <View style={wb.widthRow}>
                  {WIDTHS.map(w => (
                    <TouchableOpacity
                      key={w}
                      style={[wb.widthBtn, activeWidth === w && wb.widthBtnActive]}
                      onPress={() => setActiveWidth(w)}
                    >
                      <View style={{ width: w * 1.5, height: w * 1.5, borderRadius: w, backgroundColor: activeColor, maxWidth: 20, maxHeight: 20 }} />
                    </TouchableOpacity>
                  ))}
                </View>

                {/* Actions */}
                <View style={wb.actionRow}>
                  <TouchableOpacity style={wb.actionBtn} onPress={handleUndo}>
                    <Ionicons name="arrow-undo" size={18} color="#9ca3af" />
                  </TouchableOpacity>
                  <TouchableOpacity style={[wb.actionBtn, { backgroundColor: '#ef444422' }]} onPress={handleClear}>
                    <Ionicons name="trash-outline" size={18} color="#ef4444" />
                  </TouchableOpacity>
                </View>
              </>
            )}
          </View>
        )}
      </View>
    );
  }
);

const wb = StyleSheet.create({
  container:       { flex: 1, backgroundColor: '#111827' },
  canvas:          { flex: 1, backgroundColor: '#111827' },
  placeholder:     { ...StyleSheet.absoluteFillObject, alignItems: 'center', justifyContent: 'center', gap: 10, padding: 20 },
  placeholderText: { color: '#374151', fontSize: 13, textAlign: 'center', lineHeight: 20 },
  // Toolbar
  toolbar:         { backgroundColor: '#1a1a2e', borderTopWidth: 1, borderTopColor: '#1e1e3a', padding: 8, gap: 8 },
  toolBtn:         { alignSelf: 'center', padding: 4 },
  colorRow:        { flexGrow: 0 },
  colorDot:        { width: 26, height: 26, borderRadius: 13, marginRight: 8, borderWidth: 2, borderColor: 'transparent' },
  colorDotActive:  { borderColor: '#fff', transform: [{ scale: 1.25 }] },
  widthRow:        { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 4 },
  widthBtn:        { width: 36, height: 36, borderRadius: 8, backgroundColor: '#111827', alignItems: 'center', justifyContent: 'center' },
  widthBtnActive:  { backgroundColor: '#4f46e522', borderWidth: 1.5, borderColor: '#4f46e5' },
  actionRow:       { flexDirection: 'row', gap: 8 },
  actionBtn:       { width: 36, height: 36, borderRadius: 8, backgroundColor: '#111827', alignItems: 'center', justifyContent: 'center' },
});

