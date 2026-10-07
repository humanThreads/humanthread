import {
  pbkdf2Sync,
  randomBytes,
  timingSafeEqual,
} from "node:crypto";
import { prisma } from "../../../../../packages/db/src/index";

const PASSWORD_HASH_ALGORITHM = "pbkdf2-sha256";
const DEFAULT_PASSWORD_ITERATIONS = 210000;
const PASSWORD_KEY_LENGTH = 32;
const PASSWORD_DIGEST = "sha256";

export interface PasswordHashOptions {
  salt?: string;
  iterations?: number;
}

export interface VerifyPasswordHashInput {
  password: string;
  passwordHash: string;
}

export interface AuthenticateWorkbenchUserInput {
  email: string;
  password: string;
  db?: {
    user: {
      findFirst: typeof prisma.user.findFirst;
    };
  };
}

export interface AuthenticatedWorkbenchUser {
  id: string;
  email: string;
}

function normalizeEmail(value: string): string {
  return value.trim().toLowerCase();
}

function normalizePassword(value: string): string {
  return value.trim();
}

function derivePasswordKey(input: {
  password: string;
  salt: string;
  iterations: number;
}): string {
  return pbkdf2Sync(
    input.password,
    input.salt,
    input.iterations,
    PASSWORD_KEY_LENGTH,
    PASSWORD_DIGEST,
  ).toString("base64url");
}

function safeEquals(left: string, right: string): boolean {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);

  return (
    leftBuffer.length === rightBuffer.length &&
    timingSafeEqual(leftBuffer, rightBuffer)
  );
}

export function createPasswordHash(
  password: string,
  options: PasswordHashOptions = {},
): string {
  const normalizedPassword = normalizePassword(password);

  if (!normalizedPassword) {
    throw new Error("Password is required");
  }

  const salt = options.salt ?? randomBytes(16).toString("base64url");
  const iterations = options.iterations ?? DEFAULT_PASSWORD_ITERATIONS;
  const hash = derivePasswordKey({
    password: normalizedPassword,
    salt,
    iterations,
  });

  return `${PASSWORD_HASH_ALGORITHM}$${iterations}$${salt}$${hash}`;
}

export function verifyPasswordHash(input: VerifyPasswordHashInput): boolean {
  const [algorithm, iterationsText, salt, expectedHash] =
    input.passwordHash.split("$");
  const password = normalizePassword(input.password);
  const iterations = Number(iterationsText);

  if (
    algorithm !== PASSWORD_HASH_ALGORITHM ||
    !Number.isInteger(iterations) ||
    iterations <= 0 ||
    !salt ||
    !expectedHash ||
    !password
  ) {
    return false;
  }

  const actualHash = derivePasswordKey({
    password,
    salt,
    iterations,
  });

  return safeEquals(actualHash, expectedHash);
}

export async function authenticateWorkbenchUser(
  input: AuthenticateWorkbenchUserInput,
): Promise<AuthenticatedWorkbenchUser> {
  const email = normalizeEmail(input.email);
  const password = normalizePassword(input.password);

  if (!email) {
    throw new Error("Email is required");
  }

  if (!password) {
    throw new Error("Password is required");
  }

  const db = input.db ?? prisma;
  const user = await db.user.findFirst({
    where: {
      email,
    },
    select: {
      id: true,
      email: true,
      status: true,
      passwordHash: true,
    },
  });

  if (
    !user ||
    user.status !== "active" ||
    !user.email ||
    !user.passwordHash ||
    !verifyPasswordHash({ password, passwordHash: user.passwordHash })
  ) {
    throw new Error("Workbench login credentials are invalid");
  }

  return {
    id: user.id,
    email: normalizeEmail(user.email),
  };
}
