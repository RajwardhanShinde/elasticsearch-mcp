import { jest } from '@jest/globals';
import { FetchIndicestool } from '../../../src/tools/fetch-indices.js';
import { ElasticsearchManager } from '../../../src/elasticsearch/client.js';
import { Logger } from '../../../src/logger.js';
import { ValidationError, ElasticsearchError } from '../../../src/errors/handlers.js';
import elasticsearchResponses from '../../fixtures/elasticsearch-responses.json';

// Mock the elasticsearch client
const mockClient = {
  cat: {
    indices: jest.fn(),
  },
  indices: {
    exists: jest.fn(),
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

describe('FetchIndicestool', () => {
  let tool: FetchIndicestool;

  beforeEach(() => {
    tool = new FetchIndicestool(mockElasticsearchManager, mockLogger);
    jest.clearAllMocks();
  });

  describe('execute', () => {
    it('should fetch all indices successfully', async () => {
      mockClient.cat.indices.mockResolvedValue(elasticsearchResponses.catIndices);

      const result = await tool.execute({});

      expect(result).toEqual({
        indices: [
          {
            name: 'test-index-1',
            health: 'green',
            status: 'open',
            docs: 1000,
            size: '10.5mb',
            created: '2022-01-01',
            uuid: 'abc123def456',
          },
          {
            name: 'test-index-2',
            health: 'yellow',
            status: 'open',
            docs: 500,
            size: '5.2mb',
            created: '2022-01-01',
            uuid: 'def456ghi789',
          },
        ],
        total: 2,
      });

      expect(mockClient.cat.indices).toHaveBeenCalledWith({
        index: '*,-.*',
        format: 'json',
        h: 'index,health,status,docs.count,store.size,creation.date,uuid',
        s: 'index:asc',
      });
    });

    it('should include system indices when requested', async () => {
      mockClient.cat.indices.mockResolvedValue(elasticsearchResponses.catIndices);

      await tool.execute({ includeSystemIndices: true });

      expect(mockClient.cat.indices).toHaveBeenCalledWith({
        index: '*',
        format: 'json',
        h: 'index,health,status,docs.count,store.size,creation.date,uuid',
        s: 'index:asc',
      });
    });

    it('should filter by pattern', async () => {
      mockClient.cat.indices.mockResolvedValue([elasticsearchResponses.catIndices[0]]);

      const result = await tool.execute({ pattern: 'test-*' });

      expect(mockClient.cat.indices).toHaveBeenCalledWith({
        index: 'test-*',
        format: 'json',
        h: 'index,health,status,docs.count,store.size,creation.date,uuid',
        s: 'index:asc',
      });

      expect(result.total).toBe(1);
      expect(result.indices[0].name).toBe('test-index-1');
    });

    it('should sort by size', async () => {
      mockClient.cat.indices.mockResolvedValue(elasticsearchResponses.catIndices);

      await tool.execute({ sortBy: 'size' });

      expect(mockClient.cat.indices).toHaveBeenCalledWith({
        index: '*,-.*',
        format: 'json',
        h: 'index,health,status,docs.count,store.size,creation.date,uuid',
        s: 'store.size:desc',
      });
    });

    it('should sort by docs', async () => {
      mockClient.cat.indices.mockResolvedValue(elasticsearchResponses.catIndices);

      await tool.execute({ sortBy: 'docs' });

      expect(mockClient.cat.indices).toHaveBeenCalledWith({
        index: '*,-.*',
        format: 'json',
        h: 'index,health,status,docs.count,store.size,creation.date,uuid',
        s: 'docs.count:desc',
      });
    });

    it('should handle invalid arguments', async () => {
      await expect(tool.execute({ sortBy: 'invalid' })).rejects.toThrow(ValidationError);
    });

    it('should handle elasticsearch errors', async () => {
      const error = new Error('Connection failed');
      mockClient.cat.indices.mockRejectedValue(error);

      await expect(tool.execute({})).rejects.toThrow(ElasticsearchError);
    });

    it('should filter out system indices by default', async () => {
      mockClient.cat.indices.mockResolvedValue(elasticsearchResponses.catIndices);

      const result = await tool.execute({});

      // Should not include .system-index
      expect(result.indices).toHaveLength(2);
      expect(result.indices.every(index => !index.name.startsWith('.'))).toBe(true);
    });

    it('should handle empty results', async () => {
      mockClient.cat.indices.mockResolvedValue([]);

      const result = await tool.execute({});

      expect(result).toEqual({
        indices: [],
        total: 0,
      });
    });

    it('should handle malformed timestamp', async () => {
      const malformedResponse = [
        {
          ...elasticsearchResponses.catIndices[0],
          'creation.date': 'invalid-timestamp',
        },
      ];
      mockClient.cat.indices.mockResolvedValue(malformedResponse);

      const result = await tool.execute({});

      expect(result.indices[0].created).toBe('unknown');
    });

    it('should handle missing fields gracefully', async () => {
      const incompleteResponse = [
        {
          index: 'incomplete-index',
          // Missing other fields
        },
      ];
      mockClient.cat.indices.mockResolvedValue(incompleteResponse);

      const result = await tool.execute({});

      expect(result.indices[0]).toEqual({
        name: 'incomplete-index',
        health: 'unknown',
        status: 'unknown',
        docs: 0,
        size: '0b',
        created: 'unknown',
        uuid: '',
      });
    });
  });
});