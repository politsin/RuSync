import {
    DEFAULT_SETTINGS,
    type CouchDBConnection,
    type EncryptionSettings,
} from "@vrtmrz/livesync-commonlib/compat/common/types";

export type SimpleAuthProvisionRequest = {
    name: string;
    encrypted: boolean;
};

export type SimpleAuthProvisionResponse = {
    couchdb?: Partial<{
        url: string;
        uri: string;
        username: string;
        user: string;
        password: string;
        database: string;
        db: string;
        useInternalApi: boolean;
        customHeaders: string;
    }>;
    couchDB?: SimpleAuthProvisionResponse["couchdb"];
    sync?: Partial<{
        encrypted: boolean;
        passphrase: string;
        pathObfuscation: boolean;
        algorithm: EncryptionSettings["E2EEAlgorithm"];
    }>;
};

export type SimpleAuthProvisionSettings = {
    couchdb: CouchDBConnection;
    encryption: EncryptionSettings;
};

export type FetchLike = (input: string, init?: RequestInit) => Promise<Pick<Response, "ok" | "status" | "text">>;

const browserFetch: FetchLike = (input, init) => window.fetch(input, init);

export function createSimpleAuthDefaultPassphrase(): string {
    const randomUUID = typeof window !== "undefined" ? window.crypto?.randomUUID?.() : undefined;
    if (randomUUID) {
        return `rusync-${randomUUID}`;
    }
    return `rusync-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}

export function normaliseSimpleAuthEndpoint(endpoint: string): string {
    const trimmed = endpoint.trim();
    if (!trimmed) {
        throw new Error("Simple authorisation server URL is required.");
    }
    return trimmed.replace(/\/+$/, "");
}

export function mapSimpleAuthProvisionResponse(
    response: SimpleAuthProvisionResponse,
    requestedEncrypted: boolean,
    fallbackPassphrase = createSimpleAuthDefaultPassphrase()
): SimpleAuthProvisionSettings {
    const couchdb = response.couchDB ?? response.couchdb;
    if (!couchdb) {
        throw new Error("Simple authorisation response does not include CouchDB settings.");
    }
    const couchDB_URI = couchdb.url ?? couchdb.uri ?? "";
    const couchDB_USER = couchdb.username ?? couchdb.user ?? "";
    const couchDB_PASSWORD = couchdb.password ?? "";
    const couchDB_DBNAME = couchdb.database ?? couchdb.db ?? "";
    if (!couchDB_URI || !couchDB_USER || !couchDB_PASSWORD || !couchDB_DBNAME) {
        throw new Error("Simple authorisation response is missing required CouchDB fields.");
    }

    const encrypted = response.sync?.encrypted ?? requestedEncrypted;
    const passphrase = encrypted ? (response.sync?.passphrase ?? fallbackPassphrase) : "";
    return {
        couchdb: {
            couchDB_URI,
            couchDB_USER,
            couchDB_PASSWORD,
            couchDB_DBNAME,
            couchDB_CustomHeaders: couchdb.customHeaders ?? "",
            useJWT: false,
            jwtAlgorithm: "",
            jwtKey: "",
            jwtKid: "",
            jwtSub: "",
            jwtExpDuration: DEFAULT_SETTINGS.jwtExpDuration,
            useRequestAPI: couchdb.useInternalApi ?? false,
        },
        encryption: {
            encrypt: encrypted,
            passphrase,
            usePathObfuscation: encrypted ? (response.sync?.pathObfuscation ?? true) : false,
            E2EEAlgorithm: response.sync?.algorithm ?? DEFAULT_SETTINGS.E2EEAlgorithm,
        },
    };
}

export async function provisionSimpleAuth(
    endpoint: string,
    request: SimpleAuthProvisionRequest,
    fetcher: FetchLike = browserFetch
): Promise<SimpleAuthProvisionSettings> {
    const response = await fetcher(`${normaliseSimpleAuthEndpoint(endpoint)}/api/provision`, {
        method: "POST",
        headers: {
            "content-type": "application/json",
        },
        body: JSON.stringify(request),
    });
    const body = await response.text();
    let parsed: SimpleAuthProvisionResponse;
    try {
        parsed = JSON.parse(body) as SimpleAuthProvisionResponse;
    } catch {
        throw new Error(`Simple authorisation server returned non-JSON response (${response.status}).`);
    }
    if (!response.ok) {
        const message = typeof (parsed as { error?: unknown }).error === "string" ? (parsed as { error: string }).error : body;
        throw new Error(`Simple authorisation failed (${response.status}): ${message}`);
    }
    return mapSimpleAuthProvisionResponse(parsed, request.encrypted);
}
