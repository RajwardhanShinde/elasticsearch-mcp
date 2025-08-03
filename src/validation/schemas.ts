import { z } from 'zod';

export const IndexNameSchema = z.string()
  .min(1, 'Index name cannot be empty')
  .max(255, 'Index name cannot exceed 255 characters')
  .regex(/^[a-z0-9_.-]+$/, 'Index name must contain only lowercase letters, numbers, hyphens, underscores, and dots')
  .refine(name => !name.startsWith('.') || name.startsWith('.'), 'Index name cannot start with a dot unless it is a system index')
  .refine(name => name !== '.' && name !== '..', 'Index name cannot be "." or ".."');

export const DocumentIdSchema = z.string()
  .min(1, 'Document ID cannot be empty')
  .max(512, 'Document ID cannot exceed 512 characters');

export const QuerySchema = z.record(z.unknown());

export const SortSchema = z.array(z.record(z.unknown()));

export const AggregationsSchema = z.record(z.unknown());

export const HighlightSchema = z.record(z.unknown());

export const SourceSchema = z.union([
  z.array(z.string()),
  z.boolean(),
]);

export const PaginationSchema = z.object({
  size: z.number().int().min(1).max(10000).optional(),
  from: z.number().int().min(0).optional(),
});

export const RefreshSchema = z.union([
  z.boolean(),
  z.literal('wait_for'),
  z.literal('false'),
  z.literal('true'),
]).optional();

export const SearchArgsSchema = z.object({
  index: IndexNameSchema,
  query: QuerySchema.optional(),
  size: z.number().int().min(1).max(10000).optional(),
  from: z.number().int().min(0).optional(),
  sort: SortSchema.optional(),
  aggregations: AggregationsSchema.optional(),
  highlight: HighlightSchema.optional(),
  source: SourceSchema.optional(),
}).strict();

export const FetchIndicesArgsSchema = z.object({
  pattern: z.string().optional(),
  includeSystemIndices: z.boolean().optional(),
  sortBy: z.enum(['name', 'size', 'docs']).optional(),
}).strict();

export const CreateIndexArgsSchema = z.object({
  name: IndexNameSchema,
  mappings: z.record(z.unknown()).optional(),
  settings: z.record(z.unknown()).optional(),
  aliases: z.array(z.string()).optional(),
}).strict();

export const InsertDataArgsSchema = z.object({
  index: IndexNameSchema,
  document: z.record(z.unknown()),
  id: DocumentIdSchema.optional(),
  refresh: RefreshSchema.optional(),
}).strict();

export const UpdateDocumentArgsSchema = z.object({
  index: IndexNameSchema,
  id: DocumentIdSchema,
  document: z.record(z.unknown()).optional(),
  script: z.object({
    source: z.string(),
    params: z.record(z.unknown()).optional(),
  }).optional(),
  upsert: z.boolean().optional(),
  refresh: RefreshSchema.optional(),
}).strict().refine(
  data => data.document || data.script,
  'Either document or script must be provided'
);

export const DeleteDocumentArgsSchema = z.object({
  index: IndexNameSchema,
  id: DocumentIdSchema.optional(),
  query: QuerySchema.optional(),
  conflicts: z.enum(['abort', 'proceed']).optional(),
  refresh: RefreshSchema.optional(),
}).strict().refine(
  data => data.id || data.query,
  'Either id or query must be provided'
);

export const ExportToCSVArgsSchema = z.object({
  index: IndexNameSchema,
  query: QuerySchema.optional(),
  fields: z.array(z.string()).optional(),
  filename: z.string().optional(),
  format: z.object({
    delimiter: z.string().length(1).optional(),
    quote: z.string().length(1).optional(),
    escape: z.string().length(1).optional(),
    header: z.boolean().optional(),
  }).optional(),
  maxRows: z.number().int().min(1).max(1000000).optional(),
  compress: z.boolean().optional(),
}).strict();

export function validateIndexName(name: string): string {
  return IndexNameSchema.parse(name);
}

export function validateDocumentId(id: string): string {
  return DocumentIdSchema.parse(id);
}

export function validatePagination(params: { size?: number; from?: number }): { size: number | undefined; from: number | undefined } {
  const result = PaginationSchema.parse(params);
  return {
    size: result.size,
    from: result.from,
  };
}

export function sanitizeQuery(query: unknown): Record<string, unknown> | undefined {
  if (!query) return undefined;
  
  if (typeof query !== 'object' || Array.isArray(query)) {
    throw new Error('Query must be an object');
  }

  const sanitized = { ...query as Record<string, unknown> };
  
  const dangerousKeys = ['script', '_source', 'size', 'from'];
  
  for (const key of dangerousKeys) {
    if (key in sanitized && typeof sanitized[key] === 'string') {
      const value = sanitized[key] as string;
      if (value.includes('System.') || value.includes('Runtime.') || value.includes('Process.')) {
        throw new Error(`Potentially dangerous query detected in ${key}`);
      }
    }
  }

  return sanitized;
}

export function sanitizeScriptSource(source: string): string {
  const dangerousPatterns = [
    /System\./g,
    /Runtime\./g,
    /Process\./g,
    /java\.lang/g,
    /java\.io/g,
    /java\.nio/g,
    /exec\(/g,
    /eval\(/g,
    /Function\(/g,
  ];

  for (const pattern of dangerousPatterns) {
    if (pattern.test(source)) {
      throw new Error('Script contains potentially dangerous code');
    }
  }

  return source;
}