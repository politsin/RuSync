import { describe, expect, it, vi } from "vitest";
import {
    mapSimpleAuthProvisionResponse,
    normaliseSimpleAuthEndpoint,
    provisionSimpleAuth,
} from "./simpleAuthProvision";

describe("simpleAuthProvision", () => {
    it("maps the backend CouchDB and default encrypted sync settings", () => {
        const mapped = mapSimpleAuthProvisionResponse(
            {
                couchdb: {
                    url: "http://localhost:5984",
                    username: "alice",
                    password: "secret",
                    database: "vault",
                },
                sync: {
                    encrypted: true,
                    passphrase: "generated-passphrase",
                },
            },
            true
        );

        expect(mapped.couchdb).toMatchObject({
            couchDB_URI: "http://localhost:5984",
            couchDB_USER: "alice",
            couchDB_PASSWORD: "secret",
            couchDB_DBNAME: "vault",
            useRequestAPI: false,
            useJWT: false,
        });
        expect(mapped.encryption).toMatchObject({
            encrypt: true,
            passphrase: "generated-passphrase",
            usePathObfuscation: true,
        });
    });

    it("keeps unencrypted AI-readable databases explicit", () => {
        const mapped = mapSimpleAuthProvisionResponse(
            {
                couchDB: {
                    uri: "https://couch.example",
                    user: "bot",
                    password: "secret",
                    db: "ai_notes",
                },
                sync: {
                    encrypted: false,
                },
            },
            true,
            "fallback"
        );

        expect(mapped.encryption).toMatchObject({
            encrypt: false,
            passphrase: "",
            usePathObfuscation: false,
        });
    });

    it("posts to the provision endpoint and maps the response", async () => {
        const fetcher = vi.fn(async () => ({
            ok: true,
            status: 200,
            text: async () =>
                JSON.stringify({
                    couchdb: {
                        url: "http://localhost:5984",
                        username: "alice",
                        password: "secret",
                        database: "vault",
                    },
                    sync: {
                        encrypted: true,
                        passphrase: "passphrase",
                    },
                }),
        }));

        await expect(
            provisionSimpleAuth(
                "http://127.0.0.1:8787/",
                { syncKey: "test-key", name: "Vault", encrypted: true },
                fetcher
            )
        ).resolves.toMatchObject({
            couchdb: {
                couchDB_USER: "alice",
            },
            encryption: {
                encrypt: true,
            },
        });
        expect(fetcher).toHaveBeenCalledWith(
            "http://127.0.0.1:8787/api/provision",
            expect.objectContaining({
                method: "POST",
                headers: expect.objectContaining({
                    "x-rusync-sync-key": "test-key",
                }),
                body: JSON.stringify({ syncKey: "test-key", name: "Vault", encrypted: true }),
            })
        );
    });

    it("rejects an empty endpoint before a network request", () => {
        expect(() => normaliseSimpleAuthEndpoint(" ")).toThrow(/required/);
    });
});
