import type { TeamMember } from "../types.js";
import { dueLabel } from "./dates.js";

export function resolveDisplayName(slug: string | null, team: TeamMember[]): string {
  if (slug === null || slug.trim() === "" || slug.trim().toLowerCase() === "me") {
    return "me";
  }
  const target = slug.trim().toLowerCase();
  const match = team.find((member) => member.slug.toLowerCase() === target);
  return match ? match.displayName : slug.trim();
}

export function composeSlackNudge(displayName: string, title: string, dueDate: string | null): string {
  const rawFirstName = displayName.trim().split(" ")[0] || "";
  const firstName = rawFirstName ? rawFirstName.charAt(0).toUpperCase() + rawFirstName.slice(1) : "";

  if (dueDate) {
    const formattedDate = dueLabel(dueDate);
    return `Hey ${firstName}, just checking in on: "${title}" (originally due ${formattedDate}). Let me know if you need any help or if we should adjust the timeline!`;
  } else {
    return `Hey ${firstName}, just checking in on: "${title}". Let me know how it's going!`;
  }
}
