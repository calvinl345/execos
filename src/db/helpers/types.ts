import type { db } from "../index.js";

export type TaskWriteClient = Pick<typeof db, "select" | "insert" | "update" | "execute">;
