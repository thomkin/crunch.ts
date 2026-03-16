import { ServiceDefinition, RpcContext } from "../../../src/types/service";

export interface Request {
  ping?: string;
}

export interface Response {
  pong: string;
  timestamp: string;
}

export const service: ServiceDefinition<Request, Response> = {
  method: "health.isAlive",
  isPublic: true, // No JWT required
  handler: async (input: Request, ctx: RpcContext): Promise<Response> => {
    console.log("Is alive is called thomas ----");
    return {
      pong: input.ping || "pong",
      timestamp: new Date().toISOString(),
    };
  },
};
