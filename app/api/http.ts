export function json(data: unknown, init: ResponseInit = {}) {
  const headers = new Headers(init.headers);
  headers.set("Content-Type", "application/json; charset=utf-8");
  headers.set("Cache-Control", "no-store");
  headers.set("Access-Control-Allow-Origin", "*");
  headers.set("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  headers.set("Access-Control-Allow-Headers", "Content-Type");

  return new Response(JSON.stringify(data), { ...init, headers });
}

export function options() {
  return json(null, { status: 204 });
}

export function cleanName(value: unknown) {
  if (typeof value !== "string") return "";
  return value.trim().replace(/\s+/g, " ").slice(0, 24);
}

export function cleanMessage(value: unknown) {
  if (typeof value !== "string") return "";
  return value.trim().replace(/\s+/g, " ").slice(0, 360);
}

export function validCode(value: unknown): value is string {
  return typeof value === "string" && /^\d{4}$/.test(value);
}

export function validParticipantId(value: unknown): value is string {
  return typeof value === "string" && /^[0-9a-f-]{36}$/i.test(value);
}

export function validVideoId(value: unknown): value is string | null {
  return value === null || (typeof value === "string" && /^[\w-]{11}$/.test(value));
}

export function safePosition(value: unknown) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.max(0, Math.min(number, 604_800)) : 0;
}
