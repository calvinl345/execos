/**
 * Matches task ids that are safe in dashboard URLs, e.g. KS-001, AB-12, KS-YQrLX0eG.
 * Prefix is 1–4 uppercase letters per Settings.infrastructure.task_id_prefix.
 */
export const TASK_ID_URL_RE = /^[A-Z]{1,4}-[A-Za-z0-9_-]+$/;

export function isWellFormedTaskId(id: string): boolean {
  return TASK_ID_URL_RE.test(id);
}
