import { parseArgs } from "node:util";
import { Bridge } from "./bridge.mjs";

const { positionals, values } = parseArgs({
  allowPositionals: true,
  options: {
    to: { type: "string" },
    title: { type: "string" },
    instructions: { type: "string" },
    note: { type: "string" },
    message: { type: "string" },
    after: { type: "string" },
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
  } else if (command === "topic-open") {
    result = bridge.openTopic("owner", values.title);
  } else if (command === "topic-list") {
    result = bridge.listTopics(values.status);
  } else if (command === "topic-show") {
    result = bridge.getTopic(taskId, values.after);
  } else if (command === "topic-comment") {
    result = bridge.postComment("owner", taskId, values.message);
  } else if (command === "topic-close") {
    result = bridge.closeTopic(taskId);
  } else {
    throw new Error("Usage: create --to <actor> --title <text> --instructions <text> | list [--status <status>] | show <id> | approve <id> [--note <text>] | cancel <id> [--note <text>] | topic-open --title <text> | topic-list [--status open|closed] | topic-show <id> [--after <comment-id>] | topic-comment <id> --message <text> | topic-close <id>");
  }
  console.log(JSON.stringify(result, null, 2));
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
} finally {
  bridge.close();
}
