export enum RpcErrorCode {
  InvalidRequest = 100,
  InvalidMethod = 101,
  MethodNotFound = 102,
  Unauthorized = 103,
  Forbidden = 104,
  ValidationError = 105,
  InternalError = 500,
}

export interface RpcContext {
  userId?: string;
  permissions: Record<string, boolean>;
  params: Record<string, string>; // Path parameters for HTTP routes
  query: Record<string, string>; // Query parameters
  headers: Headers; // Raw headers
}

export interface RpcRequest<TInput = unknown> {
  method: string;
  params: TInput;
  token?: string;
}

export interface RpcResponse<TOutput = unknown> {
  error?: RpcErrorCode | string;
  message?: string;
  result?: TOutput;
}

export type HttpMethod =
  | "GET"
  | "POST"
  | "PUT"
  | "PATCH"
  | "DELETE"
  | "HEAD"
  | "OPTIONS";

export interface ServiceDefinition<TInput, TOutput> {
  method: string; //needed for rpc endpoints, for CRUD it is used to map them into the client
  isPublic?: boolean;
  requiredPermission?: string[];
  handler: (input: TInput, ctx: RpcContext) => Promise<TOutput>;
  validation: (input: TInput) => TInput | null;

  // HTTP specific fields
  httpMethod?: HttpMethod;
  path?: string; // e.g. "/users/:id" or "/static/*"
}

// Internal type for the generated registry
export interface RegisteredService {
  definition: ServiceDefinition<unknown, unknown>;
  // validate: (input: unknown) => unknown; // Typia validation wrapper
}
