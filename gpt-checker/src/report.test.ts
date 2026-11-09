import assert from "node:assert/strict";
import { test } from "node:test";
import { buildSummary, parseCsv } from "./report";

const history = (rows: string[][]) =>
  ["run_id,brand,query,status,mentioned,line,lines,logged_in", ...rows.map((r) => r.join(","))].join("\n") + "\n";

test("parseCsv handles quotes, commas and newlines", () => {
  const rows = parseCsv('a,b\n"x, ""y""","two\nlines"\n');
  assert.deepEqual(rows, [{ a: 'x, "y"', b: "two\nlines" }]);
});

test("summary compares the latest run with the previous one", () => {
  const md = buildSummary(
    parseCsv(
      history([
        ["20261101-090000", "K18", "q1", "ok", "no", "", "", "no"],
        ["20261101-090000", "K18", "q2", "ok", "yes", "1", "9", "no"],
        ["20261102-090000", "K18", "q1", "ok", "yes", "3", "20", "no"],
        ["20261102-090000", "K18", "q2", "ok", "no", "", "", "no"],
        ["20261102-090000", "K18", "q3", "error", "", "", "", "no"],
      ]),
    ),
  );
  assert.match(md, /mentioned in \*\*1 of 2\*\* answers\. 2 runs in history/);
  assert.match(md, /\| K18 \| q1 \| \*\*yes\*\* \(line 3 of 20\) \| no \| ▲ newly mentioned \| 1 of 2 \|/);
  assert.match(md, /\| K18 \| q2 \| no \| yes \| ▼ dropped \| 1 of 2 \|/);
  assert.match(md, /\| K18 \| q3 \| error \| – \| – \| 0 of 0 \|/);
});
