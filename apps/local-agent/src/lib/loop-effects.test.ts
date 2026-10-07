import { describe, expect, it, vi } from "vitest";
import { executeReservedEffect, type EffectReservation } from "./loop-effects";

const reservation: EffectReservation = {
  effectKey: "effect:key_1",
  status: "prepared",
  providerIdempotencyKey: "provider:key_1",
  execute: true,
  request: { to: "user@example.com", subject: "Hello" },
};

describe("executeReservedEffect", () => {
  it("does not dispatch a reservation the platform has already resolved", async () => {
    const dispatch = vi.fn();
    const recordReceipt = vi.fn();

    await expect(executeReservedEffect({
      ...reservation,
      status: "succeeded",
      execute: false,
    }, { dispatch, recordReceipt })).resolves.toMatchObject({
      effectKey: "effect:key_1",
      status: "succeeded",
      execute: false,
    });
    expect(dispatch).not.toHaveBeenCalled();
    expect(recordReceipt).not.toHaveBeenCalled();
  });

  it("dispatches once with the provider idempotency key and records success", async () => {
    const dispatch = vi.fn().mockResolvedValue({ providerId: "message_1" });
    const recordReceipt = vi.fn().mockResolvedValue({
      effectKey: "effect:key_1",
      status: "succeeded",
    });

    await expect(executeReservedEffect(reservation, { dispatch, recordReceipt })).resolves.toEqual({
      effectKey: "effect:key_1",
      status: "succeeded",
    });
    expect(dispatch).toHaveBeenCalledOnce();
    expect(dispatch).toHaveBeenCalledWith({
      to: "user@example.com",
      subject: "Hello",
      idempotencyKey: "provider:key_1",
    });
    expect(recordReceipt).toHaveBeenCalledWith({
      effectKey: "effect:key_1",
      status: "succeeded",
      providerReceipt: { providerId: "message_1" },
    });
  });

  it("leaves the reservation prepared when dispatch provably did not begin", async () => {
    const error = Object.assign(new Error("validation failed before dispatch"), {
      dispatchState: "not_started",
    });
    const dispatch = vi.fn().mockRejectedValue(error);
    const recordReceipt = vi.fn();

    await expect(executeReservedEffect(reservation, { dispatch, recordReceipt })).rejects.toBe(error);
    expect(dispatch).toHaveBeenCalledOnce();
    expect(recordReceipt).not.toHaveBeenCalled();
  });

  it("requires reconciliation when the connection drops after dispatch", async () => {
    const dispatch = vi.fn().mockRejectedValue(Object.assign(
      new Error("connection dropped after request write"),
      { dispatchState: "possibly_dispatched" },
    ));
    const recordReceipt = vi.fn().mockResolvedValue({
      effectKey: "effect:key_1",
      status: "reconciliation_required",
    });

    await expect(executeReservedEffect(reservation, { dispatch, recordReceipt }))
      .rejects.toMatchObject({ code: "reconciliation_required" });
    expect(dispatch).toHaveBeenCalledOnce();
    expect(recordReceipt).toHaveBeenCalledWith({
      effectKey: "effect:key_1",
      status: "reconciliation_required",
    });
  });
});
