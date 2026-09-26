// Offline search evaluation: scores src/media/youtube/search-ranking.ts
// against recorded or hand-written candidate lists.
//
//   npm run eval:search                       evaluate the default fixture
//   npm run eval:search -- path/to/cases.json evaluate another file
//   npm run eval:search -- --record "duki rockstar" "queen bohemian rhapsody"
//       print cases captured from live YouTube, with an empty "expected"
//       list to fill in by hand before adding them to the fixture
import { readFileSync } from "node:fs";
import { join } from "node:path";

import {
  pickInnertubeCandidates,
  searchInnertubeMusicVideos,
  searchInnertubeVideos,
} from "../src/media/youtube/innertube-search.js";
import {
  evaluateSearch,
  formatSearchEval,
  type SearchEvalCase,
  type SearchEvalFixture,
} from "../src/media/youtube/search-eval.js";

const DEFAULT_FIXTURE = join(
  import.meta.dirname,
  "..",
  "tests",
  "fixtures",
  "search-eval.json",
);

async function record(queries: readonly string[]): Promise<void> {
  const cases: SearchEvalCase[] = [];
  for (const query of queries) {
    const [results, musicResults] = await Promise.all([
      searchInnertubeVideos(query),
      searchInnertubeMusicVideos(query),
    ]);
    cases.push({
      candidates: pickInnertubeCandidates(results, musicResults) ?? [],
      expected: [],
      query,
      source: "recorded",
    });
  }
  process.stdout.write(`${JSON.stringify(cases, null, 2)}\n`);
}

function evaluate(path: string): void {
  const fixture = JSON.parse(readFileSync(path, "utf8")) as SearchEvalFixture;
  const result = evaluateSearch(fixture.cases);
  process.stdout.write(`${formatSearchEval(result)}\n`);
  if (result.accuracy < fixture.minAccuracy) {
    process.stderr.write(
      `Accuracy ${result.accuracy}% is below the fixture minimum ${fixture.minAccuracy}%\n`,
    );
    process.exitCode = 1;
  }
}

const args = process.argv.slice(2);
if (args[0] === "--record") {
  await record(args.slice(1));
} else {
  evaluate(args[0] ?? DEFAULT_FIXTURE);
}
