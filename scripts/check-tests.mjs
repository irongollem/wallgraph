// Verify that the test runner will actually find tests to run.
//
// `npm test` discovers its files by glob rather than naming each one, so a
// glob that matches nothing exits 0 with "pass 0" -- a green run that tested
// nothing, which is worse than a red one. Nothing else would notice: CI reads
// the exit code. This runs as npm's `pretest`, so every `npm test` passes
// through it, locally and in CI alike.
//
// The floor is deliberately loose. It is here to catch a moved directory or a
// broken pattern, not to police how many suites the repository keeps.
import { readdirSync, statSync } from "node:fs";
import { join } from "node:path";

/** Every .test.ts under tests/, walked directly rather than globbed — this
 *  check must not depend on the globbing it exists to check. */
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
  files = testFiles("tests");
} catch (err) {
  console.error(`tests/ could not be read: ${err.message}`);
  process.exit(1);
}

if (files.length < MINIMUM) {
  console.error(
    `test discovery found ${files.length} file(s) under tests/, fewer than the ${MINIMUM} `
    + "this repository carries — the suite is not running what it should. Check the `test` "
    + "glob in package.json and that tests/ is where it belongs.",
  );
  process.exit(1);
}

console.log(`${files.length} test files`);
