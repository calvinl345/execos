import { describe, expect, test } from "vitest";
import {
  applyResourceFilters,
  defaultResourceFilters,
  parseResourceFilters,
  serializeResourceFilters,
  type ResourceFilterableDocument,
  type ResourceFilters,
} from "../../src/web/routes/resources/resource-filters.js";

function doc(partial: Partial<ResourceFilterableDocument> & Pick<ResourceFilterableDocument, "filename">): ResourceFilterableDocument {
  return {
    filename: partial.filename,
    category: partial.category ?? "house",
    linked_task_ids: partial.linked_task_ids ?? [],
  };
}

function expectFiltersRoundTrip(filters: ResourceFilters): void {
  const again = parseResourceFilters(serializeResourceFilters(filters));
  expect(again.q).toBe(filters.q.trim());
  expect([...again.categories].sort()).toEqual([...filters.categories].sort());
  expect(again.task).toBe(filters.task);
}

describe("parseResourceFilters / serializeResourceFilters", () => {
  test("empty URL parses to empty filters and serializes to no params", () => {
    const filters = parseResourceFilters(new URLSearchParams());
    expect(filters).toEqual(defaultResourceFilters());
    expect(serializeResourceFilters(filters).toString()).toBe("");
  });

  test("q round-trips", () => {
    const filters = parseResourceFilters(new URLSearchParams("q=foo"));
    expect(filters.q).toBe("foo");
    expectFiltersRoundTrip(filters);
  });

  test("repeated category keys parse as a set", () => {
    const filters = parseResourceFilters(new URLSearchParams("category=product&category=house"));
    expect([...filters.categories].sort()).toEqual(["house", "product"]);
    expect(serializeResourceFilters(filters).getAll("category").sort()).toEqual(["house", "product"]);
  });

  test("task parses only when well formed", () => {
    expect(parseResourceFilters(new URLSearchParams("task=KS-1")).task).toBe("KS-1");
    expect(parseResourceFilters(new URLSearchParams("task=foo")).task).toBeNull();
  });
});

describe("applyResourceFilters", () => {
  test("honors AND across filename, category, and task dimensions", () => {
    const docs = [
      doc({ filename: "report.pdf", category: "product", linked_task_ids: ["KS-5"] }),
      doc({ filename: "report-notes.md", category: "house", linked_task_ids: ["KS-5"] }),
      doc({ filename: "client.pdf", category: "product", linked_task_ids: ["KS-9"] }),
    ];
    const filters: ResourceFilters = {
      q: "report",
      categories: new Set(["product"]),
      task: "KS-5",
    };
    expect(applyResourceFilters(docs, filters).map((d) => d.filename)).toEqual(["report.pdf"]);
  });

  test("filename search is case-insensitive", () => {
    const docs = [doc({ filename: "REPORT.pdf" }), doc({ filename: "notes.txt" })];
    expect(
      applyResourceFilters(docs, {
        ...defaultResourceFilters(),
        q: "report",
      }).map((d) => d.filename),
    ).toEqual(["REPORT.pdf"]);
  });

  test("task filter keeps documents linked to the exact task id", () => {
    const docs = [
      doc({ filename: "a.pdf", linked_task_ids: ["KS-5", "KS-6"] }),
      doc({ filename: "b.pdf", linked_task_ids: ["KS-50"] }),
    ];
    expect(
      applyResourceFilters(docs, {
        ...defaultResourceFilters(),
        task: "KS-5",
      }).map((d) => d.filename),
    ).toEqual(["a.pdf"]);
  });
});
