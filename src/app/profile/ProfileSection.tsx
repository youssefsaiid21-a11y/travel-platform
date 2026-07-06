"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { getCountryOptions } from "@/lib/countries";
import { PassportIcon } from "@/components/icons";
import styles from "./page.module.css";

interface PassengerProfile {
  id: string;
  givenName: string;
  familyName: string;
  bornOn: string;
  gender: string;
  title: string;
  phone: string;
  specialRequests: string | null;
  nationality: string | null;
  passportNumber: string | null;
  passportExpiry: string | null;
  updatedAt: string;
}

const TITLES = ["mr", "ms", "mrs", "dr", "miss"] as const;
const GENDERS = [{ value: "m", label: "Male" }, { value: "f", label: "Female" }] as const;
const TITLE_MAP: Record<string, string> = { mr: "Mr", ms: "Ms", mrs: "Mrs", dr: "Dr", miss: "Miss" };
const GENDER_MAP: Record<string, string> = { m: "Male", f: "Female" };

export function ProfileSection({ profile }: { profile: PassengerProfile | null }) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const countryOptions = getCountryOptions();

  const [form, setForm] = useState({
    title: profile?.title ?? "mr",
    gender: profile?.gender ?? "m",
    givenName: profile?.givenName ?? "",
    familyName: profile?.familyName ?? "",
    bornOn: profile?.bornOn ?? "",
    phone: profile?.phone ?? "",
    specialRequests: profile?.specialRequests ?? "",
    nationality: profile?.nationality ?? "",
    passportNumber: profile?.passportNumber ?? "",
    passportExpiry: profile?.passportExpiry ?? "",
  });

  function startEdit() {
    setForm({
      title: profile?.title ?? "mr",
      gender: profile?.gender ?? "m",
      givenName: profile?.givenName ?? "",
      familyName: profile?.familyName ?? "",
      bornOn: profile?.bornOn ?? "",
      phone: profile?.phone ?? "",
      specialRequests: profile?.specialRequests ?? "",
      nationality: profile?.nationality ?? "",
      passportNumber: profile?.passportNumber ?? "",
      passportExpiry: profile?.passportExpiry ?? "",
    });
    setError("");
    setEditing(true);
  }

  async function handleSave() {
    if (!form.givenName.trim() || !form.familyName.trim() || !form.bornOn || !form.phone.trim()) {
      setError("Name, date of birth, and phone are required.");
      return;
    }
    setSaving(true);
    setError("");
    const res = await fetch("/api/profile/passenger", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        givenName: form.givenName.trim(),
        familyName: form.familyName.trim(),
        bornOn: form.bornOn,
        gender: form.gender,
        title: form.title,
        phone: form.phone.trim(),
        specialRequests: form.specialRequests.trim() || null,
        nationality: form.nationality || null,
        passportNumber: form.passportNumber.trim() || null,
        passportExpiry: form.passportExpiry || null,
      }),
    });
    setSaving(false);
    if (!res.ok) {
      setError("Failed to save profile. Please try again.");
      return;
    }
    setEditing(false);
    router.refresh();
  }

  async function handleDelete() {
    if (!confirm("Delete your saved passenger profile? You can re-add it next time you book.")) return;
    setDeleting(true);
    await fetch("/api/profile/passenger", { method: "DELETE" });
    router.refresh();
    setDeleting(false);
  }

  if (!profile && !editing) {
    return (
      <div className={styles.emptyProfileWrap}>
        <p className={styles.emptyNote}>
          No saved profile yet. Next time you book a flight, check &ldquo;Save my details for
          faster booking&rdquo; - or add your details now.
        </p>
        <button type="button" className={styles.editBtn} onClick={startEdit}>
          Add passenger profile
        </button>
      </div>
    );
  }

  if (editing) {
    return (
      <div className={styles.editForm}>
        <div className={styles.formGrid}>
          <label className={styles.formLabel}>
            Title
            <select className={styles.formSelect} value={form.title}
              onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))}>
              {TITLES.map((t) => <option key={t} value={t}>{TITLE_MAP[t]}</option>)}
            </select>
          </label>
          <label className={styles.formLabel}>
            Gender
            <select className={styles.formSelect} value={form.gender}
              onChange={(e) => setForm((f) => ({ ...f, gender: e.target.value }))}>
            {GENDERS.map((g) => <option key={g.value} value={g.value}>{g.label}</option>)}
            </select>
          </label>
          <label className={styles.formLabel}>
            First name
            <input className={styles.formInput} value={form.givenName} required
              onChange={(e) => setForm((f) => ({ ...f, givenName: e.target.value }))} />
          </label>
          <label className={styles.formLabel}>
            Last name
            <input className={styles.formInput} value={form.familyName} required
              onChange={(e) => setForm((f) => ({ ...f, familyName: e.target.value }))} />
          </label>
          <label className={styles.formLabel}>
            Date of birth
            <input type="date" className={styles.formInput} value={form.bornOn} required
              onChange={(e) => setForm((f) => ({ ...f, bornOn: e.target.value }))} />
          </label>
          <label className={styles.formLabel}>
            Phone
            <input type="tel" className={styles.formInput} placeholder="+44 7700 900000"
              value={form.phone} required
              onChange={(e) => setForm((f) => ({ ...f, phone: e.target.value }))} />
          </label>
          <label className={styles.formLabel}>
            Nationality
            {countryOptions.length > 0 ? (
              <select className={styles.formSelect} value={form.nationality}
                onChange={(e) => setForm((f) => ({ ...f, nationality: e.target.value }))}>
                <option value="">Select country</option>
                {countryOptions.map((c) => <option key={c.code} value={c.code}>{c.name}</option>)}
              </select>
            ) : (
              <input className={styles.formInput} value={form.nationality}
                placeholder="ISO country code, e.g. GB"
                onChange={(e) => setForm((f) => ({ ...f, nationality: e.target.value.toUpperCase() }))} />
            )}
          </label>
          <label className={styles.formLabel}>
            <span className={styles.formLabelText}>
              <PassportIcon className={styles.formLabelIcon} />
              Passport number
            </span>
            <input className={styles.formInput} value={form.passportNumber}
              onChange={(e) => setForm((f) => ({ ...f, passportNumber: e.target.value }))} />
          </label>
          <label className={styles.formLabel}>
            Passport expiry
            <input type="date" className={styles.formInput} value={form.passportExpiry}
              onChange={(e) => setForm((f) => ({ ...f, passportExpiry: e.target.value }))} />
          </label>
        </div>
        <label className={`${styles.formLabel} ${styles.formLabelFull}`}>
          Special requests
          <textarea className={styles.formTextarea} rows={2}
            placeholder="Wheelchair access, meal preference…"
            value={form.specialRequests}
            onChange={(e) => setForm((f) => ({ ...f, specialRequests: e.target.value }))} />
        </label>
        {error && <p className={styles.formError}>{error}</p>}
        <div className={styles.editActions}>
          <button type="button" className={styles.saveBtn} onClick={handleSave} disabled={saving}>
            {saving ? "Saving…" : "Save profile"}
          </button>
          <button type="button" className={styles.cancelBtn} onClick={() => { setEditing(false); setError(""); }}>
            Cancel
          </button>
        </div>
      </div>
    );
  }

  return (
    <>
      <div className={styles.profileGrid}>
        <div className={styles.field}>
          <span className={styles.fieldLabel}>Name</span>
          <span className={styles.fieldValue}>
            {TITLE_MAP[profile!.title] ?? profile!.title}{" "}
            {profile!.givenName} {profile!.familyName}
          </span>
        </div>
        <div className={styles.field}>
          <span className={styles.fieldLabel}>Date of birth</span>
          <span className={styles.fieldValue}>
            {new Date(profile!.bornOn).toLocaleDateString("en-GB", { dateStyle: "medium" })}
          </span>
        </div>
        <div className={styles.field}>
          <span className={styles.fieldLabel}>Gender</span>
          <span className={styles.fieldValue}>{GENDER_MAP[profile!.gender] ?? profile!.gender}</span>
        </div>
        <div className={styles.field}>
          <span className={styles.fieldLabel}>Phone</span>
          <span className={styles.fieldValue}>{profile!.phone}</span>
        </div>
        <div className={styles.field}>
          <span className={styles.fieldLabel}>Nationality</span>
          <span className={styles.fieldValue}>{profile!.nationality ?? "Not set"}</span>
        </div>
        <div className={styles.field}>
          <span className={styles.fieldLabel}>Passport</span>
          <span className={styles.fieldValue}>
            {profile!.passportNumber
              ? `${profile!.passportNumber} · expires ${profile!.passportExpiry ? new Date(profile!.passportExpiry).toLocaleDateString("en-GB", { dateStyle: "medium" }) : "unknown"}`
              : "Not set"}
          </span>
        </div>
        {profile!.specialRequests && (
          <div className={`${styles.field} ${styles.fieldFull}`}>
            <span className={styles.fieldLabel}>Special requests</span>
            <span className={styles.fieldValue}>{profile!.specialRequests}</span>
          </div>
        )}
      </div>
      <div className={styles.profileFooter}>
        <span className={styles.savedNote}>
          Last updated{" "}
          {new Date(profile!.updatedAt).toLocaleDateString("en-GB", { dateStyle: "medium" })}
        </span>
        <div className={styles.profileActions}>
          <button type="button" className={styles.editBtn} onClick={startEdit}>Edit</button>
          <button type="button" className={styles.deleteBtn} onClick={handleDelete} disabled={deleting}>
            {deleting ? "Deleting…" : "Delete"}
          </button>
        </div>
      </div>
    </>
  );
}
