import { Logger } from '../logger.js';

export class ElasticMCPError extends Error {
  public readonly code: string;
  public readonly statusCode: number;
  public readonly context: Record<string, unknown> | undefined;

  constructor(
    message: string,
    code: string,
    statusCode: number = 500,
    context?: Record<string, unknown>
  ) {
    super(message);
    this.name = 'ElasticMCPError';
    this.code = code;
    this.statusCode = statusCode;
    this.context = context;
    
    Error.captureStackTrace(this, ElasticMCPError);
  }
}

export class ValidationError extends ElasticMCPError {
  constructor(message: string, context?: Record<string, unknown>) {
    super(message, 'VALIDATION_ERROR', 400, context);
    this.name = 'ValidationError';
  }
}

export class ConnectionError extends ElasticMCPError {
  constructor(message: string, context?: Record<string, unknown>) {
    super(message, 'CONNECTION_ERROR', 503, context);
    this.name = 'ConnectionError';
  }
}

export class AuthenticationError extends ElasticMCPError {
  constructor(message: string, context?: Record<string, unknown>) {
    super(message, 'AUTHENTICATION_ERROR', 401, context);
    this.name = 'AuthenticationError';
  }
}

export class NotFoundError extends ElasticMCPError {
  constructor(message: string, context?: Record<string, unknown>) {
    super(message, 'NOT_FOUND', 404, context);
    this.name = 'NotFoundError';
  }
}

export class RateLimitError extends ElasticMCPError {
  constructor(message: string, context?: Record<string, unknown>) {
    super(message, 'RATE_LIMIT_EXCEEDED', 429, context);
    this.name = 'RateLimitError';
  }
}

export class ElasticsearchError extends ElasticMCPError {
  constructor(message: string, originalError?: Error, context?: Record<string, unknown>) {
    super(message, 'ELASTICSEARCH_ERROR', 500, {
      ...context,
      originalError: originalError ? {
        name: originalError.name,
        message: originalError.message,
      } : undefined,
    });
    this.name = 'ElasticsearchError';
  }
}

export interface ErrorResponse {
  error: {
    code: string;
    message: string;
    statusCode: number;
    context: Record<string, unknown> | undefined;
    timestamp: string;
    requestId: string | undefined;
  };
}

export class ErrorHandler {
  private logger: Logger;

  constructor(logger: Logger) {
    this.logger = logger.child({ component: 'error-handler' });
  }

  handleError(error: unknown, requestId?: string): ErrorResponse {
    if (error instanceof ElasticMCPError) {
      this.logger.warn('Handled error occurred', {
        code: error.code,
        message: error.message,
        statusCode: error.statusCode,
        context: error.context,
        requestId,
      });

      return {
        error: {
          code: error.code,
          message: error.message,
          statusCode: error.statusCode,
          context: error.context,
          timestamp: new Date().toISOString(),
          requestId,
        },
      };
    }

    if (error instanceof Error) {
      this.logger.error('Unhandled error occurred', {
        name: error.name,
        message: error.message,
        stack: error.stack,
        requestId,
      }, error);

      return {
        error: {
          code: 'INTERNAL_ERROR',
          message: 'An unexpected error occurred',
          statusCode: 500,
          context: undefined,
          timestamp: new Date().toISOString(),
          requestId,
        },
      };
    }

    this.logger.error('Unknown error occurred', {
      error: String(error),
      requestId,
    });

    return {
      error: {
        code: 'UNKNOWN_ERROR',
        message: 'An unknown error occurred',
        statusCode: 500,
        context: undefined,
        timestamp: new Date().toISOString(),
        requestId,
      },
    };
  }

  isRetryableError(error: unknown): boolean {
    if (error instanceof ConnectionError) {
      return true;
    }

    if (error instanceof ElasticsearchError) {
      return true;
    }

    if (error instanceof Error) {
      const message = error.message.toLowerCase();
      return (
        message.includes('timeout') ||
        message.includes('connection') ||
        message.includes('network') ||
        message.includes('503') ||
        message.includes('502') ||
        message.includes('504')
      );
    }

    return false;
  }

  sanitizeError(error: ErrorResponse): ErrorResponse {
    const sanitized = { ...error };
    
    if (sanitized.error.context) {
      const context = { ...sanitized.error.context };
      
      const sensitiveKeys = [
        'password',
        'apiKey',
        'token',
        'secret',
        'auth',
        'authorization',
        'credential',
      ];

      for (const key of Object.keys(context)) {
        if (sensitiveKeys.some(sensitive => key.toLowerCase().includes(sensitive))) {
          context[key] = '***';
        }
      }
      
      sanitized.error.context = context;
    }

    return sanitized;
  }
}