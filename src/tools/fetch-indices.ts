import { ElasticsearchManager } from '../elasticsearch/client.js';
import { Logger } from '../logger.js';
import { FetchIndicesArgsSchema } from '../validation/schemas.js';
import { ValidationError, ElasticsearchError } from '../errors/handlers.js';

export interface FetchIndicesArgs {
  pattern?: string;
  includeSystemIndices?: boolean;
  sortBy?: 'name' | 'size' | 'docs';
}

export interface IndexInfo {
  name: string;
  health: string;
  status: string;
  docs: number;
  size: string;
  created: string;
  uuid: string;
}

export interface FetchIndicesResult {
  indices: IndexInfo[];
  total: number;
}

export class FetchIndicestool {
  private elasticsearch: ElasticsearchManager;
  private logger: Logger;

  constructor(elasticsearch: ElasticsearchManager, logger: Logger) {
    this.elasticsearch = elasticsearch;
    this.logger = logger.child({ tool: 'fetch-indices' });
  }

  async execute(args: unknown): Promise<FetchIndicesResult> {
    try {
      const validatedArgs = FetchIndicesArgsSchema.parse(args);
      this.logger.info('Fetching indices', {
        pattern: validatedArgs.pattern,
        includeSystemIndices: validatedArgs.includeSystemIndices,
        sortBy: validatedArgs.sortBy,
      });

      const client = this.elasticsearch.getClient();
      
      // Build index pattern
      let indexPattern = validatedArgs.pattern || '*';
      if (!validatedArgs.includeSystemIndices && !indexPattern.startsWith('.')) {
        // Exclude system indices by default unless explicitly requested
        if (indexPattern === '*') {
          indexPattern = '*,-.*';
        }
      }

      // Get cat indices info for basic details
      const catResponse = await client.cat.indices({
        index: indexPattern,
        format: 'json',
        h: 'index,health,status,docs.count,store.size,creation.date,uuid',
        s: this.getSortParameter(validatedArgs.sortBy),
      });

      const indices: IndexInfo[] = catResponse.map((indexData: any) => ({
        name: indexData.index || indexData['index'],
        health: indexData.health || indexData['health'] || 'unknown',
        status: indexData.status || indexData['status'] || 'unknown',
        docs: parseInt(indexData['docs.count'] || indexData.docscount || '0', 10),
        size: indexData['store.size'] || indexData.storesize || '0b',
        created: this.formatDate(indexData['creation.date'] || indexData.creationdate),
        uuid: indexData.uuid || indexData['uuid'] || '',
      }));

      // Apply additional filtering if needed
      const filteredIndices = this.filterIndices(indices, validatedArgs);

      this.logger.info('Successfully fetched indices', {
        total: filteredIndices.length,
        pattern: indexPattern,
      });

      return {
        indices: filteredIndices,
        total: filteredIndices.length,
      };
    } catch (error) {
      if (error instanceof Error && error.name === 'ZodError') {
        throw new ValidationError('Invalid arguments for fetch_indices', {
          details: error.message,
        });
      }

      this.logger.error('Failed to fetch indices', {}, error as Error);
      throw new ElasticsearchError(
        'Failed to fetch indices from Elasticsearch',
        error as Error,
        { args }
      );
    }
  }

  private getSortParameter(sortBy?: 'name' | 'size' | 'docs'): string {
    switch (sortBy) {
      case 'size':
        return 'store.size:desc';
      case 'docs':
        return 'docs.count:desc';
      case 'name':
      default:
        return 'index:asc';
    }
  }

  private formatDate(timestamp?: string): string {
    if (!timestamp) return 'unknown';
    
    try {
      const date = new Date(parseInt(timestamp, 10));
      return date.toISOString().split('T')[0]; // Return YYYY-MM-DD format
    } catch {
      return 'unknown';
    }
  }

  private filterIndices(indices: IndexInfo[], args: FetchIndicesArgs): IndexInfo[] {
    let filtered = [...indices];

    // Filter out system indices if not requested
    if (!args.includeSystemIndices) {
      filtered = filtered.filter(index => !index.name.startsWith('.'));
    }

    // Apply pattern matching if specified (additional client-side filtering)
    if (args.pattern && args.pattern !== '*') {
      const pattern = args.pattern.replace(/\*/g, '.*');
      const regex = new RegExp(`^${pattern}$`, 'i');
      filtered = filtered.filter(index => regex.test(index.name));
    }

    return filtered;
  }
}