// One-time: create the first admin login.
//
//   node scripts/create-admin.mjs you@example.com "Your Name"
//
// Prints a generated first password once. Reads the Supabase settings from
// .env / .env.local in the project folder.

import { createClient } from "@supabase/supabase-js";
import { randomBytes } from "node:crypto";
import { readFileSync, existsSync } from "node:fs";

for (const file of [".env", ".env.local"]) {
  if (!existsSync(file)) continue;
  for (const line of readFileSync(file, "utf8").split(/\r?\n/)) {
    const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
}

const [email, fullName] = process.argv.slice(2);
if (!email || !fullName) {
  console.error('Usage: node scripts/create-admin.mjs you@example.com "Your Name"');
  process.exit(1);
}

const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});

const { data: org } = await db.from("organizations").select("id, name").order("created_at").limit(1).single();
if (!org) {
  console.error("No organisation in the database. Create one first.");
  process.exit(1);
}

const password = randomBytes(12).toString("base64url");
const { data: created, error } = await db.auth.admin.createUser({
  email: email.toLowerCase(),
  password,
  email_confirm: true,
  user_metadata: { full_name: fullName },
});
if (error) {
  console.error("Could not create the login:", error.message);
  process.exit(1);
}

const { error: profileError } = await db.from("profiles").insert({
  id: created.user.id,
  organization_id: org.id,
  full_name: fullName,
  email: email.toLowerCase(),
  role: "admin",
  active: true,
});
if (profileError) {
  await db.auth.admin.deleteUser(created.user.id);
  console.error("Could not create the profile:", profileError.message);
  process.exit(1);
}

console.log(`Admin created for ${org.name}.`);
console.log(`Email:    ${email}`);
console.log(`Password: ${password}   (shown once - change it after signing in)`);
