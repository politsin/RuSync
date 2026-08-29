import { pathToFileURL } from "node:url";

const DEFAULT_SIMPLE_AUTH_URL = "http://127.0.0.1:8787";
const DEFAULT_SYNC_KEY = "dev-sync-key";

export function redactSecret(value) {
    const text = `${value ?? ""}`;
    if (text.length <= 10) {
        return "<redacted>";
    }
    return `${text.slice(0, 6)}...${text.slice(-4)}`;
}

export function buildProvisionPayload(env = process.env, args = process.argv.slice(2)) {
    return {
        syncKey: env.RUSYNC_SIMPLE_AUTH_KEY ?? DEFAULT_SYNC_KEY,
        name: env.RUSYNC_SIMPLE_AUTH_SMOKE_NAME ?? "smoke vault",
        encrypted: !args.includes("--unencrypted"),
    };
}

export function sanitiseProvisioningResponse(response) {
    return {
        couchdb: {
            url: response.couchdb?.url,
            username: response.couchdb?.username,
            password: redactSecret(response.couchdb?.password),
            database: response.couchdb?.database,
            useInternalApi: response.couchdb?.useInternalApi,
        },
        sync: {
            encrypted: response.sync?.encrypted,
            passphrase: response.sync?.passphrase ? redactSecret(response.sync.passphrase) : "",
            pathObfuscation: response.sync?.pathObfuscation,
            algorithm: response.sync?.algorithm,
        },
    };
}

async function readJsonResponse(response) {
    const text = await response.text();
    try {
        return JSON.parse(text);
    } catch {
        throw new Error(`Expected JSON response from ${response.url || "request"}, got: ${text}`);
    }
}

export async function provisionThroughSimpleAuth({ endpoint, payload, fetcher = fetch }) {
    const response = await fetcher(`${endpoint.replace(/\/+$/, "")}/api/provision`, {
        method: "POST",
        headers: {
            "content-type": "application/json",
            "x-rusync-sync-key": payload.syncKey,
        },
        body: JSON.stringify(payload),
    });
    const body = await readJsonResponse(response);
    if (!response.ok) {
        throw new Error(`Provisioning failed (${response.status}): ${body.error ?? JSON.stringify(body)}`);
    }
    return body;
}

export async function verifyProvisionedDatabase(response, fetcher = fetch) {
    const { url, username, password, database } = response.couchdb ?? {};
    if (!url || !username || !password || !database) {
        throw new Error("Provisioning response does not contain complete CouchDB credentials.");
    }
    const auth = Buffer.from(`${username}:${password}`).toString("base64");
    const dbResponse = await fetcher(`${url.replace(/\/+$/, "")}/${encodeURIComponent(database)}`, {
        headers: {
            authorization: `Basic ${auth}`,
        },
    });
    const body = await readJsonResponse(dbResponse);
    if (!dbResponse.ok) {
        throw new Error(`Provisioned CouchDB database check failed (${dbResponse.status}): ${body.error ?? JSON.stringify(body)}`);
    }
    return {
        db_name: body.db_name,
        doc_count: body.doc_count,
        update_seq: body.update_seq,
    };
}

export async function runSmoke(env = process.env, args = process.argv.slice(2), fetcher = fetch) {
    const endpoint = `${env.RUSYNC_SIMPLE_AUTH_URL ?? DEFAULT_SIMPLE_AUTH_URL}`.replace(/\/+$/, "");
    const payload = buildProvisionPayload(env, args);
    const provisioned = await provisionThroughSimpleAuth({ endpoint, payload, fetcher });
    const database = await verifyProvisionedDatabase(provisioned, fetcher);
    return {
        endpoint,
        payload: {
            ...payload,
            syncKey: redactSecret(payload.syncKey),
        },
        provisioned: sanitiseProvisioningResponse(provisioned),
        database,
    };
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
    runSmoke()
        .then((result) => {
            console.log(JSON.stringify(result, null, 2));
        })
        .catch((error) => {
            console.error(error instanceof Error ? error.message : `${error}`);
            process.exitCode = 1;
        });
}
