import { createClient, type SupabaseClient } from "@supabase/supabase-js";

const DOCUMENTS_BUCKET = "documents";
const DEFAULT_SIGNED_URL_TTL_SECONDS = 300;

let _storageSigningClient: SupabaseClient | undefined;

function requireSupabaseUrl(): string {
  const url = process.env.SUPABASE_URL;
  if (!url) {
    throw new Error("SUPABASE_URL is not set in env");
  }
  return url.replace(/\/+$/, "").replace(/\/rest\/v1$/, "");
}

function requireServiceRoleKey(): string {
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!key) {
    throw new Error("SUPABASE_SERVICE_ROLE_KEY is not set in env");
  }
  return key;
}

function storageSigningClient(): SupabaseClient {
  if (!_storageSigningClient) {
    _storageSigningClient = createClient(requireSupabaseUrl(), requireServiceRoleKey(), {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
      },
    });
  }
  return _storageSigningClient;
}

const SIGN_REFRESH_MARGIN_MS = 60_000;
const signedUrlCache = new Map<string, { url: string; expiresAt: number }>();

export async function createDocumentSignedUrl(
  storagePath: string,
  filename: string,
  ttlSeconds = DEFAULT_SIGNED_URL_TTL_SECONDS,
): Promise<string | null> {
  const cacheKey = `${storagePath}|${filename}|${ttlSeconds}`;
  const hit = signedUrlCache.get(cacheKey);
  if (hit && hit.expiresAt - SIGN_REFRESH_MARGIN_MS > Date.now()) {
    return hit.url;
  }

  try {
    const { data, error } = await storageSigningClient()
      .storage
      .from(DOCUMENTS_BUCKET)
      .createSignedUrl(storagePath, ttlSeconds, {
        download: filename,
      });

    if (error) {
      console.warn(`[resources] could not sign document download: ${error.message}`);
      return null;
    }

    if (data?.signedUrl) {
      signedUrlCache.set(cacheKey, {
        url: data.signedUrl,
        expiresAt: Date.now() + ttlSeconds * 1000,
      });
    }

    return data?.signedUrl ?? null;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.warn(`[resources] could not sign document download: ${message}`);
    return null;
  }
}

