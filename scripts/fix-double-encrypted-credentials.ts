#!/usr/bin/env tsx

import { createDecipheriv } from "crypto";
import { eq } from "drizzle-orm";
import { db } from "../src/infrastructure/db/client";
import { clinics } from "../src/infrastructure/db/schema";
import {
  isEncryptedCredential,
} from "../src/infrastructure/crypto/credential-vault";

const ENC_PREFIX = "enc:v1:";

function getKey(): Buffer {
  const hex = process.env.CREDENTIAL_ENCRYPTION_KEY;
  if (!hex) throw new Error("CREDENTIAL_ENCRYPTION_KEY not set");
  if (hex.length !== 64) throw new Error("CREDENTIAL_ENCRYPTION_KEY must be 64 hex chars (32 bytes)");
  return Buffer.from(hex, "hex");
}

function decryptOneLayer(value: string): string {
  const key = getKey();
  const rest = value.slice(ENC_PREFIX.length);
  const parts = rest.split(":");
  if (parts.length !== 3) throw new Error("Formato de credencial encriptada inválido");
  const [ivHex, tagHex, ciphertextHex] = parts;
  const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(ivHex, "hex"));
  decipher.setAuthTag(Buffer.from(tagHex, "hex"));
  return Buffer.concat([
    decipher.update(Buffer.from(ciphertextHex, "hex")),
    decipher.final(),
  ]).toString("utf8");
}

function normalizeStoredCredential(value: string | null): string | null {
  if (!value) return null;

  let current = value;
  let changed = false;

  while (isEncryptedCredential(current)) {
    const decrypted = decryptOneLayer(current);
    if (!decrypted || !isEncryptedCredential(decrypted)) break;
    current = decrypted;
    changed = true;
  }

  return changed ? current : value;
}

async function main() {
  const clinicFilter = process.argv[2]?.trim().toLowerCase() ?? null;

  const rows = await db.select({
    id: clinics.id,
    slug: clinics.slug,
    name: clinics.name,
    zapiToken: clinics.zapiToken,
    zapiClientToken: clinics.zapiClientToken,
    metaAccessToken: clinics.metaAccessToken,
  }).from(clinics);

  let fixed = 0;

  for (const row of rows) {
    if (clinicFilter && row.slug?.toLowerCase() !== clinicFilter && row.name.toLowerCase() !== clinicFilter) {
      continue;
    }

    const nextZapiToken = normalizeStoredCredential(row.zapiToken);
    const nextZapiClientToken = normalizeStoredCredential(row.zapiClientToken);
    const nextMetaAccessToken = normalizeStoredCredential(row.metaAccessToken);

    const changed =
      nextZapiToken !== row.zapiToken ||
      nextZapiClientToken !== row.zapiClientToken ||
      nextMetaAccessToken !== row.metaAccessToken;

    if (!changed) continue;

    await db.update(clinics).set({
      zapiToken: nextZapiToken,
      zapiClientToken: nextZapiClientToken,
      metaAccessToken: nextMetaAccessToken,
      updatedAt: new Date(),
    }).where(eq(clinics.id, row.id));

    fixed += 1;
    console.log(`fixed ${row.slug ?? row.name}`);
  }

  console.log(`done: ${fixed} clinic(s) fixed`);
}

await main();
