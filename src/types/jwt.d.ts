import { FastifyJWT } from '@fastify/jwt';

declare module '@fastify/jwt' {
  interface FastifyJWT {
    payload: {
      userId: string;
      email: string;
      role: 'guest' | 'member' | 'premium_builder' | 'state_admin' | 'super_admin';
      stateId: string | null;
    };
    user: {
      userId: string;
      email: string;
      role: 'guest' | 'member' | 'premium_builder' | 'state_admin' | 'super_admin';
      stateId: string | null;
    };
  }
}

declare module 'fastify' {
  interface FastifyRequest {
    user: FastifyJWT['user'];
  }
}
