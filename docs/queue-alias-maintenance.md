# Offline reconciliation of an acknowledged queue alias

Some older prompt callers persisted a short agent ID literally in `queues/<alias>.json`. The public queue API resolves that ID to its canonical UUID before listing or removing items. Consequently, an acknowledged item can remain in an inaccessible alias file and correctly block a guarded rollout.

`scripts/reconcile-queue-alias.mts` implements a narrow maintenance operation for one owner-acknowledged, plain text item. It does not change the running daemon, alter rollout allowlists, dispatch prompts, or delete queue files. It uses Paseo's existing `AgentQueueStore` and `MessageReceipts` implementations.

## Prepare and inspect

Use an existing checkout with its locked dependencies installed. No dependency update is needed.

```sh
node --import tsx scripts/reconcile-queue-alias.mts inspect /absolute/path/plan.json
node --import tsx --test scripts/reconcile-queue-alias.test.mts
```

The reviewed plan contains:

- `home`: the exact daemon home.
- `mustBeStoppedPids`: the observed supervisor and worker PIDs. A running or reused PID refuses application; never kill a reused PID to satisfy this check.
- `alias`, `canonicalId`, `itemId`: the literal stored alias, its canonical UUID, and the acknowledged item UUID.
- `expectedAliasSha256`, `expectedCanonicalSha256`: hashes of the exact original file bytes. The canonical queue must be empty.
- `ownerAcknowledgement.path` and `.sha256`: the durable original owner's acknowledgement and its hash.
- `listen.host` (`127.0.0.1`) and `.port`: the actual daemon listener observed before maintenance.

Inspection reads the target queues and receipts and reports whether the daemon or observed processes are running. The operation rejects attachments, changed identities/hashes, and any pending or completed receipt for the target item. Other pending receipts remain untouched.

## Apply only within an explicitly authorized offline window

The utility **does not stop Paseo**. First drain all protected work and owned terminals and obtain any required maintenance authorization. Disable automatic daemon relaunch using the established host lifecycle procedure, stop the daemon, and verify that its supervisor and worker have exited. Do not treat this command as permission to bypass another rollout gate.

```sh
node --import tsx scripts/reconcile-queue-alias.mts apply-offline \
  /absolute/path/plan.json /absolute/path/new-private-evidence-directory
```

Application refuses a live PID, takes Paseo's own exclusive PID lease, and reserves the exact listener to detect surviving workers and prevent relaunch during maintenance. It then:

1. Revalidates the exact queue bytes and target receipt states.
2. Saves all original queue/journal and request-receipt bytes in a new private evidence directory, with a SHA-256 manifest and the owner's acknowledgement.
3. Records removal tombstones for both alias and canonical spellings. This prevents a stale retry from replaying the acknowledged request.
4. Uses the production queue store to append and sync the before/after journal, increment the revision, and atomically retain an empty alias queue file.
5. Verifies that unrelated queues and receipts are byte-identical, the original journal is an unchanged prefix, and both tombstones exist.

The command releases only its maintenance listener and PID lease. It never launches a daemon. `finish.json` is the successful receipt. A failure after evidence creation leaves `failure.json` and the recoverable originals. Never restore originals or retry blindly: restoring a removal tombstone could replay already acknowledged work. Inspect partial state before issuing another reviewed plan.

## Current rollout boundary (`code-nnl` / `code-9yr`)

The existing release controller requires all queue gates to pass **before** stopping the daemon. The alias cannot be acknowledged through its live API, while this separate maintenance operation requires the daemon to be stopped. This is an ordering dependency, not another request for general upgrade permission.

For the current rollout, the smallest additional decision is an explicit, one-time offline maintenance window for the exact acknowledged alias item, after all live work and terminals are idle. The controller must remain held during that window. Its existing lifecycle owner can then incorporate this repair after the cold backup and before resuming the reviewed release. Every other queue/hash/history/terminal gate remains in force. No such exception is enabled by this source change.

The maintenance scripts are separate from the already signed desktop/iOS application. Preparing or testing them does not replace or install that application, and a source PR does not prove the live queue was repaired.
