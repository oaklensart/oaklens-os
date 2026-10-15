import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    setupFiles: ['./tests/setup.js'],
    include: ['tests/**/*.test.js'],
    // A test that parses a page (dev/field-console.html) in happy-dom must not
    // make happy-dom fetch the page's stylesheet and scripts: there is no
    // server, so every run printed six ECONNREFUSED traces from localhost:3000
    // (maintenance review 2026-10-15, H1). The suite reads files from disk; it
    // never needs the browser to load them.
    environmentOptions: {
      happyDOM: {
        settings: {
          disableCSSFileLoading: true,
          disableJavaScriptFileLoading: true,
          handleDisabledFileLoadingAsSuccess: true,
        },
      },
    },
  },
});
