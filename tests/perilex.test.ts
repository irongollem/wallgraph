// Perilex marks and the rotation rule for a wall-mounted symbol standing loose.
import { getSymbol } from "../src/render/symbols";
import { canRotateSymbol } from "../src/core/placed";
import { defaultMountHeight } from "../src/core/mount";
import { emptyDoc } from "../src/model/doc";
import { resources } from "../src/i18n";

let failures = 0;
function check(name: string, cond: boolean, detail = ""): void {
  if (!cond) { failures++; console.error(`FAIL ${name} ${detail}`); }
  else console.log(`ok   ${name}`);
}

const names = (lang: "nl" | "en") => resources[lang].translation.symbol as Record<string, string>;

for (const type of ["socket-perilex", "point-perilex"]) {
  const def = getSymbol(type);
  check(`${type} is registered`, !!def);
  if (!def) continue;
  check(`${type} is a wall-mounted electrical power device`,
    def.wallMounted && def.category === "electrical" &&
    def.ports?.some(p => p.key === "electrical:power" && p.required) === true);
  check(`${type} states no mounting height`,
    def.mountHeight === undefined && defaultMountHeight(emptyDoc().floors[0]!, type) === undefined);
  check(`${type} has nl and en names`, !!names("nl")[type] && names("en")[type] === def.label);
}

check("a loose wall-mounted symbol rotates", canRotateSymbol({}));
check("a wall-snapped symbol does not", !canRotateSymbol({ wallId: "w1" }));

if (failures) { console.error(`${failures} failure(s)`); process.exit(1); }
