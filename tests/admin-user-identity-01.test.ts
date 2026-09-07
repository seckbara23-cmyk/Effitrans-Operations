/**
 * ADMIN-USER-IDENTITY-01 / DBC-STAFF-IDENTITY-01 — a System Administrator must
 * be able to change a staff member's name, fonction and titre principal from
 * Administration → Users.
 * ---------------------------------------------------------------------------
 * THE GAP THIS CLOSES, from the audit: `lib/users/actions.ts` had create,
 * suspend, archive, restore, assign role, revoke role and four password levers —
 * and NO update. There was no way to correct a name anywhere in the Users area,
 * and the only editor for a job title was the Digital Branding Center.
 *
 * THE RULE THAT OUTRANKS EVERY OTHER TEST HERE: professional identity is not
 * authority. Section « SECURITY » is the one to read first.
 *
 * Numbering follows the brief's §23 matrix.
 */
import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  IDENTITY_MAX,
  SUGGESTED_FUNCTIONS,
  buildStaffIdentity,
  displayNameFrom,
  normalizeField,
  validateIdentity,
} from "@/lib/users/identity";
import { USER_ADMIN_PERMISSIONS, canUserAdmin, userAdminCodes } from "@/lib/users/permissions";
import { AuditActions } from "@/lib/audit/events";

const read = (p: string) => readFileSync(fileURLToPath(new URL(`../${p}`, import.meta.url)), "utf8");
const code = (p: string) =>
  read(p).replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

const ACTIONS = "lib/users/actions.ts";
const SERVICE = "lib/users/service.ts";
const PANEL = "components/users/user-identity-panel.tsx";
const LIST = "components/users/users-admin.tsx";
const DETAILS = "app/users/[id]/page.tsx";
const PROBE = "lib/users/identity-141.ts";
const MIGRATION = "supabase/migrations/20261003000001_staff_professional_identity.sql";
const VERIFIER = "supabase/verifiers/20261003000001_staff_professional_identity.verify.sql";

/** The slice of `actions.ts` that is the identity editor, and only it. */
function identityAction(): string {
  const src = code(ACTIONS);
  const from = src.indexOf("export async function updateUserIdentity");
  expect(from, "updateUserIdentity must exist").toBeGreaterThan(-1);
  const next = src.indexOf("\nexport async function", from + 10);
  return src.slice(from, next === -1 ? undefined : next);
}

// ===========================================================================
// ADMINISTRATION — §23.1 … §23.11
// ===========================================================================

describe("the administrator can edit a staff identity from the Users area", () => {
  it("01/02/03 — the Users area reaches a per-user page, and the action says « Modifier »", () => {
    const list = code(LIST);
    expect(list).toContain("href={`/users/${user.id}`}");
    expect(list).toContain("{t.users.actions.edit}");
    expect(read("lib/i18n.ts")).toContain('edit: "Modifier"');
    // Same interaction pattern as before — a link to the existing details page.
    // No modal, no drawer, no second navigation idiom invented for this.
    expect(list).not.toMatch(/<dialog|role="dialog"/);
  });

  it("04 — the edit surface loads the stored values", () => {
    const panel = code(PANEL);
    for (const seed of [
      "useState(identity.firstName ?? \"\")",
      "useState(identity.lastName ?? \"\")",
      "useState(identity.displayName)",
      "useState(identity.functionLabel ?? \"\")",
      "useState(identity.mainTitle ?? \"\")",
    ]) {
      expect(panel, seed).toContain(seed);
    }
    expect(code(DETAILS)).toContain("<UserIdentityPanel");
    expect(code(DETAILS)).toContain("identity={user.identity}");
  });

  it("05/06/07/08 — all four ratified fields are editable, and they are four fields", () => {
    const panel = read(PANEL);
    for (const label of ["Prénom", "Nom", "Fonction", "Titre principal"]) {
      expect(panel, label).toContain(label);
    }
    // Fonction and Titre are NOT synonyms and never share an input.
    expect(panel).toContain("setFunctionLabel");
    expect(panel).toContain("setMainTitle");
    const a = identityAction();
    expect(a).toContain("row.job_title = v.mainTitle");
    expect(a).toContain("row.staff_function = v.functionLabel");
  });

  it("09 — a partial edit preserves every untouched field", () => {
    // `undefined` is « not touched » and must never be confused with `null`,
    // which is « clear it ». The validator keeps the distinction…
    expect(normalizeField(undefined)).toBeUndefined();
    expect(normalizeField(null)).toBeNull();
    expect(normalizeField("  Chef   de  Transit ")).toBe("Chef de Transit");
    expect(normalizeField("   ")).toBeNull();

    const only = validateIdentity({ mainTitle: "Chef de Transit" });
    expect(only.ok).toBe(true);
    if (only.ok) {
      expect(only.value.mainTitle).toBe("Chef de Transit");
      expect(only.value.firstName).toBeUndefined();
      expect(only.value.functionLabel).toBeUndefined();
    }
    // …the action only writes what it was given…
    const a = identityAction();
    expect(a).toContain("if (v.mainTitle !== undefined) row.job_title = v.mainTitle;");
    expect(a).toContain("if (v.firstName !== undefined) row.first_name = v.firstName;");
    // …and the client only sends what actually changed.
    expect(code(PANEL)).toContain('if (mainTitle !== (identity.mainTitle ?? "")) patch.mainTitle = mainTitle;');
  });

  it("10/11 — success and failure are both reported truthfully", () => {
    const panel = code(PANEL);
    expect(panel).toContain("setSaved(true)");
    expect(panel).toContain("router.refresh()");
    // Every refusal the action can emit has its own sentence; none of them is
    // the word « succès ».
    for (const err of ["forbidden", "not_found", "user_archived", "invalid_identity", "identity_schema_unavailable", "generic"]) {
      expect(panel, err).toContain(`${err}:`);
    }
    // `setSaved(true)` may only be reached AFTER the refusal branch returns.
    const refusal = panel.indexOf("if (!res.ok)");
    expect(refusal).toBeGreaterThan(-1);
    expect(refusal).toBeLessThan(panel.indexOf("setSaved(true)"));
  });

  it("09b — a user with NO professional profile yet still saves", () => {
    // 28 of the 60 production users have no `workforce_profile` row at all, so
    // this is the COMMON path, not an edge case. The write is an upsert that
    // supplies only `user_id`, `tenant_id`, `updated_by` and the touched
    // identity columns — which works because `signature_variant` and
    // `public_card_enabled` are NOT NULL *with defaults* (verified against the
    // live schema). Supplying them here instead would silently reset a person's
    // signature variant every time an administrator fixed a typo in their name.
    const a = identityAction();
    expect(a).toContain('.upsert(row as never, { onConflict: "user_id" })');
    expect(a).toContain("user_id: userId,");
    expect(a).toContain("tenant_id: admin.tenantId,");
    expect(a).toContain("updated_by: admin.id,");
    for (const untouched of ["signature_variant", "public_card_enabled", "public_card_token", "photo_asset_id", "phone_"]) {
      expect(a, `identity editing must not write ${untouched}`).not.toContain(untouched);
    }
    // And the profile is only written when something for it actually changed —
    // the three keys above are always present, so >3 means a real field.
    expect(a).toContain("if (Object.keys(row).length > 3) {");
  });

  it("09c — editing only a title never writes a name the admin did not enter", () => {
    // ⚠ A REAL BUG, found on review rather than by a test. `displayNameFrom`
    // falls back to the e-mail — correct for RENDERING an unnamed user, wrong
    // for WRITING. Two production users have no stored name, so an
    // administrator who edited only their titre principal would have had their
    // e-mail address written into `app_user.name`: « no name recorded » would
    // silently have become « their name is finance@effitrans.com », as a side
    // effect of an unrelated edit.
    //
    // The name is now written only when the name was actually touched.
    const a = identityAction();
    expect(a).toContain("const nameTouched =");
    expect(a).toContain("v.displayName !== undefined || v.firstName !== undefined || v.lastName !== undefined;");
    expect(a).toContain("if (nameTouched && nextName !== target.name) {");
    // …and the audit does not claim a name change that did not happen.
    const flatAction = a.replace(/\s+/g, " ");
    expect(flatAction).toContain("if (nameTouched && nextName !== target.name) { changed.display_name");
    // The fallback itself is unchanged: rendering an unnamed user still yields
    // the e-mail, which is the architecture's existing final fallback.
    expect(displayNameFrom({ email: "finance@effitrans.com" })).toBe("finance@effitrans.com");
    expect(buildStaffIdentity({ email: "plain@test.local" }).displayName).toBe("plain@test.local");
  });

  it("11b — an empty submission is refused rather than reported as saved", () => {
    expect(validateIdentity({})).toEqual({ ok: false, error: "nothing_to_change" });
    expect(code(PANEL)).toContain("Aucune modification à enregistrer.");
  });

  it("11c — values that cannot be stored are refused, not truncated", () => {
    const tooLong = "x".repeat(IDENTITY_MAX + 1);
    expect(validateIdentity({ firstName: tooLong })).toEqual({ ok: false, error: "first_name_invalid" });
    expect(validateIdentity({ mainTitle: tooLong })).toEqual({ ok: false, error: "main_title_invalid" });
    // Two answers to one question is refused outright.
    expect(validateIdentity({ displayName: "A B", firstName: "A" }))
      .toEqual({ ok: false, error: "name_conflict" });
  });
});

// ===========================================================================
// SECURITY — §23.12 … §23.18. THE SECTION THAT MATTERS MOST.
// ===========================================================================

describe("professional identity is NOT authority", () => {
  it("12 — an ordinary user cannot edit another staff member's identity", () => {
    const a = identityAction();
    expect(a).toContain('assertAnyPermission(userAdminCodes("update"))');
    expect(a).toContain('return { ok: false, error: "forbidden" }');
    // The gate is the FIRST thing, before any read of the target.
    expect(a.indexOf("userAdminCodes")).toBeLessThan(a.indexOf('.from("app_user")'));
    // And it is a real, existing, narrowly-held capability — not a new one
    // invented to make this feature reachable.
    expect(USER_ADMIN_PERMISSIONS.update).toBe("admin:users:update");
    expect(userAdminCodes("update")).toEqual(["admin:users:update", "admin:users:manage"]);
    expect(canUserAdmin([], "update")).toBe(false);
    expect(canUserAdmin(["file:read", "customs:update"], "update")).toBe(false);
    expect(canUserAdmin(["admin:users:update"], "update")).toBe(true);
  });

  it("13/14/15/16/17 — no identity field can grant, revoke or change anything", () => {
    // ⚠⚠ THE HARD ARCHITECTURAL RULE. Changing « Fonction = Transit » and
    // « Titre principal = Chef de Transit » must not produce CHIEF_OF_TRANSIT,
    // must not produce `customs:validate`, and must not produce anything at all.
    //
    // Asserted structurally rather than behaviourally, because the strongest
    // form of « it cannot grant » is that the code has no mechanism to: the
    // identity editor never touches the role tables and never resolves a
    // permission.
    const a = identityAction();
    for (const forbidden of [
      "user_role", "role_permission", '"role"', "assignRole", "revokeRole",
      "getEffectivePermissions", "hasPermission", "is_system_admin",
      "grant", "ROLE_", "CHIEF_OF_TRANSIT",
    ]) {
      expect(a, `the identity editor must not mention ${forbidden}`).not.toContain(forbidden);
    }
    // The pure identity model is likewise free of RBAC — it cannot even import it.
    const model = code("lib/users/identity.ts");
    expect(model).not.toContain("rbac");
    expect(model).not.toContain("permission");
    expect(model).not.toContain("role");
    // The three columns it writes, exhaustively. Nothing else.
    const written = a.match(/row\.[a-z_]+ =/g) ?? [];
    expect([...new Set(written)].sort()).toEqual([
      "row.first_name =", "row.job_title =", "row.last_name =", "row.staff_function =",
    ]);
  });

  it("18 — the user's identity, e-mail and account state are never rewritten", () => {
    const a = identityAction();
    // The ONE update on app_user, and it sets exactly one column.
    const updates = a.match(/\.update\(\{[^}]*\}\)/g) ?? [];
    expect(updates).toHaveLength(1);
    expect(updates[0]).toBe(".update({ name: nextName })");
    // Scoped by id AND tenant: an administrator of one tenant cannot reach
    // another's user even by guessing a uuid.
    expect(a).toContain('.eq("id", userId)');
    expect(a).toContain('.eq("tenant_id", admin.tenantId)');
    expect(a).toContain("target.tenant_id !== admin.tenantId");
    for (const forbidden of ["email:", "status:", "id:", "password", "auth", "token", "session"]) {
      expect(a.toLowerCase(), forbidden).not.toContain(`${forbidden.toLowerCase()} =`);
    }
  });

  it("18b — an archived user stays read-only", () => {
    expect(identityAction()).toContain('if (target.status === "archived") return { ok: false, error: "user_archived" };');
  });
});

// ===========================================================================
// OPERATIONAL INTEGRITY — §23.19 … §23.24
// ===========================================================================

describe("a rename breaks nothing operational", () => {
  it("19/20/21/22/23/24 — every reference is keyed by uuid, and the rename touches none", () => {
    // THE AUDIT'S STRONGEST FINDING: 204 foreign keys reference `app_user`, and
    // every one of them is a uuid. Not one operational relationship is keyed by
    // display text, so a rename CANNOT break a dossier assignment, a process
    // step, a handoff, a document, an Account Manager designation or an audit
    // actor — there is no text join to break.
    //
    // What this asserts is that the identity editor stays inside that property:
    // it writes `app_user.name` and three `workforce_profile` columns, and it
    // touches no table that carries an operational relationship.
    const a = identityAction();
    const tables = [...a.matchAll(/\.from\("([a-z_]+)"\)/g)].map((m) => m[1]);
    expect([...new Set(tables)].sort()).toEqual(["app_user", "workforce_profile"]);
    for (const t of [
      "operational_file", "process_step_execution", "process_handoff", "document",
      "assignment_event", "account_manager_id", "assigned_user_id", "task", "invoice",
    ]) {
      expect(a, `identity editing must not reach ${t}`).not.toContain(t);
    }
  });

  it("24b — and the display name is derived, never a second stored fact", () => {
    expect(displayNameFrom({ firstName: "Mamadou", lastName: "Diallo", email: "m@x.sn" }))
      .toBe("Mamadou Diallo");
    // Precedence, in order.
    expect(displayNameFrom({ firstName: "Mamadou", email: "m@x.sn" })).toBe("Mamadou");
    expect(displayNameFrom({ legacyName: "Ancien Nom", email: "m@x.sn" })).toBe("Ancien Nom");
    expect(displayNameFrom({ email: "m@x.sn" })).toBe("m@x.sn");
    expect(displayNameFrom({ firstName: "  ", lastName: " ", legacyName: " ", email: "m@x.sn" }))
      .toBe("m@x.sn");
  });
});

// ===========================================================================
// DBC — §23.25 … §23.30
// ===========================================================================

describe("the Digital Branding Center reads the canonical identity and holds none", () => {
  it("25/28 — the business card resolves the name and title from the canonical stores", () => {
    const card = code("lib/brand/server/card-service.ts");
    expect(card).toContain("app_user:user_id(name, email, status)");
    expect(card).toContain("name: user.name ?? user.email");
    expect(card).toContain("title: row.job_title");
  });

  it("26 — and the fonction, once the schema can hold it", () => {
    const card = code("lib/brand/server/card-service.ts");
    expect(card).toContain("const withFunction = await staffIdentityStored();");
    expect(card).toContain("department: withFunction ? (row.staff_function ?? null) : null,");
  });

  it("27/29 — the signature and generated documents read the same single title", () => {
    for (const mod of [
      "lib/brand/server/signature-actions.ts",
      "lib/brand/server/document-actions.ts",
    ]) {
      const src = code(mod);
      expect(src, mod).toContain('.from("workforce_profile")');
      expect(src, mod).toContain("job_title");
      expect(src, mod).toContain("u.name ?? u.email");
    }
  });

  it("30 — there is ONE title value, so no duplicate can become authoritative", () => {
    // ⚠ THE DUPLICATION QUESTION, answered precisely. `workforce_profile.job_title`
    // is the only store: the Users editor writes it and the Brand Center writes
    // it, and they write THE SAME COLUMN. Two editors, one value, last write
    // wins — so there is no canonical-versus-override precedence to resolve,
    // because there is no second value to prefer.
    //
    // The Brand Center label used to say « Fonction (titre professionnel) »,
    // collapsing the two ratified concepts onto the column that holds the title.
    // That was a labelling defect, and it is fixed.
    expect(identityAction()).toContain("row.job_title = v.mainTitle");
    expect(code("lib/brand/server/actions.ts")).toContain("row.job_title = t;");
    const people = code("components/brand/people-manager.tsx");
    expect(people).toContain('label="Titre principal"');
    // The old label survives in a comment that records WHY it changed; what
    // must not survive is the rendered string.
    expect(people).not.toContain("Fonction (titre professionnel)");
    expect(read("components/brand/people-manager.tsx")).toContain("Fonction (titre professionnel)");
    expect(people).toContain("Administration → Utilisateurs");
    // And no branding table holds a name or a title of its own.
    for (const t of ["tenant_brand_profile", "brand_asset"]) {
      expect(code("lib/brand/server/card-service.ts"), t).not.toMatch(
        new RegExp(`from\\("${t}"\\)[\\s\\S]{0,120}job_title`),
      );
    }
  });
});

// ===========================================================================
// LEGACY — §23.31 … §23.34
// ===========================================================================

describe("existing users render safely and nothing is invented for them", () => {
  it("31/32/33 — a user with no fonction and no title renders from what exists", () => {
    const legacy = buildStaffIdentity({
      legacyName: "Cheikh Ahmadou Bamba SECK",
      email: "declarant1@effitrans.com",
    });
    expect(legacy.displayName).toBe("Cheikh Ahmadou Bamba SECK");
    expect(legacy.firstName).toBeNull();
    expect(legacy.lastName).toBeNull();
    expect(legacy.functionLabel).toBeNull();
    expect(legacy.mainTitle).toBeNull();

    // And a user with NOTHING at all still renders — the e-mail fallback the
    // architecture already requires. Two production rows are in this state.
    expect(buildStaffIdentity({ email: "plain@test.local" }).displayName).toBe("plain@test.local");
  });

  it("33b — a legacy display name is NEVER split into a first and last name", () => {
    // « Cheikh Ahmadou Bamba SECK » has no safe split, and guessing one would
    // assert a family name nobody gave the platform. The vCard exporter guesses
    // because a vCard demands the structure; the identity model does not.
    const model = code("lib/users/identity.ts");
    expect(model).not.toContain(".split(");
    expect(model).not.toContain("splitName");
    // Nor does the migration backfill one.
    expect(read(MIGRATION)).toContain("must not backfill");
    expect(read(MIGRATION)).not.toMatch(/^\s*update\s+public\.workforce_profile/im);
  });

  it("34 — a missing title is NEVER inferred from a role", () => {
    // ⚠ « role = CHIEF_OF_TRANSIT » must not become « title = Chef de Transit ».
    // Security role is not professional identity, and the inference would look
    // helpful right up to the moment somebody's card announced a job they do
    // not hold.
    const model = code("lib/users/identity.ts");
    const service = code(SERVICE);
    for (const src of [model, service]) {
      expect(src).not.toMatch(/CHIEF_OF_TRANSIT|CUSTOMS_DECLARANT|roleLabel|ROLE_LABEL/);
    }
    expect(code(SERVICE)).toContain("mainTitle: wp?.job_title ?? null,");
    // The identity built for a user with roles and no title has no title.
    expect(buildStaffIdentity({ email: "x@y.z", legacyName: "X" }).mainTitle).toBeNull();
  });

  it("34b — the fonction suggestions are suggestions, not a closed catalogue", () => {
    // The 30 live titles are free-form and inconsistently cased
    // («DECLARANT EN DOUANE», «declarant en douane»). A rigid catalogue would
    // have rejected legitimate values on the day it shipped.
    expect(SUGGESTED_FUNCTIONS).toContain("Transit");
    expect(SUGGESTED_FUNCTIONS).toContain("Douane");
    expect(validateIdentity({ functionLabel: "Quelque chose d'inattendu" }).ok).toBe(true);
    expect(code(PANEL)).toContain("list=\"effitrans-functions\"");
    expect(code(PANEL)).toContain("<datalist id=\"effitrans-functions\">");
  });
});

// ===========================================================================
// AUDIT — §23.35 … §23.39
// ===========================================================================

describe("the edit is auditable through the existing architecture", () => {
  it("35/36/37 — one audit row, naming the actor and the target", () => {
    const a = identityAction();
    expect(a).toContain("await writeAudit({");
    expect(a).toContain("action: AuditActions.USER_IDENTITY_UPDATED");
    expect(a).toContain("actorId: admin.id");
    expect(a).toContain("entityId: userId");
    expect(a).toContain('entity: "app_user"');
    expect(AuditActions.USER_IDENTITY_UPDATED).toBe("user.identity.updated");
    // The EXISTING audit writer, not a parallel system.
    expect(a).not.toContain("insert");
    expect(code(ACTIONS)).toContain('import { writeAudit } from "@/lib/audit/log"');
  });

  it("38 — old and new values are both represented", () => {
    const a = identityAction();
    expect(a).toContain("before: before[col] ?? null");
    expect(a).toContain("after: (row[col] as string | null) ?? null");
    expect(a.replace(/\s+/g, " ")).toContain("changed.display_name = { before: target.name, after: nextName };");
  });

  it("39 — no credential, token or session data can reach the audit", () => {
    const a = identityAction();
    for (const secret of [
      "password", "temp_password", "public_card_token", "token", "session",
      "access_token", "refresh", "secret", "auth.admin",
    ]) {
      expect(a.toLowerCase(), secret).not.toContain(secret.toLowerCase());
    }
  });

  it("39b — and it is not filed as a privilege change", () => {
    // An auditor scanning for `user.role.*` must not find an identity edit, and
    // an auditor scanning for identity edits must not have to read role rows.
    expect(AuditActions.USER_IDENTITY_UPDATED).not.toContain("role");
    expect(AuditActions.USER_IDENTITY_UPDATED).not.toContain("permission");
  });
});

// ===========================================================================
// HISTORY — §23.40 … §23.42
// ===========================================================================

describe("current identity moves; history does not", () => {
  it("40 — no immutable artefact is rewritten", () => {
    const a = identityAction();
    for (const t of [
      "brand_asset", "generated_document", "aging_report_artifact", "ec_message",
      "business_event", "audit_log",
    ]) {
      expect(a, `identity editing must not rewrite ${t}`).not.toContain(t);
    }
    // Only two tables are written at all, and neither stores a historical artefact.
    expect(a).toContain('.from("app_user")');
    expect(a).toContain('.from("workforce_profile")');
  });

  it("41 — an existing audit row stays linked to the same user", () => {
    // Audit rows carry `actor_id`, a uuid. The rename does not touch the id, so
    // every historical row keeps pointing at the same person — and an audit UI
    // that resolves a CURRENT display name will show the new one, which is the
    // documented dynamic behaviour rather than a rewrite.
    expect(identityAction()).not.toContain("actor_id");
    expect(identityAction()).toContain(".update({ name: nextName })");
  });

  it("42 — the dynamic surfaces are told to re-render", () => {
    const a = identityAction();
    expect(a).toContain('revalidatePath("/users")');
    expect(a).toContain("revalidatePath(`/users/${userId}`)");
    // The branding surfaces read the same two stores, so they need no second
    // write — but their pages are cached.
    expect(a).toContain('revalidatePath("/brand-center")');
  });
});

// ===========================================================================
// SCHEMA — §23.43 … §23.47
// ===========================================================================

describe("schema 138 renders and saves safely, with three migrations pending", () => {
  const PENDING = {
    "#139": ["gainde_declaration_reference", "gainde_tax_payment", "record_declaration_reference"],
    "#140": ["services"],
    "#141": ["first_name", "last_name", "staff_function"],
  };
  const GUARDS = ["gaindeLedgerAvailable", "serviceScopeStored", "staffIdentityStored"];

  it("43/46 — the Users read never names a pending column unconditionally", () => {
    const svc = code(SERVICE);
    expect(svc).toContain("const identityStorable = await staffIdentityStored();");
    // Whitespace-insensitive on purpose: the working tree is CRLF, and a
    // literal-with-newlines assertion passes or fails on line endings rather
    // than on the property it claims to test. It did exactly that once.
    const flat = svc.replace(/\s+/g, " ");
    expect(flat).toContain(
      'identityStorable ? "user_id, job_title, first_name, last_name, staff_function" : "user_id, job_title"',
    );
    // The schema-138 branch names NONE of the three pending columns.
    const safeBranch = '"user_id, job_title"';
    expect(flat).toContain(safeBranch);
    for (const pending of PENDING["#141"]) {
      expect(safeBranch, pending).not.toContain(pending);
    }
    expect(svc).toContain('"user_id, job_title"');
    // A GENUINE failure still throws. Only the not-yet-applied migration was
    // made survivable, and it was made survivable by NOT ASKING.
    //
    // Scoped to the profile read: `service.ts` has an unrelated try/catch of its
    // own, and a module-wide ban would have been a assertion about the wrong
    // thing that happened to pass.
    expect(svc).toContain("[users] professional profile read failed:");
    const at = svc.indexOf("profileRows.error");
    expect(at).toBeGreaterThan(-1);
    expect(svc.slice(at - 400, at + 200)).not.toContain("try {");
  });

  it("44/45 — #139 and #140 are untouched by this slice", () => {
    const mine = read(MIGRATION);
    for (const name of [...PENDING["#139"], ...PENDING["#140"]]) {
      expect(mine, name).not.toContain(name);
    }
    // …and their probes still exist and still guard their own modules.
    for (const probe of ["lib/customs/schema-139.ts", "lib/files/service-scope-140.ts"]) {
      expect(read(probe), probe).toContain("42703");
    }
  });

  it("46b — the probe is narrow: one column, one SQLSTATE, zero rows, per request", () => {
    const probe = code(PROBE);
    expect(probe).toContain('const UNDEFINED_COLUMN = "42703"');
    expect(probe).toContain("if (error.code === UNDEFINED_COLUMN) return false;");
    expect(probe).toContain(".limit(0)");
    expect(probe).toContain('import { cache } from "react"');
    expect(probe).toContain("throw new Error(`[users] identity schema probe failed:");
    expect(probe).not.toContain("try {");
    expect(probe).not.toContain("catch");
    expect(read(PROBE)).toContain("DELETE THIS FILE");
    expect(read("tests/tenant-scope.test.ts")).toContain('"lib/users/identity-141.ts::workforce_profile"');
  });

  it("47 — ⚠ NO FALSE PERSISTENCE: an unstorable field is REFUSED, never dropped", () => {
    // §21, verbatim: « do not claim data was saved when it could not be
    // persisted ». The trap would have been to accept a Prénom, write nothing,
    // and report success — the administrator would believe the platform holds a
    // name it has never seen.
    const a = identityAction();
    expect(a).toContain("const canStoreSplit = await staffIdentityStored();");
    expect(a).toContain("if (wantsSplit && !canStoreSplit) return { ok: false, error: \"identity_schema_unavailable\" };");
    // The refusal is decided BEFORE anything is written.
    expect(a.indexOf("canStoreSplit")).toBeLessThan(a.indexOf(".update({ name: nextName })"));
    // …and the UI does not offer what cannot be stored, saying why instead.
    const panel = read(PANEL);
    expect(panel).toContain("{storable ? (");
    expect(panel).toContain("20261003000001");
    expect(panel).toContain("pas encore disponibles");
    expect(panel).toContain("Aucune donnée n&apos;est perdue");
  });

  it("47b — the repo-wide census still passes with a THIRD pending migration", () => {
    // The same exhaustive walk OPS-UAT-CONVERGENCE-01 introduced, extended to
    // #141. A name only reaches the database through `.from(x)` / `.select(x)` /
    // `.rpc(x)`; everywhere else it is inert.
    //
    // ⚠ AND #141 FORCED THE CENSUS TO BECOME TABLE-AWARE, which the first draft
    // was not. `first_name` and `last_name` are ALSO columns of HR's `employee`
    // table — they have existed since migration 57, they are NOT NULL there, and
    // six HR modules read them perfectly legitimately on schema 138. Flagging
    // them by name alone reported six false offenders and would have pushed a
    // future author to "fix" working code. What is pending is those names ON
    // `workforce_profile`, so that is what is checked.
    const files = walk(fileURLToPath(new URL("..", import.meta.url)));
    const offenders: string[] = [];
    for (const rel of files) {
      if (rel.startsWith("tests/")) continue;
      const src = code(rel);
      for (const [guard, names, table] of [
        [GUARDS[0], PENDING["#139"], null],
        [GUARDS[1], PENDING["#140"], "operational_file"],
        [GUARDS[2], PENDING["#141"], "workforce_profile"],
      ] as const) {
        if (src.includes(guard)) continue;
        // A column name is only dangerous in a module that queries the table it
        // belongs to. `staff_function` is unique enough to stand alone;
        // `first_name` and `services` are not.
        if (table && !src.includes(`.from("${table}")`)) continue;
        for (const name of names) {
          const re = new RegExp(`\\.(from|select|rpc)\\(\\s*[\`"'][^\`"']*\\b${name}\\b`);
          if (re.test(src)) offenders.push(`${rel}: ${name}`);
        }
      }
    }
    expect(offenders, offenders.join("\n")).toEqual([]);
  });

  it("47d — and HR keeps its own first_name/last_name, which are NOT pending", () => {
    // The other half of the correction above, pinned so nobody "fixes" HR.
    // `employee.first_name` and `employee.last_name` shipped with migration 57,
    // are NOT NULL, and belong to a different object with a different lifecycle.
    // This slice adds columns to `workforce_profile` and touches no HR table.
    expect(code("lib/hr/read.ts")).toContain("first_name");
    expect(code("lib/hr/read.ts")).toContain('.from("employee")');
    // The migration's PROSE explains at length why HR is not the authority; its
    // SQL must not touch HR at all. Stripping the comments is the difference
    // between checking what it says and checking what it does.
    const sql = read(MIGRATION).replace(/^\s*--.*$/gm, "");
    expect(sql).not.toContain("employee");
    expect(sql).toContain("workforce_profile");
    expect(read(MIGRATION)).toContain("This migration touches no HR table.");
    // …and HR remains a separate authority: the identity editor never reads it,
    // so renaming a login does not rename an employee record, and vice versa.
    // Reconciling the two is RQ-ID-1, deliberately unresolved.
    expect(identityAction()).not.toContain("employee");
  });

  it("47c — the migration ships with a verifier and backfills nothing", () => {
    const m = read(MIGRATION);
    expect(m).toContain("migrate:executor db-query");
    expect(m).toContain("NOT APPLIED");
    expect(m).toContain("add column if not exists first_name");
    expect(m).toContain("staff_function");
    // FUNCTION is a reserved word; the column deliberately is not called it.
    expect(m).not.toMatch(/add column if not exists\s+"?function"?\s/i);
    const v = read(VERIFIER);
    expect(v).toContain("Read-only");
    expect(v).toContain("ok boolean, detail text");
    // The verifier asserts the architectural rule too, in the database.
    expect(v).toContain("no permission code was created from the identity vocabulary");
    expect(v).toContain("HR''s employee registry was not touched");
  });
});

/** Every application source file, repo-relative, for the exhaustive census. */
function walk(dir: string, base = dir, out: string[] = []): string[] {
  const SKIP = new Set(["node_modules", ".next", ".git", "supabase", "docs", "scripts", "public"]);
  for (const e of readdirSync(dir)) {
    if (SKIP.has(e)) continue;
    const p = `${dir}/${e}`;
    if (statSync(p).isDirectory()) walk(p, base, out);
    else if (/\.(ts|tsx)$/.test(e)) out.push(p.slice(base.length).replace(/^\/+/, ""));
  }
  return out;
}
