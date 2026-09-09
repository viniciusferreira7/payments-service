import { Logger } from '@nestjs/common';
import type { ShutdownService } from './shutdown.service';

export type ShutdownLogger = {
  info: (obj: object, msg: string) => void;
};

export type ShutdownHandlerOptions = {
  shutdownService: ShutdownService;
  /**
   * How long to keep serving traffic after the readiness probe starts failing,
   * so the cluster can remove this instance from its endpoints before the
   * server stops accepting connections.
   */
  drainDelayMs: number;
  close: () => Promise<void>;
  wait?: (ms: number) => Promise<void>;
  logger?: Logger;
};

const sleep = (ms: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, ms));

export function createShutdownHandler({
  shutdownService,
  drainDelayMs,
  close,
  wait = sleep,
  logger = new Logger('Shutdown'),
}: ShutdownHandlerOptions) {
  let shutdown: Promise<void> | undefined;

  return (signal: string) => {
    if (shutdown) {
      return shutdown;
    }

    shutdown = (async () => {
      logger.log({ signal, drainDelayMs }, '[Shutdown] draining connections');
      shutdownService.markShuttingDown();

      await wait(drainDelayMs);
      await close();

      logger.log({ signal }, '[Shutdown] server closed');
    })();

    return shutdown;
  };
}
