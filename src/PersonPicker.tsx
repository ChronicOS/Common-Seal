import { useEffect, useId, useState } from "react";
import { supabase } from "./supabase";

export type PersonOption = { full_name: string; email: string | null; user_id: string | null };

// The people of the organisation that is open, loaded once and shared by every picker
let currentOrg: string | null = null;
let cache: { org: string; list: Promise<PersonOption[]> } | null = null;
export function setPickerOrganisation(id: string) {
  currentOrg = id;
  if (cache && cache.org !== id) cache = null;
}
function load(): Promise<PersonOption[]> {
  if (!currentOrg || !supabase) return Promise.resolve([]);
  if (!cache || cache.org !== currentOrg) {
    const org = currentOrg;
    const list = (async () => {
      const { data } = await supabase!.from("people").select("full_name, email, user_id").eq("organisation_id", org).order("full_name");
      return ((data ?? []) as PersonOption[]).filter((p) => (p.full_name ?? "").trim());
    })();
    cache = { org, list };
  }
  return cache.list;
}

/**
 * One way to name a person anywhere in VeraPhius: type to pick someone in the organisation,
 * or type any name for someone outside it. Picking someone also gives their email where a form needs it.
 */
export default function PersonPicker({ id, value, onChange, placeholder, disabled, label, className }: {
  id?: string; value: string; onChange: (name: string, person: PersonOption | null) => void; placeholder?: string; disabled?: boolean; label?: string; className?: string;
}) {
  const auto = useId();
  const listId = `people-${auto.replace(/:/g, "")}`;
  const [people, setPeople] = useState<PersonOption[]>([]);
  useEffect(() => {
    let live = true;
    void load().then((p) => live && setPeople(p));
    return () => {
      live = false;
    };
  }, []);
  return (
    <>
      <input id={id} className={className} list={people.length ? listId : undefined} aria-label={label} placeholder={placeholder ?? (people.length ? "Type to pick a person, or any name" : undefined)} disabled={disabled} value={value} autoComplete="off"
        onChange={(e) => {
          const name = e.target.value;
          const match = people.find((p) => p.full_name.toLowerCase() === name.trim().toLowerCase()) ?? null;
          onChange(name, match);
        }} />
      {people.length > 0 && (
        <datalist id={listId}>
          {people.map((p) => <option key={`${p.full_name}-${p.email ?? ""}`} value={p.full_name}>{p.email ?? (p.user_id ? "" : "outside VeraPhius")}</option>)}
        </datalist>
      )}
    </>
  );
}
