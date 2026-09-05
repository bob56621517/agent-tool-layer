import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";

import { buildServer } from "./build-server.js";
import { ensureBackend } from "./ensure-backend.js";

await ensureBackend();
const server = buildServer();
await server.connect(new StdioServerTransport());
