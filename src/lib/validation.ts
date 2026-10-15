// Client-side validation for instant feedback. These mirror the CHECK
// constraints in supabase/migrations; the database remains the authority.
import { z } from "zod";
import { ROLES } from "./types";

const trimmed = (min: number, max: number, label: string) =>
  z
    .string()
    .trim()
    .min(min, `${label} must be at least ${min} characters.`)
    .max(max, `${label} must be at most ${max} characters.`);

/** IMO numbers: 7 digits, last one is a checksum of the first six (weights 7..2). */
export function isValidImo(value: string): boolean {
  if (!/^\d{7}$/.test(value)) return false;
  const digits = [...value].map(Number);
  const sum = digits.slice(0, 6).reduce((acc, d, i) => acc + d * (7 - i), 0);
  return sum % 10 === digits[6];
}

export const workOrderSchema = z.object({
  title: trimmed(3, 120, "Title"),
  issue: trimmed(3, 4000, "Issue"),
  assignedTo: z.string().min(1, "Choose a crew member."),
});

export const solutionSchema = trimmed(1, 4000, "Solution");

export const rejectionSchema = trimmed(5, 2000, "Rejection reason");

export const memberSchema = z.object({
  fullName: trimmed(2, 100, "Full name"),
  email: z.string().trim().toLowerCase().max(254).email("Enter a valid email address."),
  role: z.enum(ROLES, { message: "Choose a role." }),
  vesselIds: z.array(z.string()),
});

export const vesselSchema = z.object({
  name: trimmed(2, 80, "Vessel name"),
  imoNumber: z
    .string()
    .trim()
    .regex(/^\d{7}$/, "IMO number must be exactly 7 digits.")
    .refine(isValidImo, "That IMO number's check digit is wrong."),
  vesselType: trimmed(2, 40, "Vessel type"),
});

/** First error message per field, for showing under inputs. */
export function fieldErrors(error: z.ZodError): Record<string, string> {
  const errors: Record<string, string> = {};
  for (const issue of error.issues) {
    const key = String(issue.path[0] ?? "form");
    errors[key] ??= issue.message;
  }
  return errors;
}
