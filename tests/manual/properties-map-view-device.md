# Properties map view — device manual test

The automated spec at `tests/e2e/properties-map-view.spec.ts` runs against
the Expo web build, where the map is replaced by a clickable pin-row shim
(`artifacts/round-house/components/PropertiesMapView.web.tsx`). On real
iOS / Android builds the map is rendered by `react-native-maps` and pins
expose a native callout that web cannot reproduce. Run this checklist on
device after any change to the Properties tab or `PropertiesMapView.tsx`.

## Setup
1. Install a recent dev build on iOS and Android.
2. Sign in as a fully onboarded test user.
3. Make sure the user has at least:
   - Two properties with saved coordinates (add via the Add Property
     modal and pick an address from the autocomplete).
   - One property without coordinates (skip the autocomplete suggestion).

## Steps

### A. Toggle list ↔ map
- [ ] Open the Properties tab. The list view shows all properties.
- [ ] Tap the map icon in the header (accessibility label "Show map view").
      The screen swaps to a real map region with pins.
- [ ] Tap the list icon (accessibility label "Show list view"). The list
      view returns and the "Not on map" sheet is gone.

### B. Pin tap and callout
- [ ] In map view, tap a pin for one of the mapped properties. The
      property name and address appear in the native callout.
- [ ] Tap the callout itself. The app navigates to that property's
      detail screen (`/property/:id`).
- [ ] Repeat the tap, but this time tap the pin twice (pin → callout →
      callout body) and confirm only one navigation happens.

### C. Not on map fallback
- [ ] Switch to map view. Below the map a "Not on map (n)" section is
      visible.
- [ ] The unmapped property appears in that section; mapped properties
      do not.
- [ ] Tap the unmapped row. The app navigates to that property's detail
      screen.

### D. Empty state
- [ ] Temporarily hide all mapped properties (or sign in as a user with
      none). Switch to map view. The map area is replaced by the
      "No mapped properties" empty state with the address-autocomplete
      hint.

Report any callout-tap regressions or pin/marker rendering issues here
when reviewing this checklist.
