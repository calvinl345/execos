export interface DelegationMessageTask {
  title: string;
  description?: string | null;
  dueDate?: Date | string | null;
  owner?: string | null;
}

export type DelegationMessageKind = "handoff" | "nudge";

export function composeDelegationMessage(input: {
  kind: DelegationMessageKind;
  task: DelegationMessageTask;
  followUpDate: Date | string | null;
  ownerDisplayName?: string | null;
}): string {
  const owner = firstName(input.ownerDisplayName ?? input.task.owner);
  const due = formatOptionalMessageDate(input.task.dueDate);
  const followUp = formatRequiredMessageDate(input.followUpDate);
  const context = compactMessageContext(input.task.description);
  const contextSentence = context ? ` Context: ${context}` : "";
  const dueSentence = due ? ` Due ${due}.` : "";

  if (input.kind === "handoff") {
    return `Hey ${owner}, can you take this on: ${input.task.title}?${contextSentence}${dueSentence} I'll check back ${followUp}.`;
  }

  return `Hey ${owner}, checking in on ${input.task.title}. Can you send me the latest?${dueSentence} I'll check back ${followUp} if we still need time.`;
}

function firstName(value: string | null | undefined): string {
  const normalized = value?.trim() ?? "";
  if (!normalized || normalized.toLowerCase() === "me") return "there";
  const [first = normalized] = normalized.split(/\s+/);
  return first.charAt(0).toUpperCase() + first.slice(1);
}

function formatOptionalMessageDate(value: Date | string | null | undefined): string | null {
  if (!value) return null;
  const date = typeof value === "string" ? new Date(value) : value;
  if (Number.isNaN(date.getTime())) return null;
  return date.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

function formatRequiredMessageDate(value: Date | string | null | undefined): string {
  if (!value) return "soon";
  const date = typeof value === "string" ? new Date(value) : value;
  if (Number.isNaN(date.getTime())) return "soon";
  return date.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

function compactMessageContext(description: string | null | undefined): string {
  const normalized = (description ?? "").trim().replace(/\s+/g, " ");
  if (!normalized) return "";
  if (normalized.length <= 160) return normalized;
  return `${normalized.slice(0, 157)}...`;
}
