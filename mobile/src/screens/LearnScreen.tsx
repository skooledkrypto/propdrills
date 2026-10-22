import { useMemo, useState } from 'react';
import { ScrollView, Text, View } from 'react-native';
import { PATTERNS, PATTERN_ORDER, mulberry32, synthDrill, type PatternId } from '../core';
import { SvgCandleChart } from '../chart/SvgCandleChart';
import { Btn, Card, Chip, H2, Muted, P } from '../ui';
import { useTheme } from '../theme';
import { ProUpsellCard } from './ProUpsell';

type LearnId = PatternId | 'key-levels' | 'key-terms';

/** Plain-English trading glossary, grouped the way a newcomer meets the terms. */
const TERM_GROUPS: { title: string; terms: [string, string][] }[] = [
  {
    title: 'The instrument',
    terms: [
      ['MNQ', 'Micro E-mini Nasdaq-100 futures — the contract this app trains on. Trades nearly 23h a day on CME.'],
      ['Contract', 'The unit you buy or sell. Trading "2 MNQ" means two contracts, doubling every $ move.'],
      ['Point & tick', 'MNQ moves in 0.25-point ticks. One full point = $2 per contract, so a 10-pt move on 2 contracts = $40.'],
      ['Long / Short', 'Long = buy first, profit if price rises. Short = sell first, profit if price falls.'],
      ['Bid / Ask / Spread', 'Best price buyers will pay / sellers will take, and the gap between them — the built-in cost of entering instantly.'],
      ['Slippage', 'The difference between the price you expected and the price you actually got filled at.'],
      ['Volume', 'Contracts traded in a period — how much participation is behind a move.'],
    ],
  },
  {
    title: 'Sessions & clock',
    terms: [
      ['RTH', 'Regular Trading Hours, 9:30–16:00 ET — the liquid "day session" where most setups play out.'],
      ['Overnight / Globex', 'Everything from the 18:00 ET reopen until the next RTH open. Builds the overnight range (ONH/ONL).'],
      ['Settlement / prior close', "The official end-of-day price. Trading above it means the market is 'up on the day'."],
      ['Maintenance halt', 'The daily 17:00–18:00 ET pause when CME futures don\'t trade.'],
    ],
  },
  {
    title: 'Risk management',
    terms: [
      ['Stop loss', 'A resting order that closes your trade at a set loss — the price where your idea is proven wrong.'],
      ['Target', 'The price where you plan to take profit. Set both sides before entering.'],
      ['R multiple', 'Profit or loss measured in units of what you risked. Risk 10 pts, make 20 → +2R. Lets different trades compare fairly.'],
      ['Position sizing', 'Choosing how many contracts so a stop-out costs a fixed, survivable amount.'],
      ['Flat', 'Holding no position. Flat is a position — often the right one.'],
      ['Drawdown', 'How far your account has fallen from its peak.'],
      ['Trailing drawdown', "A fail-line that follows your equity peak up (never down). Give back that much from the peak and you're out."],
      ['High-water mark', 'Your account\'s best-ever equity — the peak the trailing drawdown hangs from.'],
      ['Daily loss limit', 'The most you may lose in one trading day before the evaluation fails.'],
    ],
  },
  {
    title: 'Prop-firm world',
    terms: [
      ['Prop firm', 'A company that stakes traders with its capital for a share of profits, after they prove themselves.'],
      ['Evaluation / Combine', 'The tryout: hit a profit target on a simulated account without breaking the loss rules.'],
      ['Funded account', 'What passing earns — trading the firm\'s capital under the same risk rules.'],
      ['Profit target', 'The $ gain that passes the evaluation.'],
      ['Consistency rule', 'No single day can make up too much of your total profit — you have to win a little every day, not all at once.'],
      ['Payout', 'Withdrawing your profit share from a funded account.'],
      ['Liquidation', 'The forced close of all positions when a hard rule is touched.'],
    ],
  },
  {
    title: 'Reading the tape',
    terms: [
      ['Bias', 'Your working opinion of the next move: long, short, or no-trade.'],
      ['Trend day', 'A session that picks a direction and keeps going. Pullbacks are entries, fading it is expensive.'],
      ['Chop', 'Directionless back-and-forth. Most losses come from trading chop like a trend.'],
      ['Breakout', 'Price pushing through a level with follow-through.'],
      ['Fakeout / failed break', 'A push through a level that immediately comes back — often the better trade, in reverse.'],
      ['Pullback', 'A pause against the move that lets you join the trend at a better price.'],
      ['Liquidity', 'Where resting orders cluster — stops above highs, below lows, around round numbers.'],
      ['Stop run / sweep', 'A quick spike through an obvious level that triggers the stops parked there, then often reverses.'],
      ['Confluence', 'Two or more levels stacked within a few points — reactions there carry more weight.'],
    ],
  },
  {
    title: 'Your stats',
    terms: [
      ['Win rate', 'Share of trades that made money. Meaningless alone — a 40% win rate with big winners beats 70% with big losers.'],
      ['Expectancy', 'Average $ per trade over many trades. Positive expectancy is the whole game.'],
      ['Profit factor', 'Gross wins ÷ gross losses. Above 1.5 is solid; below 1 is a leak.'],
      ['Avg R', 'Average R multiple per trade — your edge measured in risk units.'],
      ['Sample size', 'No stat means anything over 5 trades. Judge yourself over 50+.'],
    ],
  },
];

const LEVEL_ROWS = [
  ['PDH / PDL', 'Prior regular-session high & low — the most-watched prices; sweeps of them are the bread-and-butter of thin sessions.'],
  ['ONH / ONL', 'Overnight high & low since the 18:00 ET reopen — the developing range of the current session.'],
  ['Prior close', 'The "unchanged" line — price accepts or rejects the prior day here.'],
  ['Round numbers', 'Multiples of 50/100 points — psychological, and self-fulfilling.'],
  ['VWAP', "The session's average paid price — trend days ride one side of it, chop days orbit it."],
  ['Swings', 'Obvious recent pivots — secondary unless they line up with something above.'],
] as const;

export function LearnScreen() {
  const [cur, setCur] = useState<LearnId>('key-levels');
  const { c: C } = useTheme();

  const example = useMemo(() => {
    if (cur === 'key-levels' || cur === 'key-terms') return null;
    return synthDrill(cur, {
      difficulty: 'easy',
      rng: mulberry32(42 + PATTERN_ORDER.indexOf(cur)),
      allowMirror: false,
    });
  }, [cur]);

  const info = cur === 'key-levels' || cur === 'key-terms' ? null : PATTERNS[cur];

  return (
    <ScrollView contentContainerStyle={{ padding: 12, paddingBottom: 30 }}>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom: 12 }}>
        <View style={{ flexDirection: 'row', gap: 6 }}>
          <Btn
            label="📍 Key Levels"
            kind={cur === 'key-levels' ? 'primary' : 'ghost'}
            onPress={() => setCur('key-levels')}
            style={{ paddingVertical: 8 }}
          />
          <Btn
            label="📚 Key Terms"
            kind={cur === 'key-terms' ? 'primary' : 'ghost'}
            onPress={() => setCur('key-terms')}
            style={{ paddingVertical: 8 }}
          />
          {PATTERN_ORDER.map((id) => (
            <Btn
              key={id}
              label={PATTERNS[id].short}
              kind={cur === id ? 'primary' : 'ghost'}
              onPress={() => setCur(id)}
              style={{ paddingVertical: 8 }}
            />
          ))}
        </View>
      </ScrollView>

      {cur === 'key-levels' ? (
        <Card>
          <H2>Key levels — where setups are allowed to exist</H2>
          <P>
            A key level is a price where meaningful trading happened before, so price is likely to
            react there again. Treat levels as zones a few points wide. The app computes and draws
            them on every drill.
          </P>
          {LEVEL_ROWS.map(([name, why]) => (
            <View key={name} style={{ marginBottom: 8 }}>
              <Text style={{ color: C.txt, fontWeight: '700', fontSize: 13 }}>{name}</Text>
              <Muted>{why}</Muted>
            </View>
          ))}
          <View style={{ borderTopWidth: 1, borderTopColor: C.line, paddingTop: 10, marginTop: 4 }}>
            <Text style={{ color: C.accent, fontSize: 11, fontWeight: '700', letterSpacing: 0.5 }}>THE ROUTINE</Text>
            <P>
              Before each session: mark PDH, PDL, ONH, ONL and the nearest round number — then do
              nothing until price reaches one of them.
            </P>
            <Text style={{ color: C.accent, fontSize: 11, fontWeight: '700', letterSpacing: 0.5 }}>CONFLUENCE</Text>
            <P>
              Two or more references within ~15 points cluster into a stronger zone — charts mark
              these with a gold ★ line. Prefer setups there. Train the eye in the Levels tab.
            </P>
          </View>
        </Card>
      ) : cur === 'key-terms' ? (
        <Card>
          <H2>Key terms — the language of the trade</H2>
          <P>
            Every term the app (or any trading desk) throws around, in plain English. Skim once now,
            come back whenever something reads like jargon.
          </P>
          {TERM_GROUPS.map((g) => (
            <View key={g.title} style={{ marginBottom: 4 }}>
              <Text
                style={{
                  color: C.accent,
                  fontSize: 11,
                  fontWeight: '700',
                  letterSpacing: 0.6,
                  textTransform: 'uppercase',
                  marginTop: 10,
                  marginBottom: 6,
                }}
              >
                {g.title}
              </Text>
              {g.terms.map(([name, def]) => (
                <View key={name} style={{ marginBottom: 8 }}>
                  <Text style={{ color: C.txt, fontWeight: '700', fontSize: 13 }}>{name}</Text>
                  <Muted>{def}</Muted>
                </View>
              ))}
            </View>
          ))}
        </Card>
      ) : info && example ? (
        <Card>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', marginBottom: 8 }}>
            <H2>{info.name}</H2>
          </View>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', marginBottom: 8 }}>
            <Chip label={info.cat} color={C.gold} />
            {cur !== 'no' && <Chip label="bullish shown — flip for bearish" />}
          </View>
          <SvgCandleChart
            bars={example.bars}
            levels={example.levelSet.levels}
            marker={{ bias: example.bias }}
            height={260}
          />
          <View style={{ marginTop: 10 }}>
            {(
              [
                ['WHAT IT IS', info.def],
                ['WHY IT WORKS', info.why],
                ['WHAT TO LOOK FOR', info.look],
                ['COMMON TRAP', info.trap],
                ...(info.evidence ? ([['EVIDENCE NOTE', info.evidence]] as const) : []),
              ] as const
            ).map(([lab, txt]) => (
              <View key={lab} style={{ marginBottom: 8 }}>
                <Text style={{ color: C.muted, fontSize: 10.5, fontWeight: '700', letterSpacing: 0.6 }}>{lab}</Text>
                <Text style={{ color: C.txt, fontSize: 13, lineHeight: 19 }}>{txt}</Text>
              </View>
            ))}
          </View>
          <View style={{ flexDirection: 'row', gap: 8 }}>
            {(
              [
                ['ENTRY', info.entry],
                ['STOP', info.stop],
                ['TARGET', info.target],
              ] as const
            ).map(([lab, txt]) => (
              <View
                key={lab}
                style={{ flex: 1, backgroundColor: C.panel2, borderColor: C.line, borderWidth: 1, borderRadius: 8, padding: 8 }}
              >
                <Text style={{ color: C.accent, fontSize: 9.5, fontWeight: '700', letterSpacing: 0.5 }}>{lab}</Text>
                <Text style={{ color: C.txt, fontSize: 11.5 }}>{txt}</Text>
              </View>
            ))}
          </View>
        </Card>
      ) : null}

      <Card>
        <Muted>
          Work one pattern at a time: read it here, then drill it in focus mode until accuracy is
          consistently high. "No Setup" reps matter as much as the others — most of the tape is
          nothing, and learning to pass is a real skill.
        </Muted>
      </Card>

      <ProUpsellCard />
    </ScrollView>
  );
}
