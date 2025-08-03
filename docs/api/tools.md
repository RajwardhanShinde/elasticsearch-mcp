# Elastic MCP API Reference

Complete reference for all available MCP tools in the elastic-mcp server.

## Overview

The elastic-mcp server provides 7 comprehensive tools for Elasticsearch operations:

| Tool | Purpose | Category |
|------|---------|----------|
| [`fetch_indices`](#fetch_indices) | List and filter indices | Index Management |
| [`create_index`](#create_index) | Create new indices | Index Management |
| [`search_elasticsearch`](#search_elasticsearch) | Search and query data | Data Retrieval |
| [`insert_data`](#insert_data) | Insert documents | Data Manipulation |
| [`update_document`](#update_document) | Update existing documents | Data Manipulation |
| [`delete_document`](#delete_document) | Delete documents | Data Manipulation |
| [`export_to_csv`](#export_to_csv) | Export data to CSV | Data Export |

## Index Management Tools

### `fetch_indices`

List all indices in the Elasticsearch cluster with filtering and sorting options.

#### Parameters

```typescript
interface FetchIndicesArgs {
  pattern?: string;              // Index pattern filter (e.g., "logs-*")
  includeSystemIndices?: boolean; // Include system indices (starting with .)
  sortBy?: 'name' | 'size' | 'docs'; // Sort results by name, size, or document count
}
```

#### Response

```typescript
interface FetchIndicesResult {
  indices: Array<{
    name: string;        // Index name
    health: string;      // green, yellow, red
    status: string;      // open, close
    docs: number;        // Document count
    size: string;        // Storage size (e.g., "10.5mb")
    created: string;     // Creation date (YYYY-MM-DD)
    uuid: string;        // Index UUID
  }>;
  total: number;         // Total number of indices
}
```

#### Examples

**List all user indices:**
```json
{
  "tool": "fetch_indices",
  "arguments": {}
}
```

**Filter by pattern:**
```json
{
  "tool": "fetch_indices", 
  "arguments": {
    "pattern": "logs-*",
    "sortBy": "size"
  }
}
```

**Include system indices:**
```json
{
  "tool": "fetch_indices",
  "arguments": {
    "includeSystemIndices": true,
    "sortBy": "docs"
  }
}
```

### `create_index`

Create a new Elasticsearch index with optional mappings, settings, and aliases.

#### Parameters

```typescript
interface CreateIndexArgs {
  name: string;                    // Index name (required)
  mappings?: Record<string, any>;  // Field mappings
  settings?: Record<string, any>;  // Index settings  
  aliases?: string[];              // Index aliases
}
```

#### Response

```typescript
interface CreateIndexResult {
  acknowledged: boolean;      // Operation acknowledged
  index: string;             // Created index name
  shardsAcknowledged: boolean; // Shards acknowledged
}
```

#### Examples

**Basic index creation:**
```json
{
  "tool": "create_index",
  "arguments": {
    "name": "user-events"
  }
}
```

**Index with mappings and settings:**
```json
{
  "tool": "create_index",
  "arguments": {
    "name": "product-catalog",
    "mappings": {
      "properties": {
        "name": {
          "type": "text",
          "analyzer": "standard"
        },
        "price": {
          "type": "float"
        },
        "category": {
          "type": "keyword"
        },
        "created_at": {
          "type": "date"
        }
      }
    },
    "settings": {
      "number_of_shards": 1,
      "number_of_replicas": 1,
      "analysis": {
        "analyzer": {
          "custom_analyzer": {
            "type": "standard",
            "stopwords": "_english_"
          }
        }
      }
    },
    "aliases": ["products", "catalog"]
  }
}
```

## Data Retrieval Tools

### `search_elasticsearch`

Execute advanced search queries with full Elasticsearch DSL support.

#### Parameters

```typescript
interface SearchArgs {
  index: string;                           // Index to search (required)
  query?: Record<string, any>;             // Elasticsearch query DSL
  size?: number;                           // Number of results (max 10,000)
  from?: number;                           // Offset for pagination
  sort?: Array<Record<string, any>>;       // Sort criteria
  aggregations?: Record<string, any>;      // Aggregations
  highlight?: Record<string, any>;         // Highlighting config
  source?: string[] | boolean;             // Source filtering
}
```

#### Response

```typescript
interface SearchResult {
  hits: {
    total: { value: number; relation: string };
    hits: Array<{
      _id: string;
      _source: Record<string, any>;
      _score: number;
      highlight?: Record<string, string[]>;
    }>;
  };
  aggregations?: Record<string, any>;
  took: number; // Query execution time in ms
}
```

#### Examples

**Basic search:**
```json
{
  "tool": "search_elasticsearch",
  "arguments": {
    "index": "user-events"
  }
}
```

**Search with query:**
```json
{
  "tool": "search_elasticsearch",
  "arguments": {
    "index": "user-events",
    "query": {
      "bool": {
        "must": [
          { "match": { "event_type": "login" } }
        ],
        "filter": [
          { "range": { "timestamp": { "gte": "2024-01-01" } } }
        ]
      }
    },
    "size": 100,
    "sort": [{ "timestamp": { "order": "desc" } }]
  }
}
```

**Search with aggregations:**
```json
{
  "tool": "search_elasticsearch",
  "arguments": {
    "index": "sales-data",
    "query": {
      "range": {
        "date": {
          "gte": "2024-01-01",
          "lte": "2024-12-31"
        }
      }
    },
    "aggregations": {
      "monthly_sales": {
        "date_histogram": {
          "field": "date",
          "calendar_interval": "month"
        },
        "aggs": {
          "total_revenue": {
            "sum": { "field": "amount" }
          }
        }
      },
      "top_products": {
        "terms": {
          "field": "product_id",
          "size": 10
        }
      }
    }
  }
}
```

## Data Manipulation Tools

### `insert_data`

Insert a new document into an Elasticsearch index.

#### Parameters

```typescript
interface InsertDataArgs {
  index: string;                    // Target index (required)
  document: Record<string, any>;    // Document to insert (required)
  id?: string;                      // Optional document ID
  refresh?: boolean | 'wait_for';   // Refresh policy
}
```

#### Response

```typescript
interface InsertDataResult {
  _id: string;           // Document ID
  _index: string;        // Index name
  _version: number;      // Document version
  result: 'created' | 'updated'; // Operation result
}
```

#### Examples

**Insert with auto-generated ID:**
```json
{
  "tool": "insert_data",
  "arguments": {
    "index": "user-events",
    "document": {
      "user_id": "user123",
      "event_type": "login",
      "timestamp": "2024-01-15T10:30:00Z",
      "ip_address": "192.168.1.1",
      "user_agent": "Mozilla/5.0..."
    }
  }
}
```

**Insert with specific ID:**
```json
{
  "tool": "insert_data",
  "arguments": {
    "index": "products",
    "id": "prod-123",
    "document": {
      "name": "Wireless Headphones",
      "price": 99.99,
      "category": "electronics",
      "in_stock": true,
      "created_at": "2024-01-15T10:30:00Z"
    },
    "refresh": "wait_for"
  }
}
```

### `update_document`

Update an existing document using partial document updates or scripts.

#### Parameters

```typescript
interface UpdateDocumentArgs {
  index: string;                    // Target index (required)
  id: string;                       // Document ID (required)
  document?: Record<string, any>;   // Partial document update
  script?: {                        // Script-based update
    source: string;                 // Painless script source
    params?: Record<string, any>;   // Script parameters
  };
  upsert?: boolean;                 // Create if doesn't exist
  refresh?: boolean | 'wait_for';   // Refresh policy
}
```

#### Response

```typescript
interface UpdateDocumentResult {
  _id: string;           // Document ID
  _index: string;        // Index name
  _version: number;      // New document version
  result: 'updated' | 'created' | 'noop'; // Operation result
}
```

#### Examples

**Partial document update:**
```json
{
  "tool": "update_document",
  "arguments": {
    "index": "products",
    "id": "prod-123",
    "document": {
      "price": 89.99,
      "last_updated": "2024-01-15T10:30:00Z"
    }
  }
}
```

**Script-based update:**
```json
{
  "tool": "update_document",
  "arguments": {
    "index": "user-profiles",
    "id": "user123",
    "script": {
      "source": "ctx._source.login_count += params.increment; ctx._source.last_login = params.timestamp",
      "params": {
        "increment": 1,
        "timestamp": "2024-01-15T10:30:00Z"
      }
    }
  }
}
```

**Upsert operation:**
```json
{
  "tool": "update_document",
  "arguments": {
    "index": "counters",
    "id": "page-views",
    "script": {
      "source": "ctx._source.count += 1"
    },
    "document": {
      "count": 1,
      "created": "2024-01-15T10:30:00Z"
    },
    "upsert": true
  }
}
```

### `delete_document`

Delete documents by ID or using query-based deletion.

#### Parameters

```typescript
interface DeleteDocumentArgs {
  index: string;                    // Target index (required)
  id?: string;                      // Document ID for single delete
  query?: Record<string, any>;      // Query for bulk delete
  conflicts?: 'abort' | 'proceed';  // Conflict handling
  refresh?: boolean | 'wait_for';   // Refresh policy
}
```

#### Response

```typescript
interface DeleteDocumentResult {
  deleted: number;          // Number of deleted documents
  versionConflicts?: number; // Version conflicts encountered
  noops?: number;           // No-op operations
  retries?: {               // Retry statistics
    bulk: number;
    search: number;
  };
  tookMs: number;           // Operation time in ms
  timedOut: boolean;        // Whether operation timed out
}
```

#### Examples

**Delete by ID:**
```json
{
  "tool": "delete_document",
  "arguments": {
    "index": "user-events",
    "id": "event123"
  }
}
```

**Delete by query:**
```json
{
  "tool": "delete_document",
  "arguments": {
    "index": "user-events",
    "query": {
      "bool": {
        "must": [
          { "range": { "timestamp": { "lt": "2023-01-01" } } },
          { "term": { "processed": true } }
        ]
      }
    },
    "conflicts": "proceed"
  }
}
```

## Data Export Tools

### `export_to_csv`

Export search results to CSV format with streaming support for large datasets.

#### Parameters

```typescript
interface ExportToCSVArgs {
  index: string;                    // Source index (required)
  query?: Record<string, any>;      // Filter query
  fields?: string[];                // Specific fields to export
  filename?: string;                // Output filename
  format?: {                        // CSV formatting options
    delimiter?: string;             // Field delimiter (default: ",")
    quote?: string;                 // Quote character (default: '"')
    escape?: string;                // Escape character
    header?: boolean;               // Include header row (default: true)
  };
  maxRows?: number;                 // Maximum rows to export (default: 1M)
  compress?: boolean;               // Gzip compression (default: false)
}
```

#### Response

```typescript
interface ExportToCSVResult {
  filename: string;      // Generated filename
  rowsExported: number;  // Number of rows exported
  fileSize: string;      // File size (e.g., "10.5 MB")
  downloadUrl?: string;  // File download URL
}
```

#### Examples

**Basic export:**
```json
{
  "tool": "export_to_csv",
  "arguments": {
    "index": "user-analytics"
  }
}
```

**Filtered export with specific fields:**
```json
{
  "tool": "export_to_csv",
  "arguments": {
    "index": "user-analytics",
    "query": {
      "bool": {
        "filter": [
          { "term": { "status": "active" } },
          { "range": { "last_login": { "gte": "2024-01-01" } } }
        ]
      }
    },
    "fields": ["user_id", "email", "last_login", "country", "subscription_tier"],
    "filename": "active_users_2024.csv",
    "compress": true,
    "maxRows": 100000
  }
}
```

**Custom CSV formatting:**
```json
{
  "tool": "export_to_csv",
  "arguments": {
    "index": "transaction-logs",
    "query": {
      "range": {
        "timestamp": {
          "gte": "2024-01-01",
          "lte": "2024-01-31"
        }
      }
    },
    "format": {
      "delimiter": "|",
      "quote": "'",
      "header": true
    },
    "filename": "transactions_jan_2024.csv"
  }
}
```

## Security Considerations

### Input Validation

All tools perform comprehensive input validation:

- **Field Names**: Cannot start with underscore (reserved fields)
- **Document Size**: Limited to 100MB per document
- **Array Size**: Maximum 10,000 elements per array
- **String Length**: Maximum 1MB per string field
- **Nesting Depth**: Maximum 20 levels deep
- **Query Depth**: Maximum 20 levels for nested queries

### Script Security

Script-based operations have additional security measures:

- **Dangerous Patterns**: Blocks `System.`, `Runtime.`, `Process.`, etc.
- **Parameter Limits**: Maximum 50 parameters per script
- **Parameter Size**: Maximum 1MB per parameter
- **Language**: Only Painless scripting language allowed

### Query Security

Search and delete operations include query security:

- **Script Queries**: Blocked in sensitive operations
- **Injection Prevention**: Input sanitization and validation
- **Size Limits**: Reasonable limits on aggregations, sort criteria
- **Performance Warnings**: Alerts for potentially slow queries

## Error Handling

All tools return structured error responses:

```typescript
interface ErrorResponse {
  error: {
    code: string;           // Error code (e.g., "VALIDATION_ERROR")
    message: string;        // Human-readable message
    statusCode: number;     // HTTP-style status code
    context?: Record<string, unknown>; // Additional context
    timestamp: string;      // ISO timestamp
    requestId?: string;     // Request tracking ID
  };
}
```

### Common Error Codes

| Code | Description | Resolution |
|------|-------------|------------|
| `VALIDATION_ERROR` | Invalid input parameters | Check parameter types and values |
| `CONNECTION_ERROR` | Elasticsearch connection failed | Verify credentials and connectivity |
| `AUTHENTICATION_ERROR` | Invalid credentials | Check API key or username/password |
| `NOT_FOUND` | Index or document not found | Verify index/document exists |
| `ELASTICSEARCH_ERROR` | Elasticsearch operation failed | Check Elasticsearch logs |
| `RATE_LIMIT_EXCEEDED` | Too many requests | Reduce request frequency |

## Performance Guidelines

### Best Practices

1. **Use Filters**: Prefer `filter` over `must` for exact matches
2. **Limit Results**: Always specify reasonable `size` limits
3. **Source Filtering**: Use `source` parameter to limit returned fields
4. **Index Patterns**: Use specific patterns instead of wildcards
5. **Batch Operations**: Group related operations when possible

### Performance Limits

| Operation | Limit | Reason |
|-----------|-------|--------|
| Search size | 10,000 | Elasticsearch default limit |
| Export rows | 1,000,000 | Memory and performance |
| Document size | 100MB | Network and storage efficiency |
| Query depth | 20 levels | Query performance |
| Aggregations | 50 per query | Response time |
| Sort criteria | 20 per query | Performance optimization |

### Monitoring

The server provides performance metrics:

- Query execution time
- Memory usage
- Connection pool status  
- Error rates
- Request volume

Use these metrics to optimize your usage patterns and identify performance bottlenecks.