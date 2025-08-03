import { ElasticsearchManager } from '../elasticsearch/client.js';
import { Logger } from '../logger.js';
import { UpdateDocumentArgsSchema, sanitizeScriptSource } from '../validation/schemas.js';
import { ValidationError, ElasticsearchError, NotFoundError } from '../errors/handlers.js';

export interface UpdateDocumentArgs {
  index: string;
  id: string;
  document?: Record<string, unknown>;
  script?: {
    source: string;
    params?: Record<string, unknown>;
  };
  upsert?: boolean;
  refresh?: boolean | 'wait_for' | 'false' | 'true';
}

export interface UpdateDocumentResult {
  _id: string;
  _index: string;
  _version: number;
  result: 'updated' | 'created' | 'noop';
}

export class UpdateDocumentTool {
  private elasticsearch: ElasticsearchManager;
  private logger: Logger;

  constructor(elasticsearch: ElasticsearchManager, logger: Logger) {
    this.elasticsearch = elasticsearch;
    this.logger = logger.child({ tool: 'update-document' });
  }

  async execute(args: unknown): Promise<UpdateDocumentResult> {
    try {
      const validatedArgs = UpdateDocumentArgsSchema.parse(args);
      this.logger.info('Updating document', {
        index: validatedArgs.index,
        id: validatedArgs.id,
        hasDocument: !!validatedArgs.document,
        hasScript: !!validatedArgs.script,
        upsert: validatedArgs.upsert,
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

      // Prepare update body
      const updateBody: any = {};

      if (validatedArgs.document) {
        this.validateDocument(validatedArgs.document);
        updateBody.doc = validatedArgs.document;
        
        if (validatedArgs.upsert) {
          updateBody.doc_as_upsert = true;
        }
      }

      if (validatedArgs.script) {
        updateBody.script = this.validateAndPrepareScript(validatedArgs.script);
        
        if (validatedArgs.upsert && validatedArgs.document) {
          updateBody.upsert = validatedArgs.document;
        }
      }

      // Execute update
      const response = await client.update({
        index: validatedArgs.index,
        id: validatedArgs.id,
        body: updateBody,
        refresh: this.normalizeRefreshParameter(validatedArgs.refresh),
        retry_on_conflict: 3, // Retry on version conflicts
      });

      this.logger.info('Successfully updated document', {
        id: response._id,
        index: response._index,
        version: response._version,
        result: response.result,
      });

      return {
        _id: response._id,
        _index: response._index,
        _version: response._version,
        result: response.result as 'updated' | 'created' | 'noop',
      };
    } catch (error) {
      if (error instanceof Error && error.name === 'ZodError') {
        throw new ValidationError('Invalid arguments for update_document', {
          details: error.message,
        });
      }

      // Handle Elasticsearch specific errors
      if (error instanceof Error) {
        const errorMessage = error.message.toLowerCase();
        
        if (errorMessage.includes('document_missing_exception') || errorMessage.includes('not_found')) {
          throw new NotFoundError(`Document with ID '${(args as any)?.id}' not found in index '${(args as any)?.index}'`);
        }
        
        if (errorMessage.includes('version_conflict')) {
          throw new ValidationError('Document was modified by another process, please retry');
        }
      }

      this.logger.error('Failed to update document', {}, error as Error);
      throw new ElasticsearchError(
        'Failed to update document in Elasticsearch',
        error as Error,
        { args }
      );
    }
  }

  private validateDocument(document: Record<string, unknown>): void {
    // Check if document is empty
    if (Object.keys(document).length === 0) {
      throw new ValidationError('Update document cannot be empty');
    }

    // Check for invalid field names
    for (const key of Object.keys(document)) {
      if (key.startsWith('_')) {
        throw new ValidationError(`Field name '${key}' cannot start with underscore (reserved)`);
      }
      
      if (key.includes('.') && !this.isValidDottedField(key)) {
        throw new ValidationError(`Invalid field name '${key}': improper dot notation`);
      }
    }

    // Validate document size
    const documentSize = JSON.stringify(document).length;
    if (documentSize > 100 * 1024 * 1024) { // 100MB limit
      throw new ValidationError('Document size exceeds 100MB limit');
    }
  }

  private validateAndPrepareScript(script: { source: string; params?: Record<string, unknown> }): {
    source: string;
    params?: Record<string, unknown>;
    lang?: string;
  } {
    if (!script.source || script.source.trim().length === 0) {
      throw new ValidationError('Script source cannot be empty');
    }

    // Sanitize script source for security
    const sanitizedSource = sanitizeScriptSource(script.source);

    // Validate script parameters
    if (script.params) {
      this.validateScriptParams(script.params);
    }

    return {
      source: sanitizedSource,
      ...(script.params && { params: script.params }),
      lang: 'painless', // Default to Painless scripting language
    };
  }

  private validateScriptParams(params: Record<string, unknown>): void {
    const maxParams = 50;
    const paramKeys = Object.keys(params);
    
    if (paramKeys.length > maxParams) {
      throw new ValidationError(`Too many script parameters (max ${maxParams})`);
    }

    for (const [key, value] of Object.entries(params)) {
      // Check parameter name
      if (key.length > 128) {
        throw new ValidationError(`Parameter name '${key}' too long (max 128 characters)`);
      }
      
      if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(key)) {
        throw new ValidationError(`Invalid parameter name '${key}': must be a valid identifier`);
      }

      // Check parameter value size
      const valueSize = JSON.stringify(value).length;
      if (valueSize > 1024 * 1024) { // 1MB limit per parameter
        throw new ValidationError(`Parameter '${key}' value exceeds 1MB limit`);
      }
    }
  }

  private isValidDottedField(fieldName: string): boolean {
    // Check for valid dot notation (no consecutive dots, no leading/trailing dots)
    return !/^\.|\.$|\.\./.test(fieldName);
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