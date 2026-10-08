import { SetMetadata } from '@nestjs/common';

/** Read by `JwtAuthGuard`; shared so the key is spelled in one place. */
export const IS_PUBLIC_KEY = 'isPublic';

/** Lets a route, or a whole controller, through without a token. */
export const Public = () => SetMetadata(IS_PUBLIC_KEY, true);
