// Campus-wide numbers for the home page and the admin dashboard. Pure: takes item records, returns totals.
import { CATEGORIES } from './validation.js';

const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const HIDDEN_STATES = new Set(['REMOVED', 'HIDDEN']);

function median(values) {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

export function campusStats(items, now = Date.now(), days = 14) {
  const visible = items.filter(item => !HIDDEN_STATES.has(item.status));
  const returned = visible.filter(item => item.status === 'RESOLVED');
  const hoursToReturn = returned
    .filter(item => item.resolvedAt && item.createdAt)
    .map(item => (Date.parse(item.resolvedAt) - Date.parse(item.createdAt)) / HOUR)
    .filter(hours => Number.isFinite(hours) && hours >= 0);

  const byCategory = Object.entries(CATEGORIES)
    .map(([category, label]) => {
      const inCategory = visible.filter(item => item.category === category);
      return {
        category,
        label,
        lost: inCategory.filter(item => item.itemType === 'LOST').length,
        found: inCategory.filter(item => item.itemType === 'FOUND').length,
        returned: inCategory.filter(item => item.status === 'RESOLVED').length,
      };
    })
    .filter(row => row.lost + row.found > 0)
    .sort((a, b) => (b.lost + b.found) - (a.lost + a.found));

  const today = new Date(now);
  today.setUTCHours(0, 0, 0, 0);
  const daily = Array.from({ length: days }, (_, index) => {
    const start = today.getTime() - (days - 1 - index) * DAY;
    const onDay = visible.filter(item => {
      const created = Date.parse(item.createdAt);
      return created >= start && created < start + DAY;
    });
    return { date: new Date(start).toISOString().slice(0, 10), posts: onDay.length, returned: onDay.filter(item => item.status === 'RESOLVED').length };
  });

  const medianHours = median(hoursToReturn);
  return {
    total: visible.length,
    openLost: visible.filter(item => item.status === 'ACTIVE' && item.itemType === 'LOST').length,
    openFound: visible.filter(item => item.status === 'ACTIVE' && item.itemType === 'FOUND').length,
    returned: returned.length,
    returnRate: visible.length ? Math.round((returned.length / visible.length) * 100) : 0,
    medianHoursToReturn: medianHours === null ? null : Math.round(medianHours * 10) / 10,
    byCategory,
    daily,
  };
}
