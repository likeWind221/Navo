import type { ExerciseId, NodeId, SessionId } from "../brand/ids.js";

/** Current Node state reconstructed from its complete committed history. */
export interface NodeSnapshot {
  readonly node: Node;
  readonly revision: number;
  readonly content: NodeContentSnapshot;
  readonly sessionId?: SessionId;
}

/** A verifiable capability unit with one separately bound conversation Session. */
export interface Node {
  readonly id: NodeId;
  readonly capability: CapabilityTarget;
  readonly sources: readonly SourceReference[];
}

/** What the learner must demonstrably be able to do. */
export interface CapabilityTarget {
  readonly title: string;
  readonly description: string;
  readonly successCriteria: readonly string[];
}

/** Current editable content displayed for one Node. */
export interface NodeContentSnapshot {
  readonly material?: MaterialDocument;
  readonly exerciseSet?: ExerciseSet;
}

/** Provider- and storage-neutral pointer to supporting material. */
export interface SourceReference {
  readonly reference: string;
  readonly label?: string;
}

/** One complete version of the Node's plain-text teaching material. */
export interface MaterialDocument {
  readonly revision: number;
  readonly text: string;
  readonly sources: readonly SourceReference[];
}

/** One complete version of the Node's exercises and private answer key. */
export interface ExerciseSet {
  readonly revision: number;
  readonly exercises: readonly Exercise[];
}

/** One editable prompt and its grading-only reference answer. */
export interface Exercise {
  readonly id: ExerciseId;
  readonly prompt: string;
  readonly referenceAnswer: string;
}

/** Exercise collection safe to expose to the learner. */
export interface LearnerExerciseSet {
  readonly revision: number;
  readonly exercises: readonly LearnerExercise[];
}

/** Learner-visible exercise fields; the reference answer is absent by type. */
export type LearnerExercise = Pick<Exercise, "id" | "prompt">;

/** Remove every private reference answer from an ExerciseSet. */
export function toLearnerExerciseSet(value: ExerciseSet): LearnerExerciseSet {
  return Object.freeze({
    revision: value.revision,
    exercises: Object.freeze(value.exercises.map((exercise) => Object.freeze({
      id: exercise.id,
      prompt: exercise.prompt,
    }))),
  });
}
