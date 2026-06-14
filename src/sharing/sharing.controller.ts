import { Controller, Delete, Get, Param, Put, Req, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { SharingService } from './sharing.service';

interface AuthedRequest { user: { sub: string } }

@Controller('sharing')
@UseGuards(JwtAuthGuard)
export class SharingController {
  constructor(private sharing: SharingService) {}

  @Get('acl')
  list(@Req() req: AuthedRequest) {
    return this.sharing.list(req.user.sub);
  }

  @Put('acl/:friendId')
  grant(@Req() req: AuthedRequest, @Param('friendId') friendId: string) {
    return this.sharing.grant(req.user.sub, friendId);
  }

  @Delete('acl/:friendId')
  revoke(@Req() req: AuthedRequest, @Param('friendId') friendId: string) {
    return this.sharing.revoke(req.user.sub, friendId);
  }
}
