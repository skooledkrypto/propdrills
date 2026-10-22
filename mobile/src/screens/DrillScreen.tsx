import { useCallback, useEffect, useRef, useState } from 'react';
import { ScrollView, Text, View } from 'react-native';
import {
  PATTERNS,
  PATTERN_ORDER,
  TRIGGERS,
  dueCount,
  nextPattern,
  type DrillInstance,
  type PatternId,
} from '../core';
import { getDrill } from '../data';
import { useApp } from '../store';
import { SvgCandleChart } from '../chart/SvgCandleChart';
import { Btn, Card, Muted, Seg, Stat } from '../ui';
import { useTheme } from '../theme';

type Source = 'synthetic' | 'real';

export function DrillScreen() {
  const { cfg, progress, answer, sessionSeen, sessionCorrect, streak, best } = useApp();
  const { c: C } = useTheme();
  const [source, setSource] = useState<Source>('synthetic');
  const [focus, setFocus] = useState<PatternId | 'all'>('all');
  const [difficulty, setDifficulty] = useState<'easy' | 'hard'>('hard');
  const [inst, setInst] = useState<DrillInstance | null>(null);
  const [picked, setPicked] = useState<PatternId | null>(null);
  const [loading, setLoading] = useState(false);
  const recent = useRef<Set<string>>(new Set());
  const seq = useRef(0);

  const due = dueCount(progress, Date.now());

  const next = useCallback(async () => {
    const mySeq = ++seq.current;
    setPicked(null);
    setLoading(true);
    const patternId = nextPattern(progress, Date.now(), {
      noSetupRate: cfg.noSetupRate,
      focus: focus === 'all' ? null : focus,
    });
    const d = await getDrill(patternId, source, cfg, difficulty, recent.current);
    if (mySeq !== seq.current) return;
    recent.current.add(d.id);
    if (recent.current.size > 12) recent.current.delete(recent.current.values().next().value as string);
    setInst(d);
    setLoading(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cfg, focus, source, difficulty, progress]);

  useEffect(() => {
    void next();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focus, source, difficulty]);

  const answered = picked !== null;
  const info = inst ? PATTERNS[inst.patternId] : null;
  const correct = inst !== null && picked === inst.patternId;

  const options: PatternId[] = focus === 'all' ? PATTERN_ORDER : ([focus, 'no'] as PatternId[]);

  const pick = (id: PatternId) => {
    if (!inst || answered) return;
    setPicked(id);
    answer({
      patternId: inst.patternId,
      correct: id === inst.patternId,
      mode: 'drill',
      source: inst.source,
      realizedMove: inst.source === 'real' ? inst.realizedMove : undefined,
    });
  };

  return (
    <ScrollView contentContainerStyle={{ padding: 12, paddingBottom: 30 }}>
      <Card>
        <Seg
          options={[
            { v: 'synthetic', label: 'Fundamentals' },
            { v: 'real', label: 'Realistic (generated)' },
          ]}
          value={source}
          onChange={(v) => setSource(v)}
        />
        <View style={{ height: 8 }} />
        <ScrollView horizontal showsHorizontalScrollIndicator={false}>
          <View style={{ flexDirection: 'row', gap: 6 }}>
            <Btn label="All" kind={focus === 'all' ? 'primary' : 'ghost'} onPress={() => setFocus('all')} style={{ paddingVertical: 7 }} />
            {TRIGGERS.map((id) => (
              <Btn
                key={id}
                label={PATTERNS[id].short}
                kind={focus === id ? 'primary' : 'ghost'}
                onPress={() => setFocus(id)}
                style={{ paddingVertical: 7 }}
              />
            ))}
          </View>
        </ScrollView>
        {source === 'synthetic' && (
          <>
            <View style={{ height: 8 }} />
            <Seg
              options={[
                { v: 'easy', label: 'Easy' },
                { v: 'hard', label: 'Realistic noise' },
              ]}
              value={difficulty}
              onChange={(v) => setDifficulty(v)}
            />
          </>
        )}
        <View style={{ flexDirection: 'row', gap: 6, marginTop: 10, flexWrap: 'wrap' }}>
          <Stat n={String(sessionSeen)} l="Seen" />
          <Stat n={sessionSeen ? `${Math.round((100 * sessionCorrect) / sessionSeen)}%` : '—'} l="Accuracy" />
          <Stat n={String(streak)} l="Streak" />
          <Stat n={String(best)} l="Best" />
          <Stat n={String(due)} l="Due today" gold />
        </View>
      </Card>

      <Card>
        {inst && !loading ? (
          <>
            <SvgCandleChart
              bars={inst.bars}
              outcome={answered ? inst.outcomeBars : []}
              levels={inst.levelSet.levels}
              clusters={inst.levelSet.clusters}
              vwapSeries={inst.levelSet.vwapSeries}
              marker={answered ? { bias: inst.bias } : null}
              showTime={inst.source === 'real'}
              height={300}
            />
            <Muted style={{ marginTop: 6, marginBottom: 10 }}>
              {inst.source === 'real'
                ? 'MNQ-like generated 1-min bars, auto-computed levels. Judge the right edge.'
                : 'Judge only what price is doing at the drawn level, at the right edge.'}
            </Muted>
            <Text style={{ color: C.txt, fontWeight: '600', fontSize: 14, marginBottom: 8 }}>
              What is price doing at the level?
            </Text>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
              {options.map((id) => (
                <Btn
                  key={id}
                  label={PATTERNS[id].short}
                  disabled={answered}
                  kind={answered && id === inst.patternId ? 'correct' : answered && id === picked ? 'wrong' : 'ghost'}
                  onPress={() => pick(id)}
                  style={{ flexBasis: '48%', flexGrow: 1 }}
                />
              ))}
            </View>

            {answered && info && (
              <View
                style={{
                  marginTop: 14,
                  backgroundColor: C.panel2,
                  borderColor: C.line,
                  borderWidth: 1,
                  borderRadius: 10,
                  padding: 12,
                }}
              >
                <Text style={{ color: correct ? C.good : C.bad, fontWeight: '700', fontSize: 14, marginBottom: 6 }}>
                  {correct ? '✓ Correct — ' : '✗ Not quite — '}
                  {info.name}
                  {inst.levelHit ? ` at ${inst.levelHit.label}` : ''}
                  {inst.confluent ? ' (★ confluence)' : ''}
                  {inst.patternId !== 'no' ? ` · ${inst.bias === 'long' ? 'long' : 'short'}` : ''}
                </Text>
                <Muted>
                  {info.look} Trap: {info.trap}
                </Muted>
                <Muted style={{ marginTop: 6 }}>
                  {inst.source === 'real'
                    ? inst.patternId === 'no'
                      ? 'No trade — staying flat was the win. The faded candles are what happened next.'
                      : `Faded candles = the actual next ${inst.outcomeBars.length} minutes: ${
                          (inst.realizedMove ?? 0) >= 0 ? '+' : ''
                        }${(inst.realizedMove ?? 0).toFixed(1)} pts ${
                          (inst.realizedMove ?? 0) >= 0 ? 'with' : 'against'
                        } the setup. Setups fail often — the edge is location + stops across many trades.`
                    : inst.patternId === 'no'
                      ? 'No trade — the correct move was to stay flat.'
                      : `One illustrative resolution ${inst.bias === 'long' ? 'upward' : 'downward'}. Real setups fail often.`}
                </Muted>
                <View style={{ marginTop: 10 }}>
                  <Btn label="Next chart →" kind="primary" onPress={() => void next()} />
                </View>
              </View>
            )}
          </>
        ) : (
          <Muted>Preparing drill… {source === 'real' ? 'first Realistic drill scans the dataset (a few seconds).' : ''}</Muted>
        )}
      </Card>
    </ScrollView>
  );
}
