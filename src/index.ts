import { Context } from 'cordis'

async function main(): Promise<void> {
  const ctx = new Context()

  try {
    // Core plugins will be mounted here in later steps.
  } finally {
    await ctx.fiber.dispose()
  }
}

try {
  await main()
} catch (error: unknown) {
  console.error(error)
  process.exitCode = 1
}
