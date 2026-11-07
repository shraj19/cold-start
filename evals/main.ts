import { runEvalite } from "evalite/runner";

await runEvalite({
  cwd: import.meta.dirname,
  mode: "run-once-and-exit",
  showTable: true,
});
