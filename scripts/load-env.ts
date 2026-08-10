import { existsSync } from 'node:fs'
import { resolve } from 'node:path'

/** Load .env.local then .env, matching Next's precedence, for standalone CLI scripts. */
export function loadEnv(): void {
  for (const file of ['.env.local', '.env']) {
    const path = resolve(process.cwd(), file)
    if (existsSync(path)) {
      try {
        process.loadEnvFile(path)
      } catch (error) {
        console.warn(`Could not read ${file}:`, error instanceof Error ? error.message : error)
      }
    }
  }
}
