import { ElasticsearchManager } from '../elasticsearch/client.js';
import { Logger } from '../logger.js';
import { InsertDataArgsSchema } from '../validation/schemas.js';
import { ValidationError, ElasticsearchError } from '../errors/handlers.js';

export interface InsertDataArgs {
  index: string;
  document: Record<string, unknown>;
  id?: string;
  refresh?: boolean | 'wait_for' | 'false' | 'true';
}

export interface InsertDataResult {
  _id: string;
  _index: string;
  _version: number;
  result: 'created' | 'updated';
}

export class InsertDataTool {
  private elasticsearch: ElasticsearchManager;
  private logger: Logger;

  constructor(elasticsearch: ElasticsearchManager, logger: Logger) {
    this.elasticsearch = elasticsearch;
    this.logger = logger.child({ tool: 'insert-data' });
  }

  async execute(args: unknown): Promise<InsertDataResult> {
    try {
      const validatedArgs = InsertDataArgsSchema.parse(args);
      this.logger.info('Inserting document', {
        index: validatedArgs.index,
        hasId: !!validatedArgs.id,
        documentKeys: Object.keys(validatedArgs.document),
        refresh: validatedArgs.refresh,
      });

      const client = this.elasticsearch.getClient();

      // Validate document content
      this.validateDocument(validatedArgs.document);

      // Check if index exists
      const indexExists = await client.indices.exists({
        index: validatedArgs.index,
      });

      if (!indexExists) {
        this.logger.warn('Index does not exist, it will be created automatically', {
          index: validatedArgs.index,
        });
      }

      // Prepare the request
      const request: any = {
        index: validatedArgs.index,
        body: validatedArgs.document,
        refresh: this.normalizeRefreshParameter(validatedArgs.refresh),
      };

      let response;
      
      if (validatedArgs.id) {
        // Use index API for specific ID
        request.id = validatedArgs.id;
        response = await client.index(request);
      } else {
        // Use create API to auto-generate ID
        response = await client.index(request);
      }

      this.logger.info('Successfully inserted document', {
        id: response._id,
        index: response._index,
        version: response._version,
        result: response.result,
      });

      return {
        _id: response._id,
        _index: response._index,
        _version: response._version,
        result: response.result as 'created' | 'updated',
      };
    } catch (error) {
      if (error instanceof Error && error.name === 'ZodError') {
        throw new ValidationError('Invalid arguments for insert_data', {
          details: error.message,
        });
      }

      this.logger.error('Failed to insert document', {}, error as Error);
      throw new ElasticsearchError(
        'Failed to insert document into Elasticsearch',
        error as Error,
        { args }
      );
    }
  }

  private validateDocument(document: Record<string, unknown>): void {
    // Check if document is empty
    if (Object.keys(document).length === 0) {
      throw new ValidationError('Document cannot be empty');
    }

    // Check for invalid field names
    for (const key of Object.keys(document)) {
      if (key.startsWith('_')) {
        throw new ValidationError(`Field name '${key}' cannot start with underscore (reserved)`);
      }
      
      if (key.includes('.') && !this.isValidDottedField(key)) {
        throw new ValidationError(`Invalid field name '${key}': improper dot notation`);
      }
      
      if (key.length > 256) {
        throw new ValidationError(`Field name '${key}' exceeds maximum length of 256 characters`);
      }
    }

    // Validate document size (rough estimate)
    const documentSize = JSON.stringify(document).length;
    if (documentSize > 100 * 1024 * 1024) { // 100MB limit
      throw new ValidationError('Document size exceeds 100MB limit');
    }

    // Recursively validate nested objects
    this.validateNestedObject(document, 0);
  }

  private isValidDottedField(fieldName: string): boolean {
    // Check for valid dot notation (no consecutive dots, no leading/trailing dots)
    return !/^\.|\.$|\.\./.test(fieldName);
  }

  private validateNestedObject(obj: Record<string, unknown>, depth: number): void {
    const MAX_NESTING_DEPTH = 20;
    
    if (depth > MAX_NESTING_DEPTH) {
      throw new ValidationError(`Document nesting exceeds maximum depth of ${MAX_NESTING_DEPTH}`);
    }

    for (const [key, value] of Object.entries(obj)) {
      if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
        this.validateNestedObject(value as Record<string, unknown>, depth + 1);
      }
      
      // Check for extremely large arrays
      if (Array.isArray(value) && value.length > 10000) {
        throw new ValidationError(`Array field '${key}' contains too many elements (max 10,000)`);
      }
      
      // Check for very long strings
      if (typeof value === 'string' && value.length > 1024 * 1024) { // 1MB
        throw new ValidationError(`String field '${key}' exceeds maximum length of 1MB`);
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