import { supabase } from "./supabase";
import { decrypt, encrypt, newVault, unlock } from "./vault";

// IP Register (migration 0041).

export type Kind = "trade_mark" | "patent" | "design" | "copyright" | "domain" | "social_media" | "business_name" | "other";
export type Status = "pending" | "registered" | "active" | "opposed" | "lapsed" | "abandoned" | "expired" | "transferred";
export type Asset = {
  id: string;
  kind: Kind;
  name: string;
  owner_entity_id: string | null;
  jurisdiction: string | null;
  application_number: string | null;
  registration_number: string | null;
  classes: number[];
  goods_services: string | null;
  status: Status;
  filed_on: string | null;
  registered_on: string | null;
  expires_on: string | null;
  agent: string | null;
  url: string | null;
  handle: string | null;
  login_identifier: string | null;
  two_factor: string | null;
  responsible_user_id: string | null;
  notes: string | null;
};
export type AssetValues = Omit<Asset, "id">;

export const KINDS: { id: Kind; label: string; plural: string }[] = [
  { id: "trade_mark", label: "Trade mark", plural: "Trade marks" },
  { id: "patent", label: "Patent", plural: "Patents" },
  { id: "design", label: "Design", plural: "Designs" },
  { id: "copyright", label: "Copyright work", plural: "Copyright" },
  { id: "domain", label: "Domain name", plural: "Domains" },
  { id: "social_media", label: "Social media account", plural: "Social media" },
  { id: "business_name", label: "Business name", plural: "Business names" },
  { id: "other", label: "Other", plural: "Other" },
];
export const kindLabel = (k: Kind) => KINDS.find((x) => x.id === k)?.label ?? k;
export const STATUS_LABELS: Record<Status, string> = {
  pending: "Pending",
  registered: "Registered",
  active: "Active",
  opposed: "Opposed",
  lapsed: "Lapsed",
  abandoned: "Abandoned",
  expired: "Expired",
  transferred: "Transferred",
};
export const LIVE: Status[] = ["pending", "registered", "active", "opposed"];
/** Which fields each kind uses, and what to call them */
export const FIELDS: Record<Kind, { number: string; date: string; expiry: string; classes?: boolean; account?: boolean; url?: boolean; agent: string }> = {
  trade_mark: { number: "Registration number", date: "Registration date", expiry: "Renewal due", classes: true, agent: "Trade marks attorney" },
  patent: { number: "Patent number", date: "Grant date", expiry: "Next renewal or expiry", agent: "Patent attorney" },
  design: { number: "Registration number", date: "Registration date", expiry: "Renewal or expiry", classes: true, agent: "Attorney" },
  copyright: { number: "Reference", date: "Created or first published", expiry: "Copyright ends (if known)", agent: "Author or creator" },
  domain: { number: "Registry reference", date: "Registered", expiry: "Renewal due", account: true, url: true, agent: "Registrar" },
  social_media: { number: "Account ID", date: "Created", expiry: "Review by", account: true, url: true, agent: "Platform" },
  business_name: { number: "Registration number", date: "Registered", expiry: "Renewal due", agent: "Registry" },
  other: { number: "Number or reference", date: "Registered or created", expiry: "Expiry", account: true, url: true, agent: "Agent" },
};
/** Nice Classification, short headings */
export const NICE: string[] = [
  "", "Chemicals", "Paints", "Cosmetics and cleaning", "Lubricants and fuels", "Pharmaceuticals", "Metal goods", "Machinery", "Hand tools",
  "Electrical and scientific apparatus, software", "Medical apparatus", "Lighting, heating, cooling", "Vehicles", "Firearms, fireworks", "Jewellery, watches",
  "Musical instruments", "Paper goods, printed matter", "Rubber and plastics", "Leather goods", "Non-metal building materials", "Furniture",
  "Housewares, glass", "Ropes, fibres", "Yarns, threads", "Fabrics", "Clothing, footwear", "Lace, buttons, fancy goods", "Floor coverings",
  "Toys, sporting goods", "Meat, dairy, processed foods", "Staple foods", "Fresh produce, agricultural", "Light beverages", "Wines and spirits",
  "Tobacco", "Advertising, business", "Insurance, finance", "Construction, repair", "Telecommunications", "Transport, storage",
  "Treatment of materials", "Education, entertainment", "Computer and scientific services", "Hotels, restaurants", "Medical, beauty, agriculture",
  "Legal, security, personal services",
];

export const blankAsset = (kind: Kind): AssetValues => ({
  kind, name: "", owner_entity_id: null, jurisdiction: kind === "domain" || kind === "social_media" ? null : "Australia", application_number: null,
  registration_number: null, classes: [], goods_services: null, status: kind === "domain" || kind === "social_media" ? "active" : "registered",
  filed_on: null, registered_on: null, expires_on: null, agent: null, url: null, handle: null, login_identifier: null, two_factor: null,
  responsible_user_id: null, notes: null,
});

function db() {
  if (!supabase) throw new Error("The site is not connected to its database.");
  return supabase;
}
function check(error: { message: string } | null) {
  if (error) throw new Error(error.message);
}

export type Vault = { salt: string; check_iv: string; check_ciphertext: string; iterations: number } | null;
export type IpData = {
  ready: boolean;
  assets: Asset[];
  vault: Vault;
  /** Assets with a stored password that this person may handle */
  withPassword: Record<string, string>;
  people: { user_id: string | null; full_name: string }[];
  views: { asset_id: string; action: string; user_id: string | null; at: string }[];
};

export async function loadIp(organisationId: string): Promise<IpData> {
  const client = db();
  const [assets, vault, index, people, views] = await Promise.all([
    client.from("ip_assets").select("*").eq("organisation_id", organisationId).order("name"),
    client.from("ip_vaults").select("salt, check_iv, check_ciphertext, iterations").eq("organisation_id", organisationId).maybeSingle(),
    client.rpc("ip_secret_index", { p_org: organisationId }),
    client.from("people").select("user_id, full_name").eq("organisation_id", organisationId),
    client.from("ip_secret_views").select("asset_id, action, user_id, at").eq("organisation_id", organisationId).order("at", { ascending: false }).limit(200),
  ]);
  if (assets.error) return { ready: false, assets: [], vault: null, withPassword: {}, people: [], views: [] };
  return {
    ready: true,
    assets: (assets.data ?? []) as Asset[],
    vault: (vault.data ?? null) as Vault,
    withPassword: Object.fromEntries(((index.data ?? []) as { asset_id: string; updated_at: string }[]).map((r) => [r.asset_id, r.updated_at])),
    people: (people.data ?? []) as IpData["people"],
    views: (views.data ?? []) as IpData["views"],
  };
}

const tidy = (v: Partial<AssetValues>) => {
  const out: Record<string, unknown> = { ...v };
  for (const [k, x] of Object.entries(v)) if (typeof x === "string") out[k] = x.trim() || (k === "name" ? x.trim() : null);
  return out;
};
export async function saveAsset(organisationId: string, id: string | null, v: Partial<AssetValues>): Promise<string> {
  if (id) {
    check((await db().from("ip_assets").update(tidy(v)).eq("id", id)).error);
    return id;
  }
  const { data, error } = await db().from("ip_assets").insert({ ...tidy(v), organisation_id: organisationId }).select("id").single();
  check(error);
  return data!.id as string;
}

export async function setUpVault(organisationId: string, passphrase: string): Promise<CryptoKey> {
  if (passphrase.length < 12) throw new Error("Use a passphrase of at least 12 characters.");
  const v = await newVault(passphrase);
  check((await db().rpc("setup_ip_vault", { p_org: organisationId, p_salt: v.salt, p_iv: v.iv, p_ciphertext: v.ciphertext, p_iterations: v.iterations })).error);
  return v.key;
}
export const unlockVault = (passphrase: string, v: NonNullable<Vault>) => unlock(passphrase, v);

export async function storePassword(key: CryptoKey, assetId: string, password: string) {
  const e = await encrypt(key, password);
  check((await db().rpc("set_ip_secret", { p_asset: assetId, p_iv: e.iv, p_ciphertext: e.ciphertext })).error);
}
export async function removePassword(assetId: string) {
  check((await db().rpc("set_ip_secret", { p_asset: assetId, p_iv: null, p_ciphertext: null })).error);
}
/** Fetching is recorded against your name before the password is returned */
export async function revealPassword(key: CryptoKey, assetId: string): Promise<string> {
  const { data, error } = await db().rpc("get_ip_secret", { p_asset: assetId });
  check(error);
  const row = ((data ?? []) as { iv: string; ciphertext: string }[])[0];
  if (!row) throw new Error("No password is stored.");
  try {
    return await decrypt(key, row.iv, row.ciphertext);
  } catch {
    throw new Error("The password could not be decrypted with this passphrase.");
  }
}
