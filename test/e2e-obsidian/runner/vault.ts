import {
    createTemporaryVault as createGenericTemporaryVault,
    type TemporaryVault,
} from "@vrtmrz/obsidian-test-session";

export type { TemporaryVault };

export async function createTemporaryVault(prefix = "rusync-e2e-"): Promise<TemporaryVault> {
    return await createGenericTemporaryVault({
        prefix,
        pluginIds: ["rusync"],
        idPrefix: "livesync-e2e",
    });
}
