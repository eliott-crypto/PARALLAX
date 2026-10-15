import { parse } from 'dotenv';
import { existsSync, readFileSync } from 'node:fs';

/** Deployment variables take precedence; an empty template must never mask a saved key. */
export function loadEnvironment(directory = process.cwd()) {
  for (const name of ['.env.local', '.env']) {
    const path = `${directory}/${name}`;
    if (!existsSync(path)) continue;
    for (const [key, value] of Object.entries(parse(readFileSync(path)))) {
      if (!process.env[key]?.trim() && value.trim()) process.env[key] = value;
    }
  }
}
