'use strict';

function convertPlaceholders(sql) {
  let out = '';
  let index = 0;
  let inSingle = false;
  let inDouble = false;

  for (let i = 0; i < sql.length; i += 1) {
    const ch = sql[i];

    if (inSingle) {
      out += ch;
      if (ch === "'") {
        if (sql[i + 1] === "'") {
          out += sql[i + 1];
          i += 1;
        } else {
          inSingle = false;
        }
      }
      continue;
    }

    if (inDouble) {
      out += ch;
      if (ch === '"') {
        if (sql[i + 1] === '"') {
          out += sql[i + 1];
          i += 1;
        } else {
          inDouble = false;
        }
      }
      continue;
    }

    if (ch === "'") {
      inSingle = true;
      out += ch;
      continue;
    }
    if (ch === '"') {
      inDouble = true;
      out += ch;
      continue;
    }
    if (ch === '?') {
      index += 1;
      out += '$' + index;
      continue;
    }

    out += ch;
  }

  return out;
}

function isInsert(sql) {
  return /^\s*insert\s/i.test(sql);
}

function hasReturning(sql) {
  return /\breturning\b/i.test(sql);
}

function withReturningId(sql) {
  if (!isInsert(sql) || hasReturning(sql)) return sql;
  const trimmed = sql.replace(/;\s*$/, '');
  return `${trimmed} RETURNING id`;
}

module.exports = { convertPlaceholders, isInsert, hasReturning, withReturningId };
