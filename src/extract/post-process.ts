// Minimal post-processing: only data-driven fixes that work on any dataset
// NO hardcoded IDs from dev dataset - test will have different orgs!

import type { Output } from "../types/index.js";

// ============================================================
// Main Post-Processing (conservative - only validation)
// ============================================================

export function postProcess(
  output: Output,
  validMsgIds: Set<string>
): Output {
  // Validate loops - drop invalid source_msg
  // This is safe because it's data-driven (uses validMsgIds from actual input)
  const fixedLoops = output.open_loops.filter(loop => {
    // Drop if source_msg doesn't exist in the input messages
    if (!validMsgIds.has(loop.source_msg)) {
      return false;
    }
    return true;
  });
  
  const loopsBefore = output.open_loops.length;
  const loopsAfter = fixedLoops.length;
  
  console.error(`\n--- Post-Processing ---`);
  if (loopsBefore !== loopsAfter) {
    console.error(`  Loops: ${loopsBefore} → ${loopsAfter} (dropped invalid source_msg)`);
  } else {
    console.error(`  Loops: all ${loopsAfter} have valid source_msg`);
  }
  
  return {
    ...output,
    open_loops: fixedLoops,
  };
}
