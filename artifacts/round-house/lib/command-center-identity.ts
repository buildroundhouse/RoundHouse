type Account = { kind: string; companyName?: string | null; sourceUserModeId?: number | null };
type Mode = { id: number; kind: string; intakeData?: unknown };
const text = (v: unknown) => typeof v === "string" ? v.trim() : "";
export function commandCenterIdentity(account: Account | null, mode: Mode | null) {
  const md = (mode?.intakeData ?? {}) as Record<string, unknown>;
  const kind = account?.kind ?? mode?.kind ?? "collab";
  const home = kind === "home" || kind === "home_teammate";
  const facility = kind === "facilities" || kind === "facilities_teammate";
  const viewer = ["collab", "trade_pro_collab", "facilities_collab", "viewer"].includes(kind);
  const supply = /suppl(y|ier)/i.test(kind) || /suppl(y|ier)/i.test(text(md.businessType));
  const roles: Record<string, string> = {
    home: "Homeowner", home_teammate: "Home Teammate",
    facilities: "Facility Management", facilities_teammate: "Facility Teammate",
    trade_pro: "Trade Professional", trade_pro_teammate: "Trade Teammate",
  };
  const roleLabel = viewer ? "Viewer" : supply ? "Supply" : roles[kind] ?? "Viewer";
  // Account titles/display names may be a person's name. Only named spaces
  // belong in this header; the photo represents the person.
  const entityName = home || facility
    ? text(md.placeName) || text(md.propertyName) || text(md.facilityName) || text(md.belongsTo) || (home ? "Home" : "Facility")
    : viewer ? text(md.placeName) || text(md.propertyName) || text(md.facilityName)
    : text(md.companyName) || text(md.businessName) || text(md.belongsTo) || text(account?.companyName) || (supply ? "Supply" : "Business");
  return { entityName, roleLabel };
}
