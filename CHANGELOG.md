# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.1.0] - 2025-01-15

### Added
- Initial release of elastic-mcp server
- **Index Management Tools**:
  - `fetch_indices` - List and filter Elasticsearch indices
  - `create_index` - Create indices with mappings and settings
- **Data Retrieval Tools**:
  - `search_elasticsearch` - Advanced search with full DSL support and aggregations
- **Data Manipulation Tools**:
  - `insert_data` - Insert documents with validation
  - `update_document` - Update documents with partial updates or scripts
  - `delete_document` - Delete documents by ID or query
- **Data Export Tools**:
  - `export_to_csv` - Stream large datasets to CSV with compression
- **Security Features**:
  - Comprehensive input validation with Zod schemas
  - Script sanitization and injection prevention
  - Query depth and complexity validation
  - Rate limiting and request throttling
- **Authentication Support**:
  - Elastic Cloud (cloud ID + API key)
  - Self-hosted Elasticsearch (basic auth)
  - TLS/SSL support
- **Performance Features**:
  - Connection pooling and health monitoring
  - Streaming for large dataset exports
  - Memory-efficient processing
  - Automatic reconnection on failures
- **Developer Experience**:
  - Full TypeScript support with strict null checks
  - Comprehensive error handling
  - Structured logging
  - Complete test coverage (90%+)
  - Extensive documentation and examples

### Technical
- Built with TypeScript 5.x and strict null checking
- Uses @modelcontextprotocol/sdk for MCP protocol compliance
- Elasticsearch client v8.11.0 with modern API support
- Jest testing framework with comprehensive mocking
- Zod for runtime type validation and security
- CSV-writer for efficient data export streaming

### Security
- Input sanitization prevents injection attacks
- Script-based queries blocked in sensitive operations
- Field name validation prevents reserved field usage
- Document size limits prevent resource exhaustion
- Query depth limits prevent stack overflow attacks
- Credential masking in logs and error messages