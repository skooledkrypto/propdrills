import { useCallback, useEffect, useRef, useState } from 'react';
import { ScrollView, Text, View } from 'react-native';
import {
  PATTERNS,
  PATTERN_ORDER,
  nearestLevel,
  nextPattern,
  type DrillInstance,
} from '../core';
import { getDrill } from '../data';
import { useApp } from '../store';
import { SvgCandleChart } from '../chart/SvgCandleChart';
import { Btn, Card, H2, Muted } from '../ui';
import { useTheme, type Palette } from '../theme';

type StepId = 'location' | 'context' | 'trigger' | 'risk';

interface StepResult {
  id: StepId;
  correct: boolean;
  truth: string;
}

const STOP_OPTIONS = [
  { key: 'beyondExtreme', label: "Beyond the pattern's extreme / wick" },
  { key: 'backThroughLevel', label: 'Back through the broken level' },
  { key: 'oppositeInside', label: 'Opposite side of the inside bar' },
  { key: 'none', label: 'No stop needed if the level is strong' },
] as const;

function structureTruth(inst: DrillInstance): 'up' | 'down' | 'sideways' {
  const closes = inst.bars.map((b) => b.c);
  const n = closes.length;
  const k = Math.max(5, Math.floor(n / 4));
  const early = closes.slice(0, k).reduce((a, b) => a + b, 0) / k;
  const late = closes.slice(n - k).reduce((a, b) => a + b, 0) / k;
  const ar = inst.bars.reduce((a, b) => a + (b.h - b.l), 0) / n;
  const diff = late - early;
  if (diff > 2.5 * ar) return 'up';
  if (diff < -2.5 * ar) return 'down';
  return 'sideways';
}

const STRUCT_LABELS = { up: 'Trending up', down: 'Trending down', sideways: 'Sideways / range' } as const;

export function FullSetupScreen() {
  const { cfg, progress, answer } = useApp();
  const { c: C } = useTheme();
  const s = makeStyles(C);
  const [inst, setInst] = useState<DrillInstance | null>(null);
  const [step, setStep] = useState<StepId>('location');
  const [results, setResults] = useState<StepResult[]>([]);
  const [pending, setPending] = useState<StepResult | null>(null);
  const [finished, setFinished] = useState(false);
  const seq = useRef(0);

  const next = useCallback(async () => {
    const mySeq = ++seq.current;
    setResults([]);
    setPending(null);
    setFinished(false);
    setStep('location');
    setInst(null);
    const patternId = nextPattern(progress, Date.now(), { noSetupRate: cfg.noSetupRate });
    const d = await getDrill(patternId, 'real', cfg, 'hard', new Set());
    if (mySeq !== seq.current) return;
    setInst(d);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cfg, progress]);

  useEffect(() => {
    void next();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (!inst) {
    return (
      <ScrollView contentContainerStyle={{ padding: 12 }}>
        <Card>
          <Muted>Loading… (first run scans the generated dataset)</Muted>
        </Card>
      </ScrollView>
    );
  }

  const lastClose = inst.bars[inst.bars.length - 1].c;
  const atLevelTruth = nearestLevel(inst.levelSet, lastClose, cfg.tol * 1.5) !== null || inst.levelHit !== null;
  const structTruth = structureTruth(inst);
  const info = PATTERNS[inst.patternId];

  const answerStep = (id: StepId, correct: boolean, truth: string) => {
    if (pending || finished) return;
    setPending({ id, correct, truth });
  };

  const advance = () => {
    if (!pending) return;
    const rs = [...results, pending];
    setResults(rs);
    setPending(null);
    const order: StepId[] = ['location', 'context', 'trigger', 'risk'];
    const idx = order.indexOf(pending.id);
    const skipRisk = inst.patternId === 'no';
    const nextStep = order[idx + 1];
    if (!nextStep || (nextStep === 'risk' && skipRisk)) {
      const triggerOk = rs.find((r) => r.id === 'trigger')?.correct ?? false;
      const riskOk = skipRisk ? true : rs.find((r) => r.id === 'risk')?.correct ?? false;
      answer({
        patternId: inst.patternId,
        correct: triggerOk && riskOk,
        mode: 'fullSetup',
        source: inst.source,
        realizedMove: inst.source === 'real' ? inst.realizedMove : undefined,
      });
      setFinished(true);
    } else {
      setStep(nextStep);
    }
  };

  const chipFor = (s: StepId, i: number) => {
    const done = results.find((r) => r.id === s);
    const skipped = s === 'risk' && inst.patternId === 'no' && finished;
    const active = s === step && !finished && !done;
    const color = done ? (done.correct ? C.good : C.bad) : active ? C.accent : C.line;
    const txtColor = done ? (done.correct ? C.good : C.bad) : active ? C.txt : C.muted;
    return (
      <View key={s} style={{ borderColor: color, borderWidth: 1, borderRadius: 20, paddingHorizontal: 10, paddingVertical: 3, backgroundColor: C.panel2 }}>
        <Text style={{ color: txtColor, fontSize: 11 }}>
          {i + 1} · {s[0].toUpperCase() + s.slice(1)}
          {done ? (done.correct ? ' ✓' : ' ✗') : skipped ? ' —' : ''}
        </Text>
      </View>
    );
  };

  return (
    <ScrollView contentContainerStyle={{ padding: 12, paddingBottom: 30 }}>
      <Card>
        <H2>Full-setup mode</H2>
        <Muted style={{ marginBottom: 10 }}>
          Grade the whole chain: location → context → trigger → risk. The closest thing to the live decision.
        </Muted>
        <SvgCandleChart
          bars={inst.bars}
          outcome={finished ? inst.outcomeBars : []}
          levels={inst.levelSet.levels}
          clusters={inst.levelSet.clusters}
          vwapSeries={inst.levelSet.vwapSeries}
          marker={finished ? { bias: inst.bias } : null}
          showTime={inst.source === 'real'}
          height={300}
        />
        <View style={{ flexDirection: 'row', gap: 6, flexWrap: 'wrap', marginVertical: 12 }}>
          {(['location', 'context', 'trigger', 'risk'] as StepId[]).map(chipFor)}
        </View>

        {!finished && !pending && step === 'location' && (
          <>
            <Text style={s.q}>1 · Is price interacting with a key level right now?</Text>
            <View style={s.optCol}>
              <Btn label="Yes — at a level" onPress={() => answerStep('location', atLevelTruth, atLevelTruth ? 'Yes' : 'No')} />
              <Btn label="No — mid-range / nowhere" onPress={() => answerStep('location', !atLevelTruth, atLevelTruth ? 'Yes' : 'No')} />
            </View>
          </>
        )}
        {!finished && !pending && step === 'context' && (
          <>
            <Text style={s.q}>2 · What is the recent structure doing?</Text>
            <View style={s.optCol}>
              {(['up', 'down', 'sideways'] as const).map((v) => (
                <Btn key={v} label={STRUCT_LABELS[v]} onPress={() => answerStep('context', v === structTruth, STRUCT_LABELS[structTruth])} />
              ))}
            </View>
          </>
        )}
        {!finished && !pending && step === 'trigger' && (
          <>
            <Text style={s.q}>3 · Is there a valid setup at the level?</Text>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
              {PATTERN_ORDER.map((id) => (
                <Btn
                  key={id}
                  label={PATTERNS[id].short}
                  onPress={() => answerStep('trigger', id === inst.patternId, PATTERNS[inst.patternId].short)}
                  style={{ flexBasis: '48%', flexGrow: 1 }}
                />
              ))}
            </View>
          </>
        )}
        {!finished && !pending && step === 'risk' && (
          <>
            <Text style={s.q}>4 · Where does the protective stop belong for a {info.short}?</Text>
            <View style={s.optCol}>
              {STOP_OPTIONS.map((o) => (
                <Btn
                  key={o.key}
                  label={o.label}
                  onPress={() =>
                    answerStep('risk', o.key === info.stopKey, STOP_OPTIONS.find((x) => x.key === info.stopKey)?.label ?? '')
                  }
                />
              ))}
            </View>
          </>
        )}

        {pending && (
          <View style={s.reveal}>
            <Text style={{ color: pending.correct ? C.good : C.bad, fontWeight: '700', fontSize: 14, marginBottom: 4 }}>
              {pending.correct ? '✓ Right.' : `✗ Not quite — answer: ${pending.truth}`}
            </Text>
            {pending.id === 'location' && (
              <Muted>
                {atLevelTruth
                  ? 'Price is inside the tolerance zone of a computed level — a setup is at least allowed to exist here.'
                  : 'No computed level within tolerance — this is the dead middle. Pass.'}
              </Muted>
            )}
            {pending.id === 'context' && <Muted>Structure over the lead-in leans {STRUCT_LABELS[structTruth].toLowerCase()}. Triggers against structure need far more proof.</Muted>}
            {pending.id === 'trigger' && (
              <Muted>
                {info.name}. {info.look}
              </Muted>
            )}
            {pending.id === 'risk' && (
              <Muted>
                Stop: {info.stop} Target: {info.target}
              </Muted>
            )}
            <View style={{ marginTop: 10 }}>
              <Btn label="Continue →" kind="primary" onPress={advance} />
            </View>
          </View>
        )}

        {finished && (
          <View style={s.reveal}>
            <Text
              style={{
                color: results.every((r) => r.correct) ? C.good : results.find((r) => r.id === 'trigger')?.correct ? C.gold : C.bad,
                fontWeight: '700',
                fontSize: 14,
                marginBottom: 4,
              }}
            >
              Chain: {results.filter((r) => r.correct).length}/{results.length} — {info.name}
              {inst.levelHit ? ` at ${inst.levelHit.label}` : ''}
              {inst.confluent ? ' (★)' : ''}
              {inst.patternId !== 'no' ? ` · ${inst.bias}` : ''}
            </Text>
            {inst.source === 'real' && inst.patternId !== 'no' && (
              <Muted>
                Actual outcome: {(inst.realizedMove ?? 0) >= 0 ? '+' : ''}
                {(inst.realizedMove ?? 0).toFixed(1)} pts over the next {inst.outcomeBars.length} minutes.
              </Muted>
            )}
            <View style={{ marginTop: 10 }}>
              <Btn label="Next setup →" kind="primary" onPress={() => void next()} />
            </View>
          </View>
        )}
      </Card>
    </ScrollView>
  );
}

function makeStyles(c: Palette) {
  return {
    q: { color: c.txt, fontWeight: '600' as const, fontSize: 14, marginBottom: 8 },
    optCol: { gap: 8 },
    reveal: {
      marginTop: 6,
      backgroundColor: c.panel2,
      borderColor: c.line,
      borderWidth: 1,
      borderRadius: 10,
      padding: 12,
    },
  };
}
