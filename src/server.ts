import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';

import { loadConfig, ServerConfig } from './config.js';
import { Logger } from './logger.js';
import { ElasticsearchManager } from './elasticsearch/client.js';
import { ErrorHandler } from './errors/handlers.js';
import {
  FetchIndicestool,
  CreateIndexTool,
  InsertDataTool,
  UpdateDocumentTool,
  DeleteDocumentTool,
  SearchElasticsearchTool,
  ExportToCSVTool,
} from './tools/index.js';

export class ElasticMCPServer {
  private server: Server;
  private config: ServerConfig;
  private logger: Logger;
  private elasticsearch: ElasticsearchManager;
  private errorHandler: ErrorHandler;
  private isShuttingDown = false;

  // Tools
  private fetchIndicesTool: FetchIndicestool;
  private createIndexTool: CreateIndexTool;
  private insertDataTool: InsertDataTool;
  private updateDocumentTool: UpdateDocumentTool;
  private deleteDocumentTool: DeleteDocumentTool;
  private searchElasticsearchTool: SearchElasticsearchTool;
  private exportToCSVTool: ExportToCSVTool;

  constructor() {
    this.config = loadConfig();
    this.logger = new Logger(this.config.logging.level, this.config.logging.format);
    this.errorHandler = new ErrorHandler(this.logger);
    this.elasticsearch = new ElasticsearchManager(this.config.elasticsearch, this.logger);

    this.server = new Server(
      {
        name: this.config.name,
        version: this.config.version,
      },
      {
        capabilities: {
          tools: {},
        },
      }
    );

    // Initialize tools
    this.fetchIndicesTool = new FetchIndicestool(this.elasticsearch, this.logger);
    this.createIndexTool = new CreateIndexTool(this.elasticsearch, this.logger);
    this.insertDataTool = new InsertDataTool(this.elasticsearch, this.logger);
    this.updateDocumentTool = new UpdateDocumentTool(this.elasticsearch, this.logger);
    this.deleteDocumentTool = new DeleteDocumentTool(this.elasticsearch, this.logger);
    this.searchElasticsearchTool = new SearchElasticsearchTool(this.elasticsearch, this.logger);
    this.exportToCSVTool = new ExportToCSVTool(this.elasticsearch, this.logger);

    this.setupHandlers();
    this.setupGracefulShutdown();
  }

  private setupHandlers(): void {
    this.server.setRequestHandler(ListToolsRequestSchema, async () => {
      this.logger.debug('Received list tools request');
      
      return {
        tools: [
          {
            name: 'fetch_indices',
            description: 'List all indices in the Elasticsearch cluster with optional filtering and sorting',
            inputSchema: {
              type: 'object',
              properties: {
                pattern: {
                  type: 'string',
                  description: 'Index pattern filter (e.g., "logs-*")',
                },
                includeSystemIndices: {
                  type: 'boolean',
                  description: 'Whether to include system indices (starting with .)',
                  default: false,
                },
                sortBy: {
                  type: 'string',
                  enum: ['name', 'size', 'docs'],
                  description: 'Sort results by name, size, or document count',
                  default: 'name',
                },
              },
              additionalProperties: false,
            },
          },
          {
            name: 'search_elasticsearch',
            description: 'Perform search queries on Elasticsearch indices with advanced options',
            inputSchema: {
              type: 'object',
              properties: {
                index: {
                  type: 'string',
                  description: 'The index name to search in',
                },
                query: {
                  type: 'object',
                  description: 'Elasticsearch query DSL object',
                },
                size: {
                  type: 'number',
                  minimum: 1,
                  maximum: 10000,
                  description: 'Number of results to return',
                  default: 10,
                },
                from: {
                  type: 'number',
                  minimum: 0,
                  description: 'Offset for pagination',
                  default: 0,
                },
                sort: {
                  type: 'array',
                  description: 'Sort criteria array',
                },
                aggregations: {
                  type: 'object',
                  description: 'Aggregations to perform',
                },
                highlight: {
                  type: 'object',
                  description: 'Highlighting configuration',
                },
                source: {
                  oneOf: [
                    { type: 'array', items: { type: 'string' } },
                    { type: 'boolean' },
                  ],
                  description: 'Fields to include in results',
                },
              },
              required: ['index'],
              additionalProperties: false,
            },
          },
          {
            name: 'create_index',
            description: 'Create a new Elasticsearch index with mappings and settings',
            inputSchema: {
              type: 'object',
              properties: {
                name: {
                  type: 'string',
                  description: 'The name of the index to create',
                },
                mappings: {
                  type: 'object',
                  description: 'Index mappings configuration',
                },
                settings: {
                  type: 'object',
                  description: 'Index settings configuration',
                },
                aliases: {
                  type: 'array',
                  items: { type: 'string' },
                  description: 'Array of alias names for the index',
                },
              },
              required: ['name'],
              additionalProperties: false,
            },
          },
          {
            name: 'insert_data',
            description: 'Insert a document into an Elasticsearch index',
            inputSchema: {
              type: 'object',
              properties: {
                index: {
                  type: 'string',
                  description: 'The index name to insert into',
                },
                document: {
                  type: 'object',
                  description: 'The document to insert',
                },
                id: {
                  type: 'string',
                  description: 'Optional document ID',
                },
                refresh: {
                  oneOf: [
                    { type: 'boolean' },
                    { type: 'string', enum: ['wait_for', 'false', 'true'] },
                  ],
                  description: 'Refresh policy for the operation',
                },
              },
              required: ['index', 'document'],
              additionalProperties: false,
            },
          },
          {
            name: 'update_document',
            description: 'Update an existing document in an Elasticsearch index',
            inputSchema: {
              type: 'object',
              properties: {
                index: {
                  type: 'string',
                  description: 'The index name',
                },
                id: {
                  type: 'string',
                  description: 'The document ID to update',
                },
                document: {
                  type: 'object',
                  description: 'Partial document for update',
                },
                script: {
                  type: 'object',
                  properties: {
                    source: { type: 'string' },
                    params: { type: 'object' },
                  },
                  description: 'Script-based update',
                },
                upsert: {
                  type: 'boolean',
                  description: 'Whether to create document if it does not exist',
                },
                refresh: {
                  oneOf: [
                    { type: 'boolean' },
                    { type: 'string', enum: ['wait_for', 'false', 'true'] },
                  ],
                  description: 'Refresh policy for the operation',
                },
              },
              required: ['index', 'id'],
              additionalProperties: false,
            },
          },
          {
            name: 'delete_document',
            description: 'Delete documents from an Elasticsearch index',
            inputSchema: {
              type: 'object',
              properties: {
                index: {
                  type: 'string',
                  description: 'The index name',
                },
                id: {
                  type: 'string',
                  description: 'The document ID to delete',
                },
                query: {
                  type: 'object',
                  description: 'Query for delete by query operation',
                },
                conflicts: {
                  type: 'string',
                  enum: ['abort', 'proceed'],
                  description: 'How to handle version conflicts',
                },
                refresh: {
                  oneOf: [
                    { type: 'boolean' },
                    { type: 'string', enum: ['wait_for', 'false', 'true'] },
                  ],
                  description: 'Refresh policy for the operation',
                },
              },
              required: ['index'],
              additionalProperties: false,
            },
          },
          {
            name: 'export_to_csv',
            description: 'Export search results from Elasticsearch to CSV format',
            inputSchema: {
              type: 'object',
              properties: {
                index: {
                  type: 'string',
                  description: 'The index name to export from',
                },
                query: {
                  type: 'object',
                  description: 'Elasticsearch query DSL object',
                },
                fields: {
                  type: 'array',
                  items: { type: 'string' },
                  description: 'Specific fields to include in export',
                },
                filename: {
                  type: 'string',
                  description: 'Output filename (optional)',
                },
                format: {
                  type: 'object',
                  properties: {
                    delimiter: { type: 'string' },
                    quote: { type: 'string' },
                    escape: { type: 'string' },
                    header: { type: 'boolean' },
                  },
                  description: 'CSV formatting options',
                },
                maxRows: {
                  type: 'number',
                  minimum: 1,
                  maximum: 1000000,
                  description: 'Maximum number of rows to export',
                },
                compress: {
                  type: 'boolean',
                  description: 'Whether to compress the output file',
                },
              },
              required: ['index'],
              additionalProperties: false,
            },
          },
        ],
      };
    });

    this.server.setRequestHandler(CallToolRequestSchema, async (request) => {
      const { name, arguments: args } = request.params;
      
      this.logger.info('Tool call received', {
        toolName: name,
        hasArgs: !!args,
      });

      try {
        if (!this.elasticsearch.getConnectionInfo().isConnected) {
          throw new Error('Elasticsearch client is not connected');
        }

        // Execute the appropriate tool
        let result: unknown;
        
        switch (name) {
          case 'fetch_indices':
            result = await this.fetchIndicesTool.execute(args);
            break;
          case 'search_elasticsearch':
            result = await this.searchElasticsearchTool.execute(args);
            break;
          case 'create_index':
            result = await this.createIndexTool.execute(args);
            break;
          case 'insert_data':
            result = await this.insertDataTool.execute(args);
            break;
          case 'update_document':
            result = await this.updateDocumentTool.execute(args);
            break;
          case 'delete_document':
            result = await this.deleteDocumentTool.execute(args);
            break;
          case 'export_to_csv':
            result = await this.exportToCSVTool.execute(args);
            break;
          default:
            throw new Error(`Unknown tool: ${name}`);
        }

        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(result, null, 2),
            },
          ],
        };
      } catch (error) {
        const errorResponse = this.errorHandler.handleError(error, 'call-tool');
        this.logger.error('Tool call failed', {
          toolName: name,
          error: errorResponse.error,
        });

        return {
          content: [
            {
              type: 'text',
              text: `Error: ${errorResponse.error.message}`,
            },
          ],
          isError: true,
        };
      }
    });
  }

  private setupGracefulShutdown(): void {
    const shutdown = async (): Promise<void> => {
      if (this.isShuttingDown) {
        return;
      }

      this.isShuttingDown = true;
      this.logger.info('Graceful shutdown initiated');

      try {
        await this.elasticsearch.shutdown();
        this.logger.info('Elasticsearch manager shut down');
      } catch (error) {
        this.logger.error('Error during Elasticsearch shutdown', {}, error as Error);
      }

      this.logger.info('Server shutdown complete');
      process.exit(0);
    };

    process.on('SIGINT', shutdown);
    process.on('SIGTERM', shutdown);

    process.on('uncaughtException', (error) => {
      this.logger.error('Uncaught exception', {}, error);
      shutdown().catch(() => process.exit(1));
    });

    process.on('unhandledRejection', (reason) => {
      this.logger.error('Unhandled rejection', {
        reason: String(reason),
      });
      shutdown().catch(() => process.exit(1));
    });
  }

  async start(): Promise<void> {
    try {
      this.logger.info('Starting Elastic MCP Server', {
        version: this.config.version,
        logLevel: this.config.logging.level,
      });

      await this.elasticsearch.initialize();
      this.logger.info('Elasticsearch connection established');

      const transport = new StdioServerTransport();
      await this.server.connect(transport);

      this.logger.info('MCP server started successfully');
    } catch (error) {
      this.logger.error('Failed to start server', {}, error as Error);
      throw error;
    }
  }
}

export default ElasticMCPServer;