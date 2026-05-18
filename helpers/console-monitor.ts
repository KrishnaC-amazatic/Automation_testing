import { Page } from '@playwright/test';

export interface ConsoleEntry {
  type: string;
  text: string;
}

/**
 * Captures console errors, page errors, and failed HTTP responses
 * for a Playwright page. Attach at test start, inspect at the end.
 */
export class ConsoleMonitor {
  private messages: ConsoleEntry[] = [];

  constructor(page: Page) {
    page.on('console', (msg) => {
      if (['error', 'warning'].includes(msg.type())) {
        this.messages.push({ type: msg.type(), text: msg.text() });
      }
    });

    page.on('pageerror', (err) => {
      this.messages.push({ type: 'pageerror', text: err.message });
    });

    page.on('response', (res) => {
      if (res.status() >= 400) {
        this.messages.push({
          type: `http-${res.status()}`,
          text: `${res.status()} ${res.url()}`,
        });
      }
    });
  }

  /** All captured entries (errors + warnings + HTTP failures). */
  all(): ConsoleEntry[] {
    return [...this.messages];
  }

  /** Only non-warning entries (pageerror, console error, HTTP 4xx/5xx). */
  errors(): ConsoleEntry[] {
    return this.messages.filter((m) => m.type !== 'warning');
  }

  /** Only warning entries. */
  warnings(): ConsoleEntry[] {
    return this.messages.filter((m) => m.type === 'warning');
  }

  /** True when at least one non-warning entry has been captured. */
  hasCriticalErrors(): boolean {
    return this.errors().length > 0;
  }

  /** Reset captured entries. */
  clear(): void {
    this.messages = [];
  }
}
