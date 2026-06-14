import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import { timingSafeEqual } from 'crypto';

@Injectable()
export class AdminKeyGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest<any>();
    const configured = process.env.ADMIN_KEY;
    const received = req.headers['x-admin-key'];
    if (!configured || typeof received !== 'string') {
      throw new UnauthorizedException('Invalid admin key');
    }
    const a = Buffer.from(received, 'utf8');
    const b = Buffer.from(configured, 'utf8');
    if (a.length !== b.length || !timingSafeEqual(a, b)) {
      throw new UnauthorizedException('Invalid admin key');
    }
    return true;
  }
}
