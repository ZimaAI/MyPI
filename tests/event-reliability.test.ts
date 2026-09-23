import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { emptyView, hydrate, reduceEvent, type ViewState } from '../apps/web/src/events.ts';
import { SqliteStore } from '../packages/storage-sqlite/src/index.ts';
import type { AgentEvent } from '../packages/contracts/src/index.ts';

function shuffle<T>(input: T[], seed: number): T[] {
  const result = [...input];
  let state = seed >>> 0;
  for (let index = result.length - 1; index > 0; index--) {
    state = (state * 1664525 + 1013904223) >>> 0;
    const other = state % (index + 1);
    [result[index], result[other]] = [result[other], result[index]];
  }
  return result;
}
function eventGroup(index: number): AgentEvent[] {
  const conversationId = `conversation-${index}`,
    runId = `run-${index}`,
    taskId = `task-${index}`,
    messageId = `message-${index}`;
  const changes: Array<[string, Record<string, unknown>]> = [
    ['run.accepted', { status: 'accepted' }],
    ['run.started', {}],
    ['task.created', { id: taskId, status: 'queued', attempt: 1, originRunId: runId }],
    ['message.delta', { messageId, delta: 'part ', offset: 0 }],
    ['task.state.changed', { id: taskId, status: 'running', attempt: 1 }],
    ['message.delta', { messageId, delta: 'two', offset: 5 }],
    ['task.state.changed', { id: taskId, status: 'succeeded', attempt: 1 }],
    [
      'task.result.ready',
      { taskId, resultId: `${taskId}:1`, originRunId: runId, summary: `result ${index}` },
    ],
    ['message.completed', { messageId, text: 'part two', role: 'assistant' }],
    ['run.completed', { status: 'succeeded' }],
  ];
  return changes.map(([type, payload], offset) => ({
    schemaVersion: 1,
    eventId: `${conversationId}:${offset + 1}`,
    conversationId,
    runId,
    sequence: offset + 1,
    type,
    payload,
    occurredAt: '2026-09-23T00:00:00.000Z',
  }));
}
function check(state: ViewState, index: number) {
  assert.equal(state.sequence, 10);
  assert.equal(state.messages.length, 1);
  assert.equal(state.messages[0].text, 'part two');
  assert.equal(state.messages[0].streaming, false);
  assert.equal(state.runs[`run-${index}`].status, 'succeeded');
  assert.equal(Object.keys(state.tasks).length, 1);
  assert.equal(state.tasks[`task-${index}`].status, 'succeeded');
  assert.equal(state.tasks[`task-${index}`].resultId, `task-${index}:1`);
  assert.equal(state.tasks[`task-${index}`].summary, `result ${index}`);
}

test('1000 result groups survive reordered delivery, duplicates, and snapshot/reconnect replay without duplicate presentation', () => {
  for (let index = 0; index < 1000; index++) {
    const events = eventGroup(index);
    let state = emptyView();
    for (const event of shuffle([...events, ...events, events[7]], index + 1))
      state = reduceEvent(state, event);
    check(state, index);
    let before = emptyView();
    for (const event of events.slice(0, 4)) before = reduceEvent(before, event);
    let resumed = hydrate({
      lastSequence: 4,
      messages: before.messages,
      runs: Object.values(before.runs),
      tasks: Object.values(before.tasks),
    });
    for (const event of shuffle([...events.slice(4), ...events.slice(2)], index + 17))
      resumed = reduceEvent(resumed, event);
    check(resumed, index);
    // A delayed worker notification with a newer transport sequence cannot rewind
    // the already completed task/run. A new attempt has a separate attempt number.
    state = reduceEvent(state, { ...events[4], eventId: `late-task-${index}`, sequence: 11 });
    state = reduceEvent(state, { ...events[1], eventId: `late-run-${index}`, sequence: 12 });
    assert.equal(state.tasks[`task-${index}`].status, 'succeeded');
    assert.equal(state.runs[`run-${index}`].status, 'succeeded');
  }
});

test(
  '1000 committed result/inbox records recover after lost notifications, rollback, replay and process reopen',
  { timeout: 30000 },
  async () => {
    const directory = await mkdtemp(join(tmpdir(), 'mypi-event-reliability-')),
      database = join(directory, 'events.sqlite');
    let store = new SqliteStore(database);
    try {
      for (let index = 0; index < 1000; index++) {
        const conversationId = `conversation-${index}`,
          resultId = `task-${index}:1`;
        assert.throws(
          () =>
            store.transaction(() => {
              store.put('result', resultId, { id: resultId, attempt: 1 }, { conversationId });
              store.appendEvent(conversationId, `run-${index}`, 'task.result.ready', { resultId });
              throw new Error('crash before commit');
            }),
          /crash before commit/,
        );
        assert.equal(store.get('result', resultId), undefined);
        assert.equal(store.events(conversationId).length, 0);
        const unsubscribe = store.subscribe(conversationId, () => {
          throw new Error('notification transport disconnected');
        });
        store.idempotent('owner', 'result-complete', resultId, { resultId }, () => {
          store.put(
            'result',
            resultId,
            { id: resultId, attempt: 1, summary: 'completed' },
            { conversationId },
          );
          store.put(
            'inbox',
            resultId,
            { id: resultId, resultId, status: 'pending' },
            { conversationId },
          );
          store.appendEvent(conversationId, `run-${index}`, 'task.result.ready', { resultId });
          return { resultId };
        });
        unsubscribe();
        for (let duplicate = 0; duplicate < 2; duplicate++)
          store.idempotent('owner', 'result-complete', resultId, { resultId }, () => {
            throw new Error('duplicate side effect');
          });
      }
      store.close();
      store = new SqliteStore(database);
      assert.equal(store.list('result', { limit: 2000 }).length, 1000);
      assert.equal(store.list('inbox', { limit: 2000 }).length, 1000);
      const outbox = store.pendingOutbox(2000);
      assert.equal(outbox.length, 1000);
      for (let index = 0; index < 1000; index++) {
        const events = store.events(`conversation-${index}`);
        assert.equal(events.length, 1);
        assert.equal(events[0].sequence, 1);
      }
      for (const entry of outbox.slice(0, 500)) {
        const resultId = entry.payload.payload.resultId;
        store.put('inbox', resultId, { id: resultId, resultId, status: 'claimed' });
      }
      store.close();
      store = new SqliteStore(database);
      assert.equal(
        store
          .list<{ status: string }>('inbox', { limit: 2000 })
          .filter((row) => row.data.status === 'claimed').length,
        500,
      );
      // Lost acknowledgement causes a replay of the same idempotency key. Claim/ack
      // transitions and their delivery receipt are one transaction, with no model call.
      for (const entry of outbox) {
        const resultId = entry.payload.payload.resultId;
        store.idempotent('owner', 'inbox-ack', resultId, { resultId }, () => {
          store.put('inbox', resultId, { id: resultId, resultId, status: 'delivered' });
          store.markOutbox(entry.id);
          return { resultId };
        });
        store.idempotent('owner', 'inbox-ack', resultId, { resultId }, () => {
          throw new Error('duplicate acknowledgement side effect');
        });
      }
      assert.equal(store.pendingOutbox(2000).length, 0);
    } finally {
      store.close();
      await rm(directory, { recursive: true, force: true });
    }
  },
);
