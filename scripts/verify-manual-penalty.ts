// ─── Manual Penalty Regression Test ────────────────────
// Verifies the manual penalty resolution (level-derived cooldown + custom
// timer) used by the admin "Penalty" button.
//
// Run: npx tsx scripts/verify-manual-penalty.ts

import { resolveManualPenalty } from "../src/engine/manual-penalty";

let passed = 0;
let failed = 0;

function assert(cond: boolean, label: string) {
  if (cond) {
    passed++;
    console.log(`  ✓ ${label}`);
  } else {
    failed++;
    console.error(`  ✗ ${label}`);
  }
}

const settings = { baseCooldown: 600, multiplier: 3, maxCooldown: 21600 };

void (async () => {
  console.log("verify-manual-penalty\n");

  // Level 1 → base cooldown
  const lv1 = resolveManualPenalty({ level: 1 }, settings);
  assert(lv1.cooldownSeconds === 600, "level 1 → 600s (base)");
  assert(lv1.penaltyLevel === 1, "level 1 reported");
  assert(lv1.penaltyType === "VARIABLE", "level → VARIABLE penalty");

  // Level 2 → base × multiplier
  const lv2 = resolveManualPenalty({ level: 2 }, settings);
  assert(lv2.cooldownSeconds === 1800, "level 2 → 1800s (base×3)");
  assert(lv2.penaltyLevel === 2, "level 2 reported");

  // High level capped at maxCooldown
  const lv10 = resolveManualPenalty({ level: 10 }, settings);
  assert(lv10.cooldownSeconds === 21600, "level 10 → capped at 21600 (max)");

  // Custom timer overrides level
  const custom = resolveManualPenalty({ level: 1, cooldownSeconds: 3600 }, settings);
  assert(custom.cooldownSeconds === 3600, "custom timer overrides level (3600s)");
  assert(custom.penaltyLevel === 1, "custom keeps provided level");

  // Custom timer min clamp
  const tiny = resolveManualPenalty({ cooldownSeconds: 2 }, settings);
  assert(tiny.cooldownSeconds === 10, "custom cooldown clamped to min 10s");

  // No input → defaults to level 1
  const def = resolveManualPenalty({}, settings);
  assert(def.penaltyLevel === 1 && def.cooldownSeconds === 600, "defaults to level 1 / base");

  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed === 0 ? 0 : 1);
})();
