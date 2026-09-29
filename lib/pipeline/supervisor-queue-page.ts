import type { SupervisorExceptionSnapshot } from "./operations-types";

const pageSize = 250;

/** Page a sorted snapshot without losing the portfolio-wide totals. */
export function supervisorQueuePage(snapshot: SupervisorExceptionSnapshot, offset = 0): SupervisorExceptionSnapshot {
  const items = snapshot.items.slice(offset, offset + pageSize);
  const nextOffset = offset + items.length;
  return {
    ...snapshot,
    items,
    next_offset: nextOffset < snapshot.total ? nextOffset : null,
  };
}
