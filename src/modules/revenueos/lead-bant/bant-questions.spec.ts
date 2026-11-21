import { readFileSync } from 'fs';
import { join } from 'path';

import {
  BANT_KEYS,
  BANT_QUESTIONS,
  bantGrade,
  bantMissing,
  bantRequiredMessage,
  bantScore,
  isBantComplete,
} from './bant-questions';

describe('BANT questions and scoring', () => {
  it('has one question per letter, in B-A-N-T order', () => {
    expect(BANT_QUESTIONS.map((q) => q.letter).join('')).toBe('BANT');
    expect(BANT_QUESTIONS.map((q) => q.key)).toEqual([...BANT_KEYS]);
  });

  it('every question tops out at 25 points, so a perfect BANT is exactly 100', () => {
    for (const q of BANT_QUESTIONS)
      expect(Math.max(...q.options.map((o) => o.points))).toBe(25);
    const best = Object.fromEntries(
      BANT_QUESTIONS.map((q) => [q.key, q.options[0].value]),
    );
    expect(bantScore(best)).toBe(100);
  });

  it('the worst answers score 0, and an unanswered question counts 0', () => {
    const worst = Object.fromEntries(
      BANT_QUESTIONS.map((q) => [q.key, q.options[q.options.length - 1].value]),
    );
    expect(bantScore(worst)).toBe(0);
    expect(bantScore({})).toBe(0);
    expect(bantScore({ budget: 'CONFIRMED' })).toBe(25);
  });

  it('a value that is not one of the options scores nothing', () => {
    expect(bantScore({ budget: 'LOTS' })).toBe(0);
  });

  it('a typical lead: rough budget, influencer, defined need, within 3 months = 63, Warm', () => {
    const score = bantScore({
      budget: 'INDICATIVE',
      authority: 'INFLUENCER',
      need: 'DEFINED',
      timeline: 'WITHIN_3_MONTHS',
    });
    expect(score).toBe(63);
    expect(bantGrade(score)).toBe('WARM');
  });

  it('grades: 75 and up Hot, 50 to 74 Warm, below 50 Cold', () => {
    expect([100, 75, 74, 50, 49, 0].map(bantGrade)).toEqual([
      'HOT',
      'HOT',
      'WARM',
      'WARM',
      'COLD',
      'COLD',
    ]);
  });

  it('complete only when all four are answered', () => {
    expect(isBantComplete(null)).toBe(false);
    expect(
      isBantComplete({ budget: 'NONE', authority: 'UNKNOWN', need: 'NONE' }),
    ).toBe(false);
    expect(
      isBantComplete({
        budget: 'NONE',
        authority: 'UNKNOWN',
        need: 'NONE',
        timeline: 'LATER',
      }),
    ).toBe(true);
  });

  it('names what is still to answer, in order', () => {
    expect(bantMissing({ authority: 'INFLUENCER' })).toEqual([
      'Budget',
      'Need',
      'Timeline',
    ]);
    expect(bantRequiredMessage(null)).toMatch(
      /Still to answer: Budget, Authority, Need, Timeline\.$/,
    );
  });

  it('the database CHECK constraints allow exactly the option values defined here', () => {
    const sql = readFileSync(
      join(
        __dirname,
        '../../../../prisma/manual-migrations/20261121_lead_bant.sql',
      ),
      'utf8',
    );
    for (const q of BANT_QUESTIONS) {
      const check = new RegExp(
        `"LeadBant_${q.key}_check"\\s+CHECK \\("${q.key}" IS NULL OR "${q.key}" IN \\(([^)]*)\\)\\)`,
      );
      const m = sql.match(check);
      expect(m).not.toBeNull();
      const inSql = m![1].split(',').map((v) => v.trim().replace(/'/g, ''));
      expect(inSql).toEqual(q.options.map((o) => o.value));
    }
  });
});
