import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pluralize, formatCount } from '../src/lib/plural.js';

test('uses the singular form for exactly one', () => {
  assert.equal(pluralize(1, 'month'), 'month');
  assert.equal(pluralize(1, 'record'), 'record');
});

test('uses the plural form for zero and many', () => {
  assert.equal(pluralize(0, 'month'), 'months');
  assert.equal(pluralize(3, 'month'), 'months');
  assert.equal(pluralize(6, 'month'), 'months');
  assert.equal(pluralize(12, 'month'), 'months');
});

test('supports an explicit irregular plural', () => {
  assert.equal(pluralize(1, 'calf', 'calves'), 'calf');
  assert.equal(pluralize(2, 'calf', 'calves'), 'calves');
});

test('month period label has correct grammar', () => {
  const label = (n) => `Last ${n} ${pluralize(n, 'month')}`;
  assert.equal(label(1), 'Last 1 month');
  assert.equal(label(3), 'Last 3 months');
  assert.equal(label(6), 'Last 6 months');
  assert.equal(label(12), 'Last 12 months');
});

test('count labels always include the number', () => {
  assert.equal(formatCount(1, 'record'), '1 record');
  assert.equal(formatCount(2, 'record'), '2 records');
  assert.equal(formatCount(12, 'record'), '12 records');
  assert.equal(formatCount(0, 'record'), '0 records');
  assert.equal(formatCount(1, 'calf', 'calves'), '1 calf');
  assert.equal(formatCount(2, 'calf', 'calves'), '2 calves');
});
