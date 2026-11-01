import {
  runCouncilRound,
  runCouncilUntilPass,
  shouldEscalate,
  allCouncilPass,
  computeProbeStats,
  PASS_THRESHOLD,
  DEFAULT_ESCALATION_THRESHOLD,
} from '../utils/uiCouncil';

describe('uiCouncil', () => {
  it('shouldEscalate respects threshold', () => {
    expect(shouldEscalate(7)).toBe(true);
    expect(shouldEscalate(6)).toBe(false);
    expect(shouldEscalate(7, 8)).toBe(false);
  });

  it('allCouncilPass requires all three members', () => {
    expect(allCouncilPass({ sol: 9, opus: 9, muse: 9 })).toBe(true);
    expect(allCouncilPass({ sol: 9, opus: 9 })).toBe(false);
    expect(allCouncilPass({ sol: 9, opus: 9, muse: 8 })).toBe(false);
  });

  it('cost-control: sol first, no escalation when sol below threshold', async () => {
    const calls: string[] = [];
    const scorer = async (model: string) => {
      calls.push(model);
      return model === 'sol' ? 5 : 9;
    };
    const round = await runCouncilRound('shot.png', scorer as any, 1);
    expect(calls[0]).toBe('sol');
    expect(round.escalated).toEqual(['sol']);
    expect(round.scores.opus).toBeUndefined();
    expect(round.scores.muse).toBeUndefined();
    expect(round.allCouncilPass).toBe(false);
  });

  it('escalates sol -> opus -> muse when scores clear threshold', async () => {
    const scorer = async () => 9;
    const round = await runCouncilRound('shot.png', scorer as any, 1);
    expect(round.escalated).toEqual(['sol', 'opus', 'muse']);
    expect(round.scores).toEqual({ sol: 9, opus: 9, muse: 9 });
    expect(round.allCouncilPass).toBe(true);
  });

  it('escalates to opus but not muse when opus below threshold', async () => {
    const scorer = async (model: string) => (model === 'opus' ? 5 : 9);
    const round = await runCouncilRound('shot.png', scorer as any, 1);
    expect(round.escalated).toEqual(['sol', 'opus']);
    expect(round.scores.muse).toBeUndefined();
  });

  it('jester score logged but ignored', async () => {
    const scorer = async (model: string) => (model === 'jester' ? 2 : 9);
    const round = await runCouncilRound('shot.png', scorer as any, 1);
    expect(round.jester).toEqual({ score: 2, ignored: true });
    expect(round.allCouncilPass).toBe(true);
  });

  it('non-determinism probe stats', () => {
    const probe = computeProbeStats('sol', [8, 8, 10]);
    expect(probe.samples).toEqual([8, 8, 10]);
    expect(probe.min).toBe(8);
    expect(probe.max).toBe(10);
    expect(probe.spread).toBe(2);
    expect(probe.stdDev).toBeGreaterThan(0);
  });

  it('zero spread when deterministic', () => {
    const probe = computeProbeStats('sol', [9, 9, 9]);
    expect(probe.spread).toBe(0);
    expect(probe.stdDev).toBe(0);
  });

  it('output shape', async () => {
    const scorer = async () => 9;
    const round = await runCouncilRound('shot.png', scorer as any, 2);
    expect(round.round).toBe(2);
    expect(round.screenshotPath).toBe('shot.png');
    expect(typeof round.timestamp).toBe('string');
    expect(round.thresholds.pass).toBe(PASS_THRESHOLD);
    expect(round.thresholds.escalation).toBe(DEFAULT_ESCALATION_THRESHOLD);
    expect(round.nonDeterminism.samples.length).toBe(3);
    expect(Array.isArray(round.escalated)).toBe(true);
  });

  it('runCouncilUntilPass stops early when passing', async () => {
    const scorer = async () => 9;
    const rounds = await runCouncilUntilPass('shot.png', scorer as any, { maxRounds: 5 });
    expect(rounds.length).toBe(1);
  });

  it('runCouncilUntilPass runs to maxRounds when never passing', async () => {
    const scorer = async () => 5;
    const rounds = await runCouncilUntilPass('shot.png', scorer as any, { maxRounds: 3 });
    expect(rounds.length).toBe(3);
    rounds.forEach((r) => expect(r.allCouncilPass).toBe(false));
  });
});
