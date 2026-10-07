import { createHash } from "node:crypto";
import type { Prisma } from "@prisma/client";
import { assertCanWriteSpace, prisma } from "@humanthread/db";

export type AgentProfileStatus = "active" | "disabled";
export type AgentProfileProvider = "codex" | "claude";

export interface AgentProfileCommandRecord {
  id: string;
  spaceId: string;
  name: string;
  provider: AgentProfileProvider;
  status: AgentProfileStatus;
  model: string | null;
}

export interface AgentProfileCommandDependencies {
  assertCanWriteSpace(input: { userId: string; spaceId: string }): Promise<{ role: string }>;
  loadProfile(input: { profileId: string }): Promise<AgentProfileCommandRecord | null>;
  createProfile(input: AgentProfileCommandRecord & {
    capabilities: Prisma.InputJsonValue;
    defaultExecutionPolicy: Prisma.InputJsonValue;
    providerConfig: Prisma.InputJsonValue;
    createdById: string;
  }): Promise<AgentProfileCommandRecord>;
  updateProfileStatus(input: { profileId: string; status: AgentProfileStatus }): Promise<AgentProfileCommandRecord>;
}

const defaultDependencies: AgentProfileCommandDependencies = {
  assertCanWriteSpace: async (input) => assertCanWriteSpace(input),
  loadProfile: (input) => prisma.agentProfile.findUnique({
    where: { id: input.profileId },
    select: {
      id: true,
      spaceId: true,
      name: true,
      provider: true,
      status: true,
      model: true,
    },
  }) as Promise<AgentProfileCommandRecord | null>,
  createProfile: (input) => prisma.agentProfile.create({
    data: input,
    select: {
      id: true,
      spaceId: true,
      name: true,
      provider: true,
      status: true,
      model: true,
    },
  }) as Promise<AgentProfileCommandRecord>,
  updateProfileStatus: (input) => prisma.agentProfile.update({
    where: { id: input.profileId },
    data: { status: input.status },
    select: {
      id: true,
      spaceId: true,
      name: true,
      provider: true,
      status: true,
      model: true,
    },
  }) as Promise<AgentProfileCommandRecord>,
};

export async function createSpaceAgentProfile(input: {
  actorUserId: string;
  commandId: string;
  spaceId: string;
  name: string;
  provider: AgentProfileProvider;
  model?: string | null;
}, dependencies: AgentProfileCommandDependencies = defaultDependencies): Promise<AgentProfileCommandRecord> {
  const name = requiredText(input.name, "Agent Profile name", 191);
  const provider = requiredProvider(input.provider);
  const model = optionalText(input.model, "Agent Profile model", 191);
  const commandId = requiredText(input.commandId, "Agent Profile command id", 128);
  const spaceId = requiredText(input.spaceId, "Agent Profile Space", 96);
  const access = await dependencies.assertCanWriteSpace({ userId: input.actorUserId, spaceId });
  assertProfileManager(access.role);

  const profileId = createHash("md5")
    .update(["agent_profile", spaceId, input.actorUserId, commandId].join("\0"))
    .digest("hex");
  const existing = await dependencies.loadProfile({ profileId });
  if (existing) return existing;

  return dependencies.createProfile({
    id: profileId,
    spaceId,
    name,
    provider,
    status: "active",
    model,
    capabilities: ["structured_result"],
    defaultExecutionPolicy: {},
    providerConfig: {},
    createdById: input.actorUserId,
  });
}

export async function setSpaceAgentProfileStatus(input: {
  actorUserId: string;
  commandId: string;
  agentProfileId: string;
  status: AgentProfileStatus;
}, dependencies: AgentProfileCommandDependencies = defaultDependencies): Promise<AgentProfileCommandRecord> {
  requiredText(input.commandId, "Agent Profile command id", 128);
  const profileId = requiredText(input.agentProfileId, "Agent Profile id", 96);
  const profile = await dependencies.loadProfile({ profileId });
  if (!profile) throw commandError("not_found", "Agent Profile not found");

  const access = await dependencies.assertCanWriteSpace({ userId: input.actorUserId, spaceId: profile.spaceId });
  assertProfileManager(access.role);
  if (profile.status === input.status) return profile;
  return dependencies.updateProfileStatus({ profileId, status: input.status });
}

function assertProfileManager(role: string): void {
  if (role !== "owner" && role !== "admin") {
    throw commandError("authorization_denied", "Only Space owners and admins can manage Agent Profiles");
  }
}

function requiredProvider(value: string): AgentProfileProvider {
  if (value !== "codex" && value !== "claude") {
    throw commandError("validation_failed", "Agent Profile provider is invalid");
  }
  return value;
}

function requiredText(value: unknown, field: string, maxLength: number): string {
  if (typeof value !== "string") throw commandError("validation_failed", `${field} is required`);
  const normalized = value.trim();
  if (!normalized || normalized.length > maxLength) {
    throw commandError("validation_failed", `${field} is invalid`);
  }
  return normalized;
}

function optionalText(value: unknown, field: string, maxLength: number): string | null {
  if (value === undefined || value === null) return null;
  if (typeof value !== "string") throw commandError("validation_failed", `${field} is invalid`);
  const normalized = value.trim();
  if (!normalized) return null;
  if (normalized.length > maxLength) throw commandError("validation_failed", `${field} is invalid`);
  return normalized;
}

function commandError(code: string, message: string): Error & { code: string } {
  return Object.assign(new Error(message), { code });
}
