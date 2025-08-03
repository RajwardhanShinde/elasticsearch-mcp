import { ElasticsearchManager } from '../elasticsearch/client.js';
import { Logger } from '../logger.js';
import { ExportToCSVArgsSchema, sanitizeQuery } from '../validation/schemas.js';
import { ValidationError, ElasticsearchError, NotFoundError } from '../errors/handlers.js';
import { createObjectCsvWriter } from 'csv-writer';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as zlib from 'zlib';
import { promisify } from 'util';

const gzip = promisify(zlib.gzip);

export interface ExportToCSVArgs {
  index: string;
  query?: Record<string, unknown>;
  fields?: string[];
  filename?: string;
  format?: {
    delimiter?: string;
    quote?: string;
    escape?: string;
    header?: boolean;
  };
  maxRows?: number;
  compress?: boolean;
}

export interface ExportToCSVResult {
  filename: string;
  rowsExported: number;
  fileSize: string;
  downloadUrl?: string;
}

export class ExportToCSVTool {
  private elasticsearch: ElasticsearchManager;
  private logger: Logger;

  constructor(elasticsearch: ElasticsearchManager, logger: Logger) {
    this.elasticsearch = elasticsearch;
    this.logger = logger.child({ tool: 'export-to-csv' });
  }

  async execute(args: unknown): Promise<ExportToCSVResult> {
    try {
      const validatedArgs = ExportToCSVArgsSchema.parse(args);
      this.logger.info('Starting CSV export', {
        index: validatedArgs.index,
        hasQuery: !!validatedArgs.query,
        fieldCount: validatedArgs.fields?.length,
        maxRows: validatedArgs.maxRows,
        compress: validatedArgs.compress,
      });

      const client = this.elasticsearch.getClient();

      // Check if index exists
      const indexExists = await client.indices.exists({
        index: validatedArgs.index,
      });

      if (!indexExists) {
        throw new NotFoundError(`Index '${validatedArgs.index}' does not exist`);
      }

      // Generate filename
      const filename = this.generateFilename(validatedArgs);
      const tempFilename = `${filename}.tmp`;

      // Determine fields to export
      const fieldsToExport = await this.determineFields(validatedArgs);

      // Setup CSV writer
      const writer = this.createCSVWriter(tempFilename, fieldsToExport, validatedArgs.format);

      // Export data with scroll API for large datasets
      const rowsExported = await this.exportDataWithScroll(
        validatedArgs,
        writer,
        fieldsToExport
      );

      // Get file size
      const stats = await fs.stat(tempFilename);
      let finalFilename = filename;
      let fileSize = this.formatFileSize(stats.size);

      // Compress if requested
      if (validatedArgs.compress) {
        finalFilename = `${filename}.gz`;
        await this.compressFile(tempFilename, finalFilename);
        await fs.unlink(tempFilename); // Remove temp file
        
        const compressedStats = await fs.stat(finalFilename);
        fileSize = this.formatFileSize(compressedStats.size);
      } else {
        await fs.rename(tempFilename, finalFilename);
      }

      this.logger.info('CSV export completed successfully', {
        filename: finalFilename,
        rowsExported,
        fileSize,
      });

      return {
        filename: finalFilename,
        rowsExported,
        fileSize,
        downloadUrl: `file://${path.resolve(finalFilename)}`,
      };
    } catch (error) {
      if (error instanceof Error && error.name === 'ZodError') {
        throw new ValidationError('Invalid arguments for export_to_csv', {
          details: error.message,
        });
      }

      if (error instanceof ValidationError || error instanceof NotFoundError) {
        throw error;
      }

      this.logger.error('Failed to export to CSV', {}, error as Error);
      throw new ElasticsearchError(
        'Failed to export data to CSV',
        error as Error,
        { args }
      );
    }
  }

  private generateFilename(args: ExportToCSVArgs): string {
    if (args.filename) {
      // Sanitize provided filename
      const sanitized = args.filename
        .replace(/[^a-zA-Z0-9._-]/g, '_')
        .replace(/_{2,}/g, '_');
      
      return sanitized.endsWith('.csv') ? sanitized : `${sanitized}.csv`;
    }

    // Generate filename based on index and timestamp
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-').split('T')[0];
    return `${args.index}_export_${timestamp}.csv`;
  }

  private async determineFields(args: ExportToCSVArgs): Promise<string[]> {
    if (args.fields && args.fields.length > 0) {
      return args.fields;
    }

    // Get mapping to determine available fields
    const client = this.elasticsearch.getClient();
    
    try {
      const mappingResponse = await client.indices.getMapping({
        index: args.index,
      });

      const indexMapping = Object.values(mappingResponse)[0] as any;
      const properties = indexMapping?.mappings?.properties || {};
      
      // Extract field names from mapping
      const fields = this.extractFieldNames(properties);
      
      if (fields.length === 0) {
        // Fallback: get a sample document to determine fields
        const sampleResponse = await client.search({
          index: args.index,
          body: { size: 1 },
        });

        if (sampleResponse.hits.hits.length > 0) {
          const sampleDoc = sampleResponse.hits.hits[0]._source;
          return Object.keys(sampleDoc || {});
        }
      }

      return fields;
    } catch (error) {
      this.logger.warn('Failed to get field mapping, using sample document', { error: (error as Error).message });
      
      // Fallback: try to get fields from a sample document
      const sampleResponse = await client.search({
        index: args.index,
        body: { size: 1 },
      });

      if (sampleResponse.hits.hits.length > 0) {
        const sampleDoc = sampleResponse.hits.hits[0]._source;
        return Object.keys(sampleDoc || {});
      }

      throw new ValidationError('Could not determine fields to export and no fields specified');
    }
  }

  private extractFieldNames(properties: Record<string, unknown>, prefix = ''): string[] {
    const fields: string[] = [];

    for (const [key, value] of Object.entries(properties)) {
      const fieldName = prefix ? `${prefix}.${key}` : key;
      
      if (typeof value === 'object' && value !== null) {
        const fieldConfig = value as Record<string, unknown>;
        
        if (fieldConfig.type) {
          // It's a field with a type
          fields.push(fieldName);
        } else if (fieldConfig.properties) {
          // It's an object with nested properties
          fields.push(...this.extractFieldNames(
            fieldConfig.properties as Record<string, unknown>,
            fieldName
          ));
        }
      }
    }

    return fields;
  }

  private createCSVWriter(
    filename: string,
    fields: string[],
    format?: ExportToCSVArgs['format']
  ) {
    const headers = fields.map(field => ({ id: field, title: field }));

    return createObjectCsvWriter({
      path: filename,
      header: headers,
      fieldDelimiter: format?.delimiter || ',',
      recordDelimiter: '\n',
      append: false,
    });
  }

  private async exportDataWithScroll(
    args: ExportToCSVArgs,
    writer: any,
    fields: string[]
  ): Promise<number> {
    const client = this.elasticsearch.getClient();
    const scrollSize = 1000; // Documents per scroll
    const maxRows = args.maxRows || 1000000; // Default 1M limit
    let totalExported = 0;

    // Build search query
    const searchBody: any = {
      size: Math.min(scrollSize, maxRows),
      _source: fields,
    };

    if (args.query) {
      const sanitizedQuery = sanitizeQuery(args.query);
      searchBody.query = sanitizedQuery || { match_all: {} };
    } else {
      searchBody.query = { match_all: {} };
    }

    // Initial search with scroll
    let response = await client.search({
      index: args.index,
      body: searchBody,
      scroll: '5m',
    });

    while (response.hits.hits.length > 0 && totalExported < maxRows) {
      // Convert hits to CSV records
      const records = response.hits.hits.map((hit: any) => {
        const record: Record<string, unknown> = {};
        
        for (const field of fields) {
          record[field] = this.extractFieldValue(hit._source, field);
        }
        
        return record;
      });

      // Write to CSV
      await writer.writeRecords(records);
      totalExported += records.length;

      this.logger.debug('Exported batch', {
        batchSize: records.length,
        totalExported,
      });

      // Check if we've reached the limit
      if (totalExported >= maxRows) {
        break;
      }

      // Continue scrolling
      if (response._scroll_id) {
        response = await client.scroll({
          scroll_id: response._scroll_id,
          scroll: '5m',
        });
      } else {
        break;
      }
    }

    // Clear scroll
    if (response._scroll_id) {
      try {
        await client.clearScroll({
          scroll_id: response._scroll_id,
        });
      } catch (error) {
        this.logger.warn('Failed to clear scroll', { error: (error as Error).message });
      }
    }

    return totalExported;
  }

  private extractFieldValue(source: Record<string, unknown>, fieldPath: string): unknown {
    const parts = fieldPath.split('.');
    let value: unknown = source;

    for (const part of parts) {
      if (value === null || value === undefined) {
        return null;
      }
      
      if (typeof value === 'object' && !Array.isArray(value)) {
        value = (value as Record<string, unknown>)[part];
      } else {
        return null;
      }
    }

    // Convert complex objects to strings
    if (typeof value === 'object' && value !== null) {
      return JSON.stringify(value);
    }

    return value;
  }

  private async compressFile(inputPath: string, outputPath: string): Promise<void> {
    const inputData = await fs.readFile(inputPath);
    const compressedData = await gzip(inputData);
    await fs.writeFile(outputPath, compressedData);
  }

  private formatFileSize(bytes: number): string {
    const units = ['B', 'KB', 'MB', 'GB'];
    let size = bytes;
    let unitIndex = 0;

    while (size >= 1024 && unitIndex < units.length - 1) {
      size /= 1024;
      unitIndex++;
    }

    return `${size.toFixed(2)} ${units[unitIndex]}`;
  }
}