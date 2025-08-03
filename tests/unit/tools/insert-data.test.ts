import { jest } from '@jest/globals';
import { InsertDataTool } from '../../../src/tools/insert-data.js';
import { ElasticsearchManager } from '../../../src/elasticsearch/client.js';
import { Logger } from '../../../src/logger.js';
import { ValidationError, ElasticsearchError } from '../../../src/errors/handlers.js';
import elasticsearchResponses from '../../fixtures/elasticsearch-responses.json';
import sampleData from '../../fixtures/sample-data.json';

// Mock the elasticsearch client
const mockClient = {
  indices: {
    exists: jest.fn(),
  },
  index: jest.fn(),
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

describe('InsertDataTool', () => {
  let tool: InsertDataTool;

  beforeEach(() => {
    tool = new InsertDataTool(mockElasticsearchManager, mockLogger);
    jest.clearAllMocks();
  });

  describe('execute', () => {
    it('should insert document successfully', async () => {
      mockClient.indices.exists.mockResolvedValue(true);
      mockClient.index.mockResolvedValue(elasticsearchResponses.documentIndexResponse);

      const result = await tool.execute({
        index: 'test-index',
        document: sampleData.sampleDocuments[0],
      });

      expect(result).toEqual({
        _id: 'doc123',
        _index: 'test-index',
        _version: 1,
        result: 'created',
      });

      expect(mockClient.index).toHaveBeenCalledWith({
        index: 'test-index',
        body: sampleData.sampleDocuments[0],
        refresh: false,
      });
    });

    it('should insert document with specific ID', async () => {
      mockClient.indices.exists.mockResolvedValue(true);
      mockClient.index.mockResolvedValue(elasticsearchResponses.documentIndexResponse);

      await tool.execute({
        index: 'test-index',
        document: sampleData.sampleDocuments[0],
        id: 'custom-id',
      });

      expect(mockClient.index).toHaveBeenCalledWith({
        index: 'test-index',
        body: sampleData.sampleDocuments[0],
        id: 'custom-id',
        refresh: false,
      });
    });

    it('should handle refresh parameter', async () => {
      mockClient.indices.exists.mockResolvedValue(true);
      mockClient.index.mockResolvedValue(elasticsearchResponses.documentIndexResponse);

      // Test boolean true
      await tool.execute({
        index: 'test-index',
        document: sampleData.sampleDocuments[0],
        refresh: true,
      });

      expect(mockClient.index).toHaveBeenCalledWith({
        index: 'test-index',
        body: sampleData.sampleDocuments[0],
        refresh: true,
      });

      // Test 'wait_for'
      await tool.execute({
        index: 'test-index',
        document: sampleData.sampleDocuments[0],
        refresh: 'wait_for',
      });

      expect(mockClient.index).toHaveBeenCalledWith({
        index: 'test-index',
        body: sampleData.sampleDocuments[0],
        refresh: 'wait_for',
      });
    });

    it('should warn when index does not exist', async () => {
      mockClient.indices.exists.mockResolvedValue(false);
      mockClient.index.mockResolvedValue(elasticsearchResponses.documentIndexResponse);

      await tool.execute({
        index: 'non-existent-index',
        document: sampleData.sampleDocuments[0],
      });

      expect(mockLogger.warn).toHaveBeenCalledWith(
        'Index does not exist, it will be created automatically',
        { index: 'non-existent-index' }
      );
    });

    it('should validate empty document', async () => {
      await expect(tool.execute({
        index: 'test-index',
        document: {},
      })).rejects.toThrow(ValidationError);
      await expect(tool.execute({
        index: 'test-index',
        document: {},
      })).rejects.toThrow('Document cannot be empty');
    });

    it('should validate field names starting with underscore', async () => {
      await expect(tool.execute({
        index: 'test-index',
        document: {
          _reserved: 'value',
          normal: 'value',
        },
      })).rejects.toThrow(ValidationError);
      await expect(tool.execute({
        index: 'test-index',
        document: {
          _reserved: 'value',
          normal: 'value',
        },
      })).rejects.toThrow('cannot start with underscore');
    });

    it('should validate field names with dots', async () => {
      await expect(tool.execute({
        index: 'test-index',
        document: {
          'field..invalid': 'value',
        },
      })).rejects.toThrow(ValidationError);

      await expect(tool.execute({
        index: 'test-index',
        document: {
          '.invalid': 'value',
        },
      })).rejects.toThrow(ValidationError);
    });

    it('should validate field name length', async () => {
      const longFieldName = 'a'.repeat(300);
      
      await expect(tool.execute({
        index: 'test-index',
        document: {
          [longFieldName]: 'value',
        },
      })).rejects.toThrow(ValidationError);
      await expect(tool.execute({
        index: 'test-index',
        document: {
          [longFieldName]: 'value',
        },
      })).rejects.toThrow('exceeds maximum length');
    });

    it('should validate document size', async () => {
      // Create a very large document
      const largeDocument: Record<string, string> = {};
      for (let i = 0; i < 10000; i++) {
        largeDocument[`field${i}`] = 'x'.repeat(10000);
      }

      await expect(tool.execute({
        index: 'test-index',
        document: largeDocument,
      })).rejects.toThrow(ValidationError);
      await expect(tool.execute({
        index: 'test-index',
        document: largeDocument,
      })).rejects.toThrow('exceeds 100MB limit');
    });

    it('should validate nesting depth', async () => {
      // Create deeply nested object
      let nestedObject: any = { value: 'deep' };
      for (let i = 0; i < 25; i++) {
        nestedObject = { nested: nestedObject };
      }

      await expect(tool.execute({
        index: 'test-index',
        document: { deepNest: nestedObject },
      })).rejects.toThrow(ValidationError);
      await expect(tool.execute({
        index: 'test-index',
        document: { deepNest: nestedObject },
      })).rejects.toThrow('exceeds maximum depth');
    });

    it('should validate array size', async () => {
      const largeArray = new Array(15000).fill('item');

      await expect(tool.execute({
        index: 'test-index',
        document: {
          largeArray,
        },
      })).rejects.toThrow(ValidationError);
      await expect(tool.execute({
        index: 'test-index',
        document: {
          largeArray,
        },
      })).rejects.toThrow('too many elements');
    });

    it('should validate string field length', async () => {
      const veryLongString = 'x'.repeat(2 * 1024 * 1024); // 2MB

      await expect(tool.execute({
        index: 'test-index',
        document: {
          longString: veryLongString,
        },
      })).rejects.toThrow(ValidationError);
      await expect(tool.execute({
        index: 'test-index',
        document: {
          longString: veryLongString,
        },
      })).rejects.toThrow('exceeds maximum length');
    });

    it('should handle valid dot notation fields', async () => {
      mockClient.indices.exists.mockResolvedValue(true);
      mockClient.index.mockResolvedValue(elasticsearchResponses.documentIndexResponse);

      const validDocument = {
        'metadata.author': 'Test Author',
        'settings.theme': 'dark',
      };

      const result = await tool.execute({
        index: 'test-index',
        document: validDocument,
      });

      expect(result.result).toBe('created');
    });

    it('should handle elasticsearch errors', async () => {
      mockClient.indices.exists.mockResolvedValue(true);
      const error = new Error('Index operation failed');
      mockClient.index.mockRejectedValue(error);

      await expect(tool.execute({
        index: 'test-index',
        document: sampleData.sampleDocuments[0],
      })).rejects.toThrow(ElasticsearchError);
    });

    it('should handle invalid arguments', async () => {
      await expect(tool.execute({
        index: 'test-index',
        // Missing document
      })).rejects.toThrow(ValidationError);

      await expect(tool.execute({
        // Missing index
        document: sampleData.sampleDocuments[0],
      })).rejects.toThrow(ValidationError);
    });

    it('should normalize refresh parameter correctly', async () => {
      mockClient.indices.exists.mockResolvedValue(true);
      mockClient.index.mockResolvedValue(elasticsearchResponses.documentIndexResponse);

      // Test 'false' string
      await tool.execute({
        index: 'test-index',
        document: sampleData.sampleDocuments[0],
        refresh: 'false',
      });

      expect(mockClient.index).toHaveBeenCalledWith(
        expect.objectContaining({ refresh: false })
      );

      // Test 'true' string
      await tool.execute({
        index: 'test-index',
        document: sampleData.sampleDocuments[0],
        refresh: 'true',
      });

      expect(mockClient.index).toHaveBeenCalledWith(
        expect.objectContaining({ refresh: true })
      );
    });
  });
});