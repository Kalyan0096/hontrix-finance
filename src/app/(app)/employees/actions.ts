"use server";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { requireOwner } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { PERMISSIONS, sanitizePermissions, validateEmployee } from "@/lib/permissions";
import { validatePassword } from "@/lib/password";

const perms = (f: FormData) => sanitizePermissions(PERMISSIONS.filter((p) => f.get(p) === "on"));

export async function createEmployee(formData: FormData) {
  const owner = await requireOwner();
  const input = {
    fullName: String(formData.get("fullName") ?? ""), email: String(formData.get("email") ?? "").trim().toLowerCase(),
    password: String(formData.get("password") ?? ""), phone: String(formData.get("phone") ?? ""),
  };
  const bad = validateEmployee(input);
  if (bad) redirect(`/employees?err=${bad}`);

  const admin = createAdminClient();
  const { data, error } = await admin.auth.admin.createUser({ email: input.email, password: input.password, email_confirm: true });
  if (error || !data.user) redirect(`/employees?err=${error?.code === "email_exists" ? "err.exists" : "err.generic"}`);

  // financier_id always comes from the owner's own profile, never from the form.
  const { error: pErr } = await admin.from("profiles").insert({
    id: data.user.id, financier_id: owner.financier_id, role: "employee",
    full_name: input.fullName.trim(), phone: input.phone.trim() || null, permissions: perms(formData),
  });
  if (pErr) { await admin.auth.admin.deleteUser(data.user.id); redirect("/employees?err=err.generic"); }
  revalidatePath("/employees");
  redirect("/employees?ok=emp.created");
}

export async function updateEmployee(formData: FormData) {
  await requireOwner();
  const supabase = await createClient(); // user-scoped: RLS lets an owner update only employees of their own business
  const { data, error } = await supabase.from("profiles")
    .update({ permissions: perms(formData), is_active: formData.get("is_active") === "on" })
    .eq("id", String(formData.get("id"))).select("id");
  if (error || !data?.length) redirect("/employees?err=err.generic");
  revalidatePath("/employees");
  redirect("/employees?ok=emp.updated");
}

export async function resetEmployeePassword(formData: FormData) {
  await requireOwner();
  const id = String(formData.get("id") ?? ""), pw = String(formData.get("password") ?? "");
  const bad = validatePassword(pw);
  if (bad) redirect(`/employees?err=${bad}`);
  // The user-scoped read only returns employees of the owner's own business (row-level security), so another business's user cannot be targeted.
  const { data: emp } = await (await createClient()).from("profiles").select("id").eq("id", id).eq("role", "employee").maybeSingle();
  if (!emp) redirect("/employees?err=err.generic");
  const { error } = await createAdminClient().auth.admin.updateUserById(emp.id, { password: pw });
  if (error) redirect("/employees?err=err.generic");
  redirect("/employees?ok=emp.passwordReset");
}
