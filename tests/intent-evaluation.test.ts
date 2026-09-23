import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { matchIntent, GROUPS } from '../packages/policy/src/index.ts';
import type { CapabilityGroup, Mode } from '../packages/contracts/src/index.ts';

interface Example {
  id: string;
  category: string;
  text: string;
  source: string;
  mode: Mode;
  expectedGroups: CapabilityGroup[];
  provenance: string;
}
const fixture = JSON.parse(
  readFileSync(new URL('../fixtures/golden-intents.json', import.meta.url), 'utf8'),
) as { annotation: string; cases: Example[] };

test('intent regression dataset has at least 200 distinct labelled cases, preserves source/mode, and reports per-group metrics', (t) => {
  assert.ok(fixture.cases.length >= 200);
  assert.equal(
    new Set(fixture.cases.map((row) => JSON.stringify([row.text, row.mode, row.source]))).size,
    fixture.cases.length,
  );
  const groups = Object.keys(GROUPS) as CapabilityGroup[];
  const counts = Object.fromEntries(
    groups.map((group) => [group, { tp: 0, fp: 0, fn: 0 }]),
  ) as Record<CapabilityGroup, { tp: number; fp: number; fn: number }>;
  const failures: Array<{
    id: string;
    category: string;
    text: string;
    expected: string[];
    actual: string[];
    reason: string;
  }> = [];
  let negativeCount = 0,
    negativeTriggered = 0,
    refused = 0;
  for (const row of fixture.cases) {
    const result = matchIntent(row.text, row.mode, row.source);
    if (!result.groups.length) refused++;
    if (!row.expectedGroups.length) {
      negativeCount++;
      if (result.groups.length) negativeTriggered++;
    }
    for (const group of groups) {
      if (result.groups.includes(group) && row.expectedGroups.includes(group)) counts[group].tp++;
      if (result.groups.includes(group) && !row.expectedGroups.includes(group)) counts[group].fp++;
      if (!result.groups.includes(group) && row.expectedGroups.includes(group)) counts[group].fn++;
    }
    if (JSON.stringify(result.groups) !== JSON.stringify(row.expectedGroups))
      failures.push({
        id: row.id,
        category: row.category,
        text: row.text.slice(0, 200),
        expected: row.expectedGroups,
        actual: result.groups,
        reason: result.reasonCode,
      });
    for (const evidence of result.evidence) {
      assert.equal(
        row.text.slice(evidence.start, evidence.end),
        evidence.text,
        `${row.id}: source span`,
      );
      assert.ok(
        evidence.start >= 0 && evidence.end <= row.text.length && evidence.end > evidence.start,
      );
    }
    if (row.source !== 'human' || row.mode === 'native')
      assert.deepEqual(result.groups, [], `${row.id}: source/mode gate`);
  }
  const metrics = Object.fromEntries(
    groups.map((group) => {
      const { tp, fp, fn } = counts[group];
      const precision = tp / (tp + fp || 1),
        recall = tp / (tp + fn || 1);
      return [
        group,
        {
          ...counts[group],
          precision,
          recall,
          f1: (2 * precision * recall) / (precision + recall || 1),
        },
      ];
    }),
  );
  const report = {
    dataset: 'fixtures/golden-intents.json',
    annotation: fixture.annotation,
    cases: fixture.cases.length,
    negativeCount,
    negativeTriggered,
    negativeFalsePositiveRate: negativeTriggered / (negativeCount || 1),
    exactSetAccuracy: 1 - failures.length / fixture.cases.length,
    refusalRate: refused / fixture.cases.length,
    metrics,
    failures,
  };
  t.diagnostic(JSON.stringify(report));
  assert.deepEqual(
    failures,
    [],
    'All regression expectations, especially negative safety examples, must pass',
  );
});
