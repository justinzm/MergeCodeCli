"use strict";

const fs = require("node:fs");
const path = require("node:path");

function getExistingSkillSlugs(skillsRoot) {
  if (!fs.existsSync(skillsRoot)) return new Set();
  const entries = fs.readdirSync(skillsRoot, { withFileTypes: true });
  const slugs = entries
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name);
  return new Set(slugs);
}

function classifyCandidate(candidate, existingSkillSlugs) {
  const exists = existingSkillSlugs.has(candidate.slug);
  return {
    ...candidate,
    writeMode: exists ? "update" : "create"
  };
}

function classifyCandidates(candidates, skillsRoot) {
  const existing = getExistingSkillSlugs(skillsRoot);
  return candidates.map((item) => classifyCandidate(item, existing));
}

module.exports = {
  classifyCandidates
};

