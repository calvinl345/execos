import type { TaskCategory } from "../../lib/types.js";

export interface ResourceFilters {
  q: string;
  categories: ReadonlySet<TaskCategory>;
  task: string | null;
}

export interface ResourceFilterableDocument {
  filename: string;
  category: TaskCategory;
  linked_task_ids: readonly string[];
}

export const RESOURCE_CATEGORY_VALUES: readonly TaskCategory[] = [
  "client",
  "business",
  "product",
  "house",
  "personal",
];

const RESOURCE_CATEGORY_SET = new Set<string>(RESOURCE_CATEGORY_VALUES);
const TASK_ID_RE = /^KS-\d+$/;

export function isWellFormedResourceTaskId(value: string): boolean {
  return TASK_ID_RE.test(value);
}

export function defaultResourceFilters(): ResourceFilters {
  return {
    q: "",
    categories: new Set(),
    task: null,
  };
}

export function parseResourceFilters(params: URLSearchParams): ResourceFilters {
  const categories = new Set<TaskCategory>();
  for (const value of params.getAll("category")) {
    if (RESOURCE_CATEGORY_SET.has(value)) {
      categories.add(value as TaskCategory);
    }
  }

  const task = params.get("task");
  return {
    q: params.get("q") ?? "",
    categories,
    task: task && isWellFormedResourceTaskId(task) ? task : null,
  };
}

export function serializeResourceFilters(filters: ResourceFilters): URLSearchParams {
  const params = new URLSearchParams();
  const q = filters.q.trim();
  if (q) params.set("q", q);

  for (const category of RESOURCE_CATEGORY_VALUES) {
    if (filters.categories.has(category)) {
      params.append("category", category);
    }
  }

  if (filters.task && isWellFormedResourceTaskId(filters.task)) {
    params.set("task", filters.task);
  }

  return params;
}

export function patchResourceFilterParams(
  params: URLSearchParams,
  next: Partial<ResourceFilters>,
): URLSearchParams {
  const patched = new URLSearchParams(params);

  if ("q" in next) {
    const q = (next.q ?? "").trim();
    if (q) patched.set("q", q);
    else patched.delete("q");
  }

  if ("categories" in next) {
    patched.delete("category");
    const categories = next.categories ?? new Set<TaskCategory>();
    for (const category of RESOURCE_CATEGORY_VALUES) {
      if (categories.has(category)) {
        patched.append("category", category);
      }
    }
  }

  if ("task" in next) {
    const task = next.task?.trim() ?? "";
    if (task && isWellFormedResourceTaskId(task)) patched.set("task", task);
    else patched.delete("task");
  }

  return patched;
}

export function hasActiveResourceFilters(filters: ResourceFilters): boolean {
  return filters.q.trim() !== "" || filters.categories.size > 0 || filters.task !== null;
}

export function applyResourceFilters<T extends ResourceFilterableDocument>(
  documents: readonly T[],
  filters: ResourceFilters,
): T[] {
  const needle = filters.q.trim().toLowerCase();

  return documents.filter((doc) => {
    if (needle && !doc.filename.toLowerCase().includes(needle)) {
      return false;
    }
    if (filters.categories.size > 0 && !filters.categories.has(doc.category)) {
      return false;
    }
    if (filters.task && !doc.linked_task_ids.includes(filters.task)) {
      return false;
    }
    return true;
  });
}
