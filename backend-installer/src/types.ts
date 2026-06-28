import '@fastify/jwt';

/** payload ที่เก็บใน JWT */
export interface AuthPayload {
  userId: string;
  hospitalId: string;
  hospitalCode: string;
  role: 'user' | 'admin' | 'viewer';
  name: string;
}

declare module '@fastify/jwt' {
  interface FastifyJWT {
    payload: AuthPayload;
    user: AuthPayload;
  }
}

declare module 'fastify' {
  interface FastifyRequest {
    auth?: AuthPayload;
  }
}
