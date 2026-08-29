import { describe, expect, it, vi } from "vitest";
import {
    createCouchDbRequests,
    createProvisioningPlan,
    createProvisioningResponse,
    createSafeName,
    applyProvisioningPlan,
    validateSyncKey,
} from "../utils/simple-auth-backend/server.mjs";

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
});
