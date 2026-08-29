import { createHash, randomBytes } from "node:crypto";
import { createServer } from "node:http";
import { pathToFileURL } from "node:url";

const DEFAULT_PORT = 8787;

export function normaliseCouchDbUrl(url) {
    const trimmed = `${url ?? ""}`.trim().replace(/\/+$/, "");
    if (!trimmed) {
        throw new Error("RUSYNC_COUCHDB_URL is required.");
    }
    return trimmed;
}

export function createToken(bytes = 18) {
    return randomBytes(bytes).toString("base64url");
}

export function createSafeName(name, fallbackToken = createToken(6)) {
    const normalised = `${name ?? ""}`
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9_$()+/-]+/g, "-")
        .replace(/^-+|-+$/g, "")
        .slice(0, 48);
    return normalised || `vault-${fallbackToken}`;
}

export function createProvisioningPlan({ couchDbUrl, name, encrypted = true, tokenFactory = createToken }) {
    const safeName = createSafeName(name, tokenFactory(6));
    const suffix = tokenFactory(9).toLowerCase();
    const username = `rusync-${safeName}-${suffix}`.slice(0, 96);
    const database = `rusync-${safeName}-${suffix}`.slice(0, 120);
    const password = tokenFactory(24);
    const passphrase = encrypted ? tokenFactory(32) : "";
    return {
        couchDbUrl: normaliseCouchDbUrl(couchDbUrl),
        username,
        password,
        database,
        encrypted,
        passphrase,
    };
}

export function createCouchDbRequests(plan) {
    return [
        {
            method: "PUT",
            path: `/_users/org.couchdb.user:${encodeURIComponent(plan.username)}`,
            body: {
                _id: `org.couchdb.user:${plan.username}`,
                name: plan.username,
                password: plan.password,
                roles: [],
                type: "user",
            },
            okStatuses: [200, 201, 202, 409],
        },
        {
            method: "PUT",
            path: `/${encodeURIComponent(plan.database)}`,
            body: undefined,
            okStatuses: [200, 201, 202, 412],
        },
        {
            method: "PUT",
            path: `/${encodeURIComponent(plan.database)}/_security`,
            body: {
                admins: { names: [], roles: [] },
                members: { names: [plan.username], roles: [] },
            },
            okStatuses: [200, 201, 202],
        },
    ];
}

export async function applyProvisioningPlan(plan, { adminUser, adminPassword, fetcher = fetch }) {
    if (!adminUser || !adminPassword) {
        throw new Error("RUSYNC_COUCHDB_ADMIN_USER and RUSYNC_COUCHDB_ADMIN_PASSWORD are required.");
    }
    const auth = Buffer.from(`${adminUser}:${adminPassword}`).toString("base64");
    for (const request of createCouchDbRequests(plan)) {
        const response = await fetcher(`${plan.couchDbUrl}${request.path}`, {
            method: request.method,
            headers: {
                authorization: `Basic ${auth}`,
                ...(request.body ? { "content-type": "application/json" } : {}),
            },
            body: request.body ? JSON.stringify(request.body) : undefined,
        });
        if (!request.okStatuses.includes(response.status)) {
            const body = await response.text();
            throw new Error(`CouchDB request ${request.method} ${request.path} failed (${response.status}): ${body}`);
        }
    }
}

export function createProvisioningResponse(plan) {
    return {
        couchdb: {
            url: plan.couchDbUrl,
            username: plan.username,
            password: plan.password,
            database: plan.database,
            useInternalApi: false,
        },
        sync: {
            encrypted: plan.encrypted,
            passphrase: plan.passphrase,
            pathObfuscation: plan.encrypted,
            algorithm: "v2",
        },
    };
}

export async function readJsonBody(request) {
    const chunks = [];
    for await (const chunk of request) {
        chunks.push(chunk);
    }
    const body = Buffer.concat(chunks).toString("utf8");
    return body ? JSON.parse(body) : {};
}

function sendJson(response, status, payload) {
    response.writeHead(status, {
        "access-control-allow-origin": "*",
        "access-control-allow-methods": "POST, OPTIONS, GET",
        "access-control-allow-headers": "content-type, authorization",
        "content-type": "application/json; charset=utf-8",
    });
    response.end(JSON.stringify(payload));
}

export function createRequestHandler(env = process.env, fetcher = fetch) {
    return async (request, response) => {
        try {
            if (request.method === "OPTIONS") {
                sendJson(response, 204, {});
                return;
            }
            const url = new URL(request.url ?? "/", "http://127.0.0.1");
            if (request.method === "GET" && url.pathname === "/health") {
                sendJson(response, 200, { ok: true });
                return;
            }
            if (request.method !== "POST" || url.pathname !== "/api/provision") {
                sendJson(response, 404, { error: "not_found" });
                return;
            }
            const body = await readJsonBody(request);
            const encrypted = body.encrypted !== false;
            const plan = createProvisioningPlan({
                couchDbUrl: env.RUSYNC_COUCHDB_URL,
                name: body.name,
                encrypted,
            });
            await applyProvisioningPlan(plan, {
                adminUser: env.RUSYNC_COUCHDB_ADMIN_USER,
                adminPassword: env.RUSYNC_COUCHDB_ADMIN_PASSWORD,
                fetcher,
            });
            sendJson(response, 200, createProvisioningResponse(plan));
        } catch (error) {
            sendJson(response, 500, {
                error: error instanceof Error ? error.message : `${error}`,
            });
        }
    };
}

export function startServer(env = process.env) {
    const port = Number.parseInt(env.RUSYNC_SIMPLE_AUTH_PORT ?? `${DEFAULT_PORT}`, 10) || DEFAULT_PORT;
    const server = createServer(createRequestHandler(env));
    server.listen(port, () => {
        const fingerprint = createHash("sha256")
            .update(`${env.RUSYNC_COUCHDB_URL ?? ""}:${env.RUSYNC_COUCHDB_ADMIN_USER ?? ""}`)
            .digest("hex")
            .slice(0, 12);
        console.log(`RuSync simple authorisation backend listening on http://127.0.0.1:${port}`);
        console.log(`CouchDB target fingerprint: ${fingerprint}`);
    });
    return server;
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
    startServer();
}
