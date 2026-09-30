import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { Bridge } from "../src/bridge.mjs";

test("agent handoffs require owner approval and keep an audit trail", () => {
  const directory = mkdtempSync(join(tmpdir(), "agent-bridge-"));
  const bridge = new Bridge(join(directory, "bridge.sqlite"));
  try {
    const proposed = bridge.submitTask("general-manager", {
      title: "Review a result",
      instructions: "Check the evidence and report discrepancies.",
      assigned_to: "engineering",
      requires_completion_approval: true,
    });
    assert.equal(proposed.status, "pending_approval");
    assert.throws(() => bridge.claimTask("engineering", proposed.id), /unavailable/);

    const approved = bridge.approveTask(proposed.id, "Proceed");
    assert.equal(approved.status, "queued");
    assert.equal(bridge.claimTask("engineering", proposed.id).status, "claimed");
    assert.throws(() => bridge.claimTask("dot", proposed.id), /unavailable/);
    assert.equal(bridge.reportResult("engineering", proposed.id, "Evidence checked.").status, "approval_required");

    const completed = bridge.approveTask(proposed.id, "Accepted");
    assert.equal(completed.status, "completed");
    assert.deepEqual(completed.events.map(({ action }) => action), [
      "submitted",
      "dispatch_approved",
      "claimed",
      "result_reported",
      "completion_approved",
    ]);
  } finally {
    bridge.close();
    rmSync(directory, { recursive: true, force: true });
  }
});
