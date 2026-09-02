// Discover and run every TypeScript test file. Keeping discovery and execution
// in one process means a broken shell glob cannot turn the suite into a green
// "pass 0" run.
import { spawnSync } from "node:child_process";
import { readdirSync, statSync } from "node:fs";
import { join } from "node:path";

/** Every .test.ts under tests/, walked directly rather than through a shell. */
function testFiles(dir) {
  return readdirSync(dir).flatMap(name => {
    const full = join(dir, name);
    return statSync(full).isDirectory() ? testFiles(full)
         : full.endsWith(".test.ts") ? [full] : [];
  });
}

const MINIMUM = 20;

let files;
try {
  files = testFiles("tests").sort();
} catch (err) {
  console.error(`tests/ could not be read: ${err.message}`);
  process.exit(1);
}

if (files.length < MINIMUM) {
  console.error(
    `test discovery found ${files.length} file(s) under tests/, fewer than the ${MINIMUM} `
    + "this repository carries — the suite is not running what it should.",
  );
  process.exit(1);
}

console.log(`${files.length} test files`);
const result = spawnSync(process.execPath, [
  "--import=tsx", "--test", "--test-reporter=spec", ...files,
], { stdio: "inherit" });

if (result.error) {
  console.error(`test runner could not start: ${result.error.message}`);
  process.exit(1);
}
process.exit(result.status ?? 1);
