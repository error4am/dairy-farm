const { HttpError } = require('./errors');

function isBlank(value) {
  return value === undefined || value === null || String(value).trim() === '';
}

function validate(body, rules) {
  const errors = {};
  const data = {};

  for (const [name, rule] of Object.entries(rules)) {
    const label = rule.label || name;
    const raw = body ? body[name] : undefined;

    if (isBlank(raw)) {
      if (rule.required) {
        errors[name] = label + ' is required.';
        continue;
      }
      data[name] = rule.default !== undefined ? rule.default : null;
      continue;
    }

    let value = typeof raw === 'string' ? raw.trim() : raw;

    if (rule.type === 'number') {
      value = Number(value);
      if (!Number.isFinite(value)) {
        errors[name] = label + ' must be a number.';
        continue;
      }
      if (rule.min !== undefined && value < rule.min) {
        errors[name] = rule.minMessage || label + ' must be at least ' + rule.min + '.';
        continue;
      }
      if (rule.max !== undefined && value > rule.max) {
        errors[name] = label + ' must be at most ' + rule.max + '.';
        continue;
      }
    } else if (rule.type === 'integer') {
      value = Number(value);
      if (!Number.isInteger(value)) {
        errors[name] = label + ' must be a whole number.';
        continue;
      }
    } else if (rule.type === 'date') {
      const ok = /^\d{4}-\d{2}-\d{2}$/.test(String(value)) && !Number.isNaN(new Date(String(value) + 'T00:00:00').getTime());
      if (!ok) {
        errors[name] = label + ' must be a valid date.';
        continue;
      }
      value = String(value);
    } else {
      value = String(value);
      if (rule.maxLength && value.length > rule.maxLength) {
        errors[name] = label + ' must be under ' + rule.maxLength + ' characters.';
        continue;
      }
    }

    if (rule.enum && !rule.enum.includes(value)) {
      errors[name] = label + ' is not valid.';
      continue;
    }

    if (rule.validate) {
      const message = rule.validate(value);
      if (message) {
        errors[name] = message;
        continue;
      }
    }

    data[name] = value;
  }

  if (Object.keys(errors).length > 0) {
    throw new HttpError(400, 'Please check the highlighted fields.', errors);
  }

  return data;
}

module.exports = { validate };
