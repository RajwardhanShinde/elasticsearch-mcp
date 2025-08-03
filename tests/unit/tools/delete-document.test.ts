import { jest } from '@jest/globals';
import { DeleteDocumentTool } from '../../../src/tools/delete-document.js';
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
  delete: jest.fn(),
  deleteByQuery: jest.fn(),
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

describe('DeleteDocumentTool', () => {
  let tool: DeleteDocumentTool;

  beforeEach(() => {
    tool = new DeleteDocumentTool(mockElasticsearchManager, mockLogger);
    jest.clearAllMocks();
  });

  describe('execute', () => {
    it('should delete document by ID successfully', async () => {
      mockClient.indices.exists.mockResolvedValue(true);
      mockClient.delete.mockResolvedValue(elasticsearchResponses.documentDeleteResponse);

      const result = await tool.execute({
        index: 'test-index',
        id: 'doc123',
      });

      expect(result).toEqual({
        deleted: 1,
        tookMs: 0,
        timedOut: false,
      });

      expect(mockClient.delete).toHaveBeenCalledWith({
        index: 'test-index',
        id: 'doc123',
        refresh: false,
      });
    });

    it('should delete documents by query successfully', async () => {
      mockClient.indices.exists.mockResolvedValue(true);
      mockClient.deleteByQuery.mockResolvedValue(elasticsearchResponses.deleteByQueryResponse);

      const query = { match: { status: 'inactive' } };

      const result = await tool.execute({
        index: 'test-index',
        query,
      });

      expect(result).toEqual({
        deleted: 5,
        versionConflicts: 0,
        noops: 0,
        retries: {
          bulk: 0,
          search: 0,
        },
        tookMs: 147,
        timedOut: false,
      });

      expect(mockClient.deleteByQuery).toHaveBeenCalledWith({
        index: 'test-index',
        body: {
          query,
        },
        refresh: false,
        conflicts: 'abort',
        timeout: '5m',
        wait_for_completion: true,
      });
    });

    it('should handle refresh parameter', async () => {
      mockClient.indices.exists.mockResolvedValue(true);
      mockClient.delete.mockResolvedValue(elasticsearchResponses.documentDeleteResponse);

      await tool.execute({
        index: 'test-index',
        id: 'doc123',
        refresh: 'wait_for',
      });

      expect(mockClient.delete).toHaveBeenCalledWith({
        index: 'test-index',
        id: 'doc123',
        refresh: 'wait_for',
      });
    });

    it('should handle conflicts parameter in delete by query', async () => {
      mockClient.indices.exists.mockResolvedValue(true);
      mockClient.deleteByQuery.mockResolvedValue(elasticsearchResponses.deleteByQueryResponse);

      await tool.execute({
        index: 'test-index',
        query: { match_all: {} },
        conflicts: 'proceed',
      });

      expect(mockClient.deleteByQuery).toHaveBeenCalledWith(
        expect.objectContaining({
          conflicts: 'proceed',
        })
      );
    });

    it('should throw error if index does not exist', async () => {
      mockClient.indices.exists.mockResolvedValue(false);

      await expect(tool.execute({
        index: 'non-existent-index',
        id: 'doc123',
      })).rejects.toThrow(NotFoundError);
      await expect(tool.execute({
        index: 'non-existent-index',
        id: 'doc123',
      })).rejects.toThrow("Index 'non-existent-index' does not exist");
    });

    it('should throw error if neither id nor query provided', async () => {
      await expect(tool.execute({
        index: 'test-index',
        // Missing both id and query
      })).rejects.toThrow(ValidationError);
      await expect(tool.execute({
        index: 'test-index',
      })).rejects.toThrow('Either id or query must be provided');
    });

    it('should handle document not found error', async () => {
      mockClient.indices.exists.mockResolvedValue(true);
      const error = new Error('not_found');
      mockClient.delete.mockRejectedValue(error);

      await expect(tool.execute({
        index: 'test-index',
        id: 'non-existent-doc',
      })).rejects.toThrow(NotFoundError);
      await expect(tool.execute({
        index: 'test-index',
        id: 'non-existent-doc',
      })).rejects.toThrow("Document with ID 'non-existent-doc' not found");
    });

    it('should validate empty query', async () => {
      mockClient.indices.exists.mockResolvedValue(true);

      await expect(tool.execute({
        index: 'test-index',
        query: undefined,
      })).rejects.toThrow(ValidationError);
    });

    it('should validate query structure', async () => {
      mockClient.indices.exists.mockResolvedValue(true);

      // Test script queries
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
      })).rejects.toThrow('Script-based queries are not allowed');
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

    it('should warn about match_all queries without size limit', async () => {
      mockClient.indices.exists.mockResolvedValue(true);
      mockClient.deleteByQuery.mockResolvedValue(elasticsearchResponses.deleteByQueryResponse);

      await tool.execute({
        index: 'test-index',
        query: { match_all: {} },
      });

      expect(mockLogger.warn).toHaveBeenCalledWith(
        'Detected match_all query without size limit',
        expect.any(Object)
      );
    });

    it('should handle elasticsearch errors in delete by query', async () => {
      mockClient.indices.exists.mockResolvedValue(true);
      const error = new Error('Delete by query failed');
      mockClient.deleteByQuery.mockRejectedValue(error);

      await expect(tool.execute({
        index: 'test-index',
        query: { match: { field: 'value' } },
      })).rejects.toThrow(ElasticsearchError);
    });

    it('should handle elasticsearch errors in delete by ID', async () => {
      mockClient.indices.exists.mockResolvedValue(true);
      const error = new Error('Delete operation failed');
      mockClient.delete.mockRejectedValue(error);

      await expect(tool.execute({
        index: 'test-index',
        id: 'doc123',
      })).rejects.toThrow(ElasticsearchError);
    });

    it('should handle invalid arguments', async () => {
      await expect(tool.execute({
        // Missing index
        id: 'doc123',
      })).rejects.toThrow(ValidationError);

      await expect(tool.execute({
        index: 'test-index',
        id: '', // Empty ID
      })).rejects.toThrow(ValidationError);
    });

    it('should normalize refresh parameter correctly', async () => {
      mockClient.indices.exists.mockResolvedValue(true);
      mockClient.delete.mockResolvedValue(elasticsearchResponses.documentDeleteResponse);

      // Test 'true' string
      await tool.execute({
        index: 'test-index',
        id: 'doc123',
        refresh: 'true',
      });

      expect(mockClient.delete).toHaveBeenCalledWith(
        expect.objectContaining({ refresh: true })
      );

      // Test 'false' string
      await tool.execute({
        index: 'test-index',
        id: 'doc123',
        refresh: 'false',
      });

      expect(mockClient.delete).toHaveBeenCalledWith(
        expect.objectContaining({ refresh: false })
      );
    });

    it('should handle complex valid queries', async () => {
      mockClient.indices.exists.mockResolvedValue(true);
      mockClient.deleteByQuery.mockResolvedValue(elasticsearchResponses.deleteByQueryResponse);

      const complexQuery = {
        bool: {
          must: [
            { match: { status: 'inactive' } },
            { range: { created_at: { lt: '2023-01-01' } } },
          ],
          must_not: [
            { term: { important: true } },
          ],
        },
      };

      const result = await tool.execute({
        index: 'test-index',
        query: complexQuery,
      });

      expect(result.deleted).toBe(5);
      expect(mockClient.deleteByQuery).toHaveBeenCalledWith({
        index: 'test-index',
        body: {
          query: complexQuery,
        },
        refresh: false,
        conflicts: 'abort',
        timeout: '5m',
        wait_for_completion: true,
      });
    });

    it('should handle delete by query with no matches', async () => {
      mockClient.indices.exists.mockResolvedValue(true);
      const noMatchResponse = {
        ...elasticsearchResponses.deleteByQueryResponse,
        deleted: 0,
        total: 0,
      };
      mockClient.deleteByQuery.mockResolvedValue(noMatchResponse);

      const result = await tool.execute({
        index: 'test-index',
        query: { match: { nonexistent: 'value' } },
      });

      expect(result.deleted).toBe(0);
    });

    it('should handle delete result when document not deleted', async () => {
      mockClient.indices.exists.mockResolvedValue(true);
      const notDeletedResponse = {
        ...elasticsearchResponses.documentDeleteResponse,
        result: 'not_found',
      };
      mockClient.delete.mockResolvedValue(notDeletedResponse);

      const result = await tool.execute({
        index: 'test-index',
        id: 'doc123',
      });

      expect(result.deleted).toBe(0);
    });

    it('should handle missing optional fields in response', async () => {
      mockClient.indices.exists.mockResolvedValue(true);
      const minimalResponse = {
        deleted: 3,
        // Missing other optional fields
      };
      mockClient.deleteByQuery.mockResolvedValue(minimalResponse);

      const result = await tool.execute({
        index: 'test-index',
        query: { match: { field: 'value' } },
      });

      expect(result).toEqual({
        deleted: 3,
        versionConflicts: 0,
        noops: 0,
        retries: {
          bulk: 0,
          search: 0,
        },
        tookMs: 0,
        timedOut: false,
      });
    });
  });
});