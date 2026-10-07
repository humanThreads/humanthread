import { createHash, randomInt } from "node:crypto";
import { Socket } from "node:net";
import { connect as connectTls, TLSSocket } from "node:tls";
import {
  buildCompanyMembershipId,
  buildCompanySpaceId,
  buildPersonalSpaceId,
  prisma,
} from "../../../../../packages/db/src/index";
import {
  clearWebAuthenticationCookies,
  setWebSessionCookie,
} from "./web-session-cookie";
import { createWebSession } from "./web-session-store";
import { createPasswordHash } from "./workbench-auth";
import type { CookieWriter } from "./workbench-login-session";
import { getWorkbenchGlobalSmtpConfig } from "./workbench-mail-config";

interface RegistrationEmailVerificationRecord {
  id: string;
  email: string;
  codeHash: string;
  attempts: number;
  expiresAt: Date;
  consumedAt: Date | null;
}

interface RegistrationDb {
  user: {
    findFirst(input: unknown): Promise<{ id: string } | null>;
  };
  registrationEmailVerification: {
    findFirst(input: unknown): Promise<RegistrationEmailVerificationRecord | null>;
    update(input: unknown): Promise<unknown>;
  };
  companyInvitation?: {
    findMany(input: unknown): Promise<Array<{
      id: string;
      companyId: string;
      role: string;
    }>>;
  };
  $transaction<T>(callback: (tx: RegistrationTransactionDb) => Promise<T>): Promise<T>;
}

interface RegistrationTransactionDb {
  user: {
    create(input: unknown): Promise<{
      id: string;
      email: string | null;
      name: string;
    }>;
  };
  space: {
    create(input: unknown): Promise<{
      id: string;
    }>;
  };
  project: {
    create(input: unknown): Promise<{
      id: string;
    }>;
  };
  projectMember: {
    create(input: unknown): Promise<{
      id: string;
    }>;
  };
  company: {
    create(input: unknown): Promise<{
      id: string;
      name: string;
    }>;
  };
  companyMember: {
    create(input: unknown): Promise<{
      id: string;
    }>;
    upsert?(input: unknown): Promise<{
      id: string;
    }>;
  };
  companyInvitation?: {
    update(input: unknown): Promise<{
      id: string;
    }>;
  };
  registrationEmailVerification?: {
    update(input: unknown): Promise<unknown>;
  };
}

interface RegistrationVerificationDb {
  user: {
    findFirst(input: unknown): Promise<{ id: string } | null>;
  };
  registrationEmailVerification: {
    findFirst(input: unknown): Promise<{
      id: string;
      createdAt: Date;
    } | null>;
    create(input: unknown): Promise<{ id: string }>;
  };
}

export interface RegisterWorkbenchUserInput {
  accountType?: "personal" | "company";
  companyName?: string;
  name: string;
  email: string;
  password: string;
  verificationCode: string;
  request: Request;
  cookieStore: CookieWriter;
  now?: Date;
  db?: RegistrationDb;
  createSession?: typeof createWebSession;
}

export interface RegisterWorkbenchUserResult {
  userId: string;
  email: string;
  name: string;
  personalProjectId: string;
  companyId: string | null;
  companySpaceId: string | null;
}

export interface CreateWorkbenchRegistrationVerificationInput {
  email: string;
  now?: Date;
  db?: RegistrationVerificationDb;
  createCode?: () => string;
  sendVerificationEmail?: (input: {
    email: string;
    code: string;
  }) => Promise<void>;
}

export interface CreateWorkbenchRegistrationVerificationResult {
  email: string;
  expiresAt: Date;
}

const DEFAULT_TEAM_ID = "team_1";
const VERIFICATION_TTL_MS = 10 * 60 * 1000;
const VERIFICATION_RESEND_COOLDOWN_MS = 60 * 1000;
const VERIFICATION_MAX_ATTEMPTS = 5;

function normalizeName(value: string): string {
  return value.trim();
}

function normalizeEmail(value: string): string {
  return value.trim().toLowerCase();
}

function normalizePassword(value: string): string {
  return value.trim();
}

function normalizeVerificationCode(value: string): string {
  return value.trim();
}

function normalizeCompanyName(value: string | undefined): string {
  return value?.trim() ?? "";
}

function slugifyCompanyName(value: string): string {
  const slug = value
    .toLowerCase()
    .replace(/[^a-z0-9]+/gu, "-")
    .replace(/^-+|-+$/gu, "");

  return slug || "company";
}

function slugifyEmailLocalPart(email: string): string {
  const localPart = email.split("@")[0] ?? "user";
  const slug = localPart.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");

  return slug || "user";
}

function shortHash(value: string): string {
  return createHash("sha256").update(value).digest("hex").slice(0, 8);
}

export function hashRegistrationVerificationCode(code: string): string {
  return createHash("sha256").update(normalizeVerificationCode(code)).digest("hex");
}

function createRegistrationVerificationCode(): string {
  return String(randomInt(0, 1_000_000)).padStart(6, "0");
}

function formatTimestamp(date: Date): string {
  return date.toISOString().replace(/[-:T.Z]/g, "").slice(0, 14);
}

function buildRegistrationIds(input: {
  email: string;
  now: Date;
}) {
  const timestamp = formatTimestamp(input.now);
  const emailSlug = slugifyEmailLocalPart(input.email).slice(0, 24);
  const hash = shortHash(input.email);
  const userId = `user_${timestamp}_${emailSlug}_${hash}`;
  const personalProjectId = `proj_${timestamp}_${emailSlug}_${hash}`;
  const projectMemberId = `pm_${timestamp}_${hash}`;
  const companyId = `company_${timestamp}_${hash}`;

  return {
    userId,
    personalProjectId,
    projectMemberId,
    companyId,
  };
}

function validateRegistrationInput(input: {
  name: string;
  email: string;
  password: string;
}) {
  if (!input.name) {
    throw new Error("Name is required");
  }

  if (!input.email || !input.email.includes("@")) {
    throw new Error("Valid email is required");
  }

  if (input.password.length < 8) {
    throw new Error("Password must be at least 8 characters");
  }
}

function validateVerificationEmail(email: string) {
  if (!email || !email.includes("@")) {
    throw new Error("Valid email is required");
  }
}

async function smtpRead(socket: Socket | TLSSocket): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];

    function cleanup() {
      socket.off("data", onData);
      socket.off("error", onError);
    }

    function onError(error: Error) {
      cleanup();
      reject(error);
    }

    function onData(chunk: Buffer) {
      chunks.push(chunk);
      const text = Buffer.concat(chunks).toString("utf8");
      const lines = text.split(/\r?\n/u).filter(Boolean);
      const lastLine = lines.at(-1);

      if (lastLine && /^\d{3} /u.test(lastLine)) {
        cleanup();
        resolve(text);
      }
    }

    socket.on("data", onData);
    socket.on("error", onError);
  });
}

async function smtpCommand(socket: Socket | TLSSocket, command: string) {
  socket.write(`${command}\r\n`);
  const response = await smtpRead(socket);
  const status = Number(response.slice(0, 3));

  if (status >= 400) {
    throw new Error(`SMTP command failed: ${status}`);
  }

  return response;
}

function encodeBase64(value: string): string {
  return Buffer.from(value, "utf8").toString("base64");
}

export async function sendWorkbenchRegistrationVerificationEmail(input: {
  email: string;
  code: string;
}) {
  const smtp = getWorkbenchGlobalSmtpConfig();

  if (!smtp) {
    throw new Error("Workbench SMTP config is not configured");
  }

  const socket = await new Promise<TLSSocket>((resolve, reject) => {
    const tlsSocket = connectTls(
      {
      host: smtp.host,
      port: smtp.port,
      servername: smtp.host,
      },
      () => resolve(tlsSocket),
    );

    tlsSocket.once("error", reject);
  });

  try {
    await smtpRead(socket);
    await smtpCommand(socket, `EHLO humanthread.example.com`);
    await smtpCommand(socket, "AUTH LOGIN");
    await smtpCommand(socket, encodeBase64(smtp.username));
    await smtpCommand(socket, encodeBase64(smtp.password));
    await smtpCommand(socket, `MAIL FROM:<${smtp.username}>`);
    await smtpCommand(socket, `RCPT TO:<${input.email}>`);
    await smtpCommand(socket, "DATA");
    socket.write(
      [
        `From: HumanThread <${smtp.username}>`,
        `To: ${input.email}`,
        "Subject: HumanThread 注册验证码",
        "Content-Type: text/plain; charset=utf-8",
        "",
        `你的 HumanThread 注册验证码是：${input.code}`,
        "验证码 10 分钟内有效。如非本人操作，请忽略此邮件。",
        ".",
        "",
      ].join("\r\n"),
    );
    await smtpRead(socket);
    await smtpCommand(socket, "QUIT");
  } finally {
    socket.destroy();
  }
}

export async function createWorkbenchRegistrationVerification(
  input: CreateWorkbenchRegistrationVerificationInput,
): Promise<CreateWorkbenchRegistrationVerificationResult> {
  const email = normalizeEmail(input.email);
  const now = input.now ?? new Date();

  validateVerificationEmail(email);

  const db = input.db ?? (prisma as unknown as RegistrationVerificationDb);
  const existingUser = await db.user.findFirst({
    where: { email },
    select: { id: true },
  });

  if (existingUser) {
    throw new Error("Workbench account already exists");
  }

  const latest = await db.registrationEmailVerification.findFirst({
    where: {
      email,
    },
    orderBy: {
      createdAt: "desc",
    },
    select: {
      id: true,
      createdAt: true,
    },
  });

  if (
    latest &&
    now.getTime() - latest.createdAt.getTime() < VERIFICATION_RESEND_COOLDOWN_MS
  ) {
    throw new Error("Registration verification email was sent too recently");
  }

  const code = input.createCode?.() ?? createRegistrationVerificationCode();
  const expiresAt = new Date(now.getTime() + VERIFICATION_TTL_MS);

  await db.registrationEmailVerification.create({
    data: {
      id: `reg_verify_${formatTimestamp(now)}_${shortHash(email + code)}`,
      email,
      codeHash: hashRegistrationVerificationCode(code),
      attempts: 0,
      expiresAt,
      consumedAt: null,
    },
    select: { id: true },
  });

  await (input.sendVerificationEmail ?? sendWorkbenchRegistrationVerificationEmail)({
    email,
    code,
  });

  return {
    email,
    expiresAt,
  };
}

async function assertRegistrationVerification(input: {
  email: string;
  code: string;
  now: Date;
  db: RegistrationDb;
}) {
  const code = normalizeVerificationCode(input.code);

  if (!code) {
    throw new Error("Registration verification code is required");
  }

  const record = await input.db.registrationEmailVerification.findFirst({
    where: {
      email: input.email,
      consumedAt: null,
    },
    orderBy: {
      createdAt: "desc",
    },
    select: {
      id: true,
      email: true,
      codeHash: true,
      attempts: true,
      expiresAt: true,
      consumedAt: true,
    },
  });

  if (!record || record.expiresAt.getTime() < input.now.getTime()) {
    throw new Error("Registration verification code is invalid");
  }

  if (record.attempts >= VERIFICATION_MAX_ATTEMPTS) {
    throw new Error("Registration verification code is invalid");
  }

  if (record.codeHash !== hashRegistrationVerificationCode(code)) {
    await input.db.registrationEmailVerification.update({
      where: { id: record.id },
      data: {
        attempts: record.attempts + 1,
      },
    });
    throw new Error("Registration verification code is invalid");
  }

  await input.db.registrationEmailVerification.update({
    where: { id: record.id },
    data: {
      attempts: record.attempts + 1,
      consumedAt: input.now,
    },
  });
}

export async function registerWorkbenchUser(
  input: RegisterWorkbenchUserInput,
): Promise<RegisterWorkbenchUserResult> {
  const name = normalizeName(input.name);
  const email = normalizeEmail(input.email);
  const password = normalizePassword(input.password);
  const verificationCode = normalizeVerificationCode(input.verificationCode);
  const accountType = input.accountType ?? "personal";
  const companyName = normalizeCompanyName(input.companyName);

  validateRegistrationInput({ name, email, password });

  if (accountType === "company" && !companyName) {
    throw new Error("Company name is required");
  }

  const db = input.db ?? (prisma as unknown as RegistrationDb);
  const existingUser = await db.user.findFirst({
    where: {
      email,
    },
    select: {
      id: true,
    },
  });

  if (existingUser) {
    throw new Error("Workbench account already exists");
  }

  const now = input.now ?? new Date();
  await assertRegistrationVerification({
    email,
    code: verificationCode,
    now,
    db,
  });
  const pendingInvitations = db.companyInvitation
    ? await db.companyInvitation.findMany({
        where: {
          email,
          status: "pending",
          expiresAt: { gt: now },
        },
        orderBy: { createdAt: "asc" },
        select: { id: true, companyId: true, role: true },
      })
    : [];
  const { userId, personalProjectId, projectMemberId, companyId } = buildRegistrationIds({
    email,
    now,
  });
  const result = await db.$transaction(async (tx) => {
    const user = await tx.user.create({
      data: {
        id: userId,
        teamId: DEFAULT_TEAM_ID,
        name,
        email,
        status: "active",
        passwordHash: createPasswordHash(password),
      },
      select: {
        id: true,
        email: true,
        name: true,
      },
    });
    const personalSpace = await tx.space.create({
      data: {
        id: buildPersonalSpaceId(user.id),
        type: "personal",
        ownerUserId: user.id,
        companyId: null,
        name: `${name} 的个人空间`,
        status: "active",
      },
      select: {
        id: true,
      },
    });
    const project = await tx.project.create({
      data: {
        id: personalProjectId,
        teamId: DEFAULT_TEAM_ID,
        spaceId: personalSpace.id,
        ownerType: "personal",
        ownerUserId: user.id,
        visibility: "private",
        name: `${name} 的个人空间`,
        description: "注册时自动创建的个人项目空间",
      },
      select: {
        id: true,
      },
    });

    await tx.projectMember.create({
      data: {
        id: projectMemberId,
        projectId: project.id,
        userId: user.id,
        role: "owner",
        status: "active",
      },
      select: {
        id: true,
      },
    });

    if (pendingInvitations.length > 0) {
      if (!tx.companyMember.upsert || !tx.companyInvitation) {
        throw new Error("Company invitation acceptance is unavailable");
      }

      for (const invitation of pendingInvitations) {
        await tx.companyMember.upsert({
          where: {
            companyId_userId: {
              companyId: invitation.companyId,
              userId: user.id,
            },
          },
          create: {
            id: buildCompanyMembershipId(invitation.companyId, user.id),
            companyId: invitation.companyId,
            userId: user.id,
            role: invitation.role,
            status: "active",
          },
          update: {
            role: invitation.role,
            status: "active",
          },
        });
        await tx.companyInvitation.update({
          where: { id: invitation.id },
          data: {
            status: "accepted",
            acceptedById: user.id,
            acceptedAt: now,
          },
        });
      }
    }

    let company: { id: string } | null = null;
    let companySpace: { id: string } | null = null;

    if (accountType === "company") {
      company = await tx.company.create({
        data: {
          id: companyId,
          name: companyName,
          slug: `${slugifyCompanyName(companyName)}-${shortHash(`${companyName}:${email}`)}`,
          status: "active",
        },
        select: {
          id: true,
          name: true,
        },
      });
      companySpace = await tx.space.create({
        data: {
          id: buildCompanySpaceId(company.id),
          type: "company",
          ownerUserId: null,
          companyId: company.id,
          name: companyName,
          status: "active",
        },
        select: { id: true },
      });
      await tx.companyMember.create({
        data: {
          id: buildCompanyMembershipId(company.id, user.id),
          companyId: company.id,
          userId: user.id,
          role: "owner",
          status: "active",
        },
        select: { id: true },
      });
    }

    return {
      user,
      project,
      company,
      companySpace,
    };
  });
  const webSession = await (input.createSession ?? createWebSession)({
    userId: result.user.id,
    request: input.request,
  });

  clearWebAuthenticationCookies(input.cookieStore);
  setWebSessionCookie({
    cookieStore: input.cookieStore,
    token: webSession.token,
    request: input.request,
  });

  return {
    userId: result.user.id,
    email: result.user.email ?? email,
    name: result.user.name,
    personalProjectId: result.project.id,
    companyId: result.company?.id ?? null,
    companySpaceId: result.companySpace?.id ?? null,
  };
}
