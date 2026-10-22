import type { ReactNode } from 'react';
import { Pressable, StyleSheet, Text, View, type StyleProp, type TextStyle, type ViewStyle } from 'react-native';
import { RADIUS, tint, useTheme, type Theme } from './theme';

// Styles are rebuilt only when the theme flips (two static Theme objects).
const styleCache = new WeakMap<Theme, ReturnType<typeof makeStyles>>();

export function useThemedStyles() {
  const t = useTheme();
  let s = styleCache.get(t);
  if (!s) {
    s = makeStyles(t);
    styleCache.set(t, s);
  }
  return { t, c: t.c, s };
}

export function Card({ children, style }: { children: ReactNode; style?: StyleProp<ViewStyle> }) {
  const { s } = useThemedStyles();
  return <View style={[s.card, style]}>{children}</View>;
}

export function H2({ children }: { children: ReactNode }) {
  const { s } = useThemedStyles();
  return <Text style={s.h2}>{children}</Text>;
}

export function P({ children, style }: { children: ReactNode; style?: StyleProp<TextStyle> }) {
  const { s } = useThemedStyles();
  return <Text style={[s.p, style]}>{children}</Text>;
}

export function Muted({ children, style }: { children: ReactNode; style?: StyleProp<TextStyle> }) {
  const { s } = useThemedStyles();
  return <Text style={[s.muted, style]}>{children}</Text>;
}

export function Btn({
  label,
  onPress,
  kind = 'ghost',
  disabled,
  style,
}: {
  label: string;
  onPress: () => void;
  kind?: 'primary' | 'ghost' | 'danger' | 'correct' | 'wrong';
  disabled?: boolean;
  style?: StyleProp<ViewStyle>;
}) {
  const { c, s } = useThemedStyles();
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      style={({ pressed }) => [
        s.btn,
        kind === 'primary' && s.btnPrimary,
        kind === 'danger' && s.btnDanger,
        kind === 'correct' && s.btnCorrect,
        kind === 'wrong' && s.btnWrong,
        disabled && { opacity: 0.45 },
        pressed && !disabled && { opacity: 0.8, transform: [{ scale: 0.98 }] },
        style,
      ]}
    >
      <Text
        style={[
          s.btnTxt,
          kind === 'primary' && { color: c.onAccent },
          kind === 'danger' && { color: c.bad },
          kind === 'correct' && { color: c.good },
          kind === 'wrong' && { color: c.bad },
        ]}
      >
        {label}
      </Text>
    </Pressable>
  );
}

export function Chip({ label, color }: { label: string; color?: string }) {
  const { c } = useThemedStyles();
  const col = color ?? c.muted;
  return (
    <View
      style={{
        borderWidth: 1,
        borderRadius: 20,
        paddingHorizontal: 10,
        paddingVertical: 3,
        marginRight: 6,
        marginBottom: 6,
        borderColor: tint(col, 0.45),
        backgroundColor: tint(col, 0.12),
      }}
    >
      <Text style={{ color: col, fontSize: 11, fontWeight: '600' }}>{label}</Text>
    </View>
  );
}

export function Stat({ n, l, gold }: { n: string; l: string; gold?: boolean }) {
  const { c, s } = useThemedStyles();
  return (
    <View style={[s.stat, gold && { borderColor: tint(c.gold, 0.5), backgroundColor: tint(c.gold, 0.08) }]}>
      <Text style={[s.statN, gold && { color: c.gold }]}>{n}</Text>
      <Text style={s.statL}>{l}</Text>
    </View>
  );
}

/** Simple segmented control. */
export function Seg<T extends string>({
  options,
  value,
  onChange,
}: {
  options: { v: T; label: string }[];
  value: T;
  onChange: (v: T) => void;
}) {
  const { c, s } = useThemedStyles();
  return (
    <View style={s.seg}>
      {options.map((o) => (
        <Pressable
          key={o.v}
          onPress={() => onChange(o.v)}
          style={[s.segBtn, value === o.v && s.segBtnActive]}
        >
          <Text
            style={{
              color: value === o.v ? c.onAccent : c.muted,
              fontSize: 12,
              fontWeight: value === o.v ? '700' : '600',
            }}
          >
            {o.label}
          </Text>
        </Pressable>
      ))}
    </View>
  );
}

function makeStyles(t: Theme) {
  const c = t.c;
  return StyleSheet.create({
    card: {
      backgroundColor: c.panel,
      borderColor: c.line,
      borderWidth: StyleSheet.hairlineWidth,
      borderRadius: RADIUS.card,
      padding: 16,
      marginBottom: 12,
      ...t.shadow,
    },
    h2: { color: c.txt, fontSize: 16, fontWeight: '700', letterSpacing: 0.2, marginBottom: 8 },
    p: { color: c.txt, fontSize: 13.5, lineHeight: 20, marginBottom: 8 },
    muted: { color: c.muted, fontSize: 12.5, lineHeight: 18 },
    btn: {
      backgroundColor: c.panel2,
      borderColor: c.line,
      borderWidth: 1,
      borderRadius: RADIUS.control,
      paddingVertical: 12,
      paddingHorizontal: 14,
      alignItems: 'center',
    },
    btnPrimary: { backgroundColor: c.accent, borderColor: c.accent },
    btnDanger: { borderColor: tint(c.bad, 0.45), backgroundColor: tint(c.bad, 0.08) },
    btnCorrect: { backgroundColor: tint(c.good, 0.16), borderColor: c.good },
    btnWrong: { backgroundColor: tint(c.bad, 0.14), borderColor: c.bad },
    btnTxt: { color: c.txt, fontSize: 13.5, fontWeight: '600' },
    stat: {
      backgroundColor: c.panel2,
      borderColor: c.line,
      borderWidth: 1,
      borderRadius: RADIUS.control,
      paddingVertical: 6,
      paddingHorizontal: 12,
      alignItems: 'center',
      minWidth: 60,
    },
    statN: { color: c.txt, fontSize: 17, fontWeight: '800', letterSpacing: 0.3 },
    statL: { color: c.muted, fontSize: 9, textTransform: 'uppercase', letterSpacing: 0.7, marginTop: 1 },
    seg: {
      flexDirection: 'row',
      backgroundColor: c.inset,
      borderRadius: RADIUS.control,
      borderWidth: 1,
      borderColor: c.line,
      padding: 3,
      gap: 3,
    },
    segBtn: {
      flex: 1,
      paddingVertical: 8,
      alignItems: 'center',
      borderRadius: RADIUS.control - 4,
    },
    segBtnActive: { backgroundColor: c.accent },
  });
}
