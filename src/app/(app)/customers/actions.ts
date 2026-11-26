"use server";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { requireProfile } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { emptyToNull, normalizeMobile, normalizeRegistration, validateCustomer, validateVehicle } from "@/lib/records";

const s = (f: FormData, k: string) => String(f.get(k) ?? "");
const dbErr = (e: { code?: string; message?: string }) => (e.code === "42501" ? "err.noPerm" : e.code === "23505" ? "err.regExists" : "err.generic");

function customerPayload(f: FormData) {
  return { full_name: s(f, "fullName").trim(), mobile: normalizeMobile(s(f, "mobile")), address: emptyToNull(f.get("address")),
    district: emptyToNull(f.get("district")), state: emptyToNull(f.get("state")) };
}
function vehiclePayload(f: FormData) {
  return { registration_number: normalizeRegistration(s(f, "registration")), make: emptyToNull(f.get("make")), model: emptyToNull(f.get("model")),
    manufacture_year: emptyToNull(f.get("year")) === null ? null : Number(s(f, "year")), category: s(f, "category"),
    chassis_number: emptyToNull(f.get("chassis")), engine_number: emptyToNull(f.get("engine")), registered_owner: emptyToNull(f.get("owner")),
    insurance_expiry: emptyToNull(f.get("insuranceExpiry")), hypothecation_details: emptyToNull(f.get("hypothecation")) };
}

export async function createCustomer(f: FormData) {
  await requireProfile();
  const bad = validateCustomer({ fullName: s(f, "fullName"), mobile: s(f, "mobile") });
  if (bad) redirect(`/customers/new?err=${bad}`);
  const { data, error } = await (await createClient()).from("customers").insert(customerPayload(f)).select("id").single();
  if (error || !data) redirect(`/customers/new?err=${error ? dbErr(error) : "err.generic"}`);
  revalidatePath("/customers");
  redirect(`/customers/${data.id}?ok=cust.created`);
}

export async function updateCustomer(f: FormData) {
  await requireProfile();
  const id = s(f, "id");
  const bad = validateCustomer({ fullName: s(f, "fullName"), mobile: s(f, "mobile") });
  if (bad) redirect(`/customers/${id}?err=${bad}`);
  const status = s(f, "status");
  const { data, error } = await (await createClient()).from("customers").update({ ...customerPayload(f), status }).eq("id", id).select("id");
  if (error || !data?.length) redirect(`/customers/${id}?err=${error ? dbErr(error) : "err.noPerm"}`);
  revalidatePath(`/customers/${id}`);
  redirect(`/customers/${id}?ok=cust.saved`);
}

export async function createVehicle(f: FormData) {
  await requireProfile();
  const customerId = s(f, "customerId");
  const p = vehiclePayload(f);
  const bad = validateVehicle({ registration: p.registration_number, year: emptyToNull(f.get("year")), category: p.category });
  if (bad) redirect(`/customers/${customerId}?err=${bad}`);
  const { error } = await (await createClient()).from("vehicles").insert({ ...p, customer_id: customerId });
  if (error) redirect(`/customers/${customerId}?err=${dbErr(error)}`);
  revalidatePath(`/customers/${customerId}`);
  redirect(`/customers/${customerId}?ok=veh.created`);
}

export async function updateVehicle(f: FormData) {
  await requireProfile();
  const id = s(f, "id"), customerId = s(f, "customerId");
  const p = vehiclePayload(f);
  const bad = validateVehicle({ registration: p.registration_number, year: emptyToNull(f.get("year")), category: p.category });
  if (bad) redirect(`/customers/${customerId}?err=${bad}`);
  // Staff without chassis access submit no chassis/engine fields; leave those columns untouched.
  const { chassis_number, engine_number, ...rest } = p;
  const patch = f.has("chassis") ? { ...rest, chassis_number, engine_number } : rest;
  const { data, error } = await (await createClient()).from("vehicles").update(patch).eq("id", id).select("id");
  if (error || !data?.length) redirect(`/customers/${customerId}?err=${error ? dbErr(error) : "err.noPerm"}`);
  revalidatePath(`/customers/${customerId}`);
  redirect(`/customers/${customerId}?ok=veh.saved`);
}
