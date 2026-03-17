import {
  ServiceDefinition,
  RpcContext,
} from "../../crunch.ts/src/types/service";

export interface Request {
  ping?: string;
}

export interface Response {
  pong: string;
  timestamp: string;
}

export const service: ServiceDefinition<Request, Response> = {
  method: "health.isAlive",
  validation: (input: Request) => {
    if (typeof input.ping !== "string") {
      return null;
    }
    return input;
  },
  isPublic: true, // No JWT required
  handler: async (input: Request, ctx: RpcContext): Promise<Response> => {
    return {
      pong: input.ping || "pong",
      timestamp: new Date().toISOString(),
    };
  },
};
