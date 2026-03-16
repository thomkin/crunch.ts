import { ServiceDefinition, RpcContext } from "../../../src/types/service";

export interface Request {
  ping?: string;
}

export interface Response {
  pong: string;
  timestamp: string;
}

export const service: ServiceDefinition<Request, Response> = {
  method: "health.isAliveProtected",
  isPublic: false, // No JWT required
  validation: (input: Request) => {
    if (typeof input.ping !== "string") {
      return null;
    }
    return input;
  },
  handler: async (input: Request, ctx: RpcContext): Promise<Response> => {
    return {
      pong: input.ping || "pong",
      timestamp: new Date().toISOString(),
    };
  },
};
