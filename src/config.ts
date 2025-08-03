import { z } from 'zod';

export const ElasticConfigSchema = z.object({
  cloudId: z.string().optional(),
  apiKey: z.string().optional(),
  node: z.string().optional(),
  auth: z.object({
    username: z.string(),
    password: z.string(),
  }).optional(),
  maxRetries: z.number().min(0).max(10).default(3),
  requestTimeout: z.number().min(1000).max(300000).default(30000),
  pingTimeout: z.number().min(1000).max(30000).default(3000),
  sniffOnStart: z.boolean().default(false),
  sniffInterval: z.number().positive().optional(),
  ssl: z.object({
    rejectUnauthorized: z.boolean().default(true),
  }).optional(),
});

export type ElasticConfig = z.infer<typeof ElasticConfigSchema>;

export interface ServerConfig {
  name: string;
  version: string;
  elasticsearch: ElasticConfig;
  logging: {
    level: 'error' | 'warn' | 'info' | 'debug';
    format: 'json' | 'text';
  };
  server: {
    maxConcurrentRequests: number;
    requestTimeoutMs: number;
  };
}

export function loadConfig(): ServerConfig {
  const config: ServerConfig = {
    name: 'elastic-mcp',
    version: '0.1.0',
    elasticsearch: ElasticConfigSchema.parse({
      cloudId: process.env.ELASTIC_CLOUD_ID,
      apiKey: process.env.ELASTIC_API_KEY,
      node: process.env.ELASTIC_NODE,
      auth: process.env.ELASTIC_USERNAME && process.env.ELASTIC_PASSWORD ? {
        username: process.env.ELASTIC_USERNAME,
        password: process.env.ELASTIC_PASSWORD,
      } : undefined,
      maxRetries: process.env.ELASTIC_MAX_RETRIES ? parseInt(process.env.ELASTIC_MAX_RETRIES, 10) : 3,
      requestTimeout: process.env.ELASTIC_REQUEST_TIMEOUT ? parseInt(process.env.ELASTIC_REQUEST_TIMEOUT, 10) : 30000,
      pingTimeout: process.env.ELASTIC_PING_TIMEOUT ? parseInt(process.env.ELASTIC_PING_TIMEOUT, 10) : 3000,
    }),
    logging: {
      level: (process.env.LOG_LEVEL as 'error' | 'warn' | 'info' | 'debug') || 'info',
      format: (process.env.LOG_FORMAT as 'json' | 'text') || 'text',
    },
    server: {
      maxConcurrentRequests: process.env.MAX_CONCURRENT_REQUESTS ? parseInt(process.env.MAX_CONCURRENT_REQUESTS, 10) : 10,
      requestTimeoutMs: process.env.REQUEST_TIMEOUT_MS ? parseInt(process.env.REQUEST_TIMEOUT_MS, 10) : 30000,
    },
  };

  validateConfig(config);
  return config;
}

function validateConfig(config: ServerConfig): void {
  const { elasticsearch } = config;
  
  if (!elasticsearch.cloudId && !elasticsearch.node) {
    throw new Error('Either ELASTIC_CLOUD_ID or ELASTIC_NODE must be provided');
  }

  if (elasticsearch.cloudId && !elasticsearch.apiKey) {
    throw new Error('ELASTIC_API_KEY is required when using Elastic Cloud');
  }

  if (elasticsearch.node && !elasticsearch.auth && !elasticsearch.apiKey) {
    throw new Error('Authentication (username/password or API key) is required');
  }
}