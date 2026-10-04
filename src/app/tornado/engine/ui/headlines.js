// @ts-check

/**
 * The news line's queue (ui/newsTicker.js), pure so it runs under node --test.
 * @typedef {{text: string, breaking: boolean}} Headline
 */

/**
 * Adds a headline to the queue, in place: breaking news goes ahead of the
 * ordinary lines (after any breaking already waiting); past `max`, the
 * newest ordinary line goes, never a breaking one (unless every line is
 * breaking, when the oldest goes).
 * @param {Headline[]} queue
 * @param {Headline} item
 * @param {number} max
 * @returns {Headline[]} the same queue
 */
export function enqueueHeadline(queue, item, max) {
  const at = item.breaking ? queue.findIndex((q) => !q.breaking) : -1;
  if (at === -1) queue.push(item);
  else queue.splice(at, 0, item);
  while (queue.length > max) {
    let drop = -1;
    for (let i = queue.length - 1; i >= 0; i--) {
      if (!queue[i].breaking) { drop = i; break; }
    }
    queue.splice(drop === -1 ? 0 : drop, 1);
  }
  return queue;
}
