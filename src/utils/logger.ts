import winston from 'winston';
import { getContext } from './request-context.js';

const isProduction = process.env.NODE_ENV === 'production';

const _logger = winston.createLogger({
  level: process.env.OPENCLAW_LOG_LEVEL ?? 'info',
  format: isProduction
    ? winston.format.combine(
        winston.format.timestamp(),
        winston.format.errors({ stack: true }),
        winston.format.json(),
      )
    : winston.format.combine(
        winston.format.colorize(),
        winston.format.timestamp({ format: 'HH:mm:ss' }),
        winston.format.printf(({ level, message, timestamp, ...meta }) => {
          const metaStr = Object.keys(meta).length ? ' ' + JSON.stringify(meta) : '';
          return `${timestamp} [${level}] ${message}${metaStr}`;
        }),
      ),
  transports: [new winston.transports.Console()],
});

function makeLogMethod(level: 'info' | 'warn' | 'error' | 'debug') {
  return (message: string, meta?: Record<string, unknown>) => {
    const ctx = getContext();
    _logger[level](message, {
      requestId: ctx.requestId,
      ...(ctx.tenantId ? { tenantId: ctx.tenantId } : {}),
      ...meta,
    });
  };
}

export const log = {
  info:  makeLogMethod('info'),
  warn:  makeLogMethod('warn'),
  error: makeLogMethod('error'),
  debug: makeLogMethod('debug'),
};

export default log;
