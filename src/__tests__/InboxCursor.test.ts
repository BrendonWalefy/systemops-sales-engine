import { describe, expect, it } from "vitest";
import {
  INBOX_PAGE_SIZE,
  decodeInboxCursor,
  encodeInboxCursor,
} from "@/application/inbox/inbox-cursor";

describe("inbox cursor", () => {
  it("uses a page size inside the specified 30-50 range", () => {
    expect(INBOX_PAGE_SIZE).toBe(40);
  });

  it("round-trips a row with a timestamp", () => {
    const at = new Date("2026-08-09T12:00:00.000Z");
    const decoded = decodeInboxCursor(encodeInboxCursor({ lastMessageAt: at, id: "abc" }));
    expect(decoded).toEqual({ lastMessageAt: at, id: "abc" });
  });

  it("round-trips a row whose conversation never received a message", () => {
    const decoded = decodeInboxCursor(encodeInboxCursor({ lastMessageAt: null, id: "abc" }));
    expect(decoded).toEqual({ lastMessageAt: null, id: "abc" });
  });

  it("returns null for absent, malformed or non-cursor input", () => {
    expect(decodeInboxCursor(null)).toBeNull();
    expect(decodeInboxCursor("")).toBeNull();
    expect(decodeInboxCursor("not-base64")).toBeNull();
    expect(decodeInboxCursor(Buffer.from("{}", "utf8").toString("base64url"))).toBeNull();
  });

  it("rejects a cursor carrying an invalid date", () => {
    const raw = Buffer.from(JSON.stringify({ t: "nope", id: "abc" }), "utf8").toString("base64url");
    expect(decodeInboxCursor(raw)).toBeNull();
  });
});
