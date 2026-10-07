export type EffectReservationStatus =
  | "prepared"
  | "executing"
  | "succeeded"
  | "failed"
  | "reconciliation_required";

export type EffectReservation = {
  effectKey: string;
  status: EffectReservationStatus;
  providerIdempotencyKey: string;
  execute: boolean;
  request: unknown;
};

export type EffectReceipt = {
  effectKey: string;
  status: "succeeded" | "failed" | "reconciliation_required";
  providerReceipt?: unknown;
};

export type EffectDependencies<TResult = unknown> = {
  dispatch(request: Record<string, unknown>): Promise<unknown>;
  recordReceipt(receipt: EffectReceipt): Promise<TResult>;
};

export async function executeReservedEffect<TResult>(
  reservation: EffectReservation,
  dependencies: EffectDependencies<TResult>,
): Promise<EffectReservation | TResult> {
  assertReservation(reservation);
  if (!reservation.execute) return reservation;

  try {
    const providerReceipt = await dependencies.dispatch(buildDispatchRequest(reservation));
    return dependencies.recordReceipt({
      effectKey: reservation.effectKey,
      status: "succeeded",
      providerReceipt,
    });
  } catch (error) {
    if (!wasPossiblyDispatched(error)) throw error;

    let receiptError: unknown;
    try {
      await dependencies.recordReceipt({
        effectKey: reservation.effectKey,
        status: "reconciliation_required",
      });
    } catch (cause) {
      receiptError = cause;
    }
    throw Object.assign(new Error("External effect outcome is unknown"), {
      code: "reconciliation_required",
      cause: error,
      ...(receiptError === undefined ? {} : { receiptError }),
    });
  }
}

function buildDispatchRequest(reservation: EffectReservation): Record<string, unknown> {
  const request = reservation.request;
  if (request && typeof request === "object" && !Array.isArray(request)) {
    return {
      ...(request as Record<string, unknown>),
      idempotencyKey: reservation.providerIdempotencyKey,
    };
  }
  return {
    request,
    idempotencyKey: reservation.providerIdempotencyKey,
  };
}

function wasPossiblyDispatched(error: unknown): boolean {
  if (!error || typeof error !== "object") return true;
  const state = Reflect.get(error, "dispatchState");
  if (state === "not_started" || Reflect.get(error, "requestStarted") === false) return false;
  return true;
}

function assertReservation(reservation: EffectReservation): void {
  if (!reservation.effectKey.trim() || reservation.effectKey.length > 191) {
    throw validationError("Effect key is invalid");
  }
  if (!reservation.providerIdempotencyKey.trim() || reservation.providerIdempotencyKey.length > 191) {
    throw validationError("Provider idempotency key is invalid");
  }
  if (reservation.execute && reservation.status !== "prepared") {
    throw validationError("Only a prepared effect may be dispatched");
  }
}

function validationError(message: string): Error {
  return Object.assign(new Error(message), { code: "validation_failed" });
}
