// Mirrors the permission strings enforced in the database (has_permission). The database is the authority;
// this file only decides what to show in the UI.
export const PERMISSIONS = [
  "customers.write", "vehicles.write", "loans.write", "payments.record",
  "payments.reverse", "documents.upload", "documents.verify", "assistant.use",
] as const;
export type Permission = (typeof PERMISSIONS)[number];
export type Role = "platform_admin" | "owner" | "employee";

export interface Profile {
  id: string; financier_id: string | null; role: Role; full_name: string;
  permissions: string[]; is_active: boolean;
}

export const can = (p: Pick<Profile, "role" | "permissions">, perm: Permission) =>
  p.role === "owner" || p.permissions.includes(perm);

export function sanitizePermissions(input: unknown[]): Permission[] {
  return PERMISSIONS.filter((p) => input.includes(p));
}

export interface EmployeeInput { fullName: string; email: string; password: string; phone: string }

/** Returns a message key (see i18n) for the first problem, or null if valid. */
export function validateEmployee(i: EmployeeInput): string | null {
  if (i.fullName.trim().length < 2) return "err.name";
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(i.email.trim())) return "err.email";
  if (i.password.length < 10) return "err.password";
  if (i.phone.trim() && !/^[6-9]\d{9}$/.test(i.phone.trim())) return "err.phone";
  return null;
}
