import { parseArgs } from "node:util";
import { Bridge } from "./bridge.mjs";

const { positionals, values } = parseArgs({
  allowPositionals: true,
  options: {
    to: { type: "string" },
    title: { type: "string" },
    instructions: { type: "string" },
    note: { type: "string" },
    status: { type: "string" },
    "no-completion-approval": { type: "boolean" },
  },
});

const [command, taskId] = positionals;
const bridge = new Bridge(process.env.BRIDGE_DB_PATH);
try {
  let result;
  if (command === "create") {
    result = bridge.submitTask("owner", {
      assigned_to: values.to,
      title: values.title,
      instructions: values.instructions,
      requires_completion_approval: !values["no-completion-approval"],
    });
  } else if (command === "list") {
    result = bridge.listTasks("owner", values.status);
  } else if (command === "show") {
    result = bridge.getTask("owner", taskId);
  } else if (command === "approve") {
    result = bridge.approveTask(taskId, values.note);
  } else if (command === "cancel") {
    result = bridge.cancelTask(taskId, values.note);
  } else {
    throw new Error("Usage: create --to codex|dot|general-manager|engineering|qa-release|content|ops|growth|any --title <text> --instructions <text> | list [--status <status>] | show <id> | approve <id> [--note <text>] | cancel <id> [--note <text>]");
  }
  console.log(JSON.stringify(result, null, 2));
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
} finally {
  bridge.close();
}
