import test from "node:test";
import assert from "node:assert/strict";
import { nextVersion } from "../scripts/bump-version.mjs";
test("patches can advance upstream compatibility without incrementing Y", () => {
  assert.equal(nextVersion("0.3.1", "1.7.1"), "0.3.2");
  assert.equal(nextVersion("0.4.6", "1.7.2", "1.7.4", "fix"), "0.4.7");
  assert.equal(nextVersion("0.3.19", "1.7.1", "1.7.2", "upstream"), "0.4.0");
  assert.throws(() => nextVersion("0.4.7", "1.7.4", "1.7.4", "upstream"));
  assert.throws(() => nextVersion("0.4.7", "1.7.4", "1.7.2", "fix"));
  assert.throws(() => nextVersion("0.3.0-preview.4", "1.7.1"));
});
