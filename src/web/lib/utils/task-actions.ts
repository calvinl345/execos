import type { InboxActionPayload } from "../types.js";

/**
 * Sends a task operation request to the server-side action dispatcher.
 */
export async function postTaskAction(
  taskId: string,
  payload: InboxActionPayload,
): Promise<{ ok: true; data: unknown } | { ok: false; status: number; message: string }> {
  try {
    const res = await fetch(`/api/task/${taskId}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    });

    if (res.ok) {
      let data: unknown = null;
      try {
        data = await res.json();
      } catch {
        data = null;
      }
      return { ok: true, data };
    }

    let message = "An error occurred";
    try {
      const data = await res.json();
      message = data.message || data.error || message;
    } catch {
      if (res.statusText) {
        message = res.statusText;
      }
    }

    return {
      ok: false,
      status: res.status,
      message,
    };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Network error";
    return {
      ok: false,
      status: 500,
      message,
    };
  }
}
