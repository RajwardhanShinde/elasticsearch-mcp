#!/usr/bin/env node

/**
 * Elastic MCP Server Entry Point
 * 
 * This is the main entry point for the Elastic MCP server that provides
 * standardized tools for interacting with Elasticsearch clusters.
 */

import ElasticMCPServer from './server.js';

async function main(): Promise<void> {
  try {
    const server = new ElasticMCPServer();
    await server.start();
  } catch (error) {
    console.error('Failed to start Elastic MCP Server:', error);
    process.exit(1);
  }
}

main().catch((error) => {
  console.error('Unhandled error in main:', error);
  process.exit(1);
});