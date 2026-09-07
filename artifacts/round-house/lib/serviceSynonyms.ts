/**
 * Synonyms / aliases for service categories. The picker uses this to expand a
 * user's search query so common phrasing maps to the canonical category.
 *
 * Keys are the canonical service-category name (must match SERVICE_CATEGORIES).
 * Values are short, lowercase synonym strings users may type instead.
 */
export const SERVICE_SYNONYMS: Record<string, string[]> = {
  Electrical: ["electrician", "wiring", "outlets", "panel"],
  Plumbing: ["plumber", "leak", "pipe", "drain", "water heater"],
  HVAC: ["heating", "cooling", "ac", "air conditioning", "furnace"],
  Roofing: ["roofer", "roof repair", "shingles"],
  Painting: ["painter", "interior paint", "exterior paint"],
  Carpentry: ["carpenter", "woodwork", "framing", "trim"],
  Flooring: ["floors", "hardwood", "tile floor", "laminate", "lvp"],
  Drywall: ["sheetrock", "patch hole"],
  Landscaping: ["lawn", "yard work", "gardening", "mowing"],
  "Tree Service": ["tree removal", "stump", "arborist"],
  Concrete: ["cement", "slab", "driveway"],
  Masonry: ["brick", "stone", "block"],
  Locksmith: ["lock", "rekey", "key"],
  "Pest Control": ["exterminator", "rodent", "termite"],
  Cleaning: ["maid", "house cleaning", "janitorial"],
  "Pressure Washing": ["power wash"],
  "Window Cleaning": ["wash windows"],
  "Solar Installation": ["solar panels", "pv"],
  Welding: ["welder", "metalwork"],
  Excavation: ["digging", "trenching", "grading"],
};

/** Returns true if `query` matches `canonical` either by substring or by any synonym. */
export function matchesService(canonical: string, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  if (canonical.toLowerCase().includes(q)) return true;
  const syns = SERVICE_SYNONYMS[canonical];
  if (!syns) return false;
  return syns.some((s) => s.includes(q) || q.includes(s));
}
