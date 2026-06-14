import { Controller, Get } from '@nestjs/common';
import { SkipThrottle } from '@nestjs/throttler';

@SkipThrottle()
@Controller('health')
export class HealthController {
  @Get()
  check() {
    return { status: 'ok', uptime: Math.floor(process.uptime()), timestamp: Date.now() };
  }
}
