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

test("shared topics preserve provider identity, role labels, replies, and cursors", () => {
  const directory = mkdtempSync(join(tmpdir(), "agent-room-"));
  const bridge = new Bridge(join(directory, "bridge.sqlite"));
  try {
    const topic = bridge.openTopic("owner", "Review the launch plan");
    const codex = bridge.postComment("codex", topic.id, "Engineering evidence is ready.", "engineering");
    const grok = bridge.postComment("growth", topic.id, "Growth needs a cohort baseline.", undefined, codex.id);

    assert.deepEqual(
      bridge.getTopic(topic.id).comments.map(({ actor, role, reply_to }) => ({ actor, role, reply_to })),
      [
        { actor: "codex", role: "engineering", reply_to: null },
        { actor: "growth", role: "growth", reply_to: codex.id },
      ],
    );
    assert.deepEqual(bridge.getTopic(topic.id, codex.id).comments.map(({ id }) => id), [grok.id]);
    assert.throws(
      () => bridge.postComment("growth", topic.id, "Pretend to be engineering", "engineering"),
      /cannot post as another role/,
    );
    assert.equal(bridge.closeTopic(topic.id).status, "closed");
    assert.throws(() => bridge.postComment("codex", topic.id, "Late comment"), /closed/);
  } finally {
    bridge.close();
    rmSync(directory, { recursive: true, force: true });
  }
});
