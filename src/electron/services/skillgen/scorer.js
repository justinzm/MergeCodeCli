"use strict";

function clamp01(value) {
  return Math.max(0, Math.min(1, value));
}

function scoreCandidate(candidate) {
  const sessionCount = Array.isArray(candidate.sessionIds) ? candidate.sessionIds.length : 0;
  const evidenceCount = Array.isArray(candidate.evidence) ? candidate.evidence.length : 0;
  const commandCount = Array.isArray(candidate.commands) ? candidate.commands.length : 0;

  const reusability = clamp01(sessionCount > 0 ? 0.45 + ((sessionCount - 1) * 0.2) : 0);
  const successEvidence = clamp01(evidenceCount / 2);
  const clarity = clamp01(commandCount > 0 ? 0.9 : 0.2);
  const stability = clamp01((sessionCount + evidenceCount) / 4);
  const difference = 0.8;

  const score = (
    0.30 * reusability
    + 0.25 * successEvidence
    + 0.20 * clarity
    + 0.15 * stability
    + 0.10 * difference
  );

  let status = "discarded";
  if (score >= 0.60) status = "accepted";
  else if (score >= 0.45) status = "draft";

  return {
    ...candidate,
    score: Number(score.toFixed(2)),
    status
  };
}

module.exports = {
  scoreCandidate
};
