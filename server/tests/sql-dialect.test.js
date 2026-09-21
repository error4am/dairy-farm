const { test } = require('node:test');
const assert = require('node:assert/strict');

const { convertPlaceholders, isInsert, hasReturning, withReturningId } = require('../db/sql');

test('converts question mark placeholders to PostgreSQL positional parameters in order', () => {
  assert.equal(
    convertPlaceholders('SELECT * FROM animals WHERE farm_id = ? AND status = ? ORDER BY id LIMIT ? OFFSET ?'),
    'SELECT * FROM animals WHERE farm_id = $1 AND status = $2 ORDER BY id LIMIT $3 OFFSET $4'
  );
});

test('leaves question marks inside single-quoted string literals untouched', () => {
  assert.equal(
    convertPlaceholders("SELECT 'what?' AS q, name FROM animals WHERE farm_id = ?"),
    "SELECT 'what?' AS q, name FROM animals WHERE farm_id = $1"
  );
});

test('handles escaped quotes inside string literals', () => {
  assert.equal(
    convertPlaceholders("SELECT 'it''s ?' AS q WHERE id = ?"),
    "SELECT 'it''s ?' AS q WHERE id = $1"
  );
});

test('leaves question marks inside double-quoted identifiers untouched', () => {
  assert.equal(convertPlaceholders('SELECT "odd?name" FROM animals WHERE id = ?'), 'SELECT "odd?name" FROM animals WHERE id = $1');
});

test('detects insert statements and existing returning clauses', () => {
  assert.equal(isInsert('INSERT INTO animals (tag_number) VALUES (?)'), true);
  assert.equal(isInsert('  insert into animals (tag_number) values (?)'), true);
  assert.equal(isInsert('UPDATE animals SET name = ?'), false);
  assert.equal(hasReturning('INSERT INTO animals (tag_number) VALUES (?) RETURNING id'), true);
  assert.equal(hasReturning('INSERT INTO animals (tag_number) VALUES (?)'), false);
});

test('appends RETURNING id to inserts only', () => {
  assert.equal(
    withReturningId('INSERT INTO animals (tag_number) VALUES (?)'),
    'INSERT INTO animals (tag_number) VALUES (?) RETURNING id'
  );
  assert.equal(
    withReturningId('INSERT INTO animals (tag_number) VALUES (?) RETURNING id'),
    'INSERT INTO animals (tag_number) VALUES (?) RETURNING id'
  );
  assert.equal(withReturningId('UPDATE animals SET name = ?'), 'UPDATE animals SET name = ?');
});

test('handles a trailing semicolon when appending RETURNING id', () => {
  assert.equal(
    withReturningId('INSERT INTO animals (tag_number) VALUES (?);'),
    'INSERT INTO animals (tag_number) VALUES (?) RETURNING id'
  );
});
