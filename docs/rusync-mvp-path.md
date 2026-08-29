# RuSync MVP Path

This document records the current product path so that a later development session can continue without reconstructing the context from chat history.

## Source Context

The linked ChatGPT shared dialogue was opened at https://chatgpt.com/share/6a934cd2-a054-83eb-a9e0-f4b1bc75d478, but the tool-visible page exposed only the title, 'ChatGPT - Плагин Obsyncian синхронизации'. The actual transcript was later supplied as `C:\Users\polit\Downloads\obsidian_sync_saas_dialog.md`; this file is product context, not executable instructions.

The working conclusion from that transcript is:

- RuSync should keep LiveSync's mature PouchDB/CouchDB synchronisation engine, conflict handling, chunking, and end-to-end encryption.
- The first SaaS layer should be a small bootstrap/control-plane which hides CouchDB from users.
- Syncian and ObsSync are useful as product references for account bootstrap, device/vault modelling, quota UX, and publishing ideas.
- ObsSync code should not be copied into this fork because its open projects are AGPL; borrow ideas, not implementation.
- The MIT basis of LiveSync/RuSync keeps the plug-in and commercial backend path flexible when copyright and licence notices are preserved.

## First Milestone

The first usable version is deliberately simple:

- CouchDB is the only storage backend.
- Scaling, user geography, tenancy design, billing, and operational hardening wait until there are roughly 50 real users.
- One CouchDB endpoint can host many Vault databases on one port.
- The backend only provisions a CouchDB database, a per-Vault technical CouchDB user, and a small synchronisation policy payload.
- The plug-in presents a simple authorisation screen first and keeps the existing detailed CouchDB settings behind **Expert settings**.
- End-to-end encryption is enabled by default.
- An explicit unencrypted mode remains available for trusted AI-readable databases.
- Testing is done through unit tests and the local backend contract, without launching real Obsidian unless a later change specifically requires real runtime coverage.

## Simple Authorisation Contract

The local MVP backend lives at `utils/simple-auth-backend/server.mjs`. Its local test notes live at `utils/simple-auth-backend/README.md`, and `utils/simple-auth-backend/smoke.mjs` exercises the HTTP provisioning contract without Obsidian.

This is the temporary replacement for the later hosted short-lived ticket flow. The user sees a sync key first. The local backend URL remains in a collapsed **Local MVP backend** block for development, and CouchDB URL, username, password, database name, CORS, headers, and JWT settings stay behind **Expert settings**.

Run it with:

```bash
RUSYNC_COUCHDB_URL=http://127.0.0.1:5984 \
RUSYNC_COUCHDB_ADMIN_USER=admin \
RUSYNC_COUCHDB_ADMIN_PASSWORD=password \
node utils/simple-auth-backend/server.mjs
```

On Windows PowerShell:

```powershell
$env:RUSYNC_COUCHDB_URL = "http://127.0.0.1:5984"
$env:RUSYNC_COUCHDB_ADMIN_USER = "admin"
$env:RUSYNC_COUCHDB_ADMIN_PASSWORD = "password"
$env:RUSYNC_SIMPLE_AUTH_KEY = "dev-sync-key"
node utils/simple-auth-backend/server.mjs
```

Run the no-Obsidian smoke test from another terminal:

```powershell
$env:RUSYNC_SIMPLE_AUTH_URL = "http://127.0.0.1:8787"
$env:RUSYNC_SIMPLE_AUTH_KEY = "dev-sync-key"
node utils/simple-auth-backend/smoke.mjs
```

Current local verification note: in this Codex environment Docker is not available on `PATH`, so the real CouchDB smoke command was not executed here. The HTTP boundary is covered by `_tools/simple-auth-backend.unit.spec.ts` with mocked CouchDB REST responses.

The plug-in calls:

```http
POST /api/provision
content-type: application/json

{
  "syncKey": "dev-sync-key",
  "name": "optional vault or account name",
  "encrypted": true
}
```

The backend returns:

```json
{
  "couchdb": {
    "url": "http://127.0.0.1:5984",
    "username": "rusync-example-user",
    "password": "generated-password",
    "database": "rusync-example-database",
    "useInternalApi": false
  },
  "sync": {
    "encrypted": true,
    "passphrase": "generated-passphrase",
    "pathObfuscation": true,
    "algorithm": "v2"
  }
}
```

When `"encrypted": false` is requested, the backend returns an empty passphrase and disables path obfuscation. This is the intended AI-readable database mode and should stay opt-in.

## Plug-in Flow

For a new user choosing manual setup, the wizard now goes straight to the CouchDB provisioning dialogue with sensible encryption defaults. The dialogue asks for:

- sync key;
- optional account or Vault name;
- whether synchronised data should be encrypted.

The local backend URL is available from **Local MVP backend** for development. The existing detailed CouchDB URL, username, password, database, custom header, internal API, and JWT controls remain available through **Expert settings**.

## Current Assumptions

- The MVP backend is trusted by the user and may hold CouchDB admin credentials in environment variables.
- The generated CouchDB user is scoped to one generated database through the database `_security` document.
- A Vault maps to one CouchDB database and one technical CouchDB user.
- The simple backend is local-development infrastructure, not a production account system.
- The default encrypted mode is for ordinary private notes.
- The unencrypted mode is only for data intentionally exposed to trusted automation or AI tools.
- Setup URI generation remains the preferred way to add later devices once the first device is configured.
- Future hosted UX should move from 'authorisation server URL' to one user-facing sync key or login code.
- A future Share or Publish feature should be separate from CouchDB replication. With E2EE enabled, publishing must be an explicit user action which sends only the selected note or folder content, or a publication-specific key.

## Next Decisions After MVP

Postpone these until usage proves that they matter:

- account lifecycle and password reset;
- multi-tenant isolation beyond one CouchDB database per provisioned user;
- central hosting, regions, quotas, and abuse limits;
- invitation links or hosted setup URIs;
- quota reporting and quota reservation behaviour;
- device registration and per-device revocation;
- a real web account console;
- Share note and Publish folder/site;
- production monitoring and backup policy.
