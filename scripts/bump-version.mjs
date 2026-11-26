import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

// This is a maintainer command, never an automatic reaction to upstream tags.
// Use the upstream mode for substantial feature updates after testing.
export function nextVersion(current, currentUpstream, nextUpstream = currentUpstream, mode = "fix") {
  const match = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.exec(current);
  if (!match || !/^\d+\.\d+\.\d+$/.test(currentUpstream) || !/^\d+\.\d+\.\d+$/.test(nextUpstream)) throw Error("Expected numeric X.Y.Z versions");
  const [, major, minor, patch] = match.map(Number);
  if (!["fix", "upstream"].includes(mode)) throw Error("Expected fix or upstream mode");
  if (mode === "upstream" && currentUpstream === nextUpstream)
    throw Error("A minor bump requires a newer tested upstream release");
  if (nextUpstream !== currentUpstream) {
    const previous = currentUpstream.split(".").map(Number), next = nextUpstream.split(".").map(Number);
    const different = next.findIndex((n, i) => n !== previous[i]);
    if (different < 0 || next[different] < previous[different]) throw Error("Upstream adaptation must advance to a newer official version");
  }
  return mode === "upstream" ? `${major}.${minor + 1}.0` : `${major}.${minor}.${patch + 1}`;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const root = fileURLToPath(new URL("../", import.meta.url));
  const file = path.join(root, "package.json"), lockFile = path.join(root, "package-lock.json");
  const pkg = JSON.parse(readFileSync(file)), lock = JSON.parse(readFileSync(lockFile));
  const [mode, upstream, ...extra] = process.argv.slice(2);
  if (extra.length || !["fix", "upstream"].includes(mode) || (mode === "upstream" && !upstream))
    throw Error("Use: node scripts/bump-version.mjs fix [X.Y.Z] | upstream X.Y.Z");
  const target = upstream ?? pkg.deeptutorCompatibility;
  pkg.version = nextVersion(pkg.version, pkg.deeptutorCompatibility, target, mode);
  pkg.deeptutorCompatibility = target;
  lock.version = pkg.version; lock.packages[""].version = pkg.version;
  writeFileSync(file, JSON.stringify(pkg, null, 2) + "\n");
  writeFileSync(lockFile, JSON.stringify(lock, null, 2) + "\n");
  console.log(`Client ${pkg.version}; tested DeepTutor ${target}. Native runtime remains unchanged.`);
}
