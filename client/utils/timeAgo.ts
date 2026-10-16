/**
 * Module: client/utils/timeAgo
 * Intent: Lightweight relative-time formatter ("2m ago", "3h ago") — avoids date-fns dependency.
 * Public API: formatDistanceToNow(date) → string ('' on invalid dates).
 * Invariants: Matches expected UI strings (just now/Nm ago/Nh ago/Nd ago/Nw ago/Nmo ago/Ny ago).
 * Side Effects: none (pure).
 * Maintenance: Update this block when exports, invariants, side effects, or ownership change.
 */
// Lightweight formatDistanceToNow fallback — avoids date-fns dependency while
// matching expected UI ("2m ago", "3h ago"). Keeps WCAG-friendly textMuted styling.
export function formatDistanceToNow(date: Date | string | number): string {
  try {
    const d = date instanceof Date ? date : new Date(date);
    const now = Date.now();
    const diff = now - d.getTime();
    if (isNaN(diff) || diff < 0) return '';
    const sec = Math.floor(diff / 1000);
    if (sec < 60) return 'just now';
    const min = Math.floor(sec / 60);
    if (min < 60) return `${min}m ago`;
    const hrs = Math.floor(min / 60);
    if (hrs < 24) return `${hrs}h ago`;
    const days = Math.floor(hrs / 24);
    if (days < 7) return `${days}d ago`;
    const weeks = Math.floor(days / 7);
    if (weeks < 5) return `${weeks}w ago`;
    const months = Math.floor(days / 30);
    if (months < 12) return `${months}mo ago`;
    const years = Math.floor(days / 365);
    return `${years}y ago`;
  } catch {
    return '';
  }
}
