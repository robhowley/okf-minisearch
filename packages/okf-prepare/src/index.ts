export interface PrepareBundleSentinel {
  readonly marker: "okf-prepare-bundled";
  readonly value: 73;
}

export function createPrepareBundleSentinel(): PrepareBundleSentinel {
  return { marker: "okf-prepare-bundled", value: 73 };
}
