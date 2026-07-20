export function parseDate(dateStr) {
  const d = new Date(dateStr + 'T00:00:00');
  if (Number.isNaN(d.getTime())) return null;
  return d;
}

export function formatDate(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

export function startOfToday() {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return today;
}

/** Mark pending bookings whose check-in is before today as expired. */
export function expirePastBookings(db) {
  const today = startOfToday();
  let changed = false;

  for (const booking of db.bookings) {
    if (booking.status !== 'pending') continue;
    const checkIn = parseDate(booking.checkIn);
    if (!checkIn || checkIn >= today) continue;

    booking.status = 'expired';
    booking.updatedAt = new Date().toISOString();
    changed = true;
  }

  return changed;
}

export function getDateRange(checkIn, checkOut) {
  const dates = [];
  const start = parseDate(checkIn);
  const end = parseDate(checkOut);
  if (!start || !end || start >= end) return dates;

  const current = new Date(start);
  while (current < end) {
    dates.push(formatDate(current));
    current.setDate(current.getDate() + 1);
  }
  return dates;
}

export function datesOverlap(rangeA, rangeB) {
  return rangeA.some((d) => rangeB.includes(d));
}
