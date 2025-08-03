import { ElasticsearchManager } from '../elasticsearch/client.js';
import { Logger } from '../logger.js';
import { SearchArgsSchema, sanitizeQuery } from '../validation/schemas.js';
import { ValidationError, ElasticsearchError, NotFoundError } from '../errors/handlers.js';

export interface SearchArgs {
  index: string;
  query?: Record<string, unknown>;
  size?: number;
  from?: number;
  sort?: Array<Record<string, unknown>>;
  aggregations?: Record<string, unknown>;
  highlight?: Record<string, unknown>;
  source?: string[] | boolean;
}

export interface SearchHit {
  _id: string;
  _source: Record<string, unknown>;
  _score: number;
  highlight?: Record<string, string[]>;
}

export interface SearchResult {
  hits: {
    total: { value: number; relation: string };
    hits: SearchHit[];
  };
  aggregations?: Record<string, unknown>;
  took: number;
}

export class SearchElasticsearchTool {
  private elasticsearch: ElasticsearchManager;
  private logger: Logger;

  constructor(elasticsearch: ElasticsearchManager, logger: Logger) {
    this.elasticsearch = elasticsearch;
    this.logger = logger.child({ tool: 'search-elasticsearch' });
  }

  async execute(args: unknown): Promise<SearchResult> {
    try {
      const validatedArgs = SearchArgsSchema.parse(args);
      this.logger.info('Executing search', {
        index: validatedArgs.index,
        hasQuery: !!validatedArgs.query,
        size: validatedArgs.size,
        from: validatedArgs.from,
        hasSort: !!validatedArgs.sort,
        hasAggregations: !!validatedArgs.aggregations,
        hasHighlight: !!validatedArgs.highlight,
      });

      const client = this.elasticsearch.getClient();

      // Check if index exists
      const indexExists = await client.indices.exists({
        index: validatedArgs.index,
      });

      if (!indexExists) {
        throw new NotFoundError(`Index '${validatedArgs.index}' does not exist`);
      }

      // Build search request
      const searchRequest = this.buildSearchRequest(validatedArgs);

      // Execute search
      const response = await client.search(searchRequest);

      this.logger.info('Search executed successfully', {
        index: validatedArgs.index,
        totalHits: response.hits.total,
        took: response.took,
        hasAggregations: !!response.aggregations,
      });

      return this.formatSearchResponse(response);
    } catch (error) {
      if (error instanceof Error && error.name === 'ZodError') {
        throw new ValidationError('Invalid arguments for search_elasticsearch', {
          details: error.message,
        });
      }

      if (error instanceof ValidationError || error instanceof NotFoundError) {
        throw error;
      }

      this.logger.error('Failed to execute search', {}, error as Error);
      throw new ElasticsearchError(
        'Failed to execute search in Elasticsearch',
        error as Error,
        { args }
      );
    }
  }

  private buildSearchRequest(args: SearchArgs): any {
    const request: any = {
      index: args.index,
      body: {},
    };

    // Add query
    if (args.query) {
      const sanitizedQuery = sanitizeQuery(args.query);
      this.validateQuery(sanitizedQuery || {});
      request.body.query = sanitizedQuery || { match_all: {} };
    } else {
      request.body.query = { match_all: {} };
    }

    // Add pagination
    if (args.size !== undefined) {
      request.body.size = Math.min(args.size, 10000); // Elasticsearch limit
    }
    
    if (args.from !== undefined) {
      request.body.from = args.from;
    }

    // Add sorting
    if (args.sort && args.sort.length > 0) {
      this.validateSort(args.sort);
      request.body.sort = args.sort;
    }

    // Add aggregations
    if (args.aggregations) {
      this.validateAggregations(args.aggregations);
      request.body.aggs = args.aggregations;
    }

    // Add highlighting
    if (args.highlight) {
      this.validateHighlight(args.highlight);
      request.body.highlight = args.highlight;
    }

    // Add source filtering
    if (args.source !== undefined) {
      if (Array.isArray(args.source)) {
        this.validateSourceFields(args.source);
      }
      request.body._source = args.source;
    }

    // Add timeout
    request.timeout = '30s';

    return request;
  }

  private validateQuery(query: Record<string, unknown>): void {
    // Check for script queries (potential security risk)
    const queryStr = JSON.stringify(query).toLowerCase();
    
    if (queryStr.includes('script_score') || queryStr.includes('script_query')) {
      throw new ValidationError('Script-based queries require additional security validation');
    }

    // Validate query depth
    this.validateQueryDepth(query, 0);

    // Check for wildcard queries on analyzed fields (performance concern)
    if (queryStr.includes('wildcard') || queryStr.includes('prefix')) {
      this.logger.warn('Wildcard/prefix queries detected - may impact performance', { query });
    }
  }

  private validateSort(sort: Array<Record<string, unknown>>): void {
    if (sort.length > 20) {
      throw new ValidationError('Too many sort criteria (max 20)');
    }

    for (const sortItem of sort) {
      if (typeof sortItem !== 'object' || Array.isArray(sortItem)) {
        throw new ValidationError('Each sort item must be an object');
      }

      // Check for script-based sorting
      const sortStr = JSON.stringify(sortItem).toLowerCase();
      if (sortStr.includes('_script')) {
        throw new ValidationError('Script-based sorting is not allowed');
      }
    }
  }

  private validateAggregations(aggregations: Record<string, unknown>): void {
    const aggStr = JSON.stringify(aggregations).toLowerCase();
    
    // Check for script-based aggregations
    if (aggStr.includes('script')) {
      throw new ValidationError('Script-based aggregations require additional security validation');
    }

    // Validate aggregation depth
    this.validateQueryDepth(aggregations, 0);

    // Check number of aggregations
    if (Object.keys(aggregations).length > 50) {
      throw new ValidationError('Too many aggregations (max 50)');
    }
  }

  private validateHighlight(highlight: Record<string, unknown>): void {
    // Validate highlight configuration
    if (highlight.fields && typeof highlight.fields === 'object') {
      const fieldCount = Object.keys(highlight.fields).length;
      if (fieldCount > 20) {
        throw new ValidationError('Too many highlight fields (max 20)');
      }
    }

    // Check for script-based highlighting
    const highlightStr = JSON.stringify(highlight).toLowerCase();
    if (highlightStr.includes('script')) {
      throw new ValidationError('Script-based highlighting is not allowed');
    }
  }

  private validateSourceFields(fields: string[]): void {
    if (fields.length > 100) {
      throw new ValidationError('Too many source fields specified (max 100)');
    }

    for (const field of fields) {
      if (typeof field !== 'string' || field.length === 0) {
        throw new ValidationError('Source fields must be non-empty strings');
      }
      
      if (field.length > 256) {
        throw new ValidationError(`Source field name too long: '${field}' (max 256 characters)`);
      }
    }
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

  private formatSearchResponse(response: any): SearchResult {
    const hits: SearchHit[] = response.hits.hits.map((hit: any) => ({
      _id: hit._id,
      _source: hit._source || {},
      _score: hit._score || 0,
      ...(hit.highlight && { highlight: hit.highlight }),
    }));

    return {
      hits: {
        total: {
          value: response.hits.total?.value || response.hits.total || 0,
          relation: response.hits.total?.relation || 'eq',
        },
        hits,
      },
      ...(response.aggregations && { aggregations: response.aggregations }),
      took: response.took || 0,
    };
  }
}