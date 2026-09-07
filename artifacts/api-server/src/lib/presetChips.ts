import { and, asc, eq, isNull, sql } from "drizzle-orm";
import {
  db,
  presetChipsTable,
  presetGroupsTable,
  type PresetChip,
  type PresetGroup,
} from "@workspace/db";

/**
 * Admin-editable chip/token sets. Six built-in sets ship today; new
 * sets just need to be added to {@link DEFAULT_PRESET_SETS} and the
 * matching consumer site updated to read from this layer.
 */
export const PRESET_SET_KEYS = [
  "home_priorities",
  "maintenance_focus",
  "trades",
  "service_categories",
  "work_order_categories",
  "work_order_priorities",
] as const;
export type PresetSetKey = (typeof PRESET_SET_KEYS)[number];

export const PRESET_SET_LABELS: Record<PresetSetKey, string> = {
  home_priorities: "Home priorities",
  maintenance_focus: "Maintenance focus",
  trades: "Trades",
  service_categories: "Service categories",
  work_order_categories: "Work order categories",
  work_order_priorities: "Work order priorities",
};

export interface DefaultChip {
  chipId: string;
  label: string;
  sublabel?: string;
  groupKey?: string;
}
export interface DefaultGroup {
  groupKey: string;
  label: string;
}
export interface DefaultPresetSet {
  chips: DefaultChip[];
  groups?: DefaultGroup[];
}

// --- Built-in fallback / seed values ---------------------------------
// Mirrors the hardcoded mobile lists they seed on first boot. Keep in
// sync with: artifacts/round-house/lib/intake-schemas.ts (home/matters,
// facilities/maintenanceGoals, trade_pro/trade), serviceCategories.ts,
// and WorkOrderEditorModal CATEGORIES/PRIORITIES.

const HOME_PRIORITIES: DefaultChip[] = [
  { chipId: "warmth", label: "Warmth" },
  { chipId: "longevity", label: "Longevity" },
  { chipId: "design", label: "Design" },
  { chipId: "safety", label: "Safety" },
  { chipId: "calm", label: "Calm" },
  { chipId: "garden", label: "Garden" },
  { chipId: "memory", label: "Memory" },
];

const MAINTENANCE_FOCUS: DefaultChip[] = [
  { chipId: "preventive", label: "Preventive" },
  { chipId: "compliance", label: "Compliance" },
  { chipId: "uptime", label: "Uptime" },
  { chipId: "cost", label: "Cost" },
  { chipId: "tenant", label: "Tenant satisfaction" },
  { chipId: "energy", label: "Energy" },
];

const TRADES: DefaultChip[] = [
  { chipId: "general", label: "General Contractor" },
  { chipId: "electrician", label: "Electrician" },
  { chipId: "plumber", label: "Plumber" },
  { chipId: "hvac", label: "HVAC" },
  { chipId: "carpenter", label: "Carpenter" },
  { chipId: "painter", label: "Painter" },
  { chipId: "landscaper", label: "Landscaper" },
  { chipId: "cleaner", label: "Cleaner" },
  { chipId: "handyman", label: "Handyman" },
  { chipId: "other", label: "Other" },
];

const WO_CATEGORIES: DefaultChip[] = [
  { chipId: "preventive", label: "Preventive" },
  { chipId: "corrective", label: "Corrective" },
  { chipId: "emergency", label: "Emergency" },
  { chipId: "inspection", label: "Inspection" },
];

const WO_PRIORITIES: DefaultChip[] = [
  { chipId: "low", label: "Low" },
  { chipId: "normal", label: "Normal" },
  { chipId: "high", label: "High" },
  { chipId: "urgent", label: "Urgent" },
];

// Service categories are grouped — pulled from serviceCategories.ts.
const SERVICE_CATEGORY_GROUPS: { label: string; items: string[] }[] = [
  {
    label: "Design & Creative",
    items: [
      "Architectural Renderings",
      "Structural Engineer",
      "Interior Designer",
      "Landscape Design",
      "Custom Wall Relief",
      "Custom Ambient Lighting Packages",
      "SketchUp",
      "AI Design Engines",
      "AutoCAD",
      "Mixed Material Art",
      "Mixed Medium Artist",
    ],
  },
  {
    label: "Handyman & General Contracting",
    items: [
      "General contracting",
      "Handyman services",
      "Home repairs",
      "Property maintenance",
      "Punch list completion",
      "Move-in/out turnover",
    ],
  },
  {
    label: "Carpentry & Cabinetry",
    items: [
      "Carpenter",
      "Cabinet Maker",
      "Finish carpentry",
      "Trim & molding",
      "Cabinet install",
      "Built-ins & shelving",
      "Door install/repair",
      "Window install/repair",
      "Drywall install",
      "Drywall repair",
      "Framing",
      "Stair install/repair",
    ],
  },
  {
    label: "Flooring",
    items: [
      "Flooring install (hardwood)",
      "Flooring install (tile)",
      "Flooring install (LVP)",
      "Carpet install",
      "Subfloor repair",
    ],
  },
  {
    label: "Plumbing",
    items: [
      "Leak detection",
      "Pipe repair",
      "Pipe replacement",
      "Drain cleaning",
      "Sewer line repair",
      "Toilet install/repair",
      "Faucet install/repair",
      "Water heater install",
      "Water heater repair",
      "Tankless water heater",
      "Garbage disposal",
      "Sump pump install",
      "Backflow testing",
      "Gas line install/repair",
      "Re-pipe (whole home)",
    ],
  },
  {
    label: "Electrical",
    items: [
      "Panel upgrade",
      "Wiring & rewiring",
      "Outlet & switch install",
      "Lighting install",
      "Recessed lighting",
      "Ceiling fan install",
      "EV charger install",
      "Generator install",
      "Smoke/CO detector install",
      "Surge protection",
      "Electrical inspection",
    ],
  },
  {
    label: "HVAC",
    items: [
      "AC install",
      "AC repair",
      "Furnace install",
      "Furnace repair",
      "Heat pump install",
      "Mini-split install",
      "Ductwork install/repair",
      "Duct cleaning",
      "Thermostat install",
      "HVAC tune-up",
      "Indoor air quality",
    ],
  },
  {
    label: "Painting",
    items: [
      "Interior painting",
      "Exterior painting",
      "Cabinet refinishing",
      "Wallpaper hanging/removal",
      "Deck staining",
      "Pressure washing",
    ],
  },
  {
    label: "Roofing & Exterior",
    items: [
      "Roof install",
      "Roof repair",
      "Gutter install/cleaning",
      "Siding install/repair",
      "Stucco repair",
      "Chimney repair",
      "Skylight install",
      "Soffit & fascia repair",
    ],
  },
  {
    label: "Concrete & Masonry",
    items: [
      "Concrete pour",
      "Concrete repair",
      "Driveway install/repair",
      "Patio install",
      "Brick & stone masonry",
      "Retaining walls",
    ],
  },
  {
    label: "Landscape & Yard",
    items: [
      "Lawn care & mowing",
      "Tree trimming",
      "Tree removal",
      "Shrub & hedge trimming",
      "Mulch & bed install",
      "Sod install",
      "Sprinkler install/repair",
      "Drainage solutions",
      "Fence install/repair",
      "Deck install",
      "Hardscape design",
      "Snow removal",
      "Leaf removal",
    ],
  },
  {
    label: "Cleaning",
    items: [
      "Standard house cleaning",
      "Deep cleaning",
      "Move-in/out cleaning",
      "Post-construction cleaning",
      "Carpet cleaning",
      "Window cleaning",
      "Junk removal",
    ],
  },
  {
    label: "Specialty",
    items: [
      "Pool maintenance",
      "Pool install/repair",
      "Pest control",
      "Mold remediation",
      "Asbestos abatement",
      "Insulation install",
      "Solar install",
      "Smart home install",
      "Security system install",
      "Garage door install/repair",
      "Appliance install/repair",
      "Locksmith services",
      "Window treatments",
      "Awnings & shades",
    ],
  },
  {
    label: "Remodels",
    items: [
      "Kitchen remodel",
      "Bathroom remodel",
      "Basement finishing",
      "Attic conversion",
      "ADU construction",
      "Whole-home remodel",
      "Tenant improvement",
    ],
  },
  {
    label: "Inspection & Consulting",
    items: [
      "Home inspection",
      "Energy audit",
      "Project management",
      "Estimating & consulting",
    ],
  },
];

function slugify(input: string): string {
  return input
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_|_$/g, "")
    .slice(0, 60);
}

function buildServiceCategoryDefaults(): DefaultPresetSet {
  const groups: DefaultGroup[] = [];
  const chips: DefaultChip[] = [];
  const seenChips = new Set<string>();
  for (const g of SERVICE_CATEGORY_GROUPS) {
    const groupKey = slugify(g.label);
    groups.push({ groupKey, label: g.label });
    for (const item of g.items) {
      let chipId = slugify(item);
      let suffix = 1;
      while (seenChips.has(chipId)) {
        chipId = `${slugify(item)}_${++suffix}`;
      }
      seenChips.add(chipId);
      chips.push({ chipId, label: item, groupKey });
    }
  }
  return { chips, groups };
}

export const DEFAULT_PRESET_SETS: Record<PresetSetKey, DefaultPresetSet> = {
  home_priorities: { chips: HOME_PRIORITIES },
  maintenance_focus: { chips: MAINTENANCE_FOCUS },
  trades: { chips: TRADES },
  service_categories: buildServiceCategoryDefaults(),
  work_order_categories: { chips: WO_CATEGORIES },
  work_order_priorities: { chips: WO_PRIORITIES },
};

// --- Seed --------------------------------------------------------------

let seedPromise: Promise<void> | null = null;

/**
 * Idempotent first-boot seed: any set with zero rows in `preset_chips`
 * is populated from the bundled defaults above. Safe to call multiple
 * times — we use `ON CONFLICT DO NOTHING` so partial states heal too.
 */
export async function seedPresetChipsIfEmpty(): Promise<void> {
  if (seedPromise) return seedPromise;
  seedPromise = (async () => {
    for (const setKey of PRESET_SET_KEYS) {
      const def = DEFAULT_PRESET_SETS[setKey];
      const existing = await db
        .select({ id: presetChipsTable.id })
        .from(presetChipsTable)
        .where(eq(presetChipsTable.setKey, setKey))
        .limit(1);
      if (existing.length > 0) continue;

      if (def.groups && def.groups.length > 0) {
        await db
          .insert(presetGroupsTable)
          .values(
            def.groups.map((g, i) => ({
              setKey,
              groupKey: g.groupKey,
              label: g.label,
              sortOrder: i,
            })),
          )
          .onConflictDoNothing({
            target: [presetGroupsTable.setKey, presetGroupsTable.groupKey],
          });
      }
      if (def.chips.length > 0) {
        await db
          .insert(presetChipsTable)
          .values(
            def.chips.map((c, i) => ({
              setKey,
              chipId: c.chipId,
              label: c.label,
              sublabel: c.sublabel ?? null,
              groupKey: c.groupKey ?? null,
              sortOrder: i,
            })),
          )
          .onConflictDoNothing({
            target: [presetChipsTable.setKey, presetChipsTable.chipId],
          });
      }
    }
  })().catch((err) => {
    seedPromise = null;
    throw err;
  });
  return seedPromise;
}

// --- Read --------------------------------------------------------------

export interface PublicChipDTO {
  id: number;
  chipId: string;
  label: string;
  sublabel: string | null;
  groupKey: string | null;
  sortOrder: number;
  /** ISO timestamp if the chip is archived; null otherwise. */
  archivedAt: string | null;
}
export interface PublicGroupDTO {
  id: number;
  groupKey: string;
  label: string;
  sortOrder: number;
}
export interface PublicPresetSetDTO {
  setKey: PresetSetKey;
  chips: PublicChipDTO[];
  groups: PublicGroupDTO[];
}

export interface AdminChipDTO extends PublicChipDTO {
  archivedAt: string | null;
  updatedAt: string;
}
export interface AdminPresetSetDTO {
  setKey: PresetSetKey;
  label: string;
  chips: AdminChipDTO[];
  groups: PublicGroupDTO[];
}

function rowToPublic(row: PresetChip): PublicChipDTO {
  return {
    id: row.id,
    chipId: row.chipId,
    label: row.label,
    sublabel: row.sublabel,
    groupKey: row.groupKey,
    sortOrder: row.sortOrder,
    archivedAt: row.archivedAt ? row.archivedAt.toISOString() : null,
  };
}
function rowToAdmin(row: PresetChip): AdminChipDTO {
  return {
    ...rowToPublic(row),
    archivedAt: row.archivedAt ? row.archivedAt.toISOString() : null,
    updatedAt: row.updatedAt.toISOString(),
  };
}
function groupRowToDTO(row: PresetGroup): PublicGroupDTO {
  return {
    id: row.id,
    groupKey: row.groupKey,
    label: row.label,
    sortOrder: row.sortOrder,
  };
}

export async function listPublicPresetSets(): Promise<{
  sets: Record<string, PublicPresetSetDTO>;
  updatedAt: string;
}> {
  await seedPresetChipsIfEmpty();
  // Public payload includes archived chips so consumers can resolve a
  // historical chipId back to its current label and mark it as
  // retired. Pickers must filter on archivedAt themselves.
  const [chips, groups] = await Promise.all([
    db
      .select()
      .from(presetChipsTable)
      .orderBy(asc(presetChipsTable.setKey), asc(presetChipsTable.sortOrder)),
    db
      .select()
      .from(presetGroupsTable)
      .orderBy(asc(presetGroupsTable.setKey), asc(presetGroupsTable.sortOrder)),
  ]);
  const sets: Record<string, PublicPresetSetDTO> = {};
  for (const setKey of PRESET_SET_KEYS) {
    sets[setKey] = { setKey, chips: [], groups: [] };
  }
  for (const c of chips) {
    const set = sets[c.setKey] ?? (sets[c.setKey] = {
      setKey: c.setKey as PresetSetKey,
      chips: [],
      groups: [],
    });
    set.chips.push(rowToPublic(c));
  }
  for (const g of groups) {
    const set = sets[g.setKey] ?? (sets[g.setKey] = {
      setKey: g.setKey as PresetSetKey,
      chips: [],
      groups: [],
    });
    set.groups.push(groupRowToDTO(g));
  }
  // Compute a deterministic updatedAt from max(updatedAt) across both
  // tables so clients can short-circuit on no-change refetches.
  const [latest] = await db
    .select({
      ts: sql<Date | null>`GREATEST(
        (SELECT MAX(${presetChipsTable.updatedAt}) FROM ${presetChipsTable}),
        (SELECT MAX(${presetGroupsTable.updatedAt}) FROM ${presetGroupsTable})
      )`.as("ts"),
    })
    .from(presetChipsTable)
    .limit(1);
  const updatedAt = latest?.ts ? new Date(latest.ts).toISOString() : new Date(0).toISOString();
  return { sets, updatedAt };
}

export async function listAdminPresetSets(): Promise<{
  sets: AdminPresetSetDTO[];
}> {
  await seedPresetChipsIfEmpty();
  const [chips, groups] = await Promise.all([
    db
      .select()
      .from(presetChipsTable)
      .orderBy(asc(presetChipsTable.setKey), asc(presetChipsTable.sortOrder)),
    db
      .select()
      .from(presetGroupsTable)
      .orderBy(asc(presetGroupsTable.setKey), asc(presetGroupsTable.sortOrder)),
  ]);
  const sets: AdminPresetSetDTO[] = PRESET_SET_KEYS.map((setKey) => ({
    setKey,
    label: PRESET_SET_LABELS[setKey],
    chips: [],
    groups: [],
  }));
  const byKey = new Map(sets.map((s) => [s.setKey, s] as const));
  for (const c of chips) {
    const s = byKey.get(c.setKey as PresetSetKey);
    if (s) s.chips.push(rowToAdmin(c));
  }
  for (const g of groups) {
    const s = byKey.get(g.setKey as PresetSetKey);
    if (s) s.groups.push(groupRowToDTO(g));
  }
  return { sets };
}

// --- Mutations ---------------------------------------------------------

function isValidSetKey(key: string): key is PresetSetKey {
  return (PRESET_SET_KEYS as readonly string[]).includes(key);
}

function normLabel(label: unknown): string | null {
  if (typeof label !== "string") return null;
  const trimmed = label.trim();
  if (trimmed.length === 0 || trimmed.length > 80) return null;
  return trimmed;
}

export async function createChip(input: {
  setKey: string;
  label: string;
  groupKey?: string | null;
}): Promise<{ chip: AdminChipDTO } | { error: string }> {
  if (!isValidSetKey(input.setKey)) return { error: "Unknown preset set" };
  const label = normLabel(input.label);
  if (!label) return { error: "Label cannot be empty" };
  // Duplicate check (case-insensitive among non-archived chips).
  const dupes = await db
    .select({ id: presetChipsTable.id })
    .from(presetChipsTable)
    .where(
      and(
        eq(presetChipsTable.setKey, input.setKey),
        isNull(presetChipsTable.archivedAt),
        sql`lower(${presetChipsTable.label}) = lower(${label})`,
      ),
    )
    .limit(1);
  if (dupes.length > 0) return { error: "A chip with that label already exists" };
  // Generate chipId — slugify label, append numeric suffix if needed.
  const base = slugify(label) || "chip";
  let chipId = base;
  let i = 1;
  // Loop until we find an unused chipId for this set.
  // (Unique among ALL chips in set, including archived, so historical refs stay stable.)
  while (true) {
    const [exists] = await db
      .select({ id: presetChipsTable.id })
      .from(presetChipsTable)
      .where(
        and(
          eq(presetChipsTable.setKey, input.setKey),
          eq(presetChipsTable.chipId, chipId),
        ),
      )
      .limit(1);
    if (!exists) break;
    chipId = `${base}_${++i}`;
  }
  const [maxRow] = await db
    .select({ m: sql<number>`coalesce(max(${presetChipsTable.sortOrder}), -1)` })
    .from(presetChipsTable)
    .where(eq(presetChipsTable.setKey, input.setKey));
  const sortOrder = (Number(maxRow?.m ?? -1) || -1) + 1;
  const [inserted] = await db
    .insert(presetChipsTable)
    .values({
      setKey: input.setKey,
      chipId,
      label,
      groupKey: input.groupKey ?? null,
      sortOrder,
    })
    .returning();
  return { chip: rowToAdmin(inserted) };
}

export async function updateChip(
  id: number,
  patch: { label?: string; groupKey?: string | null; archived?: boolean },
): Promise<{ chip: AdminChipDTO } | { error: string }> {
  const [existing] = await db
    .select()
    .from(presetChipsTable)
    .where(eq(presetChipsTable.id, id));
  if (!existing) return { error: "Chip not found" };

  const updates: Partial<typeof presetChipsTable.$inferInsert> = {};
  if (patch.label !== undefined) {
    const label = normLabel(patch.label);
    if (!label) return { error: "Label cannot be empty" };
    if (label.toLowerCase() !== existing.label.toLowerCase()) {
      const dupes = await db
        .select({ id: presetChipsTable.id })
        .from(presetChipsTable)
        .where(
          and(
            eq(presetChipsTable.setKey, existing.setKey),
            isNull(presetChipsTable.archivedAt),
            sql`lower(${presetChipsTable.label}) = lower(${label})`,
          ),
        )
        .limit(1);
      if (dupes.length > 0)
        return { error: "A chip with that label already exists" };
    }
    updates.label = label;
  }
  if (patch.groupKey !== undefined) {
    updates.groupKey = patch.groupKey;
  }
  if (patch.archived !== undefined) {
    updates.archivedAt = patch.archived ? new Date() : null;
  }
  if (Object.keys(updates).length === 0) {
    return { chip: rowToAdmin(existing) };
  }
  const [updated] = await db
    .update(presetChipsTable)
    .set(updates)
    .where(eq(presetChipsTable.id, id))
    .returning();
  return { chip: rowToAdmin(updated) };
}

export async function reorderChips(
  setKey: string,
  orderedIds: number[],
): Promise<{ ok: true } | { error: string }> {
  if (!isValidSetKey(setKey)) return { error: "Unknown preset set" };
  const rows = await db
    .select({ id: presetChipsTable.id, setKey: presetChipsTable.setKey })
    .from(presetChipsTable)
    .where(eq(presetChipsTable.setKey, setKey));
  const owned = new Set(rows.map((r) => r.id));
  for (const id of orderedIds) {
    if (!owned.has(id)) return { error: `Chip ${id} not in this set` };
  }
  for (let i = 0; i < orderedIds.length; i++) {
    await db
      .update(presetChipsTable)
      .set({ sortOrder: i })
      .where(eq(presetChipsTable.id, orderedIds[i]!));
  }
  return { ok: true };
}

export async function renameGroup(
  id: number,
  label: string,
): Promise<{ group: PublicGroupDTO } | { error: string }> {
  const norm = normLabel(label);
  if (!norm) return { error: "Group label cannot be empty" };
  const [updated] = await db
    .update(presetGroupsTable)
    .set({ label: norm })
    .where(eq(presetGroupsTable.id, id))
    .returning();
  if (!updated) return { error: "Group not found" };
  return { group: groupRowToDTO(updated) };
}
