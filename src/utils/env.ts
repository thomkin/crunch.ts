export function getEnv(name: string): string | undefined {
  // @ts-ignore
  if (typeof Deno !== "undefined" && Deno.env) {
    // @ts-ignore
    return Deno.env.get(name);
  }
  if (typeof process !== "undefined" && process.env) {
    return process.env[name];
  }
  // @ts-ignore
  if (typeof Bun !== "undefined" && Bun.env) {
    // @ts-ignore
    return Bun.env[name];
  }
  return undefined;
}
