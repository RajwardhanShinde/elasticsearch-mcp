# Elasticsearch MCP

> **Model Context Protocol server for Elasticsearch integration with comprehensive security and performance features**

[![npm version](https://badge.fury.io/js/elasticsearch-mcp.svg)](https://www.npmjs.com/package/elasticsearch-mcp)
[![TypeScript](https://img.shields.io/badge/TypeScript-007ACC?logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![Elasticsearch](https://img.shields.io/badge/Elasticsearch-005571?logo=elasticsearch&logoColor=white)](https://www.elastic.co/)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

**elasticsearch-mcp** is a Model Context Protocol (MCP) server that provides standardized, secure tools for interacting with Elasticsearch clusters. Built with TypeScript and optimized for Elastic Cloud environments, it offers comprehensive data management capabilities with enterprise-grade security features.

## 🚀 Features

- **🔐 Secure by Design**: Input validation, script sanitization, injection prevention
- **☁️ Elastic Cloud Ready**: Native support for cloud ID and API key authentication  
- **⚡ High Performance**: Streaming for large datasets, connection pooling, health monitoring
- **🛠️ Comprehensive Tools**: 7 essential tools covering all major Elasticsearch operations
- **📊 Advanced Querying**: Full Elasticsearch DSL support with aggregations and highlighting
- **📁 Data Export**: Stream large datasets to CSV with compression support
- **🔍 Smart Validation**: Zod-based schemas with security-first validation
- **📝 Full TypeScript**: Complete type safety with strict null checks

## 📦 Installation

```bash
npm install elasticsearch-mcp
```

## 🏃‍♂️ Quick Start

### 1. Basic Setup

```bash
# Set your Elasticsearch credentials
export ELASTIC_CLOUD_ID="your-cloud-id"
export ELASTIC_API_KEY="your-api-key"

# Start the MCP server
npx elasticsearch-mcp
```

### 2. Using with Claude Desktop

Add to your Claude Desktop MCP configuration:

```json
{
  "mcpServers": {
    "elasticsearch-mcp": {
      "command": "npx",
      "args": ["elasticsearch-mcp"],
      "env": {
        "ELASTIC_CLOUD_ID": "your-cloud-id",
        "ELASTIC_API_KEY": "your-api-key"
      }
    }
  }
}
```

### 3. Using with any MCP Client

```typescript
import { ElasticMCPServer } from 'elasticsearch-mcp';

const server = new ElasticMCPServer();
await server.start();
```

## 🛠️ Available Tools

| Tool | Description | Use Cases |
|------|-------------|-----------|
| `fetch_indices` | List and filter Elasticsearch indices | Index management, monitoring |
| `search_elasticsearch` | Advanced search with aggregations | Data analysis, querying |
| `create_index` | Create indices with mappings/settings | Schema management |
| `insert_data` | Insert documents with validation | Data ingestion |
| `update_document` | Update documents with scripts | Data modification |
| `delete_document` | Delete by ID or query | Data cleanup |
| `export_to_csv` | Stream data to CSV files | Reporting, data export |

## 📋 Tool Examples

### Search with Aggregations

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
      }
    }
  }
}
```

### Export Large Dataset

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
    "fields": ["user_id", "email", "last_login", "country"],
    "filename": "active_users_2024.csv",
    "compress": true,
    "maxRows": 100000
  }
}
```

### Create Index with Schema

```json
{
  "tool": "create_index",
  "arguments": {
    "name": "product-catalog",
    "mappings": {
      "properties": {
        "name": { "type": "text", "analyzer": "standard" },
        "price": { "type": "float" },
        "category": { "type": "keyword" },
        "created_at": { "type": "date" },
        "tags": { "type": "keyword" },
        "description": { "type": "text" }
      }
    },
    "settings": {
      "number_of_shards": 1,
      "number_of_replicas": 1,
      "analysis": {
        "analyzer": {
          "product_analyzer": {
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

## ⚙️ Configuration

### Environment Variables

| Variable | Description | Required | Example |
|----------|-------------|----------|---------|
| `ELASTIC_CLOUD_ID` | Elastic Cloud deployment ID | Yes* | `deployment:dXMtY2VudHJhbDE=` |
| `ELASTIC_API_KEY` | Elasticsearch API key | Yes* | `VnVhQ2ZHY0JDZGJrU...` |
| `ELASTIC_NODE` | Self-hosted Elasticsearch URL | Yes* | `https://localhost:9200` |
| `ELASTIC_USERNAME` | Basic auth username | No | `elastic` |
| `ELASTIC_PASSWORD` | Basic auth password | No | `changeme` |
| `LOG_LEVEL` | Logging level | No | `info` |
| `LOG_FORMAT` | Log output format | No | `text` |
| `MAX_CONCURRENT_REQUESTS` | Request concurrency limit | No | `10` |

*Either `ELASTIC_CLOUD_ID` or `ELASTIC_NODE` is required

### Configuration File

Create `.env` file:

```bash
# Elastic Cloud (recommended)
ELASTIC_CLOUD_ID=your-deployment-id
ELASTIC_API_KEY=your-api-key

# Logging
LOG_LEVEL=info
LOG_FORMAT=json

# Performance
MAX_CONCURRENT_REQUESTS=10
REQUEST_TIMEOUT_MS=30000
```

## 🔒 Security Features

### Input Validation
- **Zod Schemas**: Strict type validation for all inputs
- **Field Name Validation**: Prevents reserved field usage
- **Size Limits**: Document size, array length, string length limits
- **Depth Validation**: Prevents deeply nested objects/queries

### Script Security
- **Script Sanitization**: Blocks dangerous script patterns
- **Parameter Validation**: Validates script parameters
- **Execution Limits**: Prevents resource exhaustion

### Query Security
- **Injection Prevention**: Sanitizes and validates all queries
- **Script Query Blocking**: Prevents script-based queries in sensitive operations
- **Rate Limiting**: Protects against abuse

### Data Protection
- **Credential Masking**: Never logs sensitive information
- **Secure Connections**: TLS/SSL support
- **Access Control**: Validates permissions before operations

## 🏗️ Architecture

```
┌─────────────────┐    ┌─────────────────┐    ┌─────────────────┐
│   MCP Client    │◄──►│Elasticsearch MCP│◄──►│  Elasticsearch  │
│  (Claude, etc.) │    │     Server      │    │    Cluster      │
└─────────────────┘    └─────────────────┘    └─────────────────┘
                              │
                       ┌─────────────┐
                       │   Tools     │
                       │             │
                       │ • fetch     │
                       │ • search    │
                       │ • create    │
                       │ • insert    │
                       │ • update    │
                       │ • delete    │
                       │ • export    │
                       └─────────────┘
```

## 📊 Performance

### Benchmarks
- **Search**: <500ms average response time
- **Large Exports**: 10K+ documents/second with streaming
- **Memory Usage**: <100MB for typical operations
- **Concurrent Requests**: Up to 10 simultaneous operations

### Optimization Features
- **Connection Pooling**: Reuses Elasticsearch connections
- **Streaming**: Memory-efficient processing of large datasets
- **Compression**: Reduces export file sizes by 70%+
- **Health Monitoring**: Automatic reconnection on failures

## 🔧 Development

### Setup Development Environment

```bash
# Clone repository
git clone https://github.com/RajwardhanShinde/elk-mcp.git
cd elk-mcp

# Install dependencies
npm install

# Set up environment
cp .env.example .env
# Edit .env with your Elasticsearch credentials

# Run in development mode
npm run dev

# Run tests
npm test

# Build for production
npm run build
```

### Project Structure

```
elasticsearch-mcp/
├── src/
│   ├── tools/           # MCP tool implementations
│   ├── elasticsearch/   # ES client and connection management
│   ├── validation/      # Input validation schemas
│   ├── errors/          # Error handling utilities
│   ├── config.ts        # Configuration management
│   ├── logger.ts        # Structured logging
│   └── server.ts        # Main MCP server
├── tests/               # Comprehensive test suite
├── docs/                # Documentation
└── build/               # Compiled output
```

## 🤝 Contributing

We welcome contributions! Please see our [Contributing Guide](CONTRIBUTING.md) for details.

### Development Workflow
1. Fork the repository
2. Create a feature branch
3. Make your changes with tests
4. Ensure all tests pass
5. Submit a pull request

## 📚 Documentation

- [Quick Start Guide](docs/guides/quick-start.md)
- [API Reference](docs/api/tools.md)
- [Configuration Guide](docs/api/configuration.md)
- [Elastic Cloud Setup](docs/guides/elastic-cloud-setup.md)
- [Troubleshooting](docs/guides/troubleshooting.md)
- [Examples](docs/examples/)

## 🐛 Troubleshooting

### Common Issues

**Connection Failed**
```bash
# Check credentials
echo $ELASTIC_CLOUD_ID
echo $ELASTIC_API_KEY

# Test connection
curl -H "Authorization: ApiKey $ELASTIC_API_KEY" \\
     "$ELASTIC_NODE/_cluster/health"
```

**Permission Denied**
- Ensure API key has required privileges
- Check index permissions
- Verify cluster access

**Tool Validation Errors**
- Check input parameter types
- Validate required fields
- Review field name restrictions

See [Troubleshooting Guide](docs/guides/troubleshooting.md) for more details.

## 📄 License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

## 🏷️ Version History

- **v0.1.0** - Initial release with 7 core tools
- Full changelog: [CHANGELOG.md](CHANGELOG.md)

## 🔗 Links

- [npm Package](https://www.npmjs.com/package/elasticsearch-mcp)
- [GitHub Repository](https://github.com/RajwardhanShinde/elk-mcp)
- [Issue Tracker](https://github.com/RajwardhanShinde/elk-mcp/issues)
- [Elasticsearch Documentation](https://www.elastic.co/guide/)
- [Model Context Protocol](https://modelcontextprotocol.io/)

---

**Built with ❤️ for the Elasticsearch and MCP communities**