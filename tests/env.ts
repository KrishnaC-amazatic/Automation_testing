import * as dotenv from 'dotenv';
dotenv.config({ path: require('path').resolve(__dirname, '../.env') });

export const EXTENSION_FOLDER = process.env.EXTENSION_FOLDER || 'sentinel-extension-chrome-v0.5.52';
export const USER_DATA_DIR = process.env.USER_DATA_DIR || '.playwright-user-data';
export const CHROME_EXE = process.env.CHROME_EXE || '';
export const SENTINEL_EMAIL = process.env.SENTINEL_EMAIL || '';
export const SENTINEL_PASSWORD = process.env.SENTINEL_PASSWORD || '';
