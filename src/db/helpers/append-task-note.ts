import { nanoid } from "nanoid";
import { db, taskNotes } from "../index.js";
import type { TaskNoteCreatedBy, TaskNoteType } from "../schema.js";

export interface AppendTaskNoteInput {
  taskId: string;
  noteType: TaskNoteType;
  content: string;
  createdBy: TaskNoteCreatedBy;
  id?: string;
}

export interface AppendTaskNoteResult {
  noteId: string;
}

export async function appendTaskNote(
  tx: Pick<typeof db, "insert">,
  input: AppendTaskNoteInput,
): Promise<AppendTaskNoteResult> {
  const noteId = input.id ?? nanoid(12);
  await tx.insert(taskNotes).values({
    id: noteId,
    taskId: input.taskId,
    noteType: input.noteType,
    content: input.content,
    createdBy: input.createdBy,
  });
  return { noteId };
}
