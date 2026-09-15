import { test } from "node:test";
import assert from "node:assert/strict";
import {
  US_STATES,
  emptyPropertyAddress,
  readPropertyAddress,
  propertyAddressError,
  addressFromPlace,
  findPropertyAddresses,
  formatPropertyAddress,
  formatPostalCodeInput,
} from "./property-address.ts";

const parts = {
  street_number: "123",
  route: "Main Street",
  locality: "Austin",
  administrative_area_level_1: "TX",
  country: "US",
  postal_code: "78701",
};
const place = {
  id: "test-place",
  addressComponents: Object.entries(parts).map(([type, text]) => ({
    types: [type],
    longText: text,
    shortText: text,
  })),
};
test("state picker contains all 50 states and DC without duplicate codes", () => {
  assert.equal(US_STATES.length, 51);
  assert.equal(new Set(US_STATES.map(([c]) => c)).size, 51);
});
test("a full street result fills city, state and ZIP", () => {
  const a = addressFromPlace(place)!;
  assert.equal(a.zip, "78701");
  assert.equal(a.street, "123 Main Street");
  assert.equal(a.city, "Austin");
  assert.equal(a.state, "TX");
  assert.equal(a.status, "matched");
  assert.equal(propertyAddressError(a), null);
});
test("ZIP+4 is offered only when the matched address supplies its suffix", () => {
  const a = addressFromPlace({ ...place, addressComponents: [...place.addressComponents,
    { types: ["postal_code_suffix"], longText: "1234", shortText: "1234" }] })!;
  assert.equal(a.zip, "78701");
  assert.equal(a.zipPlus4, "78701-1234");
  assert.equal(propertyAddressError(a), null);
  assert.equal(propertyAddressError({ ...a, zip: a.zipPlus4! }), null);
  assert.equal(addressFromPlace(place)!.zipPlus4, undefined);
});
test("pasted ZIP+4 is normalized with or without a hyphen", () => {
  for (const zip of ["78701-1234", "787011234", "78701–1234"]) assert.equal(formatPostalCodeInput(zip), "78701-1234");
  assert.equal(formatPostalCodeInput("78701"), "78701");
});
test("hosted lookup works without a Google key", async () => {
  const expected = addressFromPlace(place)!;
  const result = await findPropertyAddresses(expected, undefined, new AbortController().signal, async (a) => {
    assert.equal(a.street, "123 Main Street");
    return [expected];
  });
  assert.deepEqual(result, [expected]);
});
test("never invents a ZIP from a city-only result", () => {
  assert.equal(
    addressFromPlace({
      ...place,
      addressComponents: place.addressComponents.filter(
        (c) => c.types[0] !== "street_number",
      ),
    }),
    null,
  );
  assert.equal(
    addressFromPlace({
      ...place,
      addressComponents: place.addressComponents.filter(
        (c) => c.types[0] !== "postal_code",
      ),
    }),
    null,
  );
});
test("rejects foreign addresses", () => {
  assert.equal(
    addressFromPlace({
      ...place,
      addressComponents: place.addressComponents.map((c) =>
        c.types[0] === "country" ? { ...c, shortText: "CA" } : c,
      ),
    }),
    null,
  );
});
test("required fields and confirmation explain why Continue cannot proceed", () => {
  assert.match(propertyAddressError(emptyPropertyAddress())!, /street/);
  const a = addressFromPlace(place)!;
  assert.match(propertyAddressError({ ...a, state: "XX" })!, /state/);
  assert.match(propertyAddressError({ ...a, zip: "123" })!, /ZIP/);
  assert.match(propertyAddressError({ ...a, status: "unchecked" })!, /Confirm/);
  assert.equal(
    propertyAddressError({
      ...a,
      status: "manual",
      placeId: null,
      zip: "78701-1234",
    }),
    null,
  );
});
test("unit is preserved in the saved formatted address", () => {
  assert.equal(
    formatPropertyAddress({ ...addressFromPlace(place)!, unit: "Unit 2" }),
    "123 Main Street, Unit 2, Austin, TX 78701",
  );
});
test("malformed navigation data cannot crash the address form", () => {
  for (const value of [null, 5, [], { street: 4 }, { latitude: Infinity }])
    assert.deepEqual(readPropertyAddress(value), emptyPropertyAddress());
});
test("missing provider configuration explains manual fallback", async () => {
  await assert.rejects(
    findPropertyAddresses(
      emptyPropertyAddress(),
      undefined,
      new AbortController().signal,
    ),
    /not configured/,
  );
});
test("lookup sends complete query and handles provider failure", async () => {
  const original = globalThis.fetch;
  try {
    globalThis.fetch = async (_url, init) => {
      assert.match(
        JSON.parse(String(init?.body)).textQuery,
        /123 Main Street, Austin, TX, USA/,
      );
      return new Response(JSON.stringify({ places: [place] }), { status: 200 });
    };
    assert.equal(
      (
        await findPropertyAddresses(
          addressFromPlace(place)!,
          "test-key",
          new AbortController().signal,
        )
      )[0].zip,
      "78701",
    );
    globalThis.fetch = async () => new Response("", { status: 403 });
    await assert.rejects(
      findPropertyAddresses(
        addressFromPlace(place)!,
        "test-key",
        new AbortController().signal,
      ),
      /unavailable/,
    );
  } finally {
    globalThis.fetch = original;
  }
});
