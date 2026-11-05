// Writing output files

import { writeFileSync } from "node:fs";
import type { Output } from "../types/index.js";

/** Write final output to JSON file */
export function writeOutput(outputPath: string, output: Output): void {
  writeFileSync(outputPath, JSON.stringify(output, null, 2), "utf-8");
}
