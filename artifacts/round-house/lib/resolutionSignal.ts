import type { Question } from "@workspace/api-client-react";

export type ResolutionSignal = {
  responsibility: "empty" | "them" | "you";
  unansweredPrompts: number;
};

type ResolutionQuestion = Question & {
  /**
   * Number of unanswered prompts in this specific Resolution thread.
   * Older API rows do not expose the field yet, so an active question is
   * conservatively treated as its first prompt instead of combining it with
   * unrelated questions.
   */
  unansweredPromptCount?: number | null;
};

function stateForQuestion(
  question: ResolutionQuestion,
  userId: string | null,
): ResolutionSignal | null {
  if (question.status === "completed") return null;

  const isOwner = !!userId && question.userClerkId === userId;
  let responsibility: ResolutionSignal["responsibility"];

  if (question.kind === "request") {
    responsibility = isOwner ? "them" : "you";
  } else if (question.status === "answered") {
    responsibility = isOwner ? "you" : "them";
  } else {
    responsibility = isOwner ? "them" : "you";
  }

  return {
    responsibility,
    unansweredPrompts: Math.max(1, question.unansweredPromptCount ?? 1),
  };
}

/**
 * Returns one icon state without adding unrelated questions together.
 * A user-owned action outranks an item waiting on somebody else; escalation
 * is read only from the unanswered count on that same Resolution.
 */
export function resolutionSignalForQuestions(
  questions: Question[],
  userId: string | null,
): ResolutionSignal {
  const active = questions
    .map((question) => stateForQuestion(question as ResolutionQuestion, userId))
    .filter((state): state is ResolutionSignal => state !== null);

  if (active.length === 0)
    return { responsibility: "empty", unansweredPrompts: 0 };

  const waitingOnYou = active
    .filter((state) => state.responsibility === "you")
    .sort((a, b) => b.unansweredPrompts - a.unansweredPrompts)[0];

  return waitingOnYou ?? { responsibility: "them", unansweredPrompts: 1 };
}
