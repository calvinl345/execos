/**
 * Pure URL helpers for task drawer (?task=) layered on filter query params.
 */

export function mergePreservingTaskParam(
  filterParams: URLSearchParams,
  currentFullUrlParams: URLSearchParams,
): URLSearchParams {
  const merged = new URLSearchParams(filterParams);
  const t = currentFullUrlParams.get("task");
  if (t) merged.set("task", t);
  return merged;
}

export function setTaskParam(
  currentFullUrlParams: URLSearchParams,
  taskId: string,
): URLSearchParams {
  const next = new URLSearchParams(currentFullUrlParams);
  next.set("task", taskId);
  return next;
}

export function clearTaskParam(currentFullUrlParams: URLSearchParams): URLSearchParams {
  const next = new URLSearchParams(currentFullUrlParams);
  next.delete("task");
  return next;
}
