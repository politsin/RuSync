import { describe, expect, it, vi } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
    createCouchDbRequests,
    createProvisioningStateKey,
    createProvisioningPlan,
    createProvisioningResponse,
    createSafeName,
    applyProvisioningPlan,
    createRequestHandler,
    getOrCreateProvisioningPlan,
    loadProvisioningStore,
    validateSyncKey,
} from "../utils/simple-auth-backend/server.mjs";
import {
    buildProvisionPayload,
    sanitiseProvisioningResponse,
    verifyProvisionedDatabase,
} from "../utils/simple-auth-backend/smoke.mjs";

type RequestListener = (request: IncomingMessage, response: ServerResponse) => void;

async function withHttpServer<T>(handler: RequestListener, run: (baseUrl: string) => Promise<T>) {
    const server = createServer(handler);
    await new Promise<void>((resolve) => {
        server.listen(0, "127.0.0.1", resolve);
    });
    const address = server.address();
    if (!address || typeof address === "string") {
        server.close();
        throw new Error("Could not bind test HTTP server.");
    }
    try {
        return await run(`http://127.0.0.1:${address.port}`);
    } finally {
        await new Promise<void>((resolve, reject) => {
            server.close((error) => (error ? reject(error) : resolve()));
        });
    }
}

async function withTempStore<T>(run: (storePath: string) => Promise<T>) {
    const directory = await mkdtemp(join(tmpdir(), "rusync-simple-auth-"));
    try {
        return await run(join(directory, "state.local.json"));
    } finally {
        await rm(directory, { recursive: true, force: true });
    }
}

describe("simple auth backend", () => {
    it("creates CouchDB-safe names and keeps encryption enabled by default", () => {
        const plan = createProvisioningPlan({
            couchDbUrl: "http://localhost:5984/",
            name: "My AI Vault",
            tokenFactory: () => "abc123",
        });

        expect(plan).toMatchObject({
            couchDbUrl: "http://localhost:5984",
            username: "rusync-my-ai-vault-abc123",
            database: "rusync-my-ai-vault-abc123",
            encrypted: true,
        });
        expect(plan.password).toBe("abc123");
        expect(plan.passphrase).toBe("abc123");
    });

    it("uses a hashed sync-key and Vault name pair as the provisioning state key", () => {
        const first = createProvisioningStateKey("sync-key", "My Vault");
        const second = createProvisioningStateKey("sync-key", "my vault");
        const differentVault = createProvisioningStateKey("sync-key", "Other Vault");

        expect(first).toMatch(/^[a-f0-9]{64}$/);
        expect(first).toBe(second);
        expect(first).not.toBe(differentVault);
        expect(first).not.toContain("sync-key");
    });

    it("reuses the same provisioning plan for the same sync key and Vault name", async () => {
        await withTempStore(async (storePath) => {
            const env = {
                RUSYNC_COUCHDB_URL: "http://localhost:5984",
                RUSYNC_SIMPLE_AUTH_STORE: storePath,
            };
            const first = await getOrCreateProvisioningPlan({
                env,
                syncKey: "dev-sync-key",
                name: "Team Vault",
                encrypted: true,
                tokenFactory: () => "first-token",
            });
            const second = await getOrCreateProvisioningPlan({
                env,
                syncKey: "dev-sync-key",
                name: "team vault",
                encrypted: false,
                tokenFactory: () => "second-token",
            });
            const store = await loadProvisioningStore(storePath);

            expect(second).toEqual(first);
            expect(Object.keys(store.vaults)).toHaveLength(1);
            expect(first.encrypted).toBe(true);
            expect(first.passphrase).toBe("first-token");
        });
    });

    it("creates a separate provisioning plan for another Vault name", async () => {
        await withTempStore(async (storePath) => {
            const env = {
                RUSYNC_COUCHDB_URL: "http://localhost:5984",
                RUSYNC_SIMPLE_AUTH_STORE: storePath,
            };
            const first = await getOrCreateProvisioningPlan({
                env,
                syncKey: "dev-sync-key",
                name: "Personal",
                encrypted: true,
                tokenFactory: () => "first-token",
            });
            const second = await getOrCreateProvisioningPlan({
                env,
                syncKey: "dev-sync-key",
                name: "Work",
                encrypted: false,
                tokenFactory: () => "second-token",
            });

            expect(second).not.toEqual(first);
            expect(second.encrypted).toBe(false);
            expect(second.passphrase).toBe("");
            expect((await loadProvisioningStore(storePath)).vaults).toMatchObject({
                [createProvisioningStateKey("dev-sync-key", "Personal")]: first,
                [createProvisioningStateKey("dev-sync-key", "Work")]: second,
            });
        });
    });

    it("allows an explicitly unencrypted AI-readable database", () => {
        const plan = createProvisioningPlan({
            couchDbUrl: "http://localhost:5984",
            name: "AI Vault",
            encrypted: false,
            tokenFactory: () => "abc123",
        });

        expect(createProvisioningResponse(plan).sync).toEqual({
            encrypted: false,
            passphrase: "",
            pathObfuscation: false,
            algorithm: "v2",
        });
    });

    it("builds the minimal CouchDB provisioning request sequence", () => {
        const requests = createCouchDbRequests({
            username: "rusync-test",
            password: "secret",
            database: "rusync-db",
        });

        expect(requests.map((request) => `${request.method} ${request.path}`)).toEqual([
            "PUT /_users/org.couchdb.user:rusync-test",
            "PUT /rusync-db",
            "PUT /rusync-db/_security",
        ]);
        const securityRequest = requests[2];
        expect(securityRequest).toBeDefined();
        expect((securityRequest?.body as { members: { names: string[] } }).members.names).toEqual(["rusync-test"]);
    });

    it("applies provisioning with admin basic authentication", async () => {
        const fetcher = vi.fn(async () => ({
            status: 201,
            text: async () => "",
        }));

        await applyProvisioningPlan(
            {
                couchDbUrl: "http://localhost:5984",
                username: "rusync-test",
                password: "secret",
                database: "rusync-db",
            },
            {
                adminUser: "admin",
                adminPassword: "password",
                fetcher: fetcher as unknown as typeof fetch,
            }
        );

        expect(fetcher).toHaveBeenCalledTimes(3);
        expect(fetcher).toHaveBeenNthCalledWith(
            1,
            "http://localhost:5984/_users/org.couchdb.user:rusync-test",
            expect.objectContaining({
                method: "PUT",
                headers: expect.objectContaining({
                    authorization: "Basic YWRtaW46cGFzc3dvcmQ=",
                }),
            })
        );
    });

    it("falls back to a generated vault name when the requested name is empty", () => {
        expect(createSafeName("", "abc123")).toBe("vault-abc123");
    });

    it("accepts the configured sync key before provisioning", () => {
        expect(() =>
            validateSyncKey(
                { headers: { "x-rusync-sync-key": "test-key" } },
                {},
                { RUSYNC_SIMPLE_AUTH_KEY: "test-key" }
            )
        ).not.toThrow();
    });

    it("rejects missing and mismatched sync keys", () => {
        expect(() => validateSyncKey({ headers: {} }, {}, {})).toThrow("sync_key_required");
        expect(() =>
            validateSyncKey({ headers: { "x-rusync-sync-key": "wrong" } }, {}, { RUSYNC_SIMPLE_AUTH_KEY: "right" })
        ).toThrow("sync_key_rejected");
    });

    it("builds an encrypted smoke payload by default", () => {
        expect(buildProvisionPayload({ RUSYNC_SIMPLE_AUTH_KEY: "test-key" }, [])).toEqual({
            syncKey: "test-key",
            name: "smoke vault",
            encrypted: true,
        });
        expect(buildProvisionPayload({ RUSYNC_SIMPLE_AUTH_KEY: "test-key" }, ["--unencrypted"]).encrypted).toBe(false);
    });

    it("sanitises smoke output secrets", () => {
        expect(
            sanitiseProvisioningResponse({
                couchdb: {
                    url: "http://localhost:5984",
                    username: "rusync-test",
                    password: "long-secret-password",
                    database: "rusync-db",
                    useInternalApi: false,
                },
                sync: {
                    encrypted: true,
                    passphrase: "long-secret-passphrase",
                    pathObfuscation: true,
                    algorithm: "v2",
                },
            })
        ).toMatchObject({
            couchdb: {
                password: "long-s...word",
            },
            sync: {
                passphrase: "long-s...rase",
            },
        });
    });

    it("verifies the generated CouchDB credentials in the smoke path", async () => {
        const fetcher = vi.fn(async () => ({
            ok: true,
            status: 200,
            url: "http://localhost:5984/rusync-db",
            text: async () => JSON.stringify({ db_name: "rusync-db", doc_count: 0, update_seq: "0-g1" }),
        }));

        await expect(
            verifyProvisionedDatabase(
                {
                    couchdb: {
                        url: "http://localhost:5984",
                        username: "rusync-test",
                        password: "secret",
                        database: "rusync-db",
                    },
                },
                fetcher as unknown as typeof fetch
            )
        ).resolves.toEqual({
            db_name: "rusync-db",
            doc_count: 0,
            update_seq: "0-g1",
        });
        expect(fetcher).toHaveBeenCalledWith(
            "http://localhost:5984/rusync-db",
            expect.objectContaining({
                headers: {
                    authorization: "Basic cnVzeW5jLXRlc3Q6c2VjcmV0",
                },
            })
        );
    });

    it("serves the HTTP provisioning boundary without a real CouchDB", async () => {
        const couchFetcher = vi.fn(async () => ({
            status: 201,
            text: async () => "",
        }));
        const handler = createRequestHandler(
            {
                RUSYNC_COUCHDB_URL: "http://couchdb.example",
                RUSYNC_COUCHDB_ADMIN_USER: "admin",
                RUSYNC_COUCHDB_ADMIN_PASSWORD: "password",
                RUSYNC_SIMPLE_AUTH_KEY: "dev-sync-key",
            },
            couchFetcher as unknown as typeof fetch
        );

        await withHttpServer(handler, async (baseUrl) => {
            await expect((await fetch(`${baseUrl}/health`)).json()).resolves.toEqual({ ok: true });

            const missingKey = await fetch(`${baseUrl}/api/provision`, {
                method: "POST",
                headers: { "content-type": "application/json" },
                body: JSON.stringify({ name: "Vault", encrypted: true }),
            });
            await expect(missingKey.json()).resolves.toEqual({ error: "sync_key_required" });
            expect(missingKey.status).toBe(401);

            const rejectedKey = await fetch(`${baseUrl}/api/provision`, {
                method: "POST",
                headers: { "content-type": "application/json", "x-rusync-sync-key": "wrong" },
                body: JSON.stringify({ name: "Vault", encrypted: true }),
            });
            await expect(rejectedKey.json()).resolves.toEqual({ error: "sync_key_rejected" });
            expect(rejectedKey.status).toBe(403);

            const provisioned = await fetch(`${baseUrl}/api/provision`, {
                method: "POST",
                headers: { "content-type": "application/json", "x-rusync-sync-key": "dev-sync-key" },
                body: JSON.stringify({ name: "Vault", encrypted: false }),
            });
            const body = await provisioned.json();
            expect(provisioned.status).toBe(200);
            expect(body).toMatchObject({
                couchdb: {
                    url: "http://couchdb.example",
                },
                sync: {
                    encrypted: false,
                    passphrase: "",
                    pathObfuscation: false,
                },
            });
        });
        expect(couchFetcher).toHaveBeenCalledTimes(3);
    });
});
