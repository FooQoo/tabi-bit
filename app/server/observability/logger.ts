import * as Sentry from "@sentry/react-router";
import {
  pino,
  stdSerializers,
  stdTimeFunctions,
  type Logger as PinoLogger,
} from "pino";

export type LogContext = Record<string, unknown>;

const isProd = process.env.NODE_ENV === "production";

const basePino: PinoLogger = pino({
  level: process.env.LOG_LEVEL ?? (isProd ? "info" : "debug"),
  base: undefined,
  timestamp: stdTimeFunctions.isoTime,
  formatters: {
    level: (label) => ({ level: label }),
  },
  serializers: { err: stdSerializers.err },
  ...(isProd
    ? {}
    : {
        transport: {
          target: "pino-pretty",
          options: {
            colorize: true,
            translateTime: "HH:MM:ss.l",
            ignore: "pid,hostname",
            messageFormat: "{type}{if msg} — {msg}{end}",
            singleLine: false,
            levelFirst: false,
          },
        },
      }),
});

function toContext(
  errorOrCtx: unknown,
  extra: LogContext | undefined,
): LogContext {
  if (errorOrCtx instanceof Error || typeof errorOrCtx === "string") {
    return { err: errorOrCtx, ...(extra ?? {}) };
  }
  return { ...((errorOrCtx as LogContext | undefined) ?? {}), ...(extra ?? {}) };
}

export type Logger = {
  debug: (type: string, msg?: string, ctx?: LogContext) => void;
  info: (type: string, msg?: string, ctx?: LogContext) => void;
  warn: (type: string, msg?: string, ctx?: LogContext) => void;
  error: (
    type: string,
    msg: string | undefined,
    errorOrCtx?: unknown,
    extra?: LogContext,
  ) => void;
  child: (ctx: LogContext) => Logger;
};

function captureToSentry(
  type: string,
  msg: string | undefined,
  errorOrCtx: unknown,
  extra: LogContext | undefined,
): void {
  const error = errorOrCtx instanceof Error ? errorOrCtx : undefined;
  const ctx = toContext(errorOrCtx, extra);
  Sentry.withScope((scope) => {
    scope.setTag("log.type", type);
    scope.setContext("log", { type, msg, ...ctx });
    if (error) {
      Sentry.captureException(error);
    } else {
      Sentry.captureMessage(msg ?? type, "error");
    }
  });
}

type SentryLogLevel = "info" | "warn" | "error";

function shipToSentryLogs(
  level: SentryLogLevel,
  type: string,
  msg: string | undefined,
  ctx: LogContext,
): void {
  Sentry.logger[level](msg ?? type, { type, ...ctx });
}

function wrap(p: PinoLogger): Logger {
  return {
    debug: (type, msg, ctx) => p.debug({ type, ...(ctx ?? {}) }, msg),
    info: (type, msg, ctx) => {
      p.info({ type, ...(ctx ?? {}) }, msg);
      shipToSentryLogs("info", type, msg, ctx ?? {});
    },
    warn: (type, msg, ctx) => {
      p.warn({ type, ...(ctx ?? {}) }, msg);
      shipToSentryLogs("warn", type, msg, ctx ?? {});
    },
    error: (type, msg, errorOrCtx, extra) => {
      const ctx = toContext(errorOrCtx, extra);
      p.error({ type, ...ctx }, msg);
      shipToSentryLogs("error", type, msg, ctx);
      captureToSentry(type, msg, errorOrCtx, extra);
    },
    child: (ctx) => wrap(p.child(ctx)),
  };
}

export const logger: Logger = wrap(basePino);
