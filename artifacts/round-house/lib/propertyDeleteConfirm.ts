/**
 * Confirmation copy + handler factories for the three destructive
 * actions on the property detail screen — Delete spec, Delete
 * standard, and Delete note.
 *
 * Task #384 routed these prompts through the cross-platform
 * `confirm()` helper so they actually work in the web build (React
 * Native Web ships `Alert.alert` as a no-op stub). Centralising the
 * copy *and* the full handler shape into named factories means:
 *
 *   1. The screen handlers stay one-liners that just call the
 *      factory — there is one place where the prompt + the API
 *      mutation + the cache invalidation are wired together.
 *   2. The factories return the exact async function the screen
 *      installs as `onDelete={handleSpecDelete}` etc., so tests
 *      exercise the *same* code path the user triggers from the UI
 *      (see `propertyDeleteConfirm.test.ts`). A future regression
 *      that reintroduces `Alert.alert` here is caught immediately.
 */
import { confirm, type ConfirmOptions } from "./confirm";

export const SPEC_DELETE_CONFIRM: ConfirmOptions = {
  title: "Delete spec",
  message: "Remove this entry from the property knowledge base?",
  confirmLabel: "Delete",
  destructive: true,
};

export const STANDARD_DELETE_CONFIRM: ConfirmOptions = {
  title: "Delete standard",
  message: "Remove this standard?",
  confirmLabel: "Delete",
  destructive: true,
};

export const NOTE_DELETE_CONFIRM: ConfirmOptions = {
  title: "Delete note",
  message: "Remove this note?",
  confirmLabel: "Delete",
  destructive: true,
};

export function confirmDeleteSpec(): Promise<boolean> {
  return confirm(SPEC_DELETE_CONFIRM);
}

export function confirmDeleteStandard(): Promise<boolean> {
  return confirm(STANDARD_DELETE_CONFIRM);
}

export function confirmDeleteNote(): Promise<boolean> {
  return confirm(NOTE_DELETE_CONFIRM);
}

/**
 * Build the exact async handler the property detail screen installs
 * as `onDelete` on the spec row. The screen passes thin wrappers
 * around the orval-generated mutations; the factory owns the prompt,
 * the early-return on cancel, the await of the mutation, and the
 * cache invalidation. Tests call the factory with stand-in mutations
 * to exercise the entire user-triggered flow.
 */
export function makeSpecDeleteHandler(args: {
  deleteSpec: (specId: number) => Promise<unknown>;
  invalidate: () => void;
}): (specId: number) => Promise<void> {
  return async (specId) => {
    if (!(await confirmDeleteSpec())) return;
    await args.deleteSpec(specId);
    args.invalidate();
  };
}

export function makeStandardDeleteHandler(args: {
  deleteStandard: (standardId: number) => Promise<unknown>;
  invalidate: () => void;
}): (standardId: number) => Promise<void> {
  return async (standardId) => {
    if (!(await confirmDeleteStandard())) return;
    await args.deleteStandard(standardId);
    args.invalidate();
  };
}

export function makeNoteDeleteHandler(args: {
  deleteNote: (noteId: number) => Promise<unknown>;
  invalidate: () => void;
}): (noteId: number) => Promise<void> {
  return async (noteId) => {
    if (!(await confirmDeleteNote())) return;
    await args.deleteNote(noteId);
    args.invalidate();
  };
}
