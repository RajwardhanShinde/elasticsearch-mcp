import { ElasticsearchManager } from '../elasticsearch/client.js';
import { Logger } from '../logger.js';
import { DeleteDocumentArgsSchema, sanitizeQuery } from '../validation/schemas.js';
import { ValidationError, ElasticsearchError, NotFoundError } from '../errors/handlers.js';

export interface DeleteDocumentArgs {
  index: string;
  id?: string;
  query?: Record<string, unknown>;
  conflicts?: 'abort' | 'proceed';
  refresh?: boolean | 'wait_for' | 'false' | 'true';
}

export interface DeleteDocumentResult {
  deleted: number;
  versionConflicts?: number;
  noops?: number;
  retries?: {
    bulk: number;
    search: number;
  };
  tookMs: number;
  timedOut: boolean;
}

export class DeleteDocumentTool {
  private elasticsearch: ElasticsearchManager;
  private logger: Logger;

  constructor(elasticsearch: ElasticsearchManager, logger: Logger) {
    this.elasticsearch = elasticsearch;
    this.logger = logger.child({ tool: 'delete-document' });
  }

  async execute(args: unknown): Promise<DeleteDocumentResult> {
    try {
      const validatedArgs = DeleteDocumentArgsSchema.parse(args);
      this.logger.info('Deleting document(s)', {
        index: validatedArgs.index,
        hasId: !!validatedArgs.id,
        hasQuery: !!validatedArgs.query,
        conflicts: validatedArgs.conflicts,
        refresh: validatedArgs.refresh,
      });

      const client = this.elasticsearch.getClient();

      // Check if index exists
      const indexExists = await client.indices.exists({
        index: validatedArgs.index,
      });

      if (!indexExists) {
        throw new NotFoundError(`Index '${validatedArgs.index}' does not exist`);
      }

      if (validatedArgs.id) {
        // Delete by ID
        return await this.deleteById(validatedArgs);
      } else if (validatedArgs.query) {
        // Delete by query
        return await this.deleteByQuery(validatedArgs);
      } else {
        throw new ValidationError('Either id or query must be provided');
      }
    } catch (error) {
      if (error instanceof Error && error.name === 'ZodError') {
        throw new ValidationError('Invalid arguments for delete_document', {
          details: error.message,
        });
      }

      if (error instanceof ValidationError || error instanceof NotFoundError) {
        throw error;
      }

      this.logger.error('Failed to delete document(s)', {}, error as Error);
      throw new ElasticsearchError(
        'Failed to delete document(s) from Elasticsearch',
        error as Error,
        { args }
      );
    }
  }

  private async deleteById(args: DeleteDocumentArgs): Promise<DeleteDocumentResult> {
    const client = this.elasticsearch.getClient();
    
    try {
      const response = await client.delete({
        index: args.index,
        id: args.id!,
        refresh: this.normalizeRefreshParameter(args.refresh),
      });

      this.logger.info('Successfully deleted document by ID', {
        id: args.id,
        index: args.index,
        version: response._version,
        result: response.result,
      });

      return {
        deleted: response.result === 'deleted' ? 1 : 0,
        tookMs: 0, // Single document delete doesn't provide timing
        timedOut: false,
      };
    } catch (error) {
      if (error instanceof Error) {
        const errorMessage = error.message.toLowerCase();
        
        if (errorMessage.includes('not_found') || errorMessage.includes('document_missing')) {
          throw new NotFoundError(`Document with ID '${args.id}' not found in index '${args.index}'`);
        }
      }
      
      throw error;
    }
  }

  private async deleteByQuery(args: DeleteDocumentArgs): Promise<DeleteDocumentResult> {
    const client = this.elasticsearch.getClient();
    
    // Sanitize and validate the query
    const sanitizedQuery = sanitizeQuery(args.query);
    
    if (!sanitizedQuery) {
      throw new ValidationError('Query cannot be empty');
    }

    // Validate query structure
    this.validateQuery(sanitizedQuery);

    const deleteRequest: any = {
      index: args.index,
      body: {
        query: sanitizedQuery,
      },
      refresh: this.normalizeRefreshParameter(args.refresh),
      conflicts: args.conflicts || 'abort',
      timeout: '5m', // 5 minute timeout
      wait_for_completion: true,
    };

    const response = await client.deleteByQuery(deleteRequest);

    this.logger.info('Successfully executed delete by query', {
      index: args.index,
      deleted: response.deleted,
      versionConflicts: response.version_conflicts,
      took: response.took,
    });

    return {
      deleted: response.deleted || 0,
      versionConflicts: response.version_conflicts || 0,
      noops: response.noops || 0,
      retries: {
        bulk: response.retries?.bulk || 0,
        search: response.retries?.search || 0,
      },
      tookMs: response.took || 0,
      timedOut: response.timed_out || false,
    };
  }

  private validateQuery(query: Record<string, unknown>): void {
    // Check for potentially dangerous queries
    const queryStr = JSON.stringify(query).toLowerCase();
    
    // Prevent match_all without limits (could delete entire index)
    if (queryStr.includes('match_all') && !queryStr.includes('size') && !queryStr.includes('from')) {
      this.logger.warn('Detected match_all query without size limit', { query });
      // Allow but log warning - user should be aware
    }

    // Check for script queries (potential security risk)
    if (queryStr.includes('script_score') || queryStr.includes('script_query')) {
      throw new ValidationError('Script-based queries are not allowed in delete operations');
    }

    // Validate query depth
    this.validateQueryDepth(query, 0);
  }

  private validateQueryDepth(obj: Record<string, unknown>, depth: number): void {
    const MAX_QUERY_DEPTH = 20;
    
    if (depth > MAX_QUERY_DEPTH) {
      throw new ValidationError(`Query nesting exceeds maximum depth of ${MAX_QUERY_DEPTH}`);
    }

    for (const value of Object.values(obj)) {
      if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
        this.validateQueryDepth(value as Record<string, unknown>, depth + 1);
      }
    }
  }

  private normalizeRefreshParameter(refresh?: boolean | 'wait_for' | 'false' | 'true'): boolean | 'wait_for' {
    if (refresh === undefined || refresh === false || refresh === 'false') {
      return false;
    }
    
    if (refresh === true || refresh === 'true') {
      return true;
    }
    
    if (refresh === 'wait_for') {
      return 'wait_for';
    }
    
    return false;
  }
}