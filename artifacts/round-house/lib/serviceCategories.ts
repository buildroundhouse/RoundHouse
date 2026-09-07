/**
 * Curated set of preset service categories for trade pros, organized into
 * named groups so the picker can render section headers and users aren't
 * staring at a single 120-item alphabet soup.
 *
 * Source of truth is `SERVICE_GROUPS` (label + items). The flat
 * `SERVICE_CATEGORIES` export is derived from it and preserves group
 * order — older callers that expect a single flat string[] keep working
 * unchanged.
 */
export type ServiceGroup = {
  label: string;
  items: string[];
};

export const SERVICE_GROUPS: ServiceGroup[] = [
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

/** Flat list of every preset service, in group order. Kept for callers
 *  that don't care about grouping (search, validation, etc.). */
export const SERVICE_CATEGORIES: string[] = SERVICE_GROUPS.flatMap(
  (g) => g.items,
);

/**
 * Render a service name in "sentence case" — only the first word
 * capitalised — while leaving real acronyms (HVAC, AC, EV, ADU, LVP, AI)
 * and CamelCase brand names (AutoCAD, SketchUp) untouched. We deliberately
 * do NOT mutate the curated source list or any saved user selections so
 * that existing data keeps matching the picker; instead every chip surface
 * pipes through this helper at render time.
 *
 * Rules per whitespace-separated token:
 *   - Pure whitespace → kept as-is.
 *   - All-uppercase letter run of length ≥2 (HVAC, EV, AC, ADU, LVP, AI,
 *     and parenthesised forms like "(LVP)") → kept as-is.
 *   - Internal mixed case (AutoCAD, SketchUp, iPhone-ish) → kept as-is.
 *   - Otherwise → lowercase the entire token. The first non-whitespace
 *     token additionally has its first letter upper-cased.
 */
export function displayServiceName(name: string): string {
  let firstWordSeen = false;
  return name
    .split(/(\s+)/)
    .map((token) => {
      if (/^\s+$/.test(token) || token.length === 0) return token;
      const letters = token.replace(/[^A-Za-z]/g, "");
      const isAcronym =
        letters.length >= 2 && letters === letters.toUpperCase();
      const isCamelCase =
        /[a-z][A-Z]/.test(letters) || /[A-Z].*[A-Z]/.test(letters);
      let out = token;
      if (!isAcronym && !isCamelCase) {
        out = token.toLowerCase();
        if (!firstWordSeen) {
          // Capitalise the first alphabetic character of the first
          // word — handles tokens that lead with punctuation too.
          out = out.replace(/[a-z]/, (c) => c.toUpperCase());
        }
      }
      firstWordSeen = true;
      return out;
    })
    .join("");
}
