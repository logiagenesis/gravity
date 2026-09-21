/**
 * Dependency licence gate.
 *
 * Policy (artifacts/04-licensing-and-clean-room.md §7): the *runtime* dependency
 * tree must stay permissive. A copyleft runtime dependency would reimpose, via
 * the back door, exactly the constraint the clean-room decision avoids.
 *
 * Dev-only dependencies are exempt: they are not distributed with the app.
 * axe-core (MPL-2.0) is the concrete case — it is a test tool and never bundled.
 *
 * Exits non-zero on violation so CI fails.
 */
import { execFileSync } from "node:child_process";

/** Licences that may appear in the production tree. */
const ALLOWED = [
  "MIT",
  "ISC",
  "Apache-2.0",
  "BSD-2-Clause",
  "BSD-3-Clause",
  "0BSD",
  "CC0-1.0",
  "Unlicense",
  "BlueOak-1.0.0",
  "Python-2.0",
  "UNLICENSED", // this package itself
];

/** Licences that must never appear in the production tree. */
const FORBIDDEN = [
  "GPL-2.0",
  "GPL-3.0",
  "AGPL-3.0",
  "LGPL-2.1",
  "LGPL-3.0",
  "SSPL-1.0",
  "CC-BY-SA-4.0",
  "BUSL-1.1",
  "EUPL-1.2",
];

type TreeNode = {
  name?: string;
  version?: string;
  dependencies?: Record<string, TreeNode>;
};

function readProductionTree(): TreeNode {
  const raw = execFileSync("npm", ["ls", "--omit=dev", "--all", "--json", "--long"], {
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  });
  return JSON.parse(raw) as TreeNode;
}

/** Normalise an SPDX expression to the identifiers it mentions. */
function identifiers(expression: string): string[] {
  return expression
    .replace(/[()]/g, " ")
    .split(/\s+(?:OR|AND)\s+/i)
    .map((part) => part.trim().replace(/\+$/, ""))
    .filter(Boolean);
}

function isAllowed(expression: string): boolean {
  const ids = identifiers(expression);
  if (ids.length === 0) return false;
  // An OR expression is acceptable if ANY branch is allowed (we may pick it).
  if (/\sOR\s/i.test(expression)) return ids.some((id) => ALLOWED.includes(id));
  // Otherwise every identifier must be allowed.
  return ids.every((id) => ALLOWED.includes(id));
}

function isForbidden(expression: string): boolean {
  return identifiers(expression).some((id) =>
    FORBIDDEN.some((bad) => id === bad || id.startsWith(`${bad}-`)),
  );
}

function walk(node: TreeNode, seen: Map<string, string>, path: string[] = []): void {
  for (const [name, dep] of Object.entries(node.dependencies ?? {})) {
    const key = `${name}@${dep.version ?? "?"}`;
    if (seen.has(key)) continue;
    const licence =
      (dep as { license?: string | { type?: string } }).license ?? "UNKNOWN";
    seen.set(key, typeof licence === "string" ? licence : (licence.type ?? "UNKNOWN"));
    walk(dep, seen, [...path, name]);
  }
}

function main(): void {
  const tree = readProductionTree();
  const seen = new Map<string, string>();
  walk(tree, seen);

  const violations: string[] = [];
  const unknown: string[] = [];

  for (const [pkg, licence] of seen) {
    if (isForbidden(licence)) {
      violations.push(`  FORBIDDEN  ${pkg}  ->  ${licence}`);
    } else if (!isAllowed(licence)) {
      unknown.push(`  UNREVIEWED ${pkg}  ->  ${licence}`);
    }
  }

  console.log(`Licence gate: inspected ${seen.size} production packages.`);

  if (violations.length > 0) {
    console.error("\nCopyleft licence found in the production dependency tree:");
    console.error(violations.join("\n"));
    console.error(
      "\nSee artifacts/04-licensing-and-clean-room.md §7. Remove the dependency" +
        " or move it to devDependencies if it is not shipped.",
    );
    process.exit(1);
  }

  if (unknown.length > 0) {
    console.error(
      "\nProduction packages with a licence that is not on the allow-list:",
    );
    console.error(unknown.join("\n"));
    console.error(
      "\nEach must be reviewed and then added to ALLOWED in scripts/check-licences.ts" +
        " (if permissive) or removed.",
    );
    process.exit(1);
  }

  console.log("Licence gate: pass — all production dependencies are permissive.");
}

main();
