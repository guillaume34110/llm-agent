import { describe, it, expect, beforeEach } from 'vitest';
import {
  recordUsage,
  getUsageLog,
  clearUsageLog,
  getDailyTokens,
  getRecentTools,
  subscribeUsageLog,
  type UsageEntry,
} from './usage-log';

describe('usage-log', () => {
  beforeEach(() => {
    clearUsageLog();
  });

  it('recordUsage + getUsageLog roundtrip', () => {
    const entry1: UsageEntry = { kind: 'tool', ts: 1000, name: 'search', ok: true };
    const entry2: UsageEntry = { kind: 'tool', ts: 2000, name: 'click', ok: false };
    recordUsage(entry1);
    recordUsage(entry2);
    const log = getUsageLog();
    expect(log).toHaveLength(2);
    expect(log[0]).toEqual(entry1);
    expect(log[1]).toEqual(entry2);
  });

  it('clearUsageLog empties', () => {
    recordUsage({ kind: 'tool', ts: 1000, name: 'test', ok: true });
    expect(getUsageLog()).toHaveLength(1);
    clearUsageLog();
    expect(getUsageLog()).toHaveLength(0);
  });

  it('MAX_ENTRIES trim', () => {
    for (let i = 0; i < 502; i++) {
      recordUsage({ kind: 'tool', ts: i, name: `tool${i}`, ok: true });
    }
    const log = getUsageLog();
    expect(log).toHaveLength(500);
    // Oldest dropped (0), newest should be 501
    expect(log[log.length - 1].ts).toBe(501);
  });

  it('getDailyTokens aggregates by day', () => {
    const now = Date.now();
    recordUsage({
      kind: 'tokens',
      ts: now,
      model: 'm1',
      promptTokens: 100,
      completionTokens: 200,
      costCents: 0.5,
    });
    recordUsage({
      kind: 'tokens',
      ts: now,
      model: 'm2',
      promptTokens: 300,
      completionTokens: 50,
      costCents: 0.2,
    });
    recordUsage({
      kind: 'tokens',
      ts: now,
      model: 'm1',
      promptTokens: 50,
      completionTokens: 0,
      costCents: 0.0,
    });
    const daily = getDailyTokens(1);
    expect(daily).toHaveLength(1);
    const today = daily[0];
    expect(today.promptTokens).toBe(450);
    expect(today.completionTokens).toBe(250);
    expect(today.costCents).toBe(0.7);
  });

  it('getDailyTokens fills empty days', () => {
    const daily = getDailyTokens(7);
    expect(daily).toHaveLength(7);
    daily.forEach(d => {
      expect(d.promptTokens).toBe(0);
      expect(d.completionTokens).toBe(0);
      expect(d.costCents).toBe(0);
    });
  });

  it('getRecentTools filters and orders', () => {
    recordUsage({ kind: 'tool', ts: 1000, name: 'a', ok: true });
    recordUsage({ kind: 'tokens', ts: 1500, model: 'x', promptTokens: 10, completionTokens: 5, costCents: 0.1 });
    recordUsage({ kind: 'tool', ts: 2000, name: 'b', ok: false });
    recordUsage({ kind: 'tool', ts: 3000, name: 'c', ok: true });
    const tools = getRecentTools(50);
    expect(tools).toHaveLength(3);
    expect(tools[0].name).toBe('c');
    expect(tools[1].name).toBe('b');
    expect(tools[2].name).toBe('a');
  });

  it('subscribeUsageLog triggers on recordUsage', () => {
    let callCount = 0;
    const unsub = subscribeUsageLog(() => {
      callCount++;
    });
    recordUsage({ kind: 'tool', ts: 1000, name: 'test', ok: true });
    expect(callCount).toBe(1);
    unsub();
    recordUsage({ kind: 'tool', ts: 2000, name: 'test', ok: true });
    expect(callCount).toBe(1);
  });

  it('subscribeUsageLog triggers on clearUsageLog', () => {
    recordUsage({ kind: 'tool', ts: 1000, name: 'test', ok: true });
    let callCount = 0;
    subscribeUsageLog(() => {
      callCount++;
    });
    clearUsageLog();
    expect(callCount).toBe(1);
  });
});
