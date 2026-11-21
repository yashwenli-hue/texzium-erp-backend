// BANT: Budget, Authority, Need, Timeline. Pre-Sales answers one question per
// letter about a lead; each answer is worth points, and the four add up to a score
// out of 100. A lead is qualified and handed to Sales only once all four are
// answered (LeadAssignmentsService.qualifyLead). The questions, their options and
// points live here only; the API returns them so the frontend never keeps its own copy.

export const BANT_KEYS = ['budget', 'authority', 'need', 'timeline'] as const;
export type BantKey = (typeof BANT_KEYS)[number];

export interface BantOption {
  value: string;
  label: string;
  points: number;
}

export interface BantQuestion {
  key: BantKey;
  letter: 'B' | 'A' | 'N' | 'T';
  title: string;
  question: string;
  options: readonly BantOption[];
}

export const BANT_QUESTIONS: readonly BantQuestion[] = [
  {
    key: 'budget',
    letter: 'B',
    title: 'Budget',
    question: 'Has the customer set aside a budget for this purchase?',
    options: [
      { value: 'CONFIRMED', label: 'Yes, budget approved', points: 25 },
      {
        value: 'INDICATIVE',
        label: 'A rough range, not yet approved',
        points: 15,
      },
      { value: 'UNKNOWN', label: 'Not discussed yet', points: 5 },
      { value: 'NONE', label: 'No budget', points: 0 },
    ],
  },
  {
    key: 'authority',
    letter: 'A',
    title: 'Authority',
    question: 'Who are we talking to?',
    options: [
      { value: 'DECISION_MAKER', label: 'The person who decides', points: 25 },
      {
        value: 'INFLUENCER',
        label: 'Someone who recommends to the decision maker',
        points: 15,
      },
      {
        value: 'USER_ONLY',
        label: 'A user with no say in the purchase',
        points: 5,
      },
      { value: 'UNKNOWN', label: 'Not known yet', points: 0 },
    ],
  },
  {
    key: 'need',
    letter: 'N',
    title: 'Need',
    question: 'How clear is the requirement?',
    options: [
      { value: 'URGENT', label: 'Clear requirement, needed now', points: 25 },
      { value: 'DEFINED', label: 'Clear requirement, not urgent', points: 15 },
      { value: 'EXPLORING', label: 'Still exploring options', points: 5 },
      { value: 'NONE', label: 'No real need', points: 0 },
    ],
  },
  {
    key: 'timeline',
    letter: 'T',
    title: 'Timeline',
    question: 'When do they plan to buy?',
    options: [
      { value: 'WITHIN_1_MONTH', label: 'Within a month', points: 25 },
      { value: 'WITHIN_3_MONTHS', label: 'Within 3 months', points: 18 },
      { value: 'WITHIN_6_MONTHS', label: 'Within 6 months', points: 10 },
      { value: 'LATER', label: 'Later, or no date yet', points: 0 },
    ],
  },
];

export const BANT_OPTION_VALUES = Object.fromEntries(
  BANT_QUESTIONS.map((q) => [q.key, q.options.map((o) => o.value)]),
) as unknown as Record<BantKey, readonly string[]>;

export type BantAnswers = Partial<Record<BantKey, string | null>>;

/** Hot, warm or cold, from the score of a complete BANT. */
export type BantGrade = 'HOT' | 'WARM' | 'COLD';
export const BANT_HOT_FROM = 75;
export const BANT_WARM_FROM = 50;

export function bantScore(answers: BantAnswers): number {
  return BANT_QUESTIONS.reduce((sum, q) => {
    const chosen = q.options.find((o) => o.value === answers[q.key]);
    return sum + (chosen?.points ?? 0);
  }, 0);
}

export function isBantComplete(
  answers: BantAnswers | null | undefined,
): boolean {
  return !!answers && BANT_KEYS.every((k) => !!answers[k]);
}

export function bantGrade(score: number): BantGrade {
  return score >= BANT_HOT_FROM
    ? 'HOT'
    : score >= BANT_WARM_FROM
      ? 'WARM'
      : 'COLD';
}

export const BANT_GRADE_LABEL: Record<BantGrade, string> = {
  HOT: 'Hot',
  WARM: 'Warm',
  COLD: 'Cold',
};

export function bantMissing(answers: BantAnswers | null | undefined): string[] {
  return BANT_QUESTIONS.filter((q) => !answers?.[q.key]).map((q) => q.title);
}

export const BANT_REQUIRED_MESSAGE =
  'Complete the BANT analysis (Budget, Authority, Need, Timeline) before qualifying this lead and handing it to Sales.';

export function bantRequiredMessage(
  answers: BantAnswers | null | undefined,
): string {
  const missing = bantMissing(answers);
  return missing.length
    ? `${BANT_REQUIRED_MESSAGE} Still to answer: ${missing.join(', ')}.`
    : BANT_REQUIRED_MESSAGE;
}
