import { ServiceDefinition } from "../../../src/types/service";

export interface Request {}
export interface Response {
  status: string;
  timestamp: number;
}

export const service: ServiceDefinition<Request, Response> = {
  method: "health.isAliveHttp",
  httpMethod: "GET",
  path: "/health",
  isPublic: true,
  handler: async () => {
    return {
      status: "alive",
      timestamp: Date.now(),
    };
  },
};
