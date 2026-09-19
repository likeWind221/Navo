const brand: unique symbol = Symbol("NavoIdBrand");

export type Brand<TValue, TBrand extends string> = TValue & {
  readonly [brand]: TBrand;
};

export type SessionId = Brand<string, "SessionId">;
export type MessageId = Brand<string, "MessageId">;
export type EventId = Brand<string, "EventId">;
export type ToolCallId = Brand<string, "ToolCallId">;
export type TurnId = Brand<string, "TurnId">;
export type StepId = Brand<string, "StepId">;
export type NodeId = Brand<string, "NodeId">;
export type ProjectId = Brand<string, "ProjectId">;
export type ExerciseId = Brand<string, "ExerciseId">;
export type ResourceId = Brand<string, "ResourceId">;

function assertIdValue(value: string, idName: string): void {
  if (value.length === 0) {
    throw new TypeError(`${idName} must not be empty`);
  }
}

export function createProjectId(value: string): ProjectId {
  return makeId<ProjectId>(value, "ProjectId");
}

function makeId<TId extends Brand<string, string>>(
  value: string,
  idName: string,
): TId {
  assertIdValue(value, idName);
  return value as TId;
}

export function createSessionId(value: string): SessionId {
  return makeId<SessionId>(value, "SessionId");
}

export function createMessageId(value: string): MessageId {
  return makeId<MessageId>(value, "MessageId");
}

export function createEventId(value: string): EventId {
  return makeId<EventId>(value, "EventId");
}

export function createToolCallId(value: string): ToolCallId {
  return makeId<ToolCallId>(value, "ToolCallId");
}

export function createTurnId(value: string): TurnId {
  return makeId<TurnId>(value, "TurnId");
}

export function createStepId(value: string): StepId {
  return makeId<StepId>(value, "StepId");
}

export function createNodeId(value: string): NodeId {
  return makeId<NodeId>(value, "NodeId");
}

export function createExerciseId(value: string): ExerciseId {
  return makeId<ExerciseId>(value, "ExerciseId");
}

export function createResourceId(value: string): ResourceId {
  return makeId<ResourceId>(value, "ResourceId");
}

export function idToString(id: Brand<string, string>): string {
  return id;
}
