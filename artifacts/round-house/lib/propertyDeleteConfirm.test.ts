/**
 * Web-build regression coverage for the three destructive
 * confirmation prompts on the property detail screen — Delete spec,
 * Delete standard, and Delete note (task #385, follow-up to #384).
 *
 * React Native Web ships `Alert.alert` as a no-op, so before #384
 * these prompts silently auto-deleted on the web build. #384 routed
 * them through `lib/confirm.ts` which uses `window.confirm` on web,
 * and #385 hardens that fix with two layers of coverage:
 *
 *   1. Behavioural: the screen installs handlers built by
 *      `make{Spec,Standard,Note}DeleteHandler` factories that own
 *      the confirm + mutation + invalidate sequence end-to-end. We
 *      call the factories with stand-in mutations and a stand-in
 *      list, then assert that accepting the prompt removes the
 *      entry and cancelling leaves it in place.
 *
 *   2. Wiring: a source-level assertion against
 *      `app/property/[id].tsx` that proves each delete handler is
 *      built from the matching factory and that no `Alert.alert(`
 *      lurks inside those handler bodies — so a future regression
 *      that bypasses the helper or reintroduces `Alert.alert` is
 *      caught by this test even before the screen runs.
 *
 * `react-native` is mocked because the api-server vitest runner
 * executes in a Node environment and the helpers under test only
 * depend on `Platform.OS` and `Alert.alert` from RN via the shared
 * `confirm()` helper — so the mock is enough.
 */
import {
  describe,
  it,
  expect,
  vi,
  beforeEach,
  afterEach,
} from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

vi.mock("react-native", () => ({
  Alert: { alert: vi.fn() },
  Platform: { OS: "web" },
}));

import { Alert } from "react-native";
import {
  confirmDeleteSpec,
  confirmDeleteStandard,
  confirmDeleteNote,
  makeSpecDeleteHandler,
  makeStandardDeleteHandler,
  makeNoteDeleteHandler,
  SPEC_DELETE_CONFIRM,
  STANDARD_DELETE_CONFIRM,
  NOTE_DELETE_CONFIRM,
} from "./propertyDeleteConfirm";

type ConfirmStub = ReturnType<typeof vi.fn>;

const setWindowConfirm = (impl: (text?: string) => boolean) => {
  const stub = vi.fn(impl);
  (globalThis as unknown as { confirm: ConfirmStub }).confirm = stub;
  return stub;
};

const clearWindowConfirm = () => {
  delete (globalThis as unknown as { confirm?: ConfirmStub }).confirm;
};

beforeEach(() => {
  (Alert.alert as unknown as ConfirmStub).mockClear?.();
});

afterEach(() => {
  clearWindowConfirm();
});

describe("Property delete confirm copy (task #385)", () => {
  it("uses destructive copy with a clear 'Delete' affordance for each flow", () => {
    for (const copy of [
      SPEC_DELETE_CONFIRM,
      STANDARD_DELETE_CONFIRM,
      NOTE_DELETE_CONFIRM,
    ]) {
      expect(copy.destructive).toBe(true);
      expect(copy.confirmLabel).toBe("Delete");
      expect(copy.title.toLowerCase()).toMatch(/^delete /);
      expect(copy.message ?? "").not.toBe("");
    }
  });

  it("uses distinct, scoped titles for each entity type", () => {
    expect(SPEC_DELETE_CONFIRM.title).toBe("Delete spec");
    expect(STANDARD_DELETE_CONFIRM.title).toBe("Delete standard");
    expect(NOTE_DELETE_CONFIRM.title).toBe("Delete note");
  });
});

describe("Property delete prompts on the web build (task #385)", () => {
  it("opens window.confirm — not Alert.alert — for each delete prompt", async () => {
    const stub = setWindowConfirm(() => true);

    await confirmDeleteSpec();
    await confirmDeleteStandard();
    await confirmDeleteNote();

    expect(stub).toHaveBeenCalledTimes(3);
    expect(Alert.alert).not.toHaveBeenCalled();
  });

  it("shows the title and explanatory message in the prompt text", async () => {
    const stub = setWindowConfirm(() => true);

    await confirmDeleteSpec();
    expect(stub).toHaveBeenLastCalledWith(
      expect.stringContaining("Delete spec"),
    );
    expect(stub).toHaveBeenLastCalledWith(
      expect.stringContaining("knowledge base"),
    );

    await confirmDeleteStandard();
    expect(stub).toHaveBeenLastCalledWith(
      expect.stringContaining("Delete standard"),
    );

    await confirmDeleteNote();
    expect(stub).toHaveBeenLastCalledWith(
      expect.stringContaining("Delete note"),
    );
  });

  it("safely treats a missing window.confirm primitive as a cancel (no auto-delete)", async () => {
    clearWindowConfirm();
    await expect(confirmDeleteSpec()).resolves.toBe(false);
    await expect(confirmDeleteStandard()).resolves.toBe(false);
    await expect(confirmDeleteNote()).resolves.toBe(false);
  });
});

/**
 * Stand-in store mirroring the orval-generated mutation + cache
 * invalidation contract. The screen wires:
 *
 *   makeSpecDeleteHandler({
 *     deleteSpec: (specId) => deleteSpec.mutateAsync({ propertyId, specId }),
 *     invalidate,
 *   })
 *
 * — so passing the same shape here exercises the exact handler the
 * UI installs as `onDelete={handleSpecDelete}`.
 */
type Entry = { id: number };

function makeStore(initial: Entry[]) {
  const items = [...initial];
  return {
    items,
    deleteFn: vi.fn(async (id: number) => {
      const idx = items.findIndex((e) => e.id === id);
      if (idx >= 0) items.splice(idx, 1);
    }),
    invalidate: vi.fn(),
  };
}

describe("Property delete handlers exercised end-to-end on web (task #385)", () => {
  it("Delete spec: accepting the prompt removes the spec and refreshes the cache", async () => {
    const store = makeStore([{ id: 1 }, { id: 2 }, { id: 3 }]);
    const handleSpecDelete = makeSpecDeleteHandler({
      deleteSpec: store.deleteFn,
      invalidate: store.invalidate,
    });

    setWindowConfirm(() => true);
    await handleSpecDelete(2);

    expect(store.deleteFn).toHaveBeenCalledWith(2);
    expect(store.items.map((e) => e.id)).toEqual([1, 3]);
    expect(store.invalidate).toHaveBeenCalledTimes(1);
    expect(Alert.alert).not.toHaveBeenCalled();
  });

  it("Delete spec: cancelling the prompt leaves the spec in place and skips the API call", async () => {
    const store = makeStore([{ id: 1 }, { id: 2 }, { id: 3 }]);
    const handleSpecDelete = makeSpecDeleteHandler({
      deleteSpec: store.deleteFn,
      invalidate: store.invalidate,
    });

    setWindowConfirm(() => false);
    await handleSpecDelete(2);

    expect(store.deleteFn).not.toHaveBeenCalled();
    expect(store.invalidate).not.toHaveBeenCalled();
    expect(store.items.map((e) => e.id)).toEqual([1, 2, 3]);
  });

  it("Delete standard: accepting the prompt removes the standard and refreshes the cache", async () => {
    const store = makeStore([{ id: 10 }, { id: 11 }]);
    const handleStandardDelete = makeStandardDeleteHandler({
      deleteStandard: store.deleteFn,
      invalidate: store.invalidate,
    });

    setWindowConfirm(() => true);
    await handleStandardDelete(10);

    expect(store.deleteFn).toHaveBeenCalledWith(10);
    expect(store.items.map((e) => e.id)).toEqual([11]);
    expect(store.invalidate).toHaveBeenCalledTimes(1);
  });

  it("Delete standard: cancelling the prompt leaves the standard in place", async () => {
    const store = makeStore([{ id: 10 }, { id: 11 }]);
    const handleStandardDelete = makeStandardDeleteHandler({
      deleteStandard: store.deleteFn,
      invalidate: store.invalidate,
    });

    setWindowConfirm(() => false);
    await handleStandardDelete(11);

    expect(store.deleteFn).not.toHaveBeenCalled();
    expect(store.invalidate).not.toHaveBeenCalled();
    expect(store.items.map((e) => e.id)).toEqual([10, 11]);
  });

  it("Delete note: accepting the prompt removes the note and refreshes the cache", async () => {
    const store = makeStore([{ id: 100 }, { id: 101 }, { id: 102 }]);
    const handleNoteDelete = makeNoteDeleteHandler({
      deleteNote: store.deleteFn,
      invalidate: store.invalidate,
    });

    setWindowConfirm(() => true);
    await handleNoteDelete(101);

    expect(store.deleteFn).toHaveBeenCalledWith(101);
    expect(store.items.map((e) => e.id)).toEqual([100, 102]);
    expect(store.invalidate).toHaveBeenCalledTimes(1);
  });

  it("Delete note: cancelling the prompt leaves the note in place", async () => {
    const store = makeStore([{ id: 100 }, { id: 101 }, { id: 102 }]);
    const handleNoteDelete = makeNoteDeleteHandler({
      deleteNote: store.deleteFn,
      invalidate: store.invalidate,
    });

    setWindowConfirm(() => false);
    await handleNoteDelete(100);

    expect(store.deleteFn).not.toHaveBeenCalled();
    expect(store.invalidate).not.toHaveBeenCalled();
    expect(store.items.map((e) => e.id)).toEqual([100, 101, 102]);
  });
});

/**
 * Wiring guard: prove the property detail screen actually installs
 * the factory-built handlers and never falls back to `Alert.alert`
 * for these three delete prompts. This is what catches a future
 * regression where someone re-inlines the prompt logic in the
 * screen and bypasses the cross-platform helper.
 */
describe("Property detail screen wires the factories (task #385)", () => {
  const screenSource = readFileSync(
    resolve(__dirname, "../app/property/[id].tsx"),
    "utf8",
  );

  it("imports the three delete-handler factories from propertyDeleteConfirm", () => {
    expect(screenSource).toMatch(/makeSpecDeleteHandler/);
    expect(screenSource).toMatch(/makeStandardDeleteHandler/);
    expect(screenSource).toMatch(/makeNoteDeleteHandler/);
    expect(screenSource).toMatch(
      /from\s+["']@\/lib\/propertyDeleteConfirm["']/,
    );
  });

  it("builds handleSpecDelete / handleStandardDelete / handleNoteDelete from the factories", () => {
    expect(screenSource).toMatch(
      /const\s+handleSpecDelete\s*=\s*makeSpecDeleteHandler\s*\(/,
    );
    expect(screenSource).toMatch(
      /const\s+handleStandardDelete\s*=\s*makeStandardDeleteHandler\s*\(/,
    );
    expect(screenSource).toMatch(
      /const\s+handleNoteDelete\s*=\s*makeNoteDeleteHandler\s*\(/,
    );
  });

  it("does not call Alert.alert from any of the three delete handlers", () => {
    // Walk forward from each handler's declaration and grab its
    // immediate body, then assert no `Alert.alert(` appears in it.
    const handlerNames = [
      "handleSpecDelete",
      "handleStandardDelete",
      "handleNoteDelete",
    ] as const;
    for (const name of handlerNames) {
      const declRe = new RegExp(`const\\s+${name}\\s*=([\\s\\S]*?);\\s*\\n`);
      const match = screenSource.match(declRe);
      expect(match, `expected to find ${name} declaration`).not.toBeNull();
      const body = match![1];
      expect(body).not.toMatch(/Alert\.alert\s*\(/);
    }
  });

  it("wires each handler's onDelete prop to the matching factory-built handler", () => {
    expect(screenSource).toMatch(/onDelete\s*=\s*\{\s*handleSpecDelete\s*\}/);
    expect(screenSource).toMatch(
      /onDelete\s*=\s*\{\s*handleStandardDelete\s*\}/,
    );
    expect(screenSource).toMatch(/onDelete\s*=\s*\{\s*handleNoteDelete\s*\}/);
  });
});
