/** Copy plain session data without changing its field names. */
export function cloneSessionData(value: unknown): unknown {
  return clonePlainData(value, new Set());
}

function clonePlainData(value: unknown, ancestors: Set<object>): unknown {
  if (
    value === undefined ||
    value === null ||
    typeof value === "string" ||
    typeof value === "boolean"
  ) {
    return value;
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new TypeError("Session data must use finite numbers");
    return value;
  }
  if (typeof value !== "object") throw new TypeError("Session data must be plain data");
  if (ancestors.has(value)) throw new TypeError("Session data must not contain cycles");
  ancestors.add(value);
  try {
    return Array.isArray(value) ? cloneArray(value, ancestors) : cloneObject(value, ancestors);
  } finally {
    ancestors.delete(value);
  }
}

function cloneArray(value: unknown[], ancestors: Set<object>): unknown[] {
  return Array.from({ length: value.length }, (_unused, index) => {
    const item = Object.getOwnPropertyDescriptor(value, String(index));
    if (!item || !("value" in item)) {
      throw new TypeError("Session arrays must contain plain values");
    }
    return clonePlainData(item.value, ancestors);
  });
}

function cloneObject(value: object, ancestors: Set<object>): Record<string, unknown> {
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) {
    throw new TypeError("Session data must use plain objects");
  }
  const output: Record<string, unknown> = {};
  for (const key of Object.keys(value)) {
    const item = Object.getOwnPropertyDescriptor(value, key);
    if (!item || !("value" in item)) {
      throw new TypeError("Session objects must contain plain values");
    }
    const copied = clonePlainData(item.value, ancestors);
    if (copied !== undefined) {
      Object.defineProperty(output, key, {
        value: copied,
        enumerable: true,
        configurable: true,
        writable: true,
      });
    }
  }
  return output;
}
