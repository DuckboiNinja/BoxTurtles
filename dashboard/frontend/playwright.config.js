import { defineConfig } from '@playwright/test';
import { existsSync, mkdirSync, mkdtempSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const python = path.join(root, '.venv', process.platform === 'win32' ? 'Scripts/python.exe' : 'bin/python');
const testRoot = path.join(root, '.tools', 'e2e-data');
mkdirSync(testRoot, { recursive: true });
const data = mkdtempSync(path.join(testRoot, 'run-'));
const interpreter = existsSync(python) ? python : process.platform === 'win32' ? 'python' : 'python3';

export default defineConfig({
  testDir: './tests', fullyParallel: false, workers: 1, retries: 0, timeout: 45000,
  reporter: 'list',
  use: { baseURL: 'http://127.0.0.1:8011', browserName: 'chromium', viewport: { width: 1440, height: 1000 }, screenshot: 'only-on-failure', trace: 'retain-on-failure' },
  webServer: {
    command: `"${interpreter}" -m uvicorn backend.app.main:app --host 127.0.0.1 --port 8011`,
    cwd: root, url: 'http://127.0.0.1:8011/api/health', reuseExistingServer: false, timeout: 60000,
    env: { TURTLE_DATA_DIR: data, TURTLE_SEED_DEMO: 'true' },
  },
});
