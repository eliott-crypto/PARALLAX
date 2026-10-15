import type { ThemeBoard } from '../../shared/boards';
import type { Evidence } from '../../shared/types';

export const UNIVERSE_COLORS = ['#7ddbd0', '#bca5ff', '#85bfff', '#f0c58b', '#f29cbb'];
const CONFIDENCE_HEIGHT = { HIGH: 0.72, MEDIUM: 0.23, LOW: -0.28, INSUFFICIENT: -0.7 };
const INDEPENDENT_TYPES = new Set<Evidence['type']>([
  'INDEPENDENT_REPORT',
  'RESEARCH_PUBLICATION',
  'PUBLIC_PROFESSIONAL_RECORD',
]);

/** The two axes use admitted evidence and actual agent assessments, never projected returns. */
export function deriveUniverseNodes(boards: ThemeBoard[], filter = 'all', independentOnly = false) {
  // Even angular spacing is layout only. Stable identities keep the same direction
  // when the evidence lens changes or the user manually reorders a shortlist.
  const identities = [
    ...new Set(
      boards
        .filter((board) => filter === 'all' || board.id === filter)
        .flatMap((board) =>
          board.candidates.map((candidate) => `${board.id}:${candidate.company.id}`),
        ),
    ),
  ].sort();
  const angles = new Map(
    identities.map((identity, index) => [
      identity,
      (index / Math.max(identities.length, 1)) * Math.PI * 2,
    ]),
  );
  return boards.flatMap((board, boardIndex) => {
    if (filter !== 'all' && board.id !== filter) return [];
    return board.candidates.map((candidate) => {
      const evidenceIds = [
        ...new Set([
          ...candidate.evidenceIds,
          ...candidate.valuation.evidenceIds,
          ...(candidate.latestReview?.evidenceIds || []),
        ]),
      ];
      const sources = [
        ...new Map(board.evidence.map((source) => [source.id, source])).values(),
      ].filter((source) => evidenceIds.includes(source.id));
      const supported = sources.filter((source) => source.status === 'SUPPORTED');
      const independent = supported.filter((source) => INDEPENDENT_TYPES.has(source.type));
      const remaining = independentOnly ? independent.length : supported.length;
      const denominator = Math.max(evidenceIds.length, 1);
      const supportShare = remaining / denominator;
      const allShare = supported.length / denominator;
      const angle = angles.get(`${board.id}:${candidate.company.id}`) ?? 0;
      const radius = 104 + (1 - supportShare) * 145;
      const confidence = candidate.latestReview?.confidence || candidate.confidence;
      return {
        key: `${board.id}:${candidate.company.id}`,
        board,
        candidate,
        sources,
        supported,
        independent,
        remaining,
        evidenceCount: evidenceIds.length,
        supportShare,
        allShare,
        angle,
        radius,
        confidence,
        color: UNIVERSE_COLORS[boardIndex % UNIVERSE_COLORS.length],
        point: {
          x: Math.cos(angle) * radius,
          y: -CONFIDENCE_HEIGHT[confidence] * 170,
          z: Math.sin(angle) * radius,
        },
      };
    });
  });
}
