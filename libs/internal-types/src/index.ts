/**
 * StreamStatus — tristate streaming state shared across @cacheplane/* parsers.
 *
 * - `pending`  : parser created, no input consumed yet.
 * - `streaming`: input has been consumed; more may arrive.
 * - `complete` : end-of-input signaled; no further state changes.
 */
export type StreamStatus = 'pending' | 'streaming' | 'complete';
