import { jest } from '@jest/globals';
import { SearchElasticsearchTool } from '../../../src/tools/search-elasticsearch.js';
import { ElasticsearchManager } from '../../../src/elasticsearch/client.js';
import { Logger } from '../../../src/logger.js';
import { ValidationError, ElasticsearchError, NotFoundError } from '../../../src/errors/handlers.js';
import elasticsearchResponses from '../../fixtures/elasticsearch-responses.json';
import sampleData from '../../fixtures/sample-data.json';

// Mock the elasticsearch client
const mockClient = {
  indices: {
    exists: jest.fn(),
  },
  search: jest.fn(),
};

const mockElasticsearchManager = {
  getClient: jest.fn(() => mockClient),
} as unknown as ElasticsearchManager;

const mockLogger = {
  child: jest.fn(() => mockLogger),
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
  debug: jest.fn(),
} as unknown as Logger;

describe('SearchElasticsearchTool', () => {
  let tool: SearchElasticsearchTool;

  beforeEach(() => {
    tool = new SearchElasticsearchTool(mockElasticsearchManager, mockLogger);
    jest.clearAllMocks();
  });

  describe('execute', () => {
    it('should execute basic search successfully', async () => {
      mockClient.indices.exists.mockResolvedValue(true);
      mockClient.search.mockResolvedValue(elasticsearchResponses.searchResponse);

      const result = await tool.execute({
        index: 'test-index',
      });

      expect(result).toEqual({
        hits: {
          total: { value: 2, relation: 'eq' },
          hits: [
            {
              _id: 'doc1',
              _score: 1.0,
              _source: {
                title: 'Test Document 1',
                content: 'This is test content',
                timestamp: '2023-01-01T00:00:00Z',
              },
            },
            {
              _id: 'doc2',
              _score: 0.8,
              _source: {
                title: 'Test Document 2',
                content: 'This is more test content',
                timestamp: '2023-01-02T00:00:00Z',
              },
            },
          ],
        },
        took: 15,
      });

      expect(mockClient.search).toHaveBeenCalledWith({
        index: 'test-index',
        body: {
          query: { match_all: {} },
        },
        timeout: '30s',
      });
    });

    it('should execute search with custom query', async () => {
      mockClient.indices.exists.mockResolvedValue(true);
      mockClient.search.mockResolvedValue(elasticsearchResponses.searchResponse);

      await tool.execute({
        index: 'test-index',
        query: sampleData.validQueries[1], // match query
      });

      expect(mockClient.search).toHaveBeenCalledWith({
        index: 'test-index',
        body: {
          query: sampleData.validQueries[1],
        },
        timeout: '30s',
      });
    });

    it('should handle pagination parameters', async () => {
      mockClient.indices.exists.mockResolvedValue(true);
      mockClient.search.mockResolvedValue(elasticsearchResponses.searchResponse);

      await tool.execute({
        index: 'test-index',
        size: 50,
        from: 100,
      });

      expect(mockClient.search).toHaveBeenCalledWith({
        index: 'test-index',
        body: {
          query: { match_all: {} },
          size: 50,
          from: 100,
        },
        timeout: '30s',
      });
    });

    it('should enforce size limit', async () => {
      mockClient.indices.exists.mockResolvedValue(true);
      mockClient.search.mockResolvedValue(elasticsearchResponses.searchResponse);

      await tool.execute({
        index: 'test-index',
        size: 50000, // Exceeds limit
      });

      expect(mockClient.search).toHaveBeenCalledWith({
        index: 'test-index',
        body: {
          query: { match_all: {} },
          size: 10000, // Capped at limit
        },
        timeout: '30s',
      });
    });

    it('should handle sort parameters', async () => {
      mockClient.indices.exists.mockResolvedValue(true);
      mockClient.search.mockResolvedValue(elasticsearchResponses.searchResponse);

      const sort = [{ timestamp: { order: 'desc' } }];

      await tool.execute({
        index: 'test-index',
        sort,
      });

      expect(mockClient.search).toHaveBeenCalledWith({
        index: 'test-index',
        body: {
          query: { match_all: {} },
          sort,
        },
        timeout: '30s',
      });
    });

    it('should handle aggregations', async () => {
      mockClient.indices.exists.mockResolvedValue(true);
      const responseWithAggs = {
        ...elasticsearchResponses.searchResponse,
        aggregations: {
          categories: {
            buckets: [
              { key: 'category1', doc_count: 10 },
              { key: 'category2', doc_count: 5 },
            ],
          },
        },
      };
      mockClient.search.mockResolvedValue(responseWithAggs);

      const aggregations = {
        categories: {
          terms: { field: 'category' },
        },
      };

      const result = await tool.execute({
        index: 'test-index',
        aggregations,
      });

      expect(result.aggregations).toEqual(responseWithAggs.aggregations);
      expect(mockClient.search).toHaveBeenCalledWith({
        index: 'test-index',
        body: {
          query: { match_all: {} },
          aggs: aggregations,
        },
        timeout: '30s',
      });
    });

    it('should handle highlighting', async () => {
      mockClient.indices.exists.mockResolvedValue(true);
      const responseWithHighlight = {
        ...elasticsearchResponses.searchResponse,
        hits: {
          ...elasticsearchResponses.searchResponse.hits,
          hits: [
            {
              ...elasticsearchResponses.searchResponse.hits.hits[0],
              highlight: {
                title: ['<em>Test</em> Document 1'],
              },
            },
          ],
        },
      };
      mockClient.search.mockResolvedValue(responseWithHighlight);

      const highlight = {
        fields: { title: {} },
      };

      const result = await tool.execute({
        index: 'test-index',
        highlight,
      });

      expect(result.hits.hits[0].highlight).toEqual({
        title: ['<em>Test</em> Document 1'],
      });
    });

    it('should handle source filtering', async () => {
      mockClient.indices.exists.mockResolvedValue(true);
      mockClient.search.mockResolvedValue(elasticsearchResponses.searchResponse);

      // Test with array of fields
      await tool.execute({
        index: 'test-index',
        source: ['title', 'content'],
      });

      expect(mockClient.search).toHaveBeenCalledWith({
        index: 'test-index',
        body: {
          query: { match_all: {} },
          _source: ['title', 'content'],
        },
        timeout: '30s',
      });

      // Test with boolean
      await tool.execute({
        index: 'test-index',
        source: false,
      });

      expect(mockClient.search).toHaveBeenCalledWith({
        index: 'test-index',
        body: {
          query: { match_all: {} },
          _source: false,
        },
        timeout: '30s',
      });
    });

    it('should throw error if index does not exist', async () => {
      mockClient.indices.exists.mockResolvedValue(false);

      await expect(tool.execute({
        index: 'non-existent-index',
      })).rejects.toThrow(NotFoundError);
      await expect(tool.execute({
        index: 'non-existent-index',
      })).rejects.toThrow("Index 'non-existent-index' does not exist");
    });

    it('should validate script queries', async () => {
      mockClient.indices.exists.mockResolvedValue(true);

      await expect(tool.execute({
        index: 'test-index',
        query: {
          script_score: {
            query: { match_all: {} },
            script: { source: 'Math.log(2)' },
          },
        },
      })).rejects.toThrow(ValidationError);
      await expect(tool.execute({
        index: 'test-index',
        query: {
          script_score: {
            query: { match_all: {} },
            script: { source: 'Math.log(2)' },
          },
        },
      })).rejects.toThrow('Script-based queries require additional security validation');
    });

    it('should validate sort criteria limit', async () => {
      mockClient.indices.exists.mockResolvedValue(true);

      const tooManySort = new Array(25).fill({ timestamp: { order: 'desc' } });

      await expect(tool.execute({
        index: 'test-index',
        sort: tooManySort,
      })).rejects.toThrow(ValidationError);
      await expect(tool.execute({
        index: 'test-index',
        sort: tooManySort,
      })).rejects.toThrow('Too many sort criteria');
    });

    it('should validate script-based sorting', async () => {
      mockClient.indices.exists.mockResolvedValue(true);

      await expect(tool.execute({
        index: 'test-index',
        sort: [{ _script: { type: 'number', script: 'doc["field"].value * 2' } }],
      })).rejects.toThrow(ValidationError);
      await expect(tool.execute({
        index: 'test-index',
        sort: [{ _script: { type: 'number', script: 'doc["field"].value * 2' } }],
      })).rejects.toThrow('Script-based sorting is not allowed');
    });

    it('should validate aggregations limit', async () => {
      mockClient.indices.exists.mockResolvedValue(true);

      const tooManyAggs: Record<string, unknown> = {};
      for (let i = 0; i < 55; i++) {
        tooManyAggs[`agg${i}`] = { terms: { field: 'field' } };
      }

      await expect(tool.execute({
        index: 'test-index',
        aggregations: tooManyAggs,
      })).rejects.toThrow(ValidationError);
      await expect(tool.execute({
        index: 'test-index',
        aggregations: tooManyAggs,
      })).rejects.toThrow('Too many aggregations');
    });

    it('should validate highlight fields limit', async () => {
      mockClient.indices.exists.mockResolvedValue(true);

      const tooManyFields: Record<string, unknown> = {};
      for (let i = 0; i < 25; i++) {
        tooManyFields[`field${i}`] = {};
      }

      await expect(tool.execute({
        index: 'test-index',
        highlight: { fields: tooManyFields },
      })).rejects.toThrow(ValidationError);
      await expect(tool.execute({
        index: 'test-index',
        highlight: { fields: tooManyFields },
      })).rejects.toThrow('Too many highlight fields');
    });

    it('should validate source fields limit', async () => {
      mockClient.indices.exists.mockResolvedValue(true);

      const tooManyFields = new Array(150).fill('field');

      await expect(tool.execute({
        index: 'test-index',
        source: tooManyFields,
      })).rejects.toThrow(ValidationError);
      await expect(tool.execute({
        index: 'test-index',
        source: tooManyFields,
      })).rejects.toThrow('Too many source fields');
    });

    it('should validate query depth', async () => {
      mockClient.indices.exists.mockResolvedValue(true);

      // Create deeply nested query
      let deepQuery: any = { match: { field: 'value' } };
      for (let i = 0; i < 25; i++) {
        deepQuery = { bool: { must: [deepQuery] } };
      }

      await expect(tool.execute({
        index: 'test-index',
        query: deepQuery,
      })).rejects.toThrow(ValidationError);
      await expect(tool.execute({
        index: 'test-index',
        query: deepQuery,
      })).rejects.toThrow('exceeds maximum depth');
    });

    it('should warn about wildcard queries', async () => {
      mockClient.indices.exists.mockResolvedValue(true);
      mockClient.search.mockResolvedValue(elasticsearchResponses.searchResponse);

      await tool.execute({
        index: 'test-index',
        query: {
          wildcard: { field: 'value*' },
        },
      });

      expect(mockLogger.warn).toHaveBeenCalledWith(
        'Wildcard/prefix queries detected - may impact performance',
        expect.any(Object)
      );
    });

    it('should handle elasticsearch errors', async () => {
      mockClient.indices.exists.mockResolvedValue(true);
      const error = new Error('Search failed');
      mockClient.search.mockRejectedValue(error);

      await expect(tool.execute({
        index: 'test-index',
      })).rejects.toThrow(ElasticsearchError);
    });

    it('should handle invalid arguments', async () => {
      await expect(tool.execute({
        // Missing index
        query: { match_all: {} },
      })).rejects.toThrow(ValidationError);

      await expect(tool.execute({
        index: 'test-index',
        size: -1, // Invalid size
      })).rejects.toThrow(ValidationError);
    });

    it('should format search response correctly', async () => {
      mockClient.indices.exists.mockResolvedValue(true);
      
      // Test response with different total format (legacy vs new)
      const legacyResponse = {
        ...elasticsearchResponses.searchResponse,
        hits: {
          ...elasticsearchResponses.searchResponse.hits,
          total: 5, // Legacy format (number instead of object)
        },
      };
      mockClient.search.mockResolvedValue(legacyResponse);

      const result = await tool.execute({
        index: 'test-index',
      });

      expect(result.hits.total).toEqual({
        value: 5,
        relation: 'eq',
      });
    });
  });
});