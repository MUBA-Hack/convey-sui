import "server-only";

import { Transaction } from "@mysten/sui/transactions";
import {
  fromBase64,
  fromHex,
  normalizeStructTag,
  normalizeSuiAddress,
} from "@mysten/sui/utils";

export interface SponsoredProtectedTransferExpectation {
  packageId: string;
  coinType: string;
  beneficiaryAddress: string;
  reviewerAddress: string;
  amountMicro: string;
  deadlineMs: number;
  commitmentHex: string;
  sealIdHex?: string;
  walrusBlobId?: string;
}

export interface SponsoredKindInspection {
  moveCallTargets: string[];
  inputObjectIds: string[];
}

type UnknownRecord = Record<string, unknown>;

function record(value: unknown): UnknownRecord {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error("Sponsored transaction command graph is invalid.");
  }
  return value as UnknownRecord;
}

function inputIndex(value: unknown): number {
  const valueRecord = record(value);
  if (
    valueRecord.$kind !== "Input" ||
    typeof valueRecord.Input !== "number" ||
    !Number.isSafeInteger(valueRecord.Input) ||
    valueRecord.Input < 0
  ) {
    throw new Error("Sponsored transaction command graph is invalid.");
  }
  return valueRecord.Input;
}

function pureBytes(inputs: unknown[], argument: unknown): Uint8Array {
  const input = record(inputs[inputIndex(argument)]);
  const pure = record(input.Pure);
  if (input.$kind !== "Pure" || typeof pure.bytes !== "string") {
    throw new Error("Sponsored transaction command graph is invalid.");
  }
  return fromBase64(pure.bytes);
}

function assertBytes(actual: Uint8Array, expected: Uint8Array, label: string): void {
  if (
    actual.byteLength !== expected.byteLength ||
    actual.some((byte, index) => byte !== expected[index])
  ) {
    throw new Error(`Sponsored transaction ${label} does not match the reviewed plan.`);
  }
}

function u64Bytes(value: bigint): Uint8Array {
  const bytes = new Uint8Array(8);
  new DataView(bytes.buffer).setBigUint64(0, value, true);
  return bytes;
}

function bcsVector(bytes: Uint8Array): Uint8Array {
  if (bytes.byteLength >= 128) {
    throw new Error("Sponsored evidence value is too large.");
  }
  const encoded = new Uint8Array(bytes.byteLength + 1);
  encoded[0] = bytes.byteLength;
  encoded.set(bytes, 1);
  return encoded;
}

function addressBytes(address: string): Uint8Array {
  return fromHex(normalizeSuiAddress(address));
}

function moveCallTarget(command: UnknownRecord): string | null {
  if (command.$kind !== "MoveCall") return null;
  const call = record(command.MoveCall);
  if (
    typeof call.package !== "string" ||
    typeof call.module !== "string" ||
    typeof call.function !== "string"
  ) {
    throw new Error("Sponsored transaction command graph is invalid.");
  }
  return `${normalizeSuiAddress(call.package)}::${call.module}::${call.function}`;
}

export function inspectSponsoredProtectedTransferKind(
  transactionKindBytes: string,
  expectation: SponsoredProtectedTransferExpectation,
): SponsoredKindInspection {
  if (transactionKindBytes.length === 0 || transactionKindBytes.length > 32_768) {
    throw new Error("Sponsored transaction command graph is invalid.");
  }
  let transaction: Transaction;
  try {
    transaction = Transaction.fromKind(transactionKindBytes);
  } catch {
    throw new Error("Sponsored transaction command graph is invalid.");
  }
  const data = transaction.getData();
  const inputs = data.inputs as unknown[];
  const commands = data.commands.map(record);
  const packageId = normalizeSuiAddress(expectation.packageId);
  const protectedTarget = `${packageId}::protected_transfer::create_escrow`;
  const evidenceTarget = `${packageId}::evidence_access::create`;
  const destroyZeroTarget = `${normalizeSuiAddress("0x2")}::coin::destroy_zero`;
  const moveCallTargets = commands
    .map(moveCallTarget)
    .filter((target): target is string => target !== null);

  const permittedKinds = new Set(["MergeCoins", "SplitCoins", "MoveCall"]);
  if (commands.some((command) => !permittedKinds.has(String(command.$kind)))) {
    throw new Error("Sponsored transaction command graph contains an unapproved command.");
  }
  const protectedIndexes = commands
    .map((command, index) => (moveCallTarget(command) === protectedTarget ? index : -1))
    .filter((index) => index >= 0);
  if (protectedIndexes.length !== 1) {
    throw new Error("Sponsored transaction command graph must contain one protected transfer.");
  }
  if (
    moveCallTargets.some(
      (target) =>
        target !== protectedTarget &&
        target !== evidenceTarget &&
        target !== destroyZeroTarget,
    )
  ) {
    throw new Error("Sponsored transaction command graph contains an unapproved Move call.");
  }

  const protectedIndex = protectedIndexes[0]!;
  const protectedCall = record(commands[protectedIndex]!.MoveCall);
  const typeArguments = protectedCall.typeArguments;
  const args = protectedCall.arguments;
  if (
    !Array.isArray(typeArguments) ||
    typeArguments.length !== 1 ||
    typeof typeArguments[0] !== "string" ||
    normalizeStructTag(typeArguments[0]) !== normalizeStructTag(expectation.coinType) ||
    !Array.isArray(args) ||
    args.length !== 6
  ) {
    throw new Error("Sponsored transaction command graph does not match the reviewed plan.");
  }

  const paymentArg = record(args[0]);
  if (
    paymentArg.$kind !== "NestedResult" ||
    !Array.isArray(paymentArg.NestedResult) ||
    paymentArg.NestedResult.length !== 2 ||
    paymentArg.NestedResult[1] !== 0
  ) {
    throw new Error("Sponsored transaction command graph has an invalid payment source.");
  }
  const splitIndex = paymentArg.NestedResult[0];
  if (typeof splitIndex !== "number" || splitIndex >= protectedIndex) {
    throw new Error("Sponsored transaction command graph has an invalid payment source.");
  }
  const split = commands[splitIndex];
  if (split?.$kind !== "SplitCoins") {
    throw new Error("Sponsored transaction command graph has an invalid payment source.");
  }
  const splitData = record(split.SplitCoins);
  if (!Array.isArray(splitData.amounts) || splitData.amounts.length !== 1) {
    throw new Error("Sponsored transaction amount does not match the reviewed plan.");
  }
  assertBytes(
    pureBytes(inputs, splitData.amounts[0]),
    u64Bytes(BigInt(expectation.amountMicro)),
    "amount",
  );

  // `Transaction.coin({ balance })` adds `coin::destroy_zero` when the selected
  // owned coin is fully consumed. Permit only that exact cleanup: once, after
  // the matching split, before the protected call, for the same coin type and
  // the same source input. This cannot redirect value or add authority.
  const destroyZeroIndexes = commands
    .map((command, index) => (moveCallTarget(command) === destroyZeroTarget ? index : -1))
    .filter((index) => index >= 0);
  if (destroyZeroIndexes.length > 1) {
    throw new Error("Sponsored transaction command graph contains invalid coin cleanup.");
  }
  if (destroyZeroIndexes.length === 1) {
    const destroyIndex = destroyZeroIndexes[0]!;
    const destroyCall = record(commands[destroyIndex]!.MoveCall);
    const destroyTypes = destroyCall.typeArguments;
    const destroyArgs = destroyCall.arguments;
    if (
      destroyIndex <= splitIndex ||
      destroyIndex >= protectedIndex ||
      !Array.isArray(destroyTypes) ||
      destroyTypes.length !== 1 ||
      typeof destroyTypes[0] !== "string" ||
      normalizeStructTag(destroyTypes[0]) !== normalizeStructTag(expectation.coinType) ||
      !Array.isArray(destroyArgs) ||
      destroyArgs.length !== 1 ||
      inputIndex(destroyArgs[0]) !== inputIndex(splitData.coin)
    ) {
      throw new Error("Sponsored transaction command graph contains invalid coin cleanup.");
    }
  }
  assertBytes(pureBytes(inputs, args[1]), addressBytes(expectation.beneficiaryAddress), "beneficiary");
  assertBytes(pureBytes(inputs, args[2]), addressBytes(expectation.reviewerAddress), "reviewer");
  assertBytes(
    pureBytes(inputs, args[3]),
    bcsVector(fromHex(expectation.commitmentHex)),
    "commitment",
  );
  assertBytes(pureBytes(inputs, args[4]), u64Bytes(BigInt(expectation.deadlineMs)), "deadline");

  const clockInput = record(inputs[inputIndex(args[5])]);
  const clockObject = record(clockInput.Object);
  const sharedClock = record(clockObject.SharedObject);
  if (
    clockInput.$kind !== "Object" ||
    clockObject.$kind !== "SharedObject" ||
    normalizeSuiAddress(String(sharedClock.objectId)) !== normalizeSuiAddress("0x6") ||
    sharedClock.mutable !== false
  ) {
    throw new Error("Sponsored transaction command graph has an invalid Clock input.");
  }

  const evidenceCalls = commands.filter(
    (command) => moveCallTarget(command) === evidenceTarget,
  );
  const expectsEvidence = expectation.sealIdHex !== undefined;
  if (expectsEvidence !== (evidenceCalls.length === 1)) {
    throw new Error("Sponsored transaction evidence call does not match the reviewed plan.");
  }
  if ((expectation.sealIdHex === undefined) !== (expectation.walrusBlobId === undefined)) {
    throw new Error("Sponsored transaction evidence expectation is incomplete.");
  }
  if (evidenceCalls.length === 1) {
    const evidenceCall = record(evidenceCalls[0]!.MoveCall);
    const evidenceArgs = evidenceCall.arguments;
    const evidenceTypes = evidenceCall.typeArguments;
    if (!Array.isArray(evidenceArgs) || evidenceArgs.length !== 3 || !Array.isArray(evidenceTypes) || evidenceTypes.length !== 0) {
      throw new Error("Sponsored transaction evidence call is invalid.");
    }
    assertBytes(
      pureBytes(inputs, evidenceArgs[0]),
      bcsVector(fromHex(expectation.sealIdHex!)),
      "Seal identity",
    );
    assertBytes(
      pureBytes(inputs, evidenceArgs[1]),
      bcsVector(new TextEncoder().encode(expectation.walrusBlobId!)),
      "Walrus locator",
    );
    const readers = new Uint8Array(1 + 64);
    readers[0] = 2;
    readers.set(addressBytes(expectation.beneficiaryAddress), 1);
    readers.set(addressBytes(expectation.reviewerAddress), 33);
    assertBytes(pureBytes(inputs, evidenceArgs[2]), readers, "evidence readers");
  }

  const inputObjectIds = inputs.flatMap((inputValue) => {
    const input = record(inputValue);
    if (input.$kind !== "Object") return [];
    const object = record(input.Object);
    const objectKind = String(object.$kind);
    if (objectKind === "ImmOrOwnedObject") {
      return [normalizeSuiAddress(String(record(object.ImmOrOwnedObject).objectId))];
    }
    if (objectKind === "SharedObject") {
      return [normalizeSuiAddress(String(record(object.SharedObject).objectId))];
    }
    throw new Error("Sponsored transaction command graph contains an invalid object input.");
  });

  return { moveCallTargets, inputObjectIds };
}
