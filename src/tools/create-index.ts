import { ElasticsearchManager } from '../elasticsearch/client.js';
import { Logger } from '../logger.js';
import { CreateIndexArgsSchema } from '../validation/schemas.js';
import { ValidationError, ElasticsearchError } from '../errors/handlers.js';

export interface CreateIndexArgs {
  name: string;
  mappings?: Record<string, unknown>;
  settings?: Record<string, unknown>;
  aliases?: string[];
}

export interface CreateIndexResult {
  acknowledged: boolean;
  index: string;
  shardsAcknowledged: boolean;
}

export class CreateIndexTool {
  private elasticsearch: ElasticsearchManager;
  private logger: Logger;

  constructor(elasticsearch: ElasticsearchManager, logger: Logger) {
    this.elasticsearch = elasticsearch;
    this.logger = logger.child({ tool: 'create-index' });
  }

  async execute(args: unknown): Promise<CreateIndexResult> {
    try {
      const validatedArgs = CreateIndexArgsSchema.parse(args);
      this.logger.info('Creating index', {
        name: validatedArgs.name,
        hasMappings: !!validatedArgs.mappings,
        hasSettings: !!validatedArgs.settings,
        aliasCount: validatedArgs.aliases?.length || 0,
      });

      const client = this.elasticsearch.getClient();

      // Check if index already exists
      const exists = await client.indices.exists({
        index: validatedArgs.name,
      });

      if (exists) {
        throw new ValidationError(`Index '${validatedArgs.name}' already exists`);
      }

      // Prepare index body
      const indexBody: Record<string, unknown> = {};

      if (validatedArgs.mappings) {
        indexBody.mappings = this.validateMappings(validatedArgs.mappings);
      }

      if (validatedArgs.settings) {
        indexBody.settings = this.validateSettings(validatedArgs.settings);
      }

      if (validatedArgs.aliases && validatedArgs.aliases.length > 0) {
        indexBody.aliases = this.buildAliases(validatedArgs.aliases);
      }

      // Create the index
      const response = await client.indices.create({
        index: validatedArgs.name,
        body: indexBody,
      });

      this.logger.info('Successfully created index', {
        name: validatedArgs.name,
        acknowledged: response.acknowledged,
        shardsAcknowledged: response.shards_acknowledged,
      });

      return {
        acknowledged: response.acknowledged,
        index: validatedArgs.name,
        shardsAcknowledged: response.shards_acknowledged,
      };
    } catch (error) {
      if (error instanceof Error && error.name === 'ZodError') {
        throw new ValidationError('Invalid arguments for create_index', {
          details: error.message,
        });
      }

      if (error instanceof ValidationError) {
        throw error;
      }

      this.logger.error('Failed to create index', {}, error as Error);
      throw new ElasticsearchError(
        'Failed to create index in Elasticsearch',
        error as Error,
        { args }
      );
    }
  }

  private validateMappings(mappings: Record<string, unknown>): Record<string, unknown> {
    // Basic validation for mappings structure
    if (typeof mappings !== 'object' || Array.isArray(mappings)) {
      throw new ValidationError('Mappings must be a valid object');
    }

    // Check for common mapping structure
    if (mappings.properties && typeof mappings.properties !== 'object') {
      throw new ValidationError('Mappings properties must be an object');
    }

    // Validate property types
    if (mappings.properties) {
      this.validateMappingProperties(mappings.properties as Record<string, unknown>);
    }

    return mappings;
  }

  private validateMappingProperties(properties: Record<string, unknown>): void {
    const validFieldTypes = [
      'text', 'keyword', 'integer', 'long', 'float', 'double', 'boolean',
      'date', 'ip', 'geo_point', 'geo_shape', 'nested', 'object', 'binary',
      'integer_range', 'float_range', 'long_range', 'double_range', 'date_range', 'ip_range',
    ];

    for (const [fieldName, fieldConfig] of Object.entries(properties)) {
      if (typeof fieldConfig === 'object' && fieldConfig !== null) {
        const config = fieldConfig as Record<string, unknown>;
        
        if (config.type && typeof config.type === 'string') {
          if (!validFieldTypes.includes(config.type)) {
            throw new ValidationError(`Invalid field type '${config.type}' for field '${fieldName}'`);
          }
        }

        // Recursively validate nested properties
        if (config.properties) {
          this.validateMappingProperties(config.properties as Record<string, unknown>);
        }
      }
    }
  }

  private validateSettings(settings: Record<string, unknown>): Record<string, unknown> {
    // Basic validation for settings structure
    if (typeof settings !== 'object' || Array.isArray(settings)) {
      throw new ValidationError('Settings must be a valid object');
    }

    // Validate critical settings
    if (settings.number_of_shards && typeof settings.number_of_shards === 'number') {
      if (settings.number_of_shards < 1 || settings.number_of_shards > 1024) {
        throw new ValidationError('Number of shards must be between 1 and 1024');
      }
    }

    if (settings.number_of_replicas && typeof settings.number_of_replicas === 'number') {
      if (settings.number_of_replicas < 0 || settings.number_of_replicas > 10) {
        throw new ValidationError('Number of replicas must be between 0 and 10');
      }
    }

    return settings;
  }

  private buildAliases(aliases: string[]): Record<string, Record<string, unknown>> {
    const aliasObject: Record<string, Record<string, unknown>> = {};
    
    for (const alias of aliases) {
      if (typeof alias !== 'string' || alias.trim().length === 0) {
        throw new ValidationError('All aliases must be non-empty strings');
      }
      
      // Validate alias name
      if (alias.includes(' ') || alias.includes('\t') || alias.includes('\n')) {
        throw new ValidationError(`Invalid alias name '${alias}': cannot contain whitespace`);
      }
      
      aliasObject[alias.trim()] = {};
    }
    
    return aliasObject;
  }
}