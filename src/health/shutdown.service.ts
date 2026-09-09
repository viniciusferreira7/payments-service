import { Injectable } from '@nestjs/common';

/**
 * Tracks whether the process has begun a graceful shutdown so the readiness
 * probe can start failing before the HTTP server stops accepting connections.
 */
@Injectable()
export class ShutdownService {
  private shuttingDown = false;

  markShuttingDown() {
    this.shuttingDown = true;
  }

  get isShuttingDown() {
    return this.shuttingDown;
  }
}
