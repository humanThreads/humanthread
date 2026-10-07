import { describe, expect, it } from "vitest";
import {
  isPrismaUniqueConstraintError,
  isRecoverableDatabaseConnectionError,
} from "./prisma-errors";

describe("database connection error classification", () => {
  it("recognizes only Prisma unique constraint failures", () => {
    expect(isPrismaUniqueConstraintError({ code: "P2002" })).toBe(true);
    expect(isPrismaUniqueConstraintError({ code: "P2003" })).toBe(false);
    expect(isPrismaUniqueConstraintError(new Error("P2002"))).toBe(false);
  });

  it.each([
    "ECONNREFUSED",
    "ECONNRESET",
    "ETIMEDOUT",
    "EPIPE",
    "EAI_AGAIN",
    "EHOSTUNREACH",
    "ENETUNREACH",
    "PROTOCOL_CONNECTION_LOST",
  ])("recognizes the transport code %s", (code) => {
    expect(isRecoverableDatabaseConnectionError({ code })).toBe(true);
  });

  it.each([45009, 45012, 45019, 45026, 45027, 45028, 45035, 45039, 45042, 45060, 45061])(
    "recognizes the MariaDB connection errno %s",
    (errno) => {
      expect(isRecoverableDatabaseConnectionError({ errno })).toBe(true);
    },
  );

  it.each(["P1001", "P1002", "P1008", "P1017", "P2024"])(
    "recognizes the Prisma connection code %s",
    (code) => {
      expect(isRecoverableDatabaseConnectionError({ code })).toBe(true);
    },
  );

  it("recognizes the nested production pool timeout and refusal", () => {
    const error = {
      code: "P2010",
      message: "Raw query failed",
      meta: {
        driverAdapterError: {
          name: "DriverAdapterError",
          cause: {
            errno: 45028,
            message:
              "pool timeout: failed to retrieve a connection from pool after 10001ms " +
              "(pool connections: active=0 idle=0 limit=10)",
            cause: {
              code: "ECONNREFUSED",
              address: "10.0.0.3",
              port: 3306,
            },
          },
        },
      },
    };

    expect(isRecoverableDatabaseConnectionError(error)).toBe(true);
  });

  it("recognizes the MariaDB code shape emitted by the Prisma adapter", () => {
    const error = {
      code: "P2010",
      meta: {
        driverAdapterError: {
          name: "DriverAdapterError",
          cause: {
            kind: "mysql",
            originalCode: "45028",
            code: 45028,
          },
        },
      },
    };

    expect(isRecoverableDatabaseConnectionError(error)).toBe(true);
  });

  it("recognizes an explicit pool timeout message without relying on P2010", () => {
    expect(
      isRecoverableDatabaseConnectionError(
        new Error(
          "pool timeout: failed to retrieve a connection from pool after 10001ms",
        ),
      ),
    ).toBe(true);
  });

  it.each([
    { code: "P2002", message: "Unique constraint failed" },
    { code: "P2010", message: "Raw query failed: syntax error" },
    { errno: 1064, message: "You have an error in your SQL syntax" },
    { code: "ER_ACCESS_DENIED_ERROR", errno: 1045 },
    null,
    "pool timeout",
  ])("does not recover an unrelated error %#", (error) => {
    expect(isRecoverableDatabaseConnectionError(error)).toBe(false);
  });

  it("handles cyclic error metadata without recursing forever", () => {
    const error: { code: string; cause?: unknown } = { code: "P2010" };
    error.cause = error;

    expect(isRecoverableDatabaseConnectionError(error)).toBe(false);
  });
});
