import { jest } from '@jest/globals';
import { CreateIndexTool } from '../../../src/tools/create-index.js';
import { ElasticsearchManager } from '../../../src/elasticsearch/client.js';
import { Logger } from '../../../src/logger.js';
import { ValidationError, ElasticsearchError } from '../../../src/errors/handlers.js';
import elasticsearchResponses from '../../fixtures/elasticsearch-responses.json';
import sampleData from '../../fixtures/sample-data.json';

// Mock the elasticsearch client
const mockClient = {
  indices: {
    exists: jest.fn(),
    create: jest.fn(),
  },
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

describe('CreateIndexTool', () => {
  let tool: CreateIndexTool;

  beforeEach(() => {
    tool = new CreateIndexTool(mockElasticsearchManager, mockLogger);
    jest.clearAllMocks();
  });

  describe('execute', () => {
    it('should create index successfully', async () => {
      mockClient.indices.exists.mockResolvedValue(false);
      mockClient.indices.create.mockResolvedValue(elasticsearchResponses.indexCreateResponse);

      const result = await tool.execute({
        name: 'test-index',
      });

      expect(result).toEqual({
        acknowledged: true,
        index: 'test-index',
        shardsAcknowledged: true,
      });

      expect(mockClient.indices.exists).toHaveBeenCalledWith({
        index: 'test-index',
      });

      expect(mockClient.indices.create).toHaveBeenCalledWith({
        index: 'test-index',
        body: {},
      });
    });

    it('should create index with mappings and settings', async () => {
      mockClient.indices.exists.mockResolvedValue(false);
      mockClient.indices.create.mockResolvedValue(elasticsearchResponses.indexCreateResponse);

      const result = await tool.execute({
        name: 'test-index',
        mappings: sampleData.sampleMappings,
        settings: sampleData.sampleSettings,
      });

      expect(result.acknowledged).toBe(true);

      expect(mockClient.indices.create).toHaveBeenCalledWith({
        index: 'test-index',
        body: {
          mappings: sampleData.sampleMappings,
          settings: sampleData.sampleSettings,
        },
      });
    });

    it('should create index with aliases', async () => {
      mockClient.indices.exists.mockResolvedValue(false);
      mockClient.indices.create.mockResolvedValue(elasticsearchResponses.indexCreateResponse);

      await tool.execute({
        name: 'test-index',
        aliases: ['alias1', 'alias2'],
      });

      expect(mockClient.indices.create).toHaveBeenCalledWith({
        index: 'test-index',
        body: {
          aliases: {
            alias1: {},
            alias2: {},
          },
        },
      });
    });

    it('should throw error if index already exists', async () => {
      mockClient.indices.exists.mockResolvedValue(true);

      await expect(tool.execute({
        name: 'existing-index',
      })).rejects.toThrow(ValidationError);
      await expect(tool.execute({
        name: 'existing-index',
      })).rejects.toThrow("Index 'existing-index' already exists");

      expect(mockClient.indices.create).not.toHaveBeenCalled();
    });

    it('should validate invalid index name', async () => {
      await expect(tool.execute({
        name: 'INVALID-NAME',
      })).rejects.toThrow(ValidationError);

      await expect(tool.execute({
        name: '',
      })).rejects.toThrow(ValidationError);

      await expect(tool.execute({
        name: 'index with spaces',
      })).rejects.toThrow(ValidationError);
    });

    it('should validate mappings', async () => {
      mockClient.indices.exists.mockResolvedValue(false);

      await expect(tool.execute({
        name: 'test-index',
        mappings: 'invalid-mappings' as any,
      })).rejects.toThrow(ValidationError);

      await expect(tool.execute({
        name: 'test-index',
        mappings: {
          properties: 'invalid-properties' as any,
        },
      })).rejects.toThrow(ValidationError);
    });

    it('should validate field types in mappings', async () => {
      mockClient.indices.exists.mockResolvedValue(false);

      await expect(tool.execute({
        name: 'test-index',
        mappings: {
          properties: {
            field1: {
              type: 'invalid-type',
            },
          },
        },
      })).rejects.toThrow(ValidationError);
    });

    it('should validate settings', async () => {
      mockClient.indices.exists.mockResolvedValue(false);

      await expect(tool.execute({
        name: 'test-index',
        settings: {
          number_of_shards: 0, // Invalid
        },
      })).rejects.toThrow(ValidationError);

      await expect(tool.execute({
        name: 'test-index',
        settings: {
          number_of_replicas: -1, // Invalid
        },
      })).rejects.toThrow(ValidationError);
    });

    it('should validate aliases', async () => {
      mockClient.indices.exists.mockResolvedValue(false);

      await expect(tool.execute({
        name: 'test-index',
        aliases: ['', 'valid-alias'], // Empty alias
      })).rejects.toThrow(ValidationError);

      await expect(tool.execute({
        name: 'test-index',
        aliases: ['alias with spaces'], // Invalid alias
      })).rejects.toThrow(ValidationError);
    });

    it('should handle elasticsearch errors', async () => {
      mockClient.indices.exists.mockResolvedValue(false);
      const error = new Error('Index creation failed');
      mockClient.indices.create.mockRejectedValue(error);

      await expect(tool.execute({
        name: 'test-index',
      })).rejects.toThrow(ElasticsearchError);
    });

    it('should handle invalid arguments', async () => {
      await expect(tool.execute({
        // Missing name
      })).rejects.toThrow(ValidationError);

      await expect(tool.execute({
        name: 'test',
        mappings: null as any,
      })).rejects.toThrow(ValidationError);
    });

    it('should validate nested mapping properties', async () => {
      mockClient.indices.exists.mockResolvedValue(false);

      await expect(tool.execute({
        name: 'test-index',
        mappings: {
          properties: {
            nested_field: {
              properties: {
                invalid_nested: {
                  type: 'invalid-nested-type',
                },
              },
            },
          },
        },
      })).rejects.toThrow(ValidationError);
    });

    it('should handle valid complex mappings', async () => {
      mockClient.indices.exists.mockResolvedValue(false);
      mockClient.indices.create.mockResolvedValue(elasticsearchResponses.indexCreateResponse);

      const complexMappings = {
        properties: {
          text_field: { type: 'text' },
          keyword_field: { type: 'keyword' },
          date_field: { type: 'date' },
          nested_object: {
            properties: {
              inner_text: { type: 'text' },
              inner_keyword: { type: 'keyword' },
            },
          },
        },
      };

      const result = await tool.execute({
        name: 'complex-index',
        mappings: complexMappings,
      });

      expect(result.acknowledged).toBe(true);
      expect(mockClient.indices.create).toHaveBeenCalledWith({
        index: 'complex-index',
        body: {
          mappings: complexMappings,
        },
      });
    });
  });
});