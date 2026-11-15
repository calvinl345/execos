---
name: save-resource-dev
description: "Use when the user asks to save_resource, save a document, file a resource, upload a document, or attach a local file to ExecOS. Runs the `execos resource add` CLI, captures category/task links/notes, and treats the CLI result as the source of truth. Does not edit Supabase storage or document tables directly."
---

# Context

This skill saves local documents into ExecOS through the resource CLI. The CLI is the service-role write path: it uploads the file to the private Supabase `documents` bucket, inserts `documents` metadata, links optional `document_tasks`, and appends task audit notes for linked tasks.

Do not write directly to Supabase Storage, `documents`, or `document_tasks`; the CLI owns those invariants and rollback behavior.

In Codex Desktop, document upload commands normally need sandbox escalation because `tsx`/`esbuild` helper process spawning is blocked by the sandbox. After the user has clearly requested the upload and the destination/category is resolved, run `execos resource add ...` with sandbox escalation instead of first trying the same command inside the sandbox.

# Pre-flight

- **File path:** Get a real local file path before running the CLI. If the user refers to an attached file but no local path is available, ask for the path instead of inventing one.
- **Category:** Use one of `client`, `business`, `product`, `house`, or `personal`. Infer only when context is clear; otherwise ask one targeted question.
- **Task links:** Link tasks only when the user names them or the document clearly belongs to the current task. Task IDs must look like `KS-173`.
- **Notes:** Keep notes brief and factual. Do not invent notes just to fill the field.
- **Upload approval:** Saving a resource transfers the local file contents to Supabase. If the user has not explicitly approved the upload destination and any inferred category, ask for confirmation before requesting sandbox escalation.

# Workflow

Track your progress through this workflow. Create a checklist from these steps at session start and update it as you complete each step.

1. **Recognize save-resource intent.**
   - Examples: "save this document", "file this PDF", "attach this resource to KS-173", "upload this to Resources", "save_resource this file".
   - This skill saves existing local files. Use the `tasks-dev` skill for task CRUD and the `dashboard-dev` skill for opening the Resources page.
2. **Resolve inputs.**
   - Required: local file path and category.
   - Optional: one or more `KS-###` task links and a short notes string.
3. **Verify the file exists** when practical:

   ```powershell
   Test-Path -LiteralPath "<path>" -PathType Leaf
   ```

   If the result is `False`, ask for the correct path. Do not create a placeholder document.
4. **Run the CLI from the project checkout with Codex sandbox escalation.**
   This upload path starts `tsx`/`esbuild` and writes to Supabase, so in Codex Desktop request elevated permission for the command after upload approval is clear:

   ```bash
   execos resource add "<path>" -c <category> [--task KS-###] [--notes "..."]
   ```

   Repeat `--task` for multiple linked tasks:

   ```bash
   execos resource add "<path>" -c personal --task KS-143 --task KS-173 --notes "Reference material"
   ```

   For generated multiline notes, pipe stdin instead of writing a scratch file:

   ```powershell
   @'
   Reference material from the user's pasted context.
   '@ | execos resource add "<path>" -c personal --task KS-143 --notes -
   ```

5. **Handle errors through the CLI result.** See [Error Handling](#error-handling).
6. **Confirm the saved resource.** Report the filename, document ID, category, storage path, and linked tasks from CLI output.

# Error Handling

## File not found or empty

Ask the user for the correct file path. Do not retry with a guessed path, and do not create a dummy file to make the command pass.

## Invalid category

Show the accepted category values and ask which one applies. Category is user-visible in Resources filtering, so avoid defaulting silently when ambiguous.

## Task not found

Tell the user which task ID the CLI rejected and ask whether to save the resource unlinked or link it to a different task.

## Storage or environment error

Surface the exact CLI message. Common causes are missing `SUPABASE_URL`, missing `SUPABASE_SERVICE_ROLE_KEY`, storage bucket permissions, or sandbox restrictions.

If the command still fails with `spawn EPERM` from `tsx`/`esbuild`, say that the elevated run was blocked or insufficient and stop for user approval/context. Do not rewrite the operation as direct database or storage calls.

# Gotchas

- `resource add` requires `-c` / `--category`; there is no default category in the CLI.
- `--task` is repeatable. Do not comma-separate task IDs.
- Use `--notes -` for generated long notes. Use a real file path only for the document being uploaded; do not create scratch note files.
- The CLI may print `created storage bucket: documents` on first use. Treat that as a successful save, not a warning.
- Resources and task attachment downloads depend on signed URLs created by the web app. Saving the resource is complete when the CLI upload and metadata write succeed; browser download behavior is a separate smoke check unless the user explicitly asks to verify it.
- In Codex Desktop, do not burn a first attempt inside the sandbox for `resource add`; it predictably fails before the CLI can work because Windows blocks the `tsx`/`esbuild` spawned helper process.
- On Windows, run the npm command from the checkout and avoid compound `cmd.exe` one-liners with quoted paths.

# Final Verification

Before replying, confirm:

1. The command used was `execos resource add`, not a direct Supabase or SQL write.
2. The saved file path was real and non-empty according to the CLI.
3. The upload to Supabase was explicitly approved, including the category when it was inferred.
4. The command ran with Codex sandbox escalation when executed from Codex Desktop.
5. The category is one of the five accepted Jordan categories.
6. Every linked task came from a `KS-###` ID the CLI accepted.
7. The final response includes the document ID and storage path from CLI output.
