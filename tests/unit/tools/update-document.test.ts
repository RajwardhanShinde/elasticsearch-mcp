import { jest } from '@jest/globals';
import { UpdateDocumentTool } from '../../../src/tools/update-document.js';
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
  update: jest.fn(),
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

describe('UpdateDocumentTool', () => {
  let tool: UpdateDocumentTool;

  beforeEach(() => {
    tool = new UpdateDocumentTool(mockElasticsearchManager, mockLogger);
    jest.clearAllMocks();
  });

  describe('execute', () => {
    it('should update document with partial document', async () => {
      mockClient.indices.exists.mockResolvedValue(true);
      mockClient.update.mockResolvedValue(elasticsearchResponses.documentUpdateResponse);

      const updateData = { title: 'Updated Title' };

      const result = await tool.execute({
        index: 'test-index',
        id: 'doc123',
        document: updateData,
      });

      expect(result).toEqual({
        _id: 'doc123',
        _index: 'test-index',
        _version: 2,
        result: 'updated',
      });

      expect(mockClient.update).toHaveBeenCalledWith({
        index: 'test-index',
        id: 'doc123',
        body: {
          doc: updateData,
        },
        refresh: false,
        retry_on_conflict: 3,
      });
    });

    it('should update document with script', async () => {
      mockClient.indices.exists.mockResolvedValue(true);
      mockClient.update.mockResolvedValue(elasticsearchResponses.documentUpdateResponse);

      const script = {
        source: 'ctx._source.counter += params.increment',
        params: { increment: 1 },
      };

      await tool.execute({
        index: 'test-index',
        id: 'doc123',
        script,
      });

      expect(mockClient.update).toHaveBeenCalledWith({
        index: 'test-index',
        id: 'doc123',
        body: {
          script: {
            source: script.source,
            params: script.params,
            lang: 'painless',
          },
        },
        refresh: false,
        retry_on_conflict: 3,
      });
    });

    it('should handle upsert with document', async () => {
      mockClient.indices.exists.mockResolvedValue(true);
      mockClient.update.mockResolvedValue({
        ...elasticsearchResponses.documentUpdateResponse,
        result: 'created',
      });

      const updateData = { title: 'New Title' };

      await tool.execute({
        index: 'test-index',
        id: 'new-doc',
        document: updateData,
        upsert: true,
      });

      expect(mockClient.update).toHaveBeenCalledWith({
        index: 'test-index',
        id: 'new-doc',
        body: {
          doc: updateData,
          doc_as_upsert: true,
        },
        refresh: false,
        retry_on_conflict: 3,
      });
    });

    it('should handle upsert with script and document', async () => {
      mockClient.indices.exists.mockResolvedValue(true);
      mockClient.update.mockResolvedValue(elasticsearchResponses.documentUpdateResponse);

      const script = { source: 'ctx._source.counter += 1' };
      const upsertDoc = { counter: 1 };

      await tool.execute({
        index: 'test-index',
        id: 'doc123',
        script,
        document: upsertDoc,
        upsert: true,
      });

      expect(mockClient.update).toHaveBeenCalledWith({
        index: 'test-index',
        id: 'doc123',
        body: {
          script: {
            source: script.source,
            lang: 'painless',
          },
          upsert: upsertDoc,
        },
        refresh: false,
        retry_on_conflict: 3,
      });
    });

    it('should handle refresh parameter', async () => {
      mockClient.indices.exists.mockResolvedValue(true);
      mockClient.update.mockResolvedValue(elasticsearchResponses.documentUpdateResponse);

      await tool.execute({
        index: 'test-index',
        id: 'doc123',
        document: { title: 'Test' },
        refresh: 'wait_for',
      });

      expect(mockClient.update).toHaveBeenCalledWith(
        expect.objectContaining({
          refresh: 'wait_for',
        })
      );
    });

    it('should throw error if index does not exist', async () => {
      mockClient.indices.exists.mockResolvedValue(false);

      await expect(tool.execute({
        index: 'non-existent-index',
        id: 'doc123',
        document: { title: 'Test' },
      })).rejects.toThrow(NotFoundError);
      await expect(tool.execute({
        index: 'non-existent-index',
        id: 'doc123',
        document: { title: 'Test' },
      })).rejects.toThrow("Index 'non-existent-index' does not exist");
    });

    it('should validate empty document', async () => {
      await expect(tool.execute({
        index: 'test-index',
        id: 'doc123',
        document: {},
      })).rejects.toThrow(ValidationError);
      await expect(tool.execute({
        index: 'test-index',
        id: 'doc123',
        document: {},
      })).rejects.toThrow('Update document cannot be empty');
    });

    it('should validate field names starting with underscore', async () => {
      await expect(tool.execute({
        index: 'test-index',
        id: 'doc123',
        document: {
          _reserved: 'value',
        },
      })).rejects.toThrow(ValidationError);
      await expect(tool.execute({
        index: 'test-index',
        id: 'doc123',
        document: {
          _reserved: 'value',
        },
      })).rejects.toThrow('cannot start with underscore');
    });

    it('should validate script source', async () => {
      await expect(tool.execute({
        index: 'test-index',
        id: 'doc123',
        script: {
          source: '',
        },
      })).rejects.toThrow(ValidationError);
      await expect(tool.execute({
        index: 'test-index',
        id: 'doc123',
        script: {
          source: '',
        },
      })).rejects.toThrow('Script source cannot be empty');
    });

    it('should validate dangerous script content', async () => {
      await expect(tool.execute({
        index: 'test-index',
        id: 'doc123',
        script: {
          source: 'System.exit(0)',
        },
      })).rejects.toThrow(ValidationError);
      await expect(tool.execute({
        index: 'test-index',
        id: 'doc123',
        script: {
          source: 'System.exit(0)',
        },
      })).rejects.toThrow('contains potentially dangerous code');
    });

    it('should validate script parameters', async () => {
      // Too many parameters
      const manyParams: Record<string, unknown> = {};
      for (let i = 0; i < 60; i++) {
        manyParams[`param${i}`] = 'value';
      }

      await expect(tool.execute({
        index: 'test-index',
        id: 'doc123',
        script: {
          source: 'ctx._source.field = params.param1',
          params: manyParams,
        },
      })).rejects.toThrow(ValidationError);
      await expect(tool.execute({
        index: 'test-index',
        id: 'doc123',
        script: {
          source: 'ctx._source.field = params.param1',
          params: manyParams,
        },
      })).rejects.toThrow('Too many script parameters');
    });

    it('should validate script parameter names', async () => {
      await expect(tool.execute({
        index: 'test-index',
        id: 'doc123',
        script: {
          source: 'ctx._source.field = params.param1',
          params: {
            '123invalid': 'value', // Invalid parameter name
          },
        },
      })).rejects.toThrow(ValidationError);
      await expect(tool.execute({
        index: 'test-index',
        id: 'doc123',
        script: {
          source: 'ctx._source.field = params.param1',
          params: {
            '123invalid': 'value',
          },
        },
      })).rejects.toThrow('Invalid parameter name');
    });

    it('should validate script parameter value size', async () => {
      const largeValue = 'x'.repeat(2 * 1024 * 1024); // 2MB

      await expect(tool.execute({
        index: 'test-index',
        id: 'doc123',
        script: {
          source: 'ctx._source.field = params.large',
          params: {
            large: largeValue,
          },
        },
      })).rejects.toThrow(ValidationError);
      await expect(tool.execute({
        index: 'test-index',
        id: 'doc123',
        script: {
          source: 'ctx._source.field = params.large',
          params: {
            large: largeValue,
          },
        },
      })).rejects.toThrow('exceeds 1MB limit');
    });

    it('should handle document missing exception', async () => {
      mockClient.indices.exists.mockResolvedValue(true);
      const error = new Error('document_missing_exception');
      mockClient.update.mockRejectedValue(error);

      await expect(tool.execute({
        index: 'test-index',
        id: 'non-existent-doc',
        document: { title: 'Test' },
      })).rejects.toThrow(NotFoundError);
      await expect(tool.execute({
        index: 'test-index',
        id: 'non-existent-doc',
        document: { title: 'Test' },
      })).rejects.toThrow("Document with ID 'non-existent-doc' not found");
    });

    it('should handle version conflict', async () => {
      mockClient.indices.exists.mockResolvedValue(true);
      const error = new Error('version_conflict_engine_exception');
      mockClient.update.mockRejectedValue(error);

      await expect(tool.execute({
        index: 'test-index',
        id: 'doc123',
        document: { title: 'Test' },
      })).rejects.toThrow(ValidationError);
      await expect(tool.execute({
        index: 'test-index',
        id: 'doc123',
        document: { title: 'Test' },
      })).rejects.toThrow('Document was modified by another process');
    });

    it('should handle elasticsearch errors', async () => {
      mockClient.indices.exists.mockResolvedValue(true);
      const error = new Error('Update operation failed');
      mockClient.update.mockRejectedValue(error);

      await expect(tool.execute({
        index: 'test-index',
        id: 'doc123',
        document: { title: 'Test' },
      })).rejects.toThrow(ElasticsearchError);
    });

    it('should handle invalid arguments', async () => {
      await expect(tool.execute({
        index: 'test-index',
        id: 'doc123',
        // Missing both document and script
      })).rejects.toThrow(ValidationError);

      await expect(tool.execute({
        index: 'test-index',
        // Missing id
        document: { title: 'Test' },
      })).rejects.toThrow(ValidationError);

      await expect(tool.execute({
        // Missing index
        id: 'doc123',
        document: { title: 'Test' },
      })).rejects.toThrow(ValidationError);
    });

    it('should normalize refresh parameter correctly', async () => {
      mockClient.indices.exists.mockResolvedValue(true);
      mockClient.update.mockResolvedValue(elasticsearchResponses.documentUpdateResponse);

      // Test 'true' string
      await tool.execute({
        index: 'test-index',
        id: 'doc123',
        document: { title: 'Test' },
        refresh: 'true',
      });

      expect(mockClient.update).toHaveBeenCalledWith(
        expect.objectContaining({ refresh: true })
      );

      // Test 'false' string
      await tool.execute({
        index: 'test-index',
        id: 'doc123',
        document: { title: 'Test' },
        refresh: 'false',
      });

      expect(mockClient.update).toHaveBeenCalledWith(
        expect.objectContaining({ refresh: false })
      );
    });

    it('should handle valid script with parameters', async () => {
      mockClient.indices.exists.mockResolvedValue(true);
      mockClient.update.mockResolvedValue(elasticsearchResponses.documentUpdateResponse);

      const script = {
        source: 'ctx._source.counter += params.increment; ctx._source.updated = params.timestamp',
        params: {
          increment: 5,
          timestamp: '2023-01-01T00:00:00Z',
        },
      };

      const result = await tool.execute({
        index: 'test-index',
        id: 'doc123',
        script,
      });

      expect(result.result).toBe('updated');
      expect(mockClient.update).toHaveBeenCalledWith({
        index: 'test-index',
        id: 'doc123',
        body: {
          script: {
            source: script.source,
            params: script.params,
            lang: 'painless',
          },
        },
        refresh: false,
        retry_on_conflict: 3,
      });
    });
  });
});