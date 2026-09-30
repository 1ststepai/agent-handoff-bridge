import { randomBytes } from "node:crypto";
import { TOKEN_ENV } from "./actors.mjs";

for (const variable of Object.values(TOKEN_ENV)) {
  console.log(`${variable}=${randomBytes(32).toString("base64url")}`);
}
