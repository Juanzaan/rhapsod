// Autoplay evaluation: runs the real playback service's autoplay over a
// catalog of tracks and their YouTube mixes, and measures repeats, artist
// spread, energy continuity and how much of it is new to the channel.
//
//   npm run eval:autoplay                  default fixture, seeds 1-3
//   npm run eval:autoplay -- cases.json 7  another file, one seed
import { readFileSync } from "node:fs";
import { join } from "node:path";

import {
  formatAutoplayEval,
  runAutoplayEval,
  type AutoplayEvalFixture,
} from "../src/application/autoplay-eval.js";

const path =
  process.argv[2] ??
  join(import.meta.dirname, "..", "tests", "fixtures", "autoplay-eval.json");
const seeds =
  process.argv[3] === undefined ? [1, 2, 3] : [Number(process.argv[3])];
const fixture = JSON.parse(readFileSync(path, "utf8")) as AutoplayEvalFixture;
for (const seed of seeds) {
  const report = await runAutoplayEval(fixture, seed);
  process.stdout.write(`--- seed ${seed}\n${formatAutoplayEval(report)}\n`);
}
