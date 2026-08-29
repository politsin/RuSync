# RuSync Simple Authorisation Backend

This directory contains the local MVP backend for testing the simplified CouchDB provisioning flow without running Obsidian.

It is intentionally small:

- it accepts one sync key;
- it creates one CouchDB database per Vault;
- it creates one technical CouchDB user per database;
- it stores issued Vault credentials in `state.local.json` so that the same sync key and Vault name can configure another device;
- it returns CouchDB credentials and the selected encryption policy to the plug-in.

## Start CouchDB

The repository already has CouchDB test helpers. A direct Docker command is enough for the MVP smoke path:

```powershell
docker run -d --name rusync-couchdb-mvp -p 5984:5984 -e COUCHDB_USER=admin -e COUCHDB_PASSWORD=password couchdb:3.5.0
```

Initialise single-node CouchDB if this is a fresh container:

```powershell
curl.exe -X POST http://127.0.0.1:5984/_cluster_setup -H "Content-Type: application/json" -d "{\"action\":\"enable_single_node\",\"username\":\"admin\",\"password\":\"password\",\"bind_address\":\"0.0.0.0\",\"port\":5984,\"singlenode\":true}" --user "admin:password"
```

## Start The Backend

```powershell
$env:RUSYNC_COUCHDB_URL = "http://127.0.0.1:5984"
$env:RUSYNC_COUCHDB_ADMIN_USER = "admin"
$env:RUSYNC_COUCHDB_ADMIN_PASSWORD = "password"
$env:RUSYNC_SIMPLE_AUTH_KEY = "dev-sync-key"
$env:RUSYNC_SIMPLE_AUTH_STORE = "utils/simple-auth-backend/state.local.json"
node utils/simple-auth-backend/server.mjs
```

## Run A Smoke Test

In another terminal:

```powershell
$env:RUSYNC_SIMPLE_AUTH_URL = "http://127.0.0.1:8787"
$env:RUSYNC_SIMPLE_AUTH_KEY = "dev-sync-key"
node utils/simple-auth-backend/smoke.mjs
```

Use the unencrypted AI-readable mode explicitly:

```powershell
node utils/simple-auth-backend/smoke.mjs --unencrypted
```

The smoke test prints a sanitised JSON result. It verifies that the backend can provision credentials and that the generated technical user can read the generated CouchDB database.

Run the same smoke command twice with the same sync key and Vault name to verify the additional-device behaviour: the backend should return the same generated database and technical username instead of provisioning a new Vault.

## Boundaries

This backend is not a production account system. It is a local contract fixture for the first RuSync MVP. The next production shape should replace the static sync key with a hosted account flow or short-lived ticket while preserving the plug-in-facing payload shape.
