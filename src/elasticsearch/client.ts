import { Client, ClientOptions } from '@elastic/elasticsearch';
import { ElasticConfig } from '../config.js';
import { Logger } from '../logger.js';

export interface ConnectionInfo {
  isConnected: boolean;
  clusterName?: string;
  version?: string;
  lastHealthCheck: Date;
  error?: string;
}

export class ElasticsearchManager {
  private client: Client | null = null;
  private config: ElasticConfig;
  private logger: Logger;
  private connectionInfo: ConnectionInfo;
  private healthCheckInterval: NodeJS.Timeout | null = null;

  constructor(config: ElasticConfig, logger: Logger) {
    this.config = config;
    this.logger = logger.child({ component: 'elasticsearch' });
    this.connectionInfo = {
      isConnected: false,
      lastHealthCheck: new Date(),
    };
  }

  async initialize(): Promise<void> {
    try {
      this.logger.info('Initializing Elasticsearch client', {
        cloudId: this.config.cloudId ? '***' : undefined,
        node: this.config.node,
        hasApiKey: !!this.config.apiKey,
        hasAuth: !!this.config.auth,
      });

      const clientOptions: ClientOptions = {
        maxRetries: this.config.maxRetries,
        requestTimeout: this.config.requestTimeout,
        pingTimeout: this.config.pingTimeout,
        sniffOnStart: this.config.sniffOnStart,
        ...(this.config.sniffInterval && { sniffInterval: this.config.sniffInterval }),
      };

      if (this.config.cloudId) {
        clientOptions.cloud = { id: this.config.cloudId };
        if (this.config.apiKey) {
          clientOptions.auth = { apiKey: this.config.apiKey };
        }
      } else if (this.config.node) {
        clientOptions.node = this.config.node;
        if (this.config.apiKey) {
          clientOptions.auth = { apiKey: this.config.apiKey };
        } else if (this.config.auth) {
          clientOptions.auth = {
            username: this.config.auth.username,
            password: this.config.auth.password,
          };
        }
      }

      if (this.config.ssl) {
        clientOptions.tls = {
          rejectUnauthorized: this.config.ssl.rejectUnauthorized,
        };
      }

      this.client = new Client(clientOptions);

      await this.healthCheck();
      this.startHealthMonitoring();

      this.logger.info('Elasticsearch client initialized successfully', {
        clusterName: this.connectionInfo.clusterName,
        version: this.connectionInfo.version,
      });
    } catch (error) {
      this.logger.error('Failed to initialize Elasticsearch client', {}, error as Error);
      throw error;
    }
  }

  async healthCheck(): Promise<boolean> {
    if (!this.client) {
      this.connectionInfo = {
        isConnected: false,
        lastHealthCheck: new Date(),
        error: 'Client not initialized',
      };
      return false;
    }

    try {
      const [pingResult, infoResult] = await Promise.all([
        this.client.ping(),
        this.client.info(),
      ]);

      this.connectionInfo = {
        isConnected: pingResult === true,
        clusterName: infoResult.cluster_name,
        version: infoResult.version?.number,
        lastHealthCheck: new Date(),
      };

      if (this.connectionInfo.isConnected) {
        this.logger.debug('Health check passed', {
          clusterName: this.connectionInfo.clusterName,
          version: this.connectionInfo.version,
        });
      }

      return this.connectionInfo.isConnected;
    } catch (error) {
      this.connectionInfo = {
        isConnected: false,
        lastHealthCheck: new Date(),
        error: (error as Error).message,
      };

      this.logger.warn('Health check failed', {
        error: (error as Error).message,
      });

      return false;
    }
  }

  async reconnect(): Promise<void> {
    this.logger.info('Attempting to reconnect to Elasticsearch');
    
    if (this.client) {
      await this.client.close();
    }

    await this.initialize();
  }

  getClient(): Client {
    if (!this.client) {
      throw new Error('Elasticsearch client not initialized');
    }
    
    if (!this.connectionInfo.isConnected) {
      throw new Error('Elasticsearch client not connected');
    }

    return this.client;
  }

  getConnectionInfo(): ConnectionInfo {
    return { ...this.connectionInfo };
  }

  private startHealthMonitoring(): void {
    const HEALTH_CHECK_INTERVAL = 30000; // 30 seconds

    this.healthCheckInterval = setInterval(async () => {
      const isHealthy = await this.healthCheck();
      
      if (!isHealthy) {
        this.logger.warn('Health check failed, attempting reconnection');
        try {
          await this.reconnect();
        } catch (error) {
          this.logger.error('Reconnection failed', {}, error as Error);
        }
      }
    }, HEALTH_CHECK_INTERVAL);
  }

  async shutdown(): Promise<void> {
    this.logger.info('Shutting down Elasticsearch manager');

    if (this.healthCheckInterval) {
      clearInterval(this.healthCheckInterval);
      this.healthCheckInterval = null;
    }

    if (this.client) {
      try {
        await this.client.close();
        this.logger.info('Elasticsearch client closed');
      } catch (error) {
        this.logger.warn('Error closing Elasticsearch client', { error: (error as Error).message });
      }
    }

    this.connectionInfo.isConnected = false;
  }
}