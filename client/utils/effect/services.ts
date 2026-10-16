/**
 * Module: client/utils/effect/services
 * Intent: Effect 4.0 context services (v4 class style) for deep exception handling.
 * Responsibilities:
 *  - Logger + AppConfig as Context.Service classes (never Context.Tag).
 *  - Layer memoization-safe Live layers for Effect.provide.
 */

import { Context, Layer } from 'effect';

export interface LoggerShape {
  readonly info: (message: string, extra?: Record<string, unknown>) => void;
  readonly warn: (message: string, extra?: Record<string, unknown>) => void;
  readonly error: (message: string, extra?: Record<string, unknown>) => void;
}

export class Logger extends Context.Service<Logger, LoggerShape>()('Vela/Logger') {}

export const LoggerLive = Layer.succeed(Logger, {
  info: (message, extra) => console.log(`[vela] ${message}`, extra ?? ''),
  warn: (message, extra) => console.warn(`[vela] ${message}`, extra ?? ''),
  error: (message, extra) => console.error(`[vela] ${message}`, extra ?? ''),
});

export interface AppConfigShape {
  readonly apiUrl: string;
  readonly apiKey: string;
  readonly timeoutMs: number;
  readonly agent: string;
}

export class AppConfig extends Context.Service<AppConfig, AppConfigShape>()('Vela/AppConfig') {}

export const DEFAULT_TIMEOUT_MS = 90000;

export const AppConfigLive = Layer.succeed(AppConfig, {
  apiUrl: '',
  apiKey: '',
  timeoutMs: DEFAULT_TIMEOUT_MS,
  agent: 'personal assistant',
});

export const makeAppConfigLayer = (config: Partial<AppConfigShape>) =>
  Layer.succeed(AppConfig, {
    apiUrl: config.apiUrl ?? '',
    apiKey: config.apiKey ?? '',
    timeoutMs: config.timeoutMs ?? DEFAULT_TIMEOUT_MS,
    agent: config.agent ?? 'personal assistant',
  });
