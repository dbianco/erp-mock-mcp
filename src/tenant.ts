import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

/** One business served by this process: its data is loaded once, its MCP server is built per request. */
export interface Tenant {
  slug: string;
  name: string;
  createServer(): McpServer;
}
