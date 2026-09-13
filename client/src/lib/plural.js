export function pluralize(count, singular, plural) {
  return count === 1 ? singular : plural || `${singular}s`;
}

export function formatCount(count, singular, plural) {
  return `${count} ${pluralize(count, singular, plural)}`;
}
